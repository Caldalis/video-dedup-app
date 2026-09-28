import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rename, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  SAMPLING_RANDOM_RANGE,
  TIME_JUMP_AMPLITUDE,
  TIME_JUMP_PERIOD,
  type ProcessingOptions,
} from '../shared/options'
import { zhCN, type ProcessorText } from '../shared/i18n/zh-CN'
import type { LogKind, MediaInfo, ProgressInfo, Stage } from '../shared/types'
import { FFmpegError, ProcessingCancelled, ProcessingError } from './errors'
import { availableEncoders, runCapture } from './ffmpeg'
import { buildVideoFilters } from './filters'
import { probeMedia, timeToSeconds } from './probe'
import { formatCommand, LineSplitter, randomString } from './util'

// 能内嵌封面缩略图的格式：MP4 用 attached_pic 视频流，MKV 用附件。
// MOV、AVI、FLV、WMV、WebM 的 FFmpeg 封装器不支持封面（会报错、丢弃，或写成一条普通视频轨）
const COVER_AS_ATTACHED_PIC = ['.mp4', '.m4v']
const COVER_AS_ATTACHMENT = ['.mkv']

// FFmpeg 输出中说明失败原因的行，以及行首 "[mp4 @ 0x77a5010280] " 这类前缀
const ERROR_LINE_RE = /error|could not|unable|invalid|not supported|failed|no such|denied|not permitted/i
const LOG_PREFIX_RE = /^(\[[^\]]* @ 0x[0-9a-fA-F]+\] )+/
// 结束时 FFmpeg 仍会输出一行 "frame=  480 fps=... time=00:00:16.00 ..." 的统计，它不是失败原因
const STATS_LINE_RE = /^(frame|size)=.*time=/

export interface ProcessorEvents {
  log?: (message: string, kind: LogKind) => void
  progress?: (progress: ProgressInfo) => void
  stage?: (stage: Stage) => void
}

interface RunOptions {
  /** 视频时长，不为空时按 FFmpeg 报告的进度计算百分比 */
  duration?: number | null
  /** 为 true 时不把 FFmpeg 的输出写入日志，只在出错时显示原因 */
  quiet?: boolean
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

/**
 * 写入随机的注释，让每次输出文件的 MD5 都不同。
 * 原视频的标题和日期不带到输出文件中：-metadata 的值为空时删除这一项
 */
function metadataArgs(): string[] {
  return ['-metadata', `comment=${randomString(16)}`, '-metadata', 'title=', '-metadata', 'date=']
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size
  } catch {
    return 0
  }
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'video-dedup-'))
}

/**
 * 执行一次视频处理：调用 run() 开始，处理过程中可以随时调用 cancel()。
 * 只调用 FFmpeg，不涉及界面；日志和错误信息使用 text 中的文字，默认是中文
 */
export class VideoProcessor {
  readonly ffmpegPath: string
  private readonly events: ProcessorEvents
  private readonly text: ProcessorText
  private cancelled = false
  private child: ChildProcess | null = null

  constructor(ffmpegPath: string, events: ProcessorEvents = {}, text: ProcessorText = zhCN.processor) {
    this.ffmpegPath = ffmpegPath
    this.events = events
    this.text = text
  }

  /** 取消处理：结束正在运行的 FFmpeg */
  cancel(): void {
    this.cancelled = true
    const child = this.child
    if (child && isRunning(child)) {
      child.kill('SIGTERM')
      // FFmpeg 收到结束信号后通常会立即退出，5 秒后还没退出就强制结束
      setTimeout(() => {
        if (isRunning(child)) child.kill('SIGKILL')
      }, 5000).unref()
    }
  }

  /**
   * 处理视频。结果先写入输出目录下的临时文件，全部完成后再改名为输出文件：
   * 失败或取消时不会留下半成品，也不会破坏已经存在的同名文件
   */
  async run(options: ProcessingOptions): Promise<void> {
    const text = this.text
    this.checkCancelled()
    this.log(text.input(options.inputPath))
    this.log(text.output(options.outputPath))
    this.setStage('probe')
    let info: MediaInfo
    try {
      info = await probeMedia(this.ffmpegPath, options.inputPath, (child) => this.track(child))
    } catch (error) {
      throw new ProcessingError(text.cannotRunFFmpeg((error as Error).message), { cause: error })
    }
    this.checkCancelled()
    if (!info.hasVideo) {
      throw new ProcessingError(info.error ? text.cannotReadInput(info.error) : text.noVideo)
    }
    if (info.duration) {
      this.log(text.duration(info.duration.toFixed(2)))
    } else {
      this.log(text.noDuration)
    }

    const { dir, name, ext } = path.parse(options.outputPath)
    const token = randomString(6)
    const tempVideo = path.join(dir, `${name}.tmp-${token}${ext}`)
    const tempCover = path.join(dir, `${name}.tmp-${token}-cover${ext}`)
    try {
      const filters = buildVideoFilters(options)
      this.logFeatures(options)
      if (filters.length > 0) {
        await this.encode(options, info, filters, tempVideo)
      } else {
        await this.copyStreams(options, info, tempVideo)
      }
      const result = await this.embedCover(tempVideo, tempCover, info.duration)
      this.checkCancelled()
      this.setStage('finalize')
      try {
        await rename(result, options.outputPath)
      } catch (error) {
        throw new ProcessingError(text.cannotWriteOutput((error as Error).message), { cause: error })
      }
    } finally {
      for (const file of [tempVideo, tempCover]) {
        try {
          await unlink(file)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            this.log(text.tempDeleteFailed(file, (error as Error).message))
          }
        }
      }
    }
    this.log(text.saved)
  }

  /** 读取 FFmpeg 支持的编码器。测试时可以在子类中改写，模拟缺少某个编码器的 FFmpeg */
  protected availableEncoders(): Promise<ReadonlySet<string>> {
    return availableEncoders(this.ffmpegPath)
  }

  private logFeatures(options: ProcessingOptions): void {
    const text = this.text
    if (options.mirror) this.log(text.effectMirror)
    if (options.maskInvert) this.log(text.effectMask(options.maskOpacity))
    if (options.rgbShift) this.log(text.effectRgbShift)
    if (options.timeJump) this.log(text.effectTimeJump(TIME_JUMP_AMPLITUDE, TIME_JUMP_PERIOD))
    if (options.frameSampling) {
      const n = options.samplingInterval
      this.log(options.samplingRandom ? text.effectSamplingRandom(n, n + SAMPLING_RANDOM_RANGE - 1) : text.effectSamplingFixed(n))
    }
  }

  /** 只修改 MD5：直接复制音视频流并写入随机注释，不重新编码，画质无损、速度快 */
  private async copyStreams(options: ProcessingOptions, info: MediaInfo, target: string): Promise<void> {
    this.setStage('copy')
    this.log(this.text.copyOnly)
    try {
      await this.runFFmpeg(['-y', '-i', options.inputPath, '-c', 'copy', ...metadataArgs(), target], {
        duration: info.duration,
      })
    } catch (error) {
      if (!(error instanceof FFmpegError)) throw error
      // 例如输出格式装不下原来的编码（把 WMV 直接复制进 MP4），改为重新编码
      this.log(this.text.copyFallback(path.extname(target), error.message))
      await this.encode(options, info, [], target)
    }
  }

  /** 按滤镜重新编码视频 */
  private async encode(options: ProcessingOptions, info: MediaInfo, filters: string[], target: string): Promise<void> {
    this.setStage('encode')
    this.log(this.text.reencode)
    const ext = path.extname(target).toLowerCase()
    const encoders = await this.availableEncoders()
    // 4:2:0 要求宽高为偶数，宽高本来就是偶数时 crop 不做任何改动
    const vf = [...filters, 'crop=trunc(iw/2)*2:trunc(ih/2)*2']
    const args = ['-y', '-i', options.inputPath, '-vf', vf.join(','), ...metadataArgs()]
    args.push(...this.videoCodecArgs(ext, encoders))
    // 统一输出 4:2:0：RGB偏移、蒙版倒置会让 FFmpeg 选择 4:4:4，很多播放器和硬件解码器放不了
    args.push('-pix_fmt', 'yuv420p')
    // 保留每一帧的显示时间：
    // - FFmpeg 7 以前默认把 MP4 等格式重排成固定帧率，抽掉的帧会被复制前一帧补回来，时间跳跃的偏移也会被舍入掉
    // - 编码器默认使用 1/帧率 的时间基：可变帧率的视频（例如手机拍的、做过时间跳跃的）会有两帧被舍入到
    //   同一时刻，后一帧被丢掉；时间跳跃不足一帧的偏移也会被舍入掉。所以改用与 settb 相同的 1/90000。
    //   FFmpeg 7 起也可以写成 -enc_time_base:v filter，6.x 不支持这种写法
    args.push('-fps_mode', 'vfr')
    if (ext === '.avi') {
      // AVI 只能以帧为单位记录时间
      if (options.timeJump) this.log(this.text.aviTimeJump)
    } else {
      args.push('-enc_time_base:v', '1/90000')
    }
    if (info.hasAudio) {
      args.push(...(await this.audioCodecArgs(options.inputPath, ext, encoders)))
    }
    args.push(target)
    await this.runFFmpeg(args, { duration: info.duration })
  }

  private videoCodecArgs(ext: string, encoders: ReadonlySet<string>): string[] {
    if (ext === '.webm') {
      // WebM 只能装 VP8/VP9/AV1，这里用 VP9，crf 32 的画质与 H.264 的 crf 23 相近
      if (!encoders.has('libvpx-vp9')) {
        throw new ProcessingError(this.text.noVp9)
      }
      return ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1']
    }
    if (!encoders.has('libx264')) {
      throw new ProcessingError(this.text.noX264)
    }
    // veryfast 的耗时约为 ultrafast 的 1.5 倍，输出文件却只有它的 1/3 到 1/2
    const args = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']
    if (ext === '.avi') {
      // AVI 不记录显示时间，B 帧的解码延迟会让画面比声音晚约 2 帧
      args.push('-bf', '0')
    }
    return args
  }

  /** 音频能直接复制就复制，避免再次有损压缩；输出格式不支持原音频编码时才重新编码 */
  private async audioCodecArgs(input: string, ext: string, encoders: ReadonlySet<string>): Promise<string[]> {
    if (await this.canCopyAudio(input, ext)) {
      this.log(this.text.audioCopy)
      return ['-c:a', 'copy']
    }
    if (ext === '.webm') {
      for (const name of ['libopus', 'libvorbis']) {
        if (encoders.has(name)) {
          this.log(this.text.audioReencode(ext, name))
          return ['-c:a', name]
        }
      }
      throw new ProcessingError(this.text.noWebmAudio)
    }
    this.log(this.text.audioReencode(ext, 'AAC'))
    return ['-c:a', 'aac']
  }

  /** 把 0.5 秒音频直接复制到同格式的临时文件中，由 FFmpeg 判断输出格式是否支持原音频编码 */
  private async canCopyAudio(input: string, ext: string): Promise<boolean> {
    const dir = await makeTempDir()
    try {
      const probeFile = path.join(dir, `audio${ext}`)
      const args = ['-v', 'error', '-nostdin', '-y', '-i', input, '-t', '0.5', '-vn', '-sn', '-dn', '-c:a', 'copy', probeFile]
      const result = await runCapture(this.ffmpegPath, args, { timeoutMs: 60_000, onSpawn: (child) => this.track(child) })
      this.checkCancelled()
      return result.code === 0 && (await fileSize(probeFile)) > 0
    } catch (error) {
      if (error instanceof ProcessingCancelled) throw error
      return false
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** 从视频中截一帧作为封面嵌入文件，返回最终文件的路径。截图或嵌入失败时返回原视频，不影响处理结果 */
  private async embedCover(video: string, target: string, duration: number | null): Promise<string> {
    const ext = path.extname(video).toLowerCase()
    if (!COVER_AS_ATTACHED_PIC.includes(ext) && !COVER_AS_ATTACHMENT.includes(ext)) {
      this.log(this.text.noCoverSupport(ext))
      return video
    }
    this.checkCancelled()
    this.setStage('cover')
    this.log(this.text.coverGenerating)
    const dir = await makeTempDir()
    const thumbnail = path.join(dir, 'cover.jpg')
    try {
      // 从第 1 秒处取图，不足 2 秒的短视频取中间
      const seek = !duration || duration >= 2 ? 1 : duration / 2
      await this.runFFmpeg(
        ['-y', '-ss', seek.toFixed(3), '-i', video, '-frames:v', '1', '-an', '-vf', 'thumbnail,setsar=1', '-q:v', '2', thumbnail],
        { quiet: true },
      )
      if ((await fileSize(thumbnail)) === 0) throw new FFmpegError(this.text.noThumbnail)
      const args = COVER_AS_ATTACHED_PIC.includes(ext)
        ? ['-y', '-i', video, '-i', thumbnail, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:1', 'attached_pic', target]
        : ['-y', '-i', video, '-map', '0', '-c', 'copy', '-attach', thumbnail,
           '-metadata:s:t', 'mimetype=image/jpeg', '-metadata:s:t', 'filename=cover.jpg', target]
      await this.runFFmpeg(args, { quiet: true })
    } catch (error) {
      if (!(error instanceof FFmpegError)) throw error
      this.log(this.text.coverFailed(error.message))
      return video
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    this.log(this.text.coverEmbedded)
    return target
  }

  /**
   * 运行 FFmpeg 并逐行读取输出。duration 不为空时按 -progress 报告的时间计算进度；
   * quiet 为 true 时不把输出写入日志，只在出错时显示原因
   */
  private runFFmpeg(args: string[], { duration = null, quiet = false }: RunOptions = {}): Promise<void> {
    this.checkCancelled()
    // -nostats 关掉 stderr 中不断刷新的进度行，改由 -progress 把进度写到 stdout
    const fullArgs = ['-hide_banner', '-nostdin', '-nostats', '-progress', 'pipe:1', ...args]
    // FFmpeg 的完整路径在程序启动时已经显示过，这里只写 ffmpeg，免得命令太长
    this.log(this.text.command(formatCommand(['ffmpeg', ...fullArgs])), 'command')

    return new Promise((resolve, reject) => {
      const recent: string[] = []
      const stderr = new LineSplitter((line) => {
        if (!STATS_LINE_RE.test(line)) {
          recent.push(line)
          if (recent.length > 20) recent.shift()
        }
        if (!quiet) this.log(line, 'ffmpeg')
      })
      let fields = new Map<string, string>()
      const stdout = new LineSplitter((line) => {
        const eq = line.indexOf('=')
        if (eq < 0) return
        const key = line.slice(0, eq).trim()
        fields.set(key, line.slice(eq + 1).trim())
        // 每组进度信息以 progress=continue 结束，全部完成时以 progress=end 结束
        if (key === 'progress') {
          if (!quiet) this.reportProgress(fields, duration)
          fields = new Map()
        }
      })

      let spawnError: Error | null = null
      const child = spawn(this.ffmpegPath, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      // 按 UTF-8 解码，元数据是 GBK 等其他编码时，无法解码的字节会变成 �，不会出错
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => stdout.push(chunk))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk))
      child.once('error', (error) => (spawnError = error))
      child.once('close', (code, signal) => {
        stdout.flush()
        stderr.flush()
        if (this.cancelled) {
          reject(new ProcessingCancelled())
        } else if (spawnError) {
          reject(new ProcessingError(this.text.cannotRunFFmpeg(spawnError.message), { cause: spawnError }))
        } else if (code !== 0) {
          // 只显示说明原因的几行；找不到时显示最后几行输出
          const reasons = recent.filter((line) => ERROR_LINE_RE.test(line)).map((line) => line.replace(LOG_PREFIX_RE, ''))
          const detail = (reasons.length > 0 ? reasons.slice(-4) : recent.slice(-3)).join('\n')
          const status = this.text.ffmpegExit(code, signal)
          reject(new FFmpegError(`${status}${detail ? `\n${detail}` : ''}`))
        } else {
          resolve()
        }
      })
      this.track(child)
    })
  }

  private reportProgress(fields: Map<string, string>, duration: number | null): void {
    // out_time_us 和名字有误的 out_time_ms 都以微秒为单位；还没有输出画面时可能是 N/A 或负数
    const micros = Number(fields.get('out_time_us') ?? fields.get('out_time_ms'))
    const time = Number.isFinite(micros) ? micros / 1e6 : timeToSeconds(fields.get('out_time') ?? '')
    if (!(time >= 0)) return
    const speed = Number.parseFloat(fields.get('speed') ?? '')
    // 最后一帧的时间比视频时长少一帧，最后一组进度信息直接算作 100%
    const done = fields.get('progress') === 'end'
    this.events.progress?.({
      percent: duration ? (done ? 100 : Math.min(100, Math.floor((time / duration) * 100))) : null,
      time,
      speed: Number.isFinite(speed) ? speed : null,
    })
  }

  /** 记下正在运行的 FFmpeg，取消时结束它；如果启动的同时已经点了取消，立即结束 */
  private track(child: ChildProcess): void {
    this.child = child
    child.once('close', () => {
      if (this.child === child) this.child = null
    })
    if (this.cancelled) child.kill('SIGTERM')
  }

  private checkCancelled(): void {
    if (this.cancelled) throw new ProcessingCancelled()
  }

  private log(message: string, kind: LogKind = 'info'): void {
    this.events.log?.(message, kind)
  }

  private setStage(stage: Stage): void {
    this.events.stage?.(stage)
  }
}

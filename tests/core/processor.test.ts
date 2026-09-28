// VideoProcessor 集成测试：用真实的 FFmpeg 处理测试素材，逐项检查每个功能的实际效果
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { FFmpegError, ProcessingCancelled, ProcessingError } from '../../src/core/errors'
import { VideoProcessor } from '../../src/core/processor'
import { en } from '../../src/shared/i18n/en'
import { DEFAULT_FEATURES, type FeatureOptions } from '../../src/shared/options'
import type { ProgressInfo, Stage } from '../../src/shared/types'
import {
  FFMPEG,
  channelShifts,
  displayGeometry,
  ffmpeg,
  ffmpegProcesses,
  fileMd5,
  firstFrameTime,
  fixture,
  frameTimes,
  globalMetadata,
  inspectFile,
  leftovers,
  lumaRange,
  matroskaDocType,
  packets,
  psnr,
  streamMd5,
} from '../helpers/media'

const BASE = path.join(os.tmpdir(), 'video-dedup-app-tests')
mkdirSync(BASE, { recursive: true })
const OUT = mkdtempSync(path.join(BASE, 'out-'))
afterAll(() => rmSync(OUT, { recursive: true, force: true }))

const NONE: FeatureOptions = { ...DEFAULT_FEATURES, timeJump: false, md5Change: false }

interface Result {
  out: string
  logs: string[]
  progress: ProgressInfo[]
  stages: Stage[]
}

/** 处理一次测试素材，返回输出文件和处理过程中的日志、进度、步骤 */
async function run(input: string, outputName: string, features: Partial<FeatureOptions>, Processor = VideoProcessor): Promise<Result> {
  const result: Result = { out: path.join(OUT, outputName), logs: [], progress: [], stages: [] }
  rmSync(result.out, { force: true })
  const processor = new Processor(FFMPEG, {
    log: (message) => result.logs.push(message),
    progress: (progress) => result.progress.push(progress),
    stage: (stage) => result.stages.push(stage),
  })
  await processor.run({ ...NONE, ...features, inputPath: fixture(input), outputPath: result.out })
  return result
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const gaps = (list: number[]) => list.slice(1).map((value, i) => value - list[i])

/** 被抽掉的帧的序号（按 fps 把显示时间换算成帧序号） */
function droppedFrames(file: string, fps: number, total: number): number[] {
  const kept = new Set(frameTimes(file).map((t) => Math.round(t * fps)))
  return range(total).filter((i) => !kept.has(i))
}

function audioCodecs(file: string): string[] {
  return inspectFile(file)
    .streams.filter((s) => s.type === 'Audio')
    .map((s) => s.codec)
}

describe('视频抽帧', () => {
  it('固定间隔：每 5 帧抽掉 1 帧，保留下来的帧时间戳不变（音画同步）', async () => {
    const { out } = await run('s30.mp4', 'samp_fixed.mp4', { frameSampling: true, samplingInterval: 5, samplingRandom: false })
    const times = frameTimes(out)
    const dropped = droppedFrames(out, 30, 480)
    expect(times).toHaveLength(384)
    expect(dropped.slice(0, 4)).toEqual([4, 9, 14, 19])
    expect(gaps(dropped).every((gap) => gap === 5)).toBe(true)
    expect(times.every((t) => Math.abs(t - Math.round(t * 30) / 30) < 0.002)).toBe(true)
  })

  it('随机间隔：每次的间隔都在 5~10 帧之间，两次处理抽掉的位置不同', async () => {
    const patterns: string[] = []
    for (const i of [1, 2]) {
      const { out } = await run('s30.mp4', `samp_rand${i}.mp4`, { frameSampling: true, samplingInterval: 5, samplingRandom: true })
      const dropped = droppedFrames(out, 30, 480)
      expect(dropped.length).toBeGreaterThan(40)
      expect(dropped[0]).toBeGreaterThanOrEqual(4)
      expect(gaps(dropped).every((gap) => gap >= 5 && gap <= 10)).toBe(true)
      patterns.push(dropped.join(','))
    }
    expect(patterns[0]).not.toBe(patterns[1])
  })
})

describe('蒙版倒置', () => {
  it('会改变画面，不透明度越大改动越大；0.5 时画面变成均匀的灰色', async () => {
    const light = await run('s30.mp4', 'mask_0.03.mp4', { maskInvert: true, maskOpacity: 0.03 })
    const half = await run('s30.mp4', 'mask_0.5.mp4', { maskInvert: true, maskOpacity: 0.5 })
    const p03 = psnr(fixture('s30.mp4'), light.out)
    const p05 = psnr(fixture('s30.mp4'), half.out)
    expect(p03).toBeGreaterThan(25)
    expect(p03).toBeLessThan(45)
    expect(p05).toBeLessThan(15)
    const luma = lumaRange(half.out)
    expect(luma.max - luma.min).toBeLessThanOrEqual(4)
  })
})

describe('RGB偏移与像素格式', () => {
  it('输出 4:2:0 的 H.264（High），不是 High 4:4:4', async () => {
    const { out } = await run('s30.mp4', 'rgb.mp4', { rgbShift: true })
    expect(inspectFile(out).streams[0]).toMatchObject({ codec: 'h264', profile: 'High', pixFmt: 'yuv420p' })
  })

  it('红色右移、蓝色下移，绿色不动，任意两个通道在水平、垂直方向上最多错开 1 个像素', async () => {
    const { out } = await run('s30.mp4', 'rgb_shift.mp4', { rgbShift: true })
    const { r, g, b } = channelShifts(fixture('s30.mp4'), out)
    // 输出为 4:2:0，色度分辨率减半，错位会被抹平一部分：实测红色约 0.9、蓝色约 0.3 个像素
    expect(r.x).toBeGreaterThan(0.7)
    expect(b.y).toBeGreaterThan(0.2)
    for (const value of [r.y, g.x, g.y, b.x]) expect(Math.abs(value)).toBeLessThan(0.2)
    for (const [p, q] of [[r, g], [g, b], [r, b]]) {
      expect(Math.abs(p.x - q.x)).toBeLessThanOrEqual(1.1)
      expect(Math.abs(p.y - q.y)).toBeLessThanOrEqual(1.1)
    }
  })

  it('奇数宽高（641x361、4:4:4）的源也能处理，并裁成偶数', async () => {
    const { out } = await run('odd.mkv', 'odd.mp4', { rgbShift: true })
    expect(inspectFile(out).streams[0]).toMatchObject({ width: 640, height: 360, pixFmt: 'yuv420p' })
  })
})

describe('时间跳跃', () => {
  it.each([
    ['s24.mp4', 24, 288],
    ['s30.mp4', 30, 480],
    ['s60.mp4', 60, 600],
  ])('%s：帧数、平均帧率不变，时长最多相差 0.04 秒，帧间隔按正弦规律波动，音频直接复制', async (name, fps, frames) => {
    const { out, logs } = await run(name, `tj_${fps}.mp4`, { timeJump: true, md5Change: true })
    const list = packets(out).sort((a, b) => a.pts - b.pts)
    const times = list.map((p) => p.pts)
    const duration = times.at(-1)! + list.at(-1)!.duration - times[0]
    const expected = (i: number) => i / fps + 0.04 * Math.sin((2 * Math.PI * (i / fps)) / 8)
    const maxError = Math.max(...times.map((t, i) => Math.abs(t - expected(i))))
    const intervals = gaps(times).map((gap) => gap * 1000)

    expect(times).toHaveLength(frames)
    expect(Math.abs(frames / duration - fps) / fps).toBeLessThan(0.005)
    expect(Math.abs(duration - frames / fps)).toBeLessThanOrEqual(0.045)
    expect(maxError).toBeLessThan(0.002)
    expect(Math.max(...intervals) - Math.min(...intervals)).toBeGreaterThan((1000 / fps) * 0.05)
    expect(streamMd5(out, 'a:0')).toBe(streamMd5(fixture(name), 'a:0'))
    expect(logs).toContain('音频直接复制，不重新编码')
  })
})

describe('可变帧率', () => {
  it('可变帧率的视频（例如做过时间跳跃的）只做镜像时不丢帧，每一帧的时间不变', async () => {
    const source = frameTimes(fixture('vfr.mp4'))
    const { out } = await run('vfr.mp4', 'vfr_mirror.mp4', { mirror: true })
    const result = frameTimes(out)
    expect(result).toHaveLength(source.length)
    expect(Math.max(...result.map((t, i) => Math.abs(t - source[i])))).toBeLessThan(0.0005)
  })
})

describe('只修改MD5值', () => {
  it('直接复制音视频流（逐包相同），文件 MD5 改变', async () => {
    const { out, stages } = await run('s30.mp4', 'md5only.mp4', { md5Change: true })
    const source = fixture('s30.mp4')
    expect(stages).toContain('copy')
    expect(stages).not.toContain('encode')
    expect(streamMd5(out, 'v:0')).toBe(streamMd5(source, 'v:0'))
    expect(streamMd5(out, 'a:0')).toBe(streamMd5(source, 'a:0'))
    expect(fileMd5(out)).not.toBe(fileMd5(source))
  })

  it('写入随机注释，每次输出的文件都不同；原视频的标题和日期不带到输出文件中', async () => {
    const input = path.join(OUT, 'tagged.mp4')
    const tag = ffmpeg(['-v', 'error', '-y', '-i', fixture('s30.mp4'), '-c', 'copy',
      '-metadata', 'title=原标题', '-metadata', 'date=2020', '-metadata', 'comment=原注释', input])
    expect(tag.status).toBe(0)
    expect(globalMetadata(input)).toMatchObject({ title: '原标题', date: '2020', comment: '原注释' })

    const outputs: string[] = []
    for (const [name, features] of [
      ['meta_copy1.mp4', { md5Change: true }],
      ['meta_copy2.mp4', { md5Change: true }],
      ['meta_encode.mp4', { mirror: true }],
    ] as const) {
      const out = path.join(OUT, name)
      rmSync(out, { force: true })
      await new VideoProcessor(FFMPEG).run({ ...NONE, ...features, inputPath: input, outputPath: out })
      const tags = globalMetadata(out)
      expect(tags.comment).toMatch(/^[A-Za-z0-9]{16}$/)
      expect(tags).not.toHaveProperty('title')
      expect(tags).not.toHaveProperty('date')
      outputs.push(out)
    }
    const [first, second] = outputs
    expect(globalMetadata(first).comment).not.toBe(globalMetadata(second).comment)
    expect(fileMd5(first)).not.toBe(fileMd5(second))
  })

  it('输出格式装不下原来的编码（WMV→MP4）时自动改为重新编码', async () => {
    const { out, logs } = await run('in.wmv', 'wmv_to.mp4', { md5Change: true })
    expect(inspectFile(out).majorBrand).toBe('isom')
    expect(logs.some((line) => line.includes('改为重新编码'))).toBe(true)
  })

  it('处理本工具的输出（带封面）时只取正片，结果仍然只有一条正片和一张封面', async () => {
    const first = await run('s30.mp4', 'again_1.mp4', { mirror: true })
    for (const [name, features] of [
      ['again_copy.mp4', { md5Change: true }],
      ['again_encode.mp4', { rgbShift: true }],
    ] as const) {
      const result = path.join(OUT, name)
      rmSync(result, { force: true })
      await new VideoProcessor(FFMPEG).run({ ...NONE, ...features, inputPath: first.out, outputPath: result })
      const streams = inspectFile(result).streams
      expect(streams.filter((s) => s.type === 'Video' && !s.attachedPic)).toHaveLength(1)
      expect(streams.filter((s) => s.attachedPic)).toHaveLength(1)
      expect(streams.filter((s) => s.type === 'Audio')).toHaveLength(1)
    }
  })
})

describe('各种输出格式', () => {
  it.each(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.flv', '.wmv'])(
    '%s：实际封装格式与扩展名一致，只为支持的格式嵌入封面，音频能复制就复制',
    async (ext) => {
      const source = ext === '.mp4' ? 's30.mp4' : `in${ext}`
      const { out, logs } = await run(source, `c${ext}`, { timeJump: true, md5Change: true })
      const info = inspectFile(out)
      const formatChecks: Record<string, () => void> = {
        '.mp4': () => expect(info.majorBrand).toBe('isom'),
        '.m4v': () => expect(info.majorBrand).toMatch(/^(M4V|isom|mp42)$/),
        '.mov': () => expect(info.majorBrand).toBe('qt'),
        '.mkv': () => expect(matroskaDocType(out)).toBe('matroska'),
        '.webm': () => expect(matroskaDocType(out)).toBe('webm'),
        '.avi': () => expect(info.formats).toBe('avi'),
        '.flv': () => expect(info.formats).toBe('flv'),
        '.wmv': () => expect(info.formats).toBe('asf'),
      }
      formatChecks[ext]()

      const wantCover = ['.mp4', '.m4v', '.mkv'].includes(ext)
      expect(info.streams.filter((s) => s.attachedPic)).toHaveLength(wantCover ? 1 : 0)
      expect(info.streams.filter((s) => s.type === 'Video' && !s.attachedPic)).toHaveLength(1)

      const audio = audioCodecs(out)
      const copied = logs.includes('音频直接复制，不重新编码')
      expect(audio).toHaveLength(1)
      expect(audio[0] === audioCodecs(fixture(source))[0]).toBe(copied)

      if (ext === '.avi') {
        // AVI 关闭 B 帧，免得画面比声音晚；x264 会把编码参数写进视频流
        expect(readFileSync(out).includes('bframes=0')).toBe(true)
      }
      if (ext === '.webm') {
        expect(info.streams.find((s) => s.type === 'Video')?.codec).toBe('vp9')
        expect(audio).toEqual(['opus'])
      }
    },
  )

  it('跨格式：AAC 放不进 WebM 时改为 Opus', async () => {
    const { out } = await run('s30.mp4', 'aac_to.webm', { mirror: true })
    expect(audioCodecs(out)).toEqual(['opus'])
  })
})

describe('音画同步', () => {
  // 按解码后的画面和声音计算：ASF 中的 H.264 数据包没有显示时间，只能解码后才知道
  const offset = (file: string) => firstFrameTime(file, 'v') - firstFrameTime(file, 'a')

  it.each(['.mp4', '.mkv', '.avi', '.flv', '.wmv'])('%s：画面相对声音的偏移与原片一致（±25ms）', async (ext) => {
    const { out } = await run('s30.mp4', `sync${ext}`, { mirror: true })
    expect(Math.abs(offset(out) - offset(fixture('s30.mp4')))).toBeLessThanOrEqual(0.025)
  })
})

describe('其他情况', () => {
  it('GBK 编码的元数据：处理成功，无法解码的字节显示为 �', async () => {
    const { out, logs } = await run('gbk.mkv', 'gbk_out.mkv', { timeJump: true, md5Change: true })
    expect(existsSync(out)).toBe(true)
    expect(logs.some((line) => line.includes('�'))).toBe(true)
  })

  it('进度：按视频时长计算百分比，逐步增加到 100%；依次经过各个步骤', async () => {
    const { out, logs, progress, stages } = await run('s30.mp4', 'progress.mp4', { mirror: true })
    const percents = progress.map((p) => p.percent ?? -1)
    expect(logs).toContain('时长：16.00 秒')
    expect(percents.at(-1)).toBe(100)
    expect(percents).toEqual([...percents].sort((a, b) => a - b))
    expect(progress.every((p) => p.speed === null || p.speed > 0)).toBe(true)
    expect(stages).toEqual(['probe', 'encode', 'cover', 'finalize'])
    expect(audioCodecs(out)).toEqual(['aac'])
  })
})

describe('各种输入', () => {
  it('文件名和目录中有空格、中文、括号、#、%、&、引号和 emoji 时也能处理', async () => {
    const dir = path.join(OUT, '我的 视频 (2026) #1')
    mkdirSync(dir, { recursive: true })
    const input = path.join(dir, "旅行 vlog [终版] 50% & 'x' 🎬.mp4")
    const output = path.join(dir, "输出 #2 100% & 'y' 🎬.mp4")
    copyFileSync(fixture('s30.mp4'), input)
    await new VideoProcessor(FFMPEG).run({ ...NONE, mirror: true, md5Change: true, inputPath: input, outputPath: output })
    const streams = inspectFile(output).streams
    expect(streams.filter((s) => s.type === 'Video' && !s.attachedPic)).toHaveLength(1)
    expect(streams.filter((s) => s.attachedPic)).toHaveLength(1)
    expect(leftovers(dir)).toEqual([])
  })

  it('只有 1 秒的短视频：从中间取封面，处理成功', async () => {
    const { out, logs } = await run('short.mp4', 'short_out.mp4', { mirror: true })
    expect(logs).toContain('已嵌入封面缩略图')
    expect(inspectFile(out).streams.filter((s) => s.attachedPic)).toHaveLength(1)
    expect(frameTimes(out)).toHaveLength(30)
  })

  it('带旋转信息的竖拍视频：重新编码后画面方向不变，只改 MD5 时保留旋转信息', async () => {
    expect(displayGeometry(fixture('rotated.mp4'))).toMatchObject({ width: 360, height: 640 })
    const encoded = await run('rotated.mp4', 'rotated_mirror.mp4', { mirror: true })
    expect(displayGeometry(encoded.out)).toMatchObject({ width: 360, height: 640 })
    const copied = await run('rotated.mp4', 'rotated_md5.mp4', { md5Change: true })
    expect(displayGeometry(copied.out)).toMatchObject({ rotation: 90, width: 360, height: 640 })
  })

  it.each(['.mkv', '.mp4'])('带字幕的 MKV 输出为 %s：处理成功，画面和声音完整', async (ext) => {
    for (const [label, features] of [
      ['mirror', { mirror: true }],
      ['md5', { md5Change: true }],
    ] as const) {
      const { out } = await run('sub.mkv', `sub_${label}${ext}`, features)
      const streams = inspectFile(out).streams
      expect(streams.filter((s) => s.type === 'Video' && !s.attachedPic)).toHaveLength(1)
      expect(streams.filter((s) => s.type === 'Audio')).toHaveLength(1)
    }
  })
})

describe('错误处理', () => {
  it('输入文件不存在：提示无法读取', async () => {
    await expect(run('no-such-file.mp4', 'err.mp4', { mirror: true })).rejects.toThrow(/^无法读取输入文件：.*No such file/)
  })

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    '输出目录没有写入权限：给出原因，不留下临时文件',
    async () => {
      const dir = path.join(OUT, 'readonly')
      mkdirSync(dir, { recursive: true })
      chmodSync(dir, 0o555)
      try {
        const error = await new VideoProcessor(FFMPEG)
          .run({ ...NONE, mirror: true, inputPath: fixture('s30.mp4'), outputPath: path.join(dir, 'out.mp4') })
          .catch((e: Error) => e)
        expect(error).toBeInstanceOf(FFmpegError)
        expect((error as Error).message).toMatch(/Permission denied/)
        expect(leftovers(dir)).toEqual([])
      } finally {
        chmodSync(dir, 0o755)
      }
    },
  )

  it('不是视频的文件：提示无法读取，并带上 FFmpeg 给出的原因', async () => {
    const error = await run('bad.mp4', 'err.mp4', { mirror: true }).catch((e: Error) => e)
    expect(error).toBeInstanceOf(ProcessingError)
    expect((error as Error).message).toMatch(/^无法读取输入文件：.*Invalid data found/)
  })

  it('只有声音的文件：提示没有视频画面', async () => {
    await expect(run('audio_only.m4a', 'err.mp4', { mirror: true })).rejects.toThrow('输入文件中没有视频画面')
  })

  it('FFmpeg 失败时给出原因，已存在的同名文件不被破坏，也不留下临时文件', async () => {
    const existing = path.join(OUT, 'keep.xyz')
    writeFileSync(existing, 'previous result')
    const processor = new VideoProcessor(FFMPEG)
    const error = await processor
      .run({ ...NONE, mirror: true, inputPath: fixture('s30.mp4'), outputPath: existing })
      .catch((e: Error) => e)
    expect(error).toBeInstanceOf(FFmpegError)
    expect((error as Error).message).toMatch(/output format|Unable to/i)
    expect((error as Error).message).not.toMatch(/Metadata|Duration/)
    expect(readFileSync(existing, 'utf8')).toBe('previous result')
    expect(leftovers(OUT)).toEqual([])
  })

  it('缺少 VP9 编码器时提示改用 MP4', async () => {
    class NoVp9Processor extends VideoProcessor {
      protected override async availableEncoders(): Promise<ReadonlySet<string>> {
        const all = await super.availableEncoders()
        return new Set([...all].filter((name) => name !== 'libvpx-vp9'))
      }
    }
    await expect(run('s30.mp4', 'noenc.webm', { mirror: true }, NoVp9Processor)).rejects.toThrow(/libvpx-vp9.*\.mp4/)
  })

  it('找不到 FFmpeg 时给出明确的提示', async () => {
    const processor = new VideoProcessor(path.join(OUT, 'no-such-ffmpeg'))
    await expect(
      processor.run({ ...NONE, mirror: true, inputPath: fixture('s30.mp4'), outputPath: path.join(OUT, 'x.mp4') }),
    ).rejects.toThrow(/^无法运行 FFmpeg/)
  })
})

describe('取消', () => {
  it('处理中途取消：很快结束，不留下 FFmpeg 进程和临时文件，已存在的同名文件不被破坏', async () => {
    const target = path.join(OUT, 'cancel.mp4')
    writeFileSync(target, 'previous result')
    const processor = new VideoProcessor(FFMPEG)
    const running = processor.run({ ...NONE, timeJump: true, md5Change: true, inputPath: fixture('long.mp4'), outputPath: target })
    running.catch(() => {})
    await sleep(2500)
    const before = ffmpegProcesses(OUT)
    const started = performance.now()
    processor.cancel()
    await expect(running).rejects.toBeInstanceOf(ProcessingCancelled)
    const seconds = (performance.now() - started) / 1000

    if (process.platform !== 'win32') expect(before.length).toBeGreaterThan(0)
    expect(seconds).toBeLessThan(6)
    await sleep(300)
    expect(ffmpegProcesses(OUT)).toEqual([])
    expect(leftovers(OUT)).toEqual([])
    expect(readFileSync(target, 'utf8')).toBe('previous result')
  })

  it('开始前就取消：不执行处理', async () => {
    const target = path.join(OUT, 'c0.mp4')
    const processor = new VideoProcessor(FFMPEG)
    processor.cancel()
    await expect(
      processor.run({ ...NONE, mirror: true, inputPath: fixture('s30.mp4'), outputPath: target }),
    ).rejects.toBeInstanceOf(ProcessingCancelled)
    expect(existsSync(target)).toBe(false)
    expect(leftovers(OUT)).toEqual([])
  })
})

describe('界面语言', () => {
  it('传入英文的文字时，日志和错误信息都是英文（执行的命令、FFmpeg 自己的输出原样显示）', async () => {
    const logs: string[] = []
    const events = { log: (message: string, kind: string) => kind !== 'ffmpeg' && logs.push(message) }
    const out = path.join(OUT, 'english.mp4')
    await new VideoProcessor(FFMPEG, events, en.processor).run({
      ...NONE,
      mirror: true,
      md5Change: true,
      inputPath: fixture('short.mp4'),
      outputPath: out,
    })
    expect(logs).toContain('Effect: mirror')
    expect(logs).toContain('Cover thumbnail embedded')
    expect(logs).toContain('Output file saved')
    expect(logs.some((line) => line.startsWith('Command: ffmpeg '))).toBe(true)
    expect(logs.filter((line) => /\p{Script=Han}/u.test(line))).toEqual([])
    await expect(
      new VideoProcessor(FFMPEG, {}, en.processor).run({
        ...NONE,
        mirror: true,
        inputPath: fixture('audio_only.m4a'),
        outputPath: path.join(OUT, 'english-err.mp4'),
      }),
    ).rejects.toThrow('The input file has no video')
  })
})

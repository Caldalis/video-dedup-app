// 测试用的 FFmpeg、测试素材，以及只用 FFmpeg 就能完成的各种检查（不需要 FFprobe）
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { locateFFmpeg } from '../../src/core/ffmpeg'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** 随 ffmpeg-static 安装的 FFmpeg */
export const BUNDLED_FFMPEG = path.join(
  ROOT,
  'node_modules',
  'ffmpeg-static',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
)

/** 测试使用的 FFmpeg，查找顺序与程序相同：环境变量 VIDEO_DEDUP_FFMPEG、ffmpeg-static、系统中安装的 FFmpeg */
export const FFMPEG = (() => {
  const location = locateFFmpeg([BUNDLED_FFMPEG])
  if (!location) throw new Error('找不到 FFmpeg：请先执行 pnpm install，或用环境变量 VIDEO_DEDUP_FFMPEG 指定')
  return location.path
})()

export interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

/** 同步运行 FFmpeg（自动加上 -hide_banner） */
export function ffmpeg(args: string[]): RunResult {
  const result = spawnSync(FFMPEG, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.error) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

export const FFMPEG_VERSION = /ffmpeg version (\S+)/.exec(ffmpeg(['-version']).stdout)?.[1] ?? 'unknown'

/** 测试素材按 FFmpeg 分目录保存，换用其他 FFmpeg 测试时会重新生成 */
export const FIXTURES_DIR = path.join(
  os.tmpdir(),
  'video-dedup-app-tests',
  `fixtures-${createHash('sha1').update(`${FFMPEG}\n${FFMPEG_VERSION}`).digest('hex').slice(0, 10)}`,
)

export function fixture(name: string): string {
  return path.join(FIXTURES_DIR, name)
}

// FFmpeg 用 INT64_MIN 表示没有时间戳
const NO_PTS = -(2n ** 63n)

export interface Packet {
  /** 显示时间（秒） */
  pts: number
  /** 时长（秒） */
  duration: number
}

/** 读取某个流中每个数据包的显示时间和时长（直接复制流，不解码，时间戳保持原样） */
export function packets(file: string, spec = 'v:0'): Packet[] {
  const result = ffmpeg(['-v', 'error', '-copyts', '-i', file, '-map', `0:${spec}`, '-c', 'copy', '-f', 'framemd5', '-'])
  if (result.status !== 0) throw new Error(`读取数据包失败: ${result.stderr}`)
  let timeBase = 1
  const list: Packet[] = []
  for (const line of result.stdout.split(/\r?\n/)) {
    const tb = /^#tb \d+: (\d+)\/(\d+)/.exec(line)
    if (tb) {
      timeBase = Number(tb[1]) / Number(tb[2])
    } else if (line && !line.startsWith('#')) {
      // stream_index, dts, pts, duration, size, hash；没有显示时间的数据包（例如 ASF 中的 H.264）跳过
      const fields = line.split(',').map((field) => field.trim())
      const pts = BigInt(fields[2])
      if (pts !== NO_PTS) list.push({ pts: Number(pts) * timeBase, duration: Number(fields[3]) * timeBase })
    }
  }
  return list
}

/** 解码后第一帧画面（v）或声音（a）的显示时间，也就是播放器开始显示它的时间 */
export function firstFrameTime(file: string, type: 'v' | 'a'): number {
  const filter = type === 'v' ? 'showinfo' : 'ashowinfo'
  const { stderr } = ffmpeg([
    '-copyts', '-i', file, '-map', `0:${type}:0`, `-filter:${type}`, filter, `-frames:${type}`, '1', '-f', 'null', '-',
  ])
  const time = /pts_time:(-?[\d.]+)/.exec(stderr)?.[1]
  if (time === undefined) throw new Error(`读取第一帧的时间失败: ${stderr}`)
  return Number(time)
}

/** 画面各帧的显示时间（秒），从小到大排列 */
export function frameTimes(file: string): number[] {
  return packets(file)
    .map((packet) => packet.pts)
    .sort((a, b) => a - b)
}

/** 某个流全部数据包的 MD5，用来判断流是否被原样复制 */
export function streamMd5(file: string, spec: string): string {
  const result = ffmpeg(['-v', 'error', '-i', file, '-map', `0:${spec}`, '-c', 'copy', '-f', 'md5', '-'])
  return result.stdout.trim()
}

export function fileMd5(file: string): string {
  return createHash('md5').update(readFileSync(file)).digest('hex')
}

export interface StreamDescription {
  type: string
  codec: string
  profile: string | null
  pixFmt: string | null
  width: number | null
  height: number | null
  attachedPic: boolean
}

export interface FileDescription {
  /** 例如 "mov,mp4,m4a,3gp,3g2,mj2"、"matroska,webm"、"avi" */
  formats: string
  /** MP4 / MOV 的 major_brand，例如 "isom"、"qt" */
  majorBrand: string
  streams: StreamDescription[]
}

/** 从 ffmpeg -i 的输出中读取封装格式和各个流的编码 */
export function inspectFile(file: string): FileDescription {
  const { stderr } = ffmpeg(['-i', file])
  const streams = [...stderr.matchAll(/Stream #0:\d+[^:]*: (\w+): (.*)/g)].map(([, type, desc]) => {
    const head = /^([\w-]+)(?: \(([^)]*)\))?/.exec(desc)
    const size = /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,[]|$)/.exec(desc)
    const pixFmt = /, ((?:yuvj?|gbr|rgb|bgr|nv|p0|gray)\w*)/.exec(desc)
    return {
      type,
      codec: head?.[1] ?? '',
      profile: head?.[2] ?? null,
      pixFmt: pixFmt?.[1] ?? null,
      width: size ? Number(size[1]) : null,
      height: size ? Number(size[2]) : null,
      attachedPic: desc.includes('(attached pic)'),
    }
  })
  return {
    formats: /Input #0, (.+?), from '/.exec(stderr)?.[1] ?? '',
    majorBrand: /major_brand\s*:\s*(\S+)/.exec(stderr)?.[1] ?? '',
    streams,
  }
}

/** 文件的全局元数据：ffmpeg -i 的输出中，Duration 之前的 Metadata 部分 */
export function globalMetadata(file: string): Record<string, string> {
  const { stderr } = ffmpeg(['-i', file])
  const head = stderr.slice(0, stderr.indexOf('  Duration:'))
  return Object.fromEntries([...head.matchAll(/^ {4}(\w+)\s*: (.*)$/gm)].map(([, key, value]) => [key, value]))
}

/** 画面的旋转角度（没有旋转信息时为 0），以及按旋转后的方向播放时的宽高 */
export function displayGeometry(file: string): { rotation: number; width: number; height: number } {
  const { stderr } = ffmpeg(['-i', file])
  // FFmpeg 7 及以前写作 "displaymatrix: rotation of 90.00 degrees"，8 以后写作 "Display Matrix: ..."
  const rotation = Number(/display ?matrix: rotation of (-?[\d.]+) degrees/i.exec(stderr)?.[1] ?? 0)
  const video = inspectFile(file).streams.find((s) => s.type === 'Video' && !s.attachedPic)!
  const turned = Math.abs(rotation) % 180 === 90
  return { rotation, width: turned ? video.height! : video.width!, height: turned ? video.width! : video.height! }
}

/** Matroska 和 WebM 的 FFmpeg 解封装器相同，要看文件头里的 DocType 才能区分 */
export function matroskaDocType(file: string): string {
  const head = readFileSync(file).subarray(0, 64).toString('latin1')
  return head.includes('webm') ? 'webm' : head.includes('matroska') ? 'matroska' : ''
}

/** 两个视频画面的平均 PSNR（dB），完全相同时返回 99 */
export function psnr(a: string, b: string): number {
  const { stderr } = ffmpeg(['-i', a, '-i', b, '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'])
  const value = /average:(\S+)/.exec(stderr)?.[1] ?? 'nan'
  return value === 'inf' ? 99 : Number(value)
}

/** 第一帧画面亮度的最小值和最大值 */
export function lumaRange(file: string): { min: number; max: number } {
  const { stderr } = ffmpeg(['-i', file, '-vf', 'signalstats,metadata=print', '-frames:v', '1', '-f', 'null', '-'])
  return {
    min: Number(/YMIN=(\d+)/.exec(stderr)?.[1]),
    max: Number(/YMAX=(\d+)/.exec(stderr)?.[1]),
  }
}

export interface Shift {
  /** 水平位移，向右为正 */
  x: number
  /** 垂直位移，向下为正 */
  y: number
}

/** 解码前 frames 帧画面，返回 RGB24 数据 */
function rgbFrames(file: string, frames: number): Buffer {
  const args = ['-v', 'error', '-i', file, '-frames:v', String(frames), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
  const result = spawnSync(FFMPEG, args, { maxBuffer: 256 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`解码画面失败: ${result.stderr.toString()}`)
  return result.stdout
}

/**
 * 处理后的画面中，红、绿、蓝各通道相对原画面的位移（像素）。
 * 对前几帧在 ±4 像素内找误差最小的整数位移，再用过最小值和相邻两点的抛物线求出小数部分
 */
export function channelShifts(original: string, processed: string, frames = 3): { r: Shift; g: Shift; b: Shift } {
  const video = (file: string) => inspectFile(file).streams.find((s) => s.type === 'Video' && !s.attachedPic)!
  const { width, height } = video(original)
  const other = video(processed)
  if (other.width !== width || other.height !== height) throw new Error('两个视频的宽高不同')
  const w = width!
  const h = height!
  const a = rgbFrames(original, frames)
  const b = rgbFrames(processed, frames)
  const count = Math.min(a.length, b.length) / (w * h * 3)
  const range = 4
  const side = 2 * range + 1
  // 避开画面边缘：rgbashift 在边缘重复最外面一行（列）像素
  const margin = range + 4
  const vertex = (prev: number, mid: number, next: number) => {
    const curve = prev - 2 * mid + next
    return curve > 0 ? (prev - next) / (2 * curve) : 0
  }
  const shift = (channel: number): Shift => {
    // err[(dy + range) * side + dx + range]：处理后的 (x, y) 与原画面的 (x - dx, y - dy) 之差的平方和
    const err = new Float64Array(side * side)
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        let sum = 0
        for (let f = 0; f < count; f++) {
          for (let y = margin; y < h - margin; y++) {
            const row = (f * h + y) * w
            const from = (f * h + y - dy) * w - dx
            for (let x = margin; x < w - margin; x++) {
              const d = b[(row + x) * 3 + channel] - a[(from + x) * 3 + channel]
              sum += d * d
            }
          }
        }
        err[(dy + range) * side + dx + range] = sum
      }
    }
    let best = 0
    for (let i = 1; i < err.length; i++) if (err[i] < err[best]) best = i
    const ix = best % side
    const iy = Math.floor(best / side)
    const fx = ix > 0 && ix < side - 1 ? vertex(err[best - 1], err[best], err[best + 1]) : 0
    const fy = iy > 0 && iy < side - 1 ? vertex(err[best - side], err[best], err[best + side]) : 0
    return { x: ix - range + fx, y: iy - range + fy }
  }
  return { r: shift(0), g: shift(1), b: shift(2) }
}

/** 目录中残留的临时文件 */
export function leftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes('.tmp-'))
}

/** 命令行中含有 text 的 FFmpeg 进程（Windows 上不检查，返回空列表） */
export function ffmpegProcesses(text: string): string[] {
  if (process.platform === 'win32') return []
  const result = spawnSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' })
  return result.stdout
    .split('\n')
    .filter((line) => line.includes(text) && /ffmpeg/i.test(line) && !line.includes(' ps -'))
}

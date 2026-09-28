import type { ChildProcess } from 'node:child_process'
import type { AudioStreamInfo, MediaInfo, VideoStreamInfo } from '../shared/types'
import { ProcessingError } from './errors'
import { runCapture } from './ffmpeg'

/** 把 FFmpeg 输出的 HH:MM:SS.mmm 转换为秒数，无法解析时返回 -1 */
export function timeToSeconds(text: string): number {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (!match) return -1
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function parseVideoStream(desc: string): VideoStreamInfo {
  const size = /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,[]|$)/.exec(desc)
  const fps = /(\d+(?:\.\d+)?)(k?) fps/.exec(desc)
  return {
    codec: /^[\w-]+/.exec(desc)?.[0] ?? '',
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    fps: fps ? Number(fps[1]) * (fps[2] ? 1000 : 1) : null,
    rotation: 0,
  }
}

function parseAudioStream(desc: string): AudioStreamInfo {
  const rate = /(\d+) Hz/.exec(desc)
  return {
    codec: /^[\w-]+/.exec(desc)?.[0] ?? '',
    sampleRate: rate ? Number(rate[1]) : null,
    channels: /\d+ Hz, ([^,]+)/.exec(desc)?.[1]?.trim() ?? null,
  }
}

/**
 * 从 ffmpeg -i 的输出中读取时长和各个流的信息，例如
 *   Duration: 00:01:23.45, start: 0.000000, bitrate: 1234 kb/s
 *   Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 30 fps, ...
 *   Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s
 */
export function parseMediaInfo(stderr: string): MediaInfo {
  const info: MediaInfo = { duration: null, hasVideo: false, hasAudio: false, video: null, audio: null, error: '' }
  const duration = /Duration: (\d+:\d+:\d+(?:\.\d+)?)/.exec(stderr)
  if (duration && timeToSeconds(duration[1]) > 0) {
    info.duration = timeToSeconds(duration[1])
  }
  // 正在读取的是不是第一条正片视频流：它下面的 Side data 中可能有旋转信息
  let inFirstVideo = false
  for (const line of stderr.split(/\r?\n/)) {
    const stream = /Stream #0:\d+[^:]*: (\w+): (.*)$/.exec(line)
    if (stream) {
      const [, type, desc] = stream
      inFirstVideo = false
      // 封面图（例如 MP4 里的缩略图、MP3 的专辑图）也显示为 Video 流，不算画面
      if (type === 'Video' && !desc.includes('(attached pic)')) {
        info.hasVideo = true
        if (!info.video) {
          info.video = parseVideoStream(desc)
          inFirstVideo = true
        }
      } else if (type === 'Audio') {
        info.hasAudio = true
        info.audio ??= parseAudioStream(desc)
      }
      continue
    }
    // FFmpeg 7 及以前写作 "displaymatrix: rotation of 90.00 degrees"，8 以后写作 "Display Matrix: ..."
    const rotation = /display ?matrix: rotation of (-?[\d.]+) degrees/i.exec(line)
    if (rotation && inFirstVideo && info.video) {
      const video = info.video
      video.rotation = Number(rotation[1])
      if (Math.abs(Math.round(video.rotation)) % 180 === 90) [video.width, video.height] = [video.height, video.width]
    }
  }
  if (!stderr.includes('Input #0')) {
    // 文件没能打开（不是视频文件、已损坏等），最后一行是原因，例如
    // "Error opening input files: Invalid data found when processing input"
    const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    info.error = lines.at(-1) ?? '未知错误'
  }
  return info
}

/** 用 FFmpeg 读取视频时长，以及是否包含画面和声音 */
export async function probeMedia(
  ffmpegPath: string,
  file: string,
  onSpawn?: (child: ChildProcess) => void,
): Promise<MediaInfo> {
  let result
  try {
    result = await runCapture(ffmpegPath, ['-hide_banner', '-nostdin', '-i', file], { timeoutMs: 60_000, onSpawn })
  } catch (error) {
    throw new ProcessingError(`无法运行 FFmpeg：${(error as Error).message}`, { cause: error })
  }
  return parseMediaInfo(result.stderr)
}

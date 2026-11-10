// 处理核心、主进程和界面之间传递的数据类型（都可以序列化，能直接通过 IPC 传递）

export interface VideoStreamInfo {
  codec: string
  /** 播放时的宽高：带旋转信息的视频（例如手机竖拍的）已经按旋转后的方向换算 */
  width: number | null
  height: number | null
  fps: number | null
  /** 旋转信息中的角度，没有旋转信息时为 0 */
  rotation: number
}

export interface AudioStreamInfo {
  codec: string
  sampleRate: number | null
  channels: string | null
}

export interface MediaInfo {
  /** 秒，读取不到时为 null */
  duration: number | null
  hasVideo: boolean
  hasAudio: boolean
  /** 第一条正片视频流（不含封面图） */
  video: VideoStreamInfo | null
  /** 第一条音频流 */
  audio: AudioStreamInfo | null
  /** 无法读取文件时 FFmpeg 给出的原因；能读取，或者 FFmpeg 没有给出原因时为空字符串 */
  error: string
}

/** 日志的类别：普通说明、执行的命令、FFmpeg 自己的输出 */
export type LogKind = 'info' | 'command' | 'ffmpeg'

/** 处理进行到的步骤：读取视频信息、重新编码、直接复制音视频流、嵌入封面、保存 */
export type Stage = 'probe' | 'encode' | 'copy' | 'cover' | 'finalize'

/** 批量处理中每个文件的状态：等待处理、正在处理、成功、失败、取消、因取消而未处理 */
export type FilePhase = 'pending' | 'running' | 'ok' | 'failed' | 'cancelled' | 'skipped'

/** 一个文件在批量处理中的最终结果 */
export interface FileOutcome {
  /** 在本次处理列表中的序号，从 0 开始 */
  index: number
  inputPath: string
  outputPath: string
  status: Exclude<FilePhase, 'pending' | 'running'>
  /** status 为 failed 时的原因 */
  message?: string
  /** status 为 ok 时的用时（秒） */
  seconds?: number
}

/** 汇总批量处理结果：成功、失败，以及取消或跳过的文件 */
export function countOutcomes(outcomes: readonly FileOutcome[]): {
  succeeded: number
  failed: number
  remaining: number
} {
  let succeeded = 0
  let failed = 0
  let remaining = 0
  for (const outcome of outcomes) {
    if (outcome.status === 'ok') succeeded++
    else if (outcome.status === 'failed') failed++
    else remaining++
  }
  return { succeeded, failed, remaining }
}

export interface ProgressInfo {
  /** 0~100 的整数，不知道视频时长时为 null */
  percent: number | null
  /** 已处理到的视频时间（秒） */
  time: number
  /** 处理速度是播放速度的多少倍，FFmpeg 没有给出时为 null */
  speed: number | null
}

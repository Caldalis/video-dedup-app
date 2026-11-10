import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { zhCN, type ProcessorText } from '../shared/i18n/zh-CN'
import type { FeatureOptions, ProcessingOptions } from '../shared/options'
import type { FileOutcome, LogKind, ProgressInfo, Stage } from '../shared/types'
import { ProcessingCancelled } from './errors'
import { defaultOutputPath } from './files'
import { VideoProcessor } from './processor'

export interface BatchItem {
  inputPath: string
  outputPath: string
}

export interface BatchOptions extends FeatureOptions {
  items: BatchItem[]
}

export interface BatchProcessorEvents {
  log?: (index: number, message: string, kind: LogKind) => void
  progress?: (index: number, progress: ProgressInfo) => void
  stage?: (index: number, stage: Stage) => void
  fileStart?: (index: number, item: BatchItem) => void
  fileFinished?: (outcome: FileOutcome) => void
}

export interface BatchSummary {
  /** 每个文件的结果，包括取消后没有处理的文件（状态为 skipped） */
  outcomes: FileOutcome[]
  seconds: number
  cancelled: boolean
}

/**
 * 比较文件用的键：存在的文件用 inode，能识别符号链接、硬链接和大小写不敏感的文件系统；
 * 还不存在的文件（例如还没有生成的输出）用所在目录的真实路径加文件名。
 */
export function fileKey(file: string): string {
  const resolved = path.resolve(file)
  try {
    const stat = statSync(resolved, { bigint: true })
    if (stat.ino !== 0n) return `ino:${stat.dev}:${stat.ino}`
  } catch {
    // 文件还不存在，按路径比较
  }
  let dir = path.dirname(resolved)
  try {
    dir = realpathSync(dir)
  } catch {
    // 所在目录也不存在时，直接使用规范化后的路径
  }
  const key = path.join(dir, path.basename(resolved))
  return process.platform === 'win32' || process.platform === 'darwin' ? key.toLowerCase() : key
}

/**
 * 规划每个输入文件的输出路径：输出到 outputDir（没有指定时输出到原文件所在目录），
 * 文件名末尾加 _dedup。输出不会与列表中的任何输入文件相同，也不会互相相同，
 * 重名时依次加 _2、_3，避免覆盖还没处理的输入文件。
 */
export function planBatchOutputs(inputs: readonly string[], outputDir: string | null): BatchItem[] {
  const taken = new Set(inputs.map(fileKey))
  return inputs.map((inputPath) => {
    const { dir, name, ext } = path.parse(inputPath)
    const folder = outputDir ?? dir
    let candidate = outputDir ? path.join(folder, `${name}_dedup${ext}`) : defaultOutputPath(inputPath)
    for (let n = 2; taken.has(fileKey(candidate)); n++) {
      candidate = path.join(folder, `${name}_dedup_${n}${ext}`)
    }
    taken.add(fileKey(candidate))
    return { inputPath, outputPath: candidate }
  })
}

/**
 * 按顺序处理多个视频。单个文件失败时继续处理后面的文件，取消时结束当前文件、
 * 不再处理剩余文件。每个文件仍然由 VideoProcessor 完成，临时文件、覆盖保护和清理规则不变
 */
export class BatchProcessor {
  readonly ffmpegPath: string
  private readonly events: BatchProcessorEvents
  private readonly text: ProcessorText
  private cancelled = false
  private current: VideoProcessor | null = null

  constructor(ffmpegPath: string, events: BatchProcessorEvents = {}, text: ProcessorText = zhCN.processor) {
    this.ffmpegPath = ffmpegPath
    this.events = events
    this.text = text
  }

  /** 取消整个批量处理：结束正在运行的 FFmpeg，剩余文件不再处理 */
  cancel(): void {
    this.cancelled = true
    this.current?.cancel()
  }

  async run(options: BatchOptions): Promise<BatchSummary> {
    const started = performance.now()
    const outcomes: FileOutcome[] = []
    const total = options.items.length
    for (let index = 0; index < total; index++) {
      const item = options.items[index]
      if (this.cancelled) {
        outcomes.push({ index, ...item, status: 'skipped' })
        continue
      }

      this.events.log?.(index, this.text.fileHeading(index + 1, total, path.basename(item.inputPath)), 'info')
      this.events.fileStart?.(index, item)
      const processor = new VideoProcessor(
        this.ffmpegPath,
        {
          log: (message, kind) => this.events.log?.(index, message, kind),
          progress: (progress) => this.events.progress?.(index, progress),
          stage: (stage) => this.events.stage?.(index, stage),
        },
        this.text,
      )
      this.current = processor
      const fileStarted = performance.now()
      let outcome: FileOutcome
      try {
        await processor.run(this.processingOptions(options, item))
        outcome = { index, ...item, status: 'ok', seconds: (performance.now() - fileStarted) / 1000 }
      } catch (error) {
        if (error instanceof ProcessingCancelled) {
          this.cancelled = true
          outcome = { index, ...item, status: 'cancelled' }
        } else {
          outcome = {
            index,
            ...item,
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          }
        }
      } finally {
        if (this.current === processor) this.current = null
      }
      outcomes.push(outcome)
      this.events.fileFinished?.(outcome)
    }
    // 取消发生在最后一个文件刚处理完之后时，所有文件都已经完成，按成功汇总
    const cancelled = outcomes.some((outcome) => outcome.status === 'cancelled' || outcome.status === 'skipped')
    return { outcomes, seconds: (performance.now() - started) / 1000, cancelled }
  }

  /** 取出一个文件的处理参数，其余功能和批量处理共用 */
  private processingOptions(options: BatchOptions, item: BatchItem): ProcessingOptions {
    return {
      mirror: options.mirror,
      rgbShift: options.rgbShift,
      timeJump: options.timeJump,
      md5Change: options.md5Change,
      maskInvert: options.maskInvert,
      maskOpacity: options.maskOpacity,
      frameSampling: options.frameSampling,
      samplingInterval: options.samplingInterval,
      samplingRandom: options.samplingRandom,
      removeAudio: options.removeAudio,
      inputPath: item.inputPath,
      outputPath: item.outputPath,
    }
  }
}

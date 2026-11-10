import { app, BrowserWindow, dialog, type WebContents } from 'electron'
import { statSync } from 'node:fs'
import path from 'node:path'
import { BatchProcessor, fileKey, planBatchOutputs, type BatchItem, type BatchOptions } from '../core/batch'
import { ProcessingCancelled } from '../core/errors'
import { isSameFile } from '../core/files'
import { VideoProcessor } from '../core/processor'
import { IPC, type JobEvent, type JobResult, type StartRequest, type StartResponse } from '../shared/ipc'
import { pickFeatureOptions, readStartOptions, validateFeatures, type ProcessingOptions, type StartOptions } from '../shared/options'
import { resolveFFmpeg } from './ffmpeg'
import { t } from './settings'

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** 检查请求并规划每个文件的输出路径；有问题时返回说明（当前界面语言） */
function checkOptions(options: StartOptions): { items: BatchItem[] } | { problem: string } {
  const text = t()
  if (options.inputs.length === 0) return { problem: text.errors.noInput }

  // 用 inode 比较，能识别指向同一个文件的符号链接、硬链接和不同写法
  const inputKeys = new Set<string>()
  for (const input of options.inputs) {
    if (!isFile(input)) return { problem: text.errors.inputMissing(input) }
    const key = fileKey(input)
    if (inputKeys.has(key)) return { problem: text.errors.duplicateInputs }
    inputKeys.add(key)
  }

  // 单个文件必须指定输出路径（来自“另存为”对话框或默认的 _dedup 路径）
  if (options.inputs.length === 1 && !options.outputPath) return { problem: text.errors.noOutput }

  let items: BatchItem[]
  if (options.inputs.length === 1 && options.outputPath) {
    const inputPath = options.inputs[0]
    const outputPath = options.outputPath
    if (isSameFile(inputPath, outputPath)) return { problem: text.errors.sameFile }
    const outputDir = path.dirname(path.resolve(outputPath))
    if (!isDirectory(outputDir)) return { problem: text.errors.outputDirMissing(outputDir) }
    items = [{ inputPath, outputPath }]
  } else {
    if (options.outputDir && !isDirectory(options.outputDir)) {
      return { problem: text.errors.outputDirMissing(options.outputDir) }
    }
    items = planBatchOutputs(options.inputs, options.outputDir)
  }

  // 再检查一次：规划结果不能与任何一个输入文件相同（防止符号链接等别名绕过）
  for (const item of items) {
    if (inputKeys.has(fileKey(item.outputPath))) return { problem: text.errors.outputMatchesInput(item.outputPath) }
  }

  const problem = validateFeatures(options)
  return problem ? { problem: text.problems[problem] } : { items }
}

/** 输出文件已存在时询问是否覆盖。批量处理只询问一次，并列出所有已存在的文件 */
async function confirmOverwrite(items: BatchItem[], sender: WebContents, confirmed: boolean): Promise<boolean> {
  if (confirmed) return true
  const existing = items.map((item) => item.outputPath).filter(isFile)
  if (existing.length === 0) return true

  const window = BrowserWindow.fromWebContents(sender)
  const text = t()
  const box: Electron.MessageBoxOptions =
    items.length === 1
      ? {
          type: 'question',
          title: text.appName,
          buttons: [text.dialogs.overwrite.confirm, text.dialogs.overwrite.cancel],
          defaultId: 1,
          cancelId: 1,
          message: text.dialogs.overwrite.message,
          detail: existing[0],
        }
      : {
          type: 'question',
          title: text.appName,
          buttons: [text.dialogs.overwrite.confirm, text.dialogs.overwrite.cancel],
          defaultId: 1,
          cancelId: 1,
          message: text.dialogs.overwriteBatch.message(existing.length),
          detail: existing.slice(0, 8).join('\n') + (existing.length > 8 ? '\n…' : ''),
        }
  const { response } = window ? await dialog.showMessageBox(window, box) : await dialog.showMessageBox(box)
  return response === 0
}

/** 管理当前的处理任务：同一时间只处理一个视频，或者一个按顺序处理的批量任务 */
export class JobManager {
  private active: VideoProcessor | BatchProcessor | null = null
  /** 正在检查参数或询问是否覆盖，还没有开始处理 */
  private preparing = false
  private idleWaiters: Array<() => void> = []

  get running(): boolean {
    return this.active !== null
  }

  /** 正在处理的是否是批量任务 */
  get batch(): boolean {
    return this.active instanceof BatchProcessor
  }

  /** 检查参数并开始处理。开始后立即返回，处理结果通过 finished 事件发给界面 */
  async start(request: StartRequest, sender: WebContents): Promise<StartResponse> {
    if (this.active || this.preparing) return { status: 'invalid', message: t().errors.busy }
    this.preparing = true
    try {
      return await this.prepareAndStart(request, sender)
    } finally {
      this.preparing = false
    }
  }

  private async prepareAndStart(request: StartRequest, sender: WebContents): Promise<StartResponse> {
    const options = readStartOptions(request?.options)
    const checked = checkOptions(options)
    if ('problem' in checked) return { status: 'invalid', message: checked.problem }
    const ffmpeg = await resolveFFmpeg()
    if (!ffmpeg) return { status: 'invalid', message: t().ffmpeg.missing(process.platform, app.isPackaged) }

    if (!(await confirmOverwrite(checked.items, sender, request.overwriteConfirmed === true))) {
      return { status: 'declined' }
    }

    const send = (event: JobEvent) => {
      if (!sender.isDestroyed()) sender.send(IPC.jobEvent, event)
    }
    // 日志和错误信息使用开始处理时的界面语言
    const text = t()
    const features = pickFeatureOptions(options)
    if (checked.items.length === 1) {
      const [item] = checked.items
      const processingOptions: ProcessingOptions = {
        ...features,
        inputPath: item.inputPath,
        outputPath: item.outputPath,
      }
      const processor = new VideoProcessor(
        ffmpeg.path,
        {
          log: (message, kind) => send({ type: 'log', message, kind }),
          progress: (progress) => send({ type: 'progress', progress }),
          stage: (stage) => send({ type: 'stage', stage }),
        },
        text.processor,
      )
      this.active = processor
      void this.runSingle(processor, processingOptions).then((result) => send({ type: 'finished', result }))
    } else {
      const batchOptions: BatchOptions = { ...features, items: checked.items }
      const batch = new BatchProcessor(
        ffmpeg.path,
        {
          log: (index, message, kind) => send({ type: 'log', message, kind, fileIndex: index }),
          progress: (index, progress) => send({ type: 'progress', progress, fileIndex: index }),
          stage: (index, stage) => send({ type: 'stage', stage, fileIndex: index }),
          fileStart: (index, item) => send({ type: 'fileStart', index, inputPath: item.inputPath, outputPath: item.outputPath }),
          fileFinished: (outcome) => send({ type: 'fileFinished', outcome }),
        },
        text.processor,
      )
      this.active = batch
      void this.runBatch(batch, batchOptions).then((result) => send({ type: 'finished', result }))
    }
    return { status: 'started' }
  }

  private async runSingle(processor: VideoProcessor, options: ProcessingOptions): Promise<JobResult> {
    const started = performance.now()
    try {
      await processor.run(options)
      return { status: 'ok', outputPath: options.outputPath, seconds: (performance.now() - started) / 1000 }
    } catch (error) {
      if (error instanceof ProcessingCancelled) return { status: 'cancelled' }
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
    } finally {
      // 先标记为空闲，界面收到结果后就能立即开始下一次处理
      this.active = null
      this.finishIdle()
    }
  }

  private async runBatch(batch: BatchProcessor, options: BatchOptions): Promise<JobResult> {
    const started = performance.now()
    try {
      const summary = await batch.run(options)
      const seconds = (performance.now() - started) / 1000
      if (summary.cancelled) return { status: 'cancelled', outcomes: summary.outcomes }
      return { status: 'batch', outcomes: summary.outcomes, seconds }
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
    } finally {
      this.active = null
      this.finishIdle()
    }
  }

  /** 取消正在进行的处理 */
  cancel(): void {
    this.active?.cancel()
  }

  /** 等待当前的处理结束（FFmpeg 已退出、临时文件已删除），最多等待 timeoutMs 毫秒 */
  waitIdle(timeoutMs: number): Promise<void> {
    if (!this.active) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      this.idleWaiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private finishIdle(): void {
    for (const resolve of this.idleWaiters.splice(0)) resolve()
  }
}

import { BrowserWindow, dialog, type WebContents } from 'electron'
import { statSync } from 'node:fs'
import path from 'node:path'
import { ProcessingCancelled } from '../core/errors'
import { isSameFile } from '../core/files'
import { VideoProcessor } from '../core/processor'
import { IPC, type JobEvent, type JobResult, type StartRequest, type StartResponse } from '../shared/ipc'
import { DEFAULT_FEATURES, validateFeatures, type ProcessingOptions } from '../shared/options'
import { ffmpegMissingMessage, resolveFFmpeg } from './ffmpeg'

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

/** 界面传来的参数不可信：逐项检查类型，缺少或类型不对的按“未勾选”或无效值处理 */
function readOptions(raw: unknown): ProcessingOptions {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const flag = (key: string) => data[key] === true
  const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '')
  const number = (key: string) => (typeof data[key] === 'number' ? (data[key] as number) : Number.NaN)
  const maskInvert = flag('maskInvert')
  const frameSampling = flag('frameSampling')
  return {
    inputPath: text('inputPath'),
    outputPath: text('outputPath'),
    mirror: flag('mirror'),
    rgbShift: flag('rgbShift'),
    timeJump: flag('timeJump'),
    md5Change: flag('md5Change'),
    maskInvert,
    maskOpacity: maskInvert ? number('maskOpacity') : DEFAULT_FEATURES.maskOpacity,
    frameSampling,
    samplingInterval: frameSampling ? number('samplingInterval') : DEFAULT_FEATURES.samplingInterval,
    samplingRandom: flag('samplingRandom'),
  }
}

/** 开始处理前的检查，返回第一个问题的说明；没有问题时返回 null */
function checkOptions(options: ProcessingOptions): string | null {
  if (!options.inputPath) return '还没有选择视频文件'
  if (!isFile(options.inputPath)) return `找不到输入文件：\n${options.inputPath}`
  if (!options.outputPath) return '还没有设置输出位置'
  if (isSameFile(options.inputPath, options.outputPath)) return '输出文件不能与输入文件相同，请选择其他输出路径'
  const outputDir = path.dirname(path.resolve(options.outputPath))
  if (!isDirectory(outputDir)) return `输出文件夹不存在：\n${outputDir}`
  return validateFeatures(options)
}

/** 管理当前的处理任务：同一时间只处理一个视频 */
export class JobManager {
  private processor: VideoProcessor | null = null
  /** 正在检查参数或询问是否覆盖，还没有开始处理 */
  private preparing = false
  private idleWaiters: Array<() => void> = []

  get running(): boolean {
    return this.processor !== null
  }

  /** 检查参数并开始处理。开始后立即返回，处理结果通过 finished 事件发给界面 */
  async start(request: StartRequest, sender: WebContents): Promise<StartResponse> {
    if (this.processor || this.preparing) return { status: 'invalid', message: '正在处理其他视频，请等待处理完成' }
    this.preparing = true
    try {
      return await this.prepareAndStart(request, sender)
    } finally {
      this.preparing = false
    }
  }

  private async prepareAndStart(request: StartRequest, sender: WebContents): Promise<StartResponse> {
    const options = readOptions(request?.options)
    const problem = checkOptions(options)
    if (problem) return { status: 'invalid', message: problem }
    const ffmpeg = await resolveFFmpeg()
    if (!ffmpeg) return { status: 'invalid', message: ffmpegMissingMessage() }

    // 输出文件已存在且没有在“另存为”对话框中确认过时，先询问是否覆盖
    if (isFile(options.outputPath) && request.overwriteConfirmed !== true) {
      const window = BrowserWindow.fromWebContents(sender)
      const box = {
        type: 'question' as const,
        buttons: ['覆盖', '取消'],
        defaultId: 1,
        cancelId: 1,
        message: '输出文件已存在，是否覆盖？',
        detail: options.outputPath,
      }
      const { response } = window ? await dialog.showMessageBox(window, box) : await dialog.showMessageBox(box)
      if (response !== 0) return { status: 'declined' }
    }

    const send = (event: JobEvent) => {
      if (!sender.isDestroyed()) sender.send(IPC.jobEvent, event)
    }
    const processor = new VideoProcessor(ffmpeg.path, {
      log: (message, kind) => send({ type: 'log', message, kind }),
      progress: (progress) => send({ type: 'progress', progress }),
      stage: (stage) => send({ type: 'stage', stage }),
    })
    this.processor = processor
    void this.run(processor, options).then((result) => send({ type: 'finished', result }))
    return { status: 'started' }
  }

  private async run(processor: VideoProcessor, options: ProcessingOptions): Promise<JobResult> {
    const started = performance.now()
    try {
      await processor.run(options)
      return { status: 'ok', outputPath: options.outputPath, seconds: (performance.now() - started) / 1000 }
    } catch (error) {
      if (error instanceof ProcessingCancelled) return { status: 'cancelled' }
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
    } finally {
      // 先标记为空闲，界面收到结果后就能立即开始下一次处理
      this.processor = null
      for (const resolve of this.idleWaiters.splice(0)) resolve()
    }
  }

  /** 取消正在进行的处理 */
  cancel(): void {
    this.processor?.cancel()
  }

  /** 等待当前的处理结束（FFmpeg 已退出、临时文件已删除），最多等待 timeoutMs 毫秒 */
  waitIdle(timeoutMs: number): Promise<void> {
    if (!this.processor) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      this.idleWaiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

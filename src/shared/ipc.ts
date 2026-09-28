// 主进程与界面之间的通信接口：通道名称、传递的数据，以及 preload 暴露给界面的 window.api
import type { Language } from './i18n/language'
import type { ProcessingOptions } from './options'
import type { LogKind, MediaInfo, ProgressInfo, Stage } from './types'

export const IPC = {
  appInfo: 'app:info',
  getTheme: 'theme:get',
  setTheme: 'theme:set',
  /** 同步读取：preload 在页面脚本运行前取得界面语言 */
  getLanguage: 'language:get',
  setLanguage: 'language:set',
  chooseInput: 'dialog:choose-input',
  chooseOutput: 'dialog:choose-output',
  inspectInput: 'file:inspect',
  md5: 'file:md5',
  startJob: 'job:start',
  cancelJob: 'job:cancel',
  jobEvent: 'job:event',
  menuCommand: 'menu:command',
  showInFolder: 'shell:show-in-folder',
  openFile: 'shell:open-file',
  copyText: 'clipboard:write-text',
} as const

/** 外观：跟随系统、浅色、深色 */
export type ThemeMode = 'system' | 'light' | 'dark'

export interface FFmpegInfo {
  path: string
  version: string | null
  /** env：环境变量 VIDEO_DEDUP_FFMPEG 指定；bundled：随程序提供；system：系统中安装的 */
  source: 'env' | 'bundled' | 'system'
  /** false 表示版本过旧（低于 5.1） */
  supported: boolean
}

export interface AppInfo {
  version: string
  platform: string
  /** 是否是打包后的正式版本：找不到 FFmpeg 时两者的解决办法不同 */
  packaged: boolean
  /** 找不到 FFmpeg 时为 null */
  ffmpeg: FFmpegInfo | null
}

export interface InputFile {
  path: string
  name: string
  size: number
  /** 默认输出路径：原文件所在目录，文件名末尾加 _dedup */
  defaultOutput: string
  /** 找不到 FFmpeg 时为 null */
  media: MediaInfo | null
}

/** 选择的文件不能读取的原因：路径无效、不是文件、读取失败（detail 是系统给出的原因） */
export type InspectFailure = 'invalidPath' | 'notAFile' | 'unreadable'

export type InspectResult = { ok: true; file: InputFile } | { ok: false; reason: InspectFailure; detail?: string }

export type Md5Result = { status: 'ok'; value: string } | { status: 'error'; message: string } | { status: 'aborted' }

/** 计算 MD5 的位置：同一位置开始新的计算时，上一次还没算完的会被取消 */
export type Md5Slot = 'input' | 'output'

export interface StartRequest {
  options: ProcessingOptions
  /** 输出路径是在“另存为”对话框中选的：对话框已经确认过覆盖，不再询问 */
  overwriteConfirmed: boolean
}

export type StartResponse =
  /** 已经开始处理，结果通过 finished 事件发送 */
  | { status: 'started' }
  /** 参数有问题，没有开始处理 */
  | { status: 'invalid'; message: string }
  /** 用户选择不覆盖已存在的输出文件，没有开始处理 */
  | { status: 'declined' }

export type JobResult =
  | { status: 'ok'; outputPath: string; seconds: number }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

/**
 * 处理过程中的事件。处理结果也作为事件发送：同一通道上的消息按发送顺序到达，
 * 结果不会跑到最后几条日志前面
 */
export type JobEvent =
  | { type: 'log'; message: string; kind: LogKind }
  | { type: 'progress'; progress: ProgressInfo }
  | { type: 'stage'; stage: Stage }
  | { type: 'finished'; result: JobResult }

export type MenuCommand = 'open'

export interface Api {
  /** 页面加载时的界面语言；之后的切换由界面自己记录 */
  initialLanguage: Language
  getAppInfo(): Promise<AppInfo>
  getTheme(): Promise<ThemeMode>
  setTheme(mode: ThemeMode): Promise<void>
  /** 切换界面语言：保存选择，并更新菜单等系统界面的文字 */
  setLanguage(language: Language): Promise<void>
  /** 打开选择视频的对话框，取消时返回 null */
  chooseInput(): Promise<string | null>
  /** 打开“另存为”对话框，取消时返回 null */
  chooseOutput(current: string): Promise<string | null>
  inspectInput(path: string): Promise<InspectResult>
  md5(path: string, slot: Md5Slot): Promise<Md5Result>
  /** 停止这个位置上还没算完的 MD5 */
  cancelMd5(slot: Md5Slot): Promise<void>
  startJob(request: StartRequest): Promise<StartResponse>
  /** 询问是否取消正在进行的处理，确认后返回 true */
  cancelJob(): Promise<boolean>
  onJobEvent(listener: (event: JobEvent) => void): () => void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
  showInFolder(path: string): Promise<void>
  /** 用系统默认程序打开文件，失败时返回原因 */
  openFile(path: string): Promise<string>
  copyText(text: string): Promise<void>
  /** 拖入的文件在磁盘上的路径 */
  pathForFile(file: File): string
}

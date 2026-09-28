import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { defaultOutputPath, md5File } from '../core/files'
import { probeMedia } from '../core/probe'
import { IPC, type AppInfo, type InspectResult, type Md5Result, type Md5Slot, type StartRequest } from '../shared/ipc'
import type { MediaInfo } from '../shared/types'
import { ffmpegMissingMessage, resolveFFmpeg } from './ffmpeg'
import type { JobManager } from './job'
import { getTheme, isThemeMode, setTheme } from './settings'

const VIDEO_EXTENSIONS = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v']

function windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function registerIpc(jobs: JobManager): void {
  ipcMain.handle(IPC.appInfo, async (): Promise<AppInfo> => ({
    version: app.getVersion(),
    platform: process.platform,
    ffmpeg: await resolveFFmpeg(),
    ffmpegMissingMessage: ffmpegMissingMessage(),
  }))

  ipcMain.handle(IPC.getTheme, () => getTheme())
  ipcMain.handle(IPC.setTheme, (_event, mode: unknown) => {
    if (isThemeMode(mode)) setTheme(mode)
  })

  ipcMain.handle(IPC.chooseInput, async (event) => {
    const options: Electron.OpenDialogOptions = {
      title: '打开视频',
      properties: ['openFile'],
      filters: [
        { name: '视频文件', extensions: VIDEO_EXTENSIONS },
        { name: '所有文件', extensions: ['*'] },
      ],
    }
    const window = windowOf(event)
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.chooseOutput, async (event, current: unknown) => {
    const defaultPath = isText(current) ? current : undefined
    const ext = defaultPath ? path.extname(defaultPath).slice(1) : ''
    const options: Electron.SaveDialogOptions = {
      title: '选择输出位置',
      defaultPath,
      filters: ext ? [{ name: `.${ext} 文件`, extensions: [ext] }, { name: '所有文件', extensions: ['*'] }] : undefined,
      // macOS 和 Windows 的“另存为”对话框总会确认是否覆盖，Linux 需要打开这个选项
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    }
    const window = windowOf(event)
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  })

  ipcMain.handle(IPC.inspectInput, async (_event, file: unknown): Promise<InspectResult> => {
    if (!isText(file)) return { ok: false, message: '无效的文件路径' }
    let size: number
    try {
      const info = await stat(file)
      if (!info.isFile()) return { ok: false, message: '请选择视频文件，而不是文件夹' }
      size = info.size
    } catch (error) {
      return { ok: false, message: `无法读取文件：${(error as Error).message}` }
    }
    const ffmpeg = await resolveFFmpeg()
    let media: MediaInfo | null = null
    if (ffmpeg) {
      try {
        media = await probeMedia(ffmpeg.path, file)
      } catch (error) {
        media = { duration: null, hasVideo: false, hasAudio: false, video: null, audio: null, error: (error as Error).message }
      }
    }
    return { ok: true, file: { path: file, name: path.basename(file), size, defaultOutput: defaultOutputPath(file), media } }
  })

  // 每个位置（原文件、新文件）同时只算一个 MD5，开始新的计算时取消上一次的；路径为空时只取消
  const hashing = new Map<Md5Slot, AbortController>()
  ipcMain.handle(IPC.md5, async (_event, file: unknown, slot: unknown): Promise<Md5Result> => {
    if (slot !== 'input' && slot !== 'output') return { status: 'error', message: '无效的参数' }
    hashing.get(slot)?.abort()
    if (!isText(file)) return { status: 'aborted' }
    const controller = new AbortController()
    hashing.set(slot, controller)
    try {
      return { status: 'ok', value: await md5File(file, controller.signal) }
    } catch (error) {
      return controller.signal.aborted ? { status: 'aborted' } : { status: 'error', message: (error as Error).message }
    } finally {
      if (hashing.get(slot) === controller) hashing.delete(slot)
    }
  })

  ipcMain.handle(IPC.startJob, (event, request: StartRequest) => jobs.start(request, event.sender))

  ipcMain.handle(IPC.cancelJob, async (event) => {
    if (!jobs.running) return false
    const box = {
      type: 'question' as const,
      buttons: ['取消处理', '继续处理'],
      defaultId: 1,
      cancelId: 1,
      message: '确定要取消当前的处理吗？',
      detail: '已经处理的部分会被丢弃，不会生成输出文件。',
    }
    const window = windowOf(event)
    const { response } = window ? await dialog.showMessageBox(window, box) : await dialog.showMessageBox(box)
    // 确认期间处理可能已经结束
    if (response !== 0 || !jobs.running) return false
    jobs.cancel()
    return true
  })

  ipcMain.handle(IPC.showInFolder, (_event, file: unknown) => {
    if (isText(file)) shell.showItemInFolder(file)
  })
  ipcMain.handle(IPC.openFile, async (_event, file: unknown) => (isText(file) ? shell.openPath(file) : '无效的文件路径'))
  // Electron 44 起主进程的剪贴板接口也是异步的，等写入完成后再返回
  ipcMain.handle(IPC.copyText, async (_event, text: unknown) => {
    if (typeof text === 'string') await clipboard.writeText(text)
  })
}

import { app, BrowserWindow, dialog, screen } from 'electron'
import path from 'node:path'
import type { JobManager } from './job'
import { t, windowBackground } from './settings'

/** 创建主窗口：按屏幕大小确定尺寸；正在处理时关闭窗口（包括 macOS 上的 Command+Q）要先确认 */
export function createMainWindow(jobs: JobManager): BrowserWindow {
  const area = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1180, area.width - 40)
  const height = Math.min(820, area.height - 40)
  const window = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(880, width),
    minHeight: Math.min(600, height),
    show: false,
    // 页面加载后，窗口标题由页面的 <title> 决定，跟随界面语言
    title: t().appName,
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    // macOS：隐藏标题栏，红绿灯按钮嵌在界面顶部
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 26 } } : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  window.once('ready-to-show', () => window.show())

  // 界面只显示本地页面：不打开新窗口，也不跳转到别的页面（例如把文件拖到窗口上时的默认行为）
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') window.webContents.toggleDevTools()
    })
  }

  let confirmed = false
  window.on('close', (event) => {
    if (confirmed || !jobs.running) return
    event.preventDefault()
    void confirmClose()
  })

  let asking = false
  async function confirmClose(): Promise<void> {
    if (asking) return
    asking = true
    const text = t()
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      title: text.appName,
      buttons: [text.dialogs.quit.confirm, text.dialogs.quit.keep],
      defaultId: 1,
      cancelId: 1,
      message: text.dialogs.quit.message,
    })
    asking = false
    if (response !== 0) return
    confirmed = true
    // 先结束 FFmpeg、删除临时文件，再关闭窗口；万一 10 秒内没有结束，也直接关闭
    jobs.cancel()
    await jobs.waitIdle(10_000)
    window.close()
  }

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devServer) {
    void window.loadURL(devServer)
  } else {
    void window.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
  return window
}

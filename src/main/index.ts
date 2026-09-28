import { app, BrowserWindow, session } from 'electron'
import { IPC } from '../shared/ipc'
import { registerIpc } from './ipc'
import { JobManager } from './job'
import { setupMenu } from './menu'
import { loadSettings } from './settings'
import { createMainWindow } from './window'

// 只允许运行一个实例：再次打开时切换到已有的窗口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const jobs = new JobManager()
  let mainWindow: BrowserWindow | null = null

  const openWindow = () => {
    mainWindow = createMainWindow(jobs)
    mainWindow.on('closed', () => (mainWindow = null))
  }

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    loadSettings()
    // 界面不需要摄像头、通知等任何权限
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    registerIpc(jobs)
    setupMenu((command) => mainWindow?.webContents.send(IPC.menuCommand, command))
    openWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow()
    })
  })

  // 只有一个窗口，关闭窗口就退出（macOS 上也是）
  app.on('window-all-closed', () => app.quit())
  // 无论以什么方式退出，都不留下还在运行的 FFmpeg
  app.on('will-quit', () => jobs.cancel())
}

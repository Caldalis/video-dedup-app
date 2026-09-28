// 在界面中暴露 window.api。界面运行在沙箱中，只能通过这里定义的方法与主进程通信
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { isLanguage } from '../shared/i18n/language'
import { IPC, type Api, type JobEvent, type MenuCommand } from '../shared/ipc'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

// 在页面脚本运行前同步读取界面语言，第一次渲染就是正确的语言，不会先显示另一种语言再切换。
// 每次加载页面（包括刷新）都重新读取，拿到的总是当前的设置
const language: unknown = ipcRenderer.sendSync(IPC.getLanguage)

const api: Api = {
  initialLanguage: isLanguage(language) ? language : 'en',
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getTheme: () => ipcRenderer.invoke(IPC.getTheme),
  setTheme: (mode) => ipcRenderer.invoke(IPC.setTheme, mode),
  setLanguage: (value) => ipcRenderer.invoke(IPC.setLanguage, value),
  chooseInput: () => ipcRenderer.invoke(IPC.chooseInput),
  chooseOutput: (current) => ipcRenderer.invoke(IPC.chooseOutput, current),
  inspectInput: (path) => ipcRenderer.invoke(IPC.inspectInput, path),
  md5: (path, slot) => ipcRenderer.invoke(IPC.md5, path, slot),
  cancelMd5: async (slot) => {
    await ipcRenderer.invoke(IPC.md5, '', slot)
  },
  startJob: (request) => ipcRenderer.invoke(IPC.startJob, request),
  cancelJob: () => ipcRenderer.invoke(IPC.cancelJob),
  onJobEvent: (listener) => subscribe<JobEvent>(IPC.jobEvent, listener),
  onMenuCommand: (listener) => subscribe<MenuCommand>(IPC.menuCommand, listener),
  showInFolder: (path) => ipcRenderer.invoke(IPC.showInFolder, path),
  openFile: (path) => ipcRenderer.invoke(IPC.openFile, path),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  pathForFile: (file) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('api', api)

// 在界面中暴露 window.api。界面运行在沙箱中，只能通过这里定义的方法与主进程通信
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type Api, type JobEvent, type MenuCommand } from '../shared/ipc'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: Api = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getTheme: () => ipcRenderer.invoke(IPC.getTheme),
  setTheme: (mode) => ipcRenderer.invoke(IPC.setTheme, mode),
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

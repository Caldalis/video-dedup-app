import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'

/**
 * macOS 使用中文的应用菜单（没有“编辑”菜单时 Command+C/V 不起作用）；
 * Windows 和 Linux 的窗口不显示菜单栏，快捷键由界面处理
 */
export function setupMenu(send: (command: MenuCommand) => void): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const name = app.name
  const template: MenuItemConstructorOptions[] = [
    {
      label: name,
      submenu: [
        { role: 'about', label: `关于${name}` },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏${name}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出${name}` },
      ],
    },
    {
      label: '文件',
      submenu: [
        { label: '打开视频…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '显示',
      submenu: [
        ...(app.isPackaged
          ? []
          : ([
              { role: 'reload', label: '重新载入' },
              { role: 'toggleDevTools', label: '开发者工具' },
              { type: 'separator' },
            ] satisfies MenuItemConstructorOptions[])),
        { role: 'togglefullscreen', label: '切换全屏幕' },
      ],
    },
    {
      label: '窗口',
      role: 'window',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

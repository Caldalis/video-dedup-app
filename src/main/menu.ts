import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'
import { t } from './settings'

let send: (command: MenuCommand) => void = () => {}

/**
 * macOS 使用应用菜单（没有“编辑”菜单时 Command+C/V 不起作用），文字跟随界面语言；
 * Windows 和 Linux 的窗口不显示菜单栏，快捷键由界面处理
 */
export function setupMenu(onCommand: (command: MenuCommand) => void): void {
  send = onCommand
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  rebuildMenu()
}

/**
 * 按当前的界面语言重新生成 macOS 的菜单，以及“关于”面板中的程序名，切换语言后调用。
 * 菜单栏最左边的程序菜单标题总是显示安装包里的程序名，不受这里影响
 */
export function rebuildMenu(): void {
  if (process.platform !== 'darwin') return
  const text = t()
  const name = text.appName
  const menu = text.menu
  app.setAboutPanelOptions({ applicationName: name, applicationVersion: app.getVersion() })
  const template: MenuItemConstructorOptions[] = [
    {
      label: name,
      submenu: [
        { role: 'about', label: menu.about(name) },
        { type: 'separator' },
        { role: 'services', label: menu.services },
        { type: 'separator' },
        { role: 'hide', label: menu.hide(name) },
        { role: 'hideOthers', label: menu.hideOthers },
        { role: 'unhide', label: menu.unhide },
        { type: 'separator' },
        { role: 'quit', label: menu.quit(name) },
      ],
    },
    {
      label: menu.file,
      submenu: [
        { label: menu.open, accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { role: 'close', label: menu.close },
      ],
    },
    {
      label: menu.edit,
      submenu: [
        { role: 'undo', label: menu.undo },
        { role: 'redo', label: menu.redo },
        { type: 'separator' },
        { role: 'cut', label: menu.cut },
        { role: 'copy', label: menu.copy },
        { role: 'paste', label: menu.paste },
        { role: 'selectAll', label: menu.selectAll },
      ],
    },
    {
      label: menu.view,
      submenu: [
        ...(app.isPackaged
          ? []
          : ([
              { role: 'reload', label: menu.reload },
              { role: 'toggleDevTools', label: menu.devTools },
              { type: 'separator' },
            ] satisfies MenuItemConstructorOptions[])),
        { role: 'togglefullscreen', label: menu.fullScreen },
      ],
    },
    {
      label: menu.window,
      role: 'window',
      submenu: [
        { role: 'minimize', label: menu.minimize },
        { role: 'zoom', label: menu.zoom },
        { type: 'separator' },
        { role: 'front', label: menu.front },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

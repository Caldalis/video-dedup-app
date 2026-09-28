import { app, BrowserWindow, nativeTheme } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ThemeMode } from '../shared/ipc'

// 用户设置保存在用户数据目录下的 settings.json 中，目前只有外观
interface Settings {
  theme: ThemeMode
}

let settings: Settings = { theme: 'system' }

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** 窗口背景色与界面背景一致，免得窗口刚打开或调整大小时闪出另一种颜色 */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#0c0e13' : '#f4f5f8'
}

/** 读取设置并应用外观，需要在创建窗口之前调用 */
export function loadSettings(): void {
  try {
    const data = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<Settings>
    if (isThemeMode(data.theme)) settings = { ...settings, theme: data.theme }
  } catch {
    // 第一次运行时还没有设置文件
  }
  nativeTheme.themeSource = settings.theme
  nativeTheme.on('updated', () => {
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(windowBackground())
  })
}

export function getTheme(): ThemeMode {
  return settings.theme
}

/**
 * 切换外观。themeSource 同时决定界面中 prefers-color-scheme 的结果，
 * 以及标题栏、菜单、对话框等系统界面的颜色
 */
export function setTheme(theme: ThemeMode): void {
  settings = { ...settings, theme }
  nativeTheme.themeSource = theme
  try {
    mkdirSync(path.dirname(settingsFile()), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify(settings, null, 2))
  } catch (error) {
    console.error('保存设置失败:', error)
  }
}

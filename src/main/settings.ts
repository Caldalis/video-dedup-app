import { app, BrowserWindow, nativeTheme } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { messages, type Messages } from '../shared/i18n'
import { detectLanguage, isLanguage, type Language } from '../shared/i18n/language'
import type { ThemeMode } from '../shared/ipc'

// 用户设置保存在用户数据目录下的 settings.json 中：外观，以及手动选择过的界面语言
interface Settings {
  theme: ThemeMode
  /** 没有手动选择过时不保存，界面语言跟随系统 */
  language?: Language
}

let settings: Settings = { theme: 'system' }
/** 当前的界面语言：手动选择过的，或者按系统语言确定的 */
let language: Language = 'en'

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

/** 系统的界面语言。启动参数 --lang 优先：界面测试用它固定语言，用户也可以用它临时换一种语言 */
function systemLanguage(): Language {
  const lang = app.commandLine.getSwitchValue('lang')
  return detectLanguage(lang ? [lang] : app.getPreferredSystemLanguages())
}

/** 读取设置并应用外观、确定界面语言，需要在创建窗口之前调用 */
export function loadSettings(): void {
  try {
    const data = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<Settings>
    if (isThemeMode(data.theme)) settings = { ...settings, theme: data.theme }
    if (isLanguage(data.language)) settings = { ...settings, language: data.language }
  } catch {
    // 第一次运行时还没有设置文件
  }
  language = settings.language ?? systemLanguage()
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
  save()
}

export function getLanguage(): Language {
  return language
}

/** 当前语言的界面文字。在生成文字时调用，切换语言后生成的就是新语言的文字 */
export function t(): Messages {
  return messages(language)
}

/**
 * 切换界面语言并保存选择，以后不再跟随系统。与当前语言相同时什么都不做，返回 false。
 * 先更新内存中的值再写文件：切换后立即刷新页面，读到的也是新语言
 */
export function setLanguage(value: Language): boolean {
  if (value === language) return false
  language = value
  settings = { ...settings, language: value }
  save()
  return true
}

function save(): void {
  try {
    mkdirSync(path.dirname(settingsFile()), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify(settings, null, 2))
  } catch (error) {
    console.error('保存设置失败:', error)
  }
}

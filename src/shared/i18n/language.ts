// 界面语言的类型和判断。不含界面文字，preload 和主进程的设置模块只引入这里，不会把两份字典都打包进去

export const LANGUAGES = ['zh-CN', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

/** 切换按钮上的语言名称：用这种语言本身书写，界面是哪种语言都一样 */
export const LANGUAGE_NAMES: Readonly<Record<Language, { short: string; full: string }>> = {
  'zh-CN': { short: '中', full: '中文' },
  en: { short: 'EN', full: 'English' },
}

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language)
}

/**
 * 按系统的首选语言列表（例如 ["ja-JP", "zh-Hans-CN"]、Linux 上的 "zh_CN.UTF-8"）确定界面语言：
 * 依次查找，先遇到中文用中文，先遇到英文用英文，都没有时用英文
 */
export function detectLanguage(tags: readonly string[]): Language {
  for (const tag of tags) {
    const primary = tag.split(/[-_.@]/)[0].toLowerCase()
    if (primary === 'zh') return 'zh-CN'
    if (primary === 'en') return 'en'
  }
  return 'en'
}

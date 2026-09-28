// 界面文字：按语言取对应的字典。主进程、处理核心、界面共用
import { en } from './en'
import type { Language } from './language'
import { zhCN, type Messages } from './zh-CN'

export type { Messages, ProcessorText } from './zh-CN'

const DICTIONARIES: Readonly<Record<Language, Messages>> = { 'zh-CN': zhCN, en }

export function messages(language: Language): Messages {
  return DICTIONARIES[language]
}

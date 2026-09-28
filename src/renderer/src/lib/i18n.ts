import { createContext, useContext } from 'react'
import { messages, type Messages } from '../../../shared/i18n'
import type { Language } from '../../../shared/i18n/language'

export interface I18n {
  language: Language
  /** 当前语言的界面文字 */
  t: Messages
}

export const I18nContext = createContext<I18n>({ language: 'zh-CN', t: messages('zh-CN') })

/** 当前的界面语言和对应的文字。切换语言时 App 重新渲染，组件读到的就是新语言的文字 */
export function useI18n(): I18n {
  return useContext(I18nContext)
}

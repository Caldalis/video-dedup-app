import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { messages } from '../../shared/i18n'
import { detectLanguage } from '../../shared/i18n/language'
import { App } from './App'
import './styles/app.css'

const root = createRoot(document.getElementById('root')!)

if (window.api) {
  // 在第一次渲染之前设置语言和标题，原生窗口的标题跟着页面标题变
  const language = window.api.initialLanguage
  document.documentElement.lang = language
  document.title = messages(language).appName
  root.render(
    <StrictMode>
      <App initialLanguage={language} />
    </StrictMode>,
  )
} else {
  // 直接在浏览器中打开页面时没有 window.api，按浏览器的语言显示提示
  root.render(<p className="standalone-notice">{messages(detectLanguage(navigator.languages)).standaloneNotice}</p>)
}

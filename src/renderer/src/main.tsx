import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/app.css'

const root = createRoot(document.getElementById('root')!)

if (window.api) {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} else {
  // 直接在浏览器中打开页面时没有 window.api
  root.render(<p className="standalone-notice">请用 pnpm dev 启动：界面需要在 Electron 中运行。</p>)
}

import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * 打包后的页面加上内容安全策略：只允许加载程序自带的脚本和样式。
 * 开发时不加，因为 React 的热更新需要执行页面中的内联脚本
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:",
        },
        injectTo: 'head-prepend',
      },
    ],
  }
}

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        // 界面运行在沙箱中，沙箱里的 preload 脚本只能是 CommonJS
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), contentSecurityPolicy()],
    build: { minify: true },
  },
})

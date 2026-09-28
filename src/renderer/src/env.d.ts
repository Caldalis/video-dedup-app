/// <reference types="vite/client" />
import type { Api } from '../../shared/ipc'

declare global {
  interface Window {
    /** preload 脚本暴露的接口，见 src/preload/index.ts */
    api: Api
  }
}

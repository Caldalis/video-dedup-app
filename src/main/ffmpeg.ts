import { app } from 'electron'
import path from 'node:path'
import { ffmpegVersion, isVersionSupported, locateFFmpeg } from '../core/ffmpeg'
import type { FFmpegInfo } from '../shared/ipc'

const EXECUTABLE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

/** 随程序提供的 FFmpeg：打包后在 resources/ffmpeg 目录中；开发时是 ffmpeg-static 在安装依赖时下载的 */
function bundledCandidates(): string[] {
  return app.isPackaged
    ? [path.join(process.resourcesPath, 'ffmpeg', EXECUTABLE)]
    : [path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', EXECUTABLE)]
}

let found: Promise<FFmpegInfo | null> | null = null

/**
 * 查找 FFmpeg 并读取版本号。找到后记住结果（同时发起的查找共用一次）；找不到时下次调用会重新查找，
 * 所以程序运行期间才安装好的 FFmpeg 也能直接用上
 */
export function resolveFFmpeg(): Promise<FFmpegInfo | null> {
  found ??= locate().then((info) => {
    if (!info) found = null
    return info
  })
  return found
}

async function locate(): Promise<FFmpegInfo | null> {
  const location = locateFFmpeg(bundledCandidates())
  if (!location) return null
  let version: string | null = null
  try {
    version = await ffmpegVersion(location.path)
  } catch {
    // 读不出版本号时仍然尝试使用
  }
  // 版本过旧的提示由界面按当前语言生成，这里只记下是否支持
  return { ...location, version, supported: isVersionSupported(version) }
}

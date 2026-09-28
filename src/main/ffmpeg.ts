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
  return {
    ...location,
    version,
    warning: isVersionSupported(version) ? null : `FFmpeg ${version} 版本过旧，本工具需要 5.1 及以上版本`,
  }
}

/** 找不到 FFmpeg 时的提示 */
export function ffmpegMissingMessage(): string {
  const after = '装好后不用重启程序，直接开始处理即可。'
  if (app.isPackaged) {
    return `未找到 FFmpeg，暂时无法处理视频。安装包中的 FFmpeg 可能被删除或被杀毒软件拦截，请重新安装本工具，或自行安装 FFmpeg。${after}`
  }
  const install =
    process.platform === 'darwin'
      ? '或在“终端”中执行 brew install ffmpeg 安装'
      : process.platform === 'win32'
        ? '或安装 FFmpeg 并把 ffmpeg.exe 所在的目录加入 PATH'
        : '或用系统的包管理器安装（例如 sudo apt install ffmpeg）'
  return `未找到 FFmpeg，暂时无法处理视频。请重新执行 pnpm install 下载 FFmpeg，${install}。${after}`
}

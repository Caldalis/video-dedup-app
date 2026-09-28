import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import path from 'node:path'

/** 用这个环境变量指定要使用的 FFmpeg，优先级最高 */
export const FFMPEG_ENV_VAR = 'VIDEO_DEDUP_FFMPEG'

export type FFmpegSource = 'env' | 'bundled' | 'system'

export interface FFmpegLocation {
  path: string
  source: FFmpegSource
}

const EXECUTABLE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

// 从访达、程序坞启动的 macOS 程序，PATH 里通常没有 Homebrew / MacPorts 的目录
const EXTRA_DIRS = process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'] : []

export function isExecutableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    if (process.platform !== 'win32') accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** 在 PATH（以及 macOS 上 Homebrew / MacPorts 的默认目录）中查找 FFmpeg */
export function findFFmpegOnPath(pathEnv = process.env.PATH ?? ''): string | null {
  const dirs = [...pathEnv.split(path.delimiter).filter(Boolean), ...EXTRA_DIRS]
  for (const dir of dirs) {
    const candidate = path.join(dir, EXECUTABLE)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

/**
 * 查找 FFmpeg：依次是环境变量 VIDEO_DEDUP_FFMPEG、随程序提供的 FFmpeg（bundled 中的路径）、
 * 系统中安装的 FFmpeg
 */
export function locateFFmpeg(bundled: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): FFmpegLocation | null {
  const fromEnv = env[FFMPEG_ENV_VAR]
  if (fromEnv && isExecutableFile(fromEnv)) return { path: fromEnv, source: 'env' }
  for (const candidate of bundled) {
    if (isExecutableFile(candidate)) return { path: candidate, source: 'bundled' }
  }
  const system = findFFmpegOnPath(env.PATH)
  return system ? { path: system, source: 'system' } : null
}

export interface CaptureResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export interface CaptureOptions {
  timeoutMs?: number
  /** 进程启动后立即调用，用于在取消处理时结束它 */
  onSpawn?: (child: ChildProcess) => void
}

/** 运行一条命令并收集全部输出。无法启动程序时（例如文件不存在）会抛出异常 */
export function runCapture(file: string, args: readonly string[], options: CaptureOptions = {}): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: options.timeoutMs ?? 60_000,
    })
    let stdout = ''
    let stderr = ''
    // 按 UTF-8 解码，元数据是 GBK 等其他编码时，无法解码的字节会变成 �，不会出错
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
    options.onSpawn?.(child)
  })
}

/** 读取 FFmpeg 的版本号，例如 "6.1.1"、"9.0.2"，读不出时返回 null */
export async function ffmpegVersion(file: string): Promise<string | null> {
  const result = await runCapture(file, ['-hide_banner', '-version'], { timeoutMs: 15_000 })
  return /ffmpeg version (\S+)/.exec(result.stdout)?.[1] ?? null
}

/** 本工具用到的 -fps_mode 选项从 FFmpeg 5.1 开始才有；读不出版本号（例如自行编译的版本）时不做判断 */
export function isVersionSupported(version: string | null): boolean {
  const match = version && /^n?(\d+)\.(\d+)/.exec(version)
  if (!match) return true
  const [major, minor] = [Number(match[1]), Number(match[2])]
  return major > 5 || (major === 5 && minor >= 1)
}

/** 从 ffmpeg -encoders 的输出中读取编码器名称 */
export function parseEncoders(output: string): Set<string> {
  const names = new Set<string>()
  let started = false
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (line.trim().startsWith('---')) {
      started = true
    } else if (started && parts.length >= 2) {
      names.add(parts[1])
    }
  }
  return names
}

const encoderCache = new Map<string, Promise<ReadonlySet<string>>>()

/** 读取 FFmpeg 支持的编码器名称（结果会缓存） */
export function availableEncoders(file: string): Promise<ReadonlySet<string>> {
  let encoders = encoderCache.get(file)
  if (!encoders) {
    encoders = runCapture(file, ['-hide_banner', '-encoders'], { timeoutMs: 30_000 }).then((r) => parseEncoders(r.stdout))
    encoders.catch(() => encoderCache.delete(file))
    encoderCache.set(file, encoders)
  }
  return encoders
}

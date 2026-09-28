import type { Stage } from '../../../shared/types'

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

/** 时长显示为 mm:ss，超过一小时显示为 h:mm:ss */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 用时显示为“0.6 秒”“12 秒”“3 分 05 秒” */
export function formatElapsed(seconds: number): string {
  if (seconds < 10) return `${Math.max(0.1, seconds).toFixed(1)} 秒`
  const total = Math.round(seconds)
  if (total < 60) return `${total} 秒`
  const m = Math.floor(total / 60)
  const s = total % 60
  return m < 60 ? `${m} 分 ${String(s).padStart(2, '0')} 秒` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}

export function formatFps(fps: number): string {
  return `${Number(fps.toFixed(2))} fps`
}

export function formatSpeed(speed: number): string {
  return `${speed >= 10 ? speed.toFixed(0) : speed.toFixed(1)}×`
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

export function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file
}

export function dirname(file: string): string {
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return index > 0 ? file.slice(0, index) : file
}

export function extname(file: string): string {
  const name = basename(file)
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index).toLowerCase() : ''
}

export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  probe: '正在读取视频信息',
  encode: '正在重新编码',
  copy: '正在复制音视频流',
  cover: '正在嵌入封面缩略图',
  finalize: '正在保存',
}

/** 各系统中文件管理器的名称 */
export function fileManagerName(platform: string | undefined): string {
  return platform === 'darwin' ? '访达' : platform === 'win32' ? '资源管理器' : '文件管理器'
}

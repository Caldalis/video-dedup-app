import type { Messages } from '../../../shared/i18n'

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

/** 用时显示为“0.6 秒”“12 秒”“3 分 05 秒”，单位按界面语言 */
export function formatElapsed(seconds: number, units: Messages['units']): string {
  if (seconds < 10) return units.seconds(Math.max(0.1, seconds).toFixed(1))
  const total = Math.round(seconds)
  if (total < 60) return units.seconds(String(total))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m < 60 ? units.minutes(m, String(s).padStart(2, '0')) : units.hours(Math.floor(m / 60), m % 60)
}

export function formatFps(fps: number): string {
  return `${Number(fps.toFixed(2))} fps`
}

export function formatSpeed(speed: number): string {
  return `${speed >= 10 ? speed.toFixed(0) : speed.toFixed(1)}×`
}

/** 日志的时间，两种界面语言都显示为 HH:MM:SS */
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

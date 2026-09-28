import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogKind } from '../../../shared/types'
import { formatClock } from './format'

export type LogLevel = LogKind | 'success' | 'error' | 'warn'

export interface LogEntry {
  id: number
  time: string
  message: string
  level: LogLevel
}

const MAX_LOG_ENTRIES = 2000

/** 处理日志：最多保留最近的 2000 条 */
export function useLog() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const nextId = useRef(1)

  const append = useCallback((message: string, level: LogLevel = 'info') => {
    const entry = { id: nextId.current++, time: formatClock(new Date()), message, level }
    setEntries((list) => (list.length >= MAX_LOG_ENTRIES ? [...list.slice(1 - MAX_LOG_ENTRIES), entry] : [...list, entry]))
  }, [])

  const clear = useCallback(() => setEntries([]), [])

  return { entries, append, clear }
}

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
}

/** 屏幕下方短暂显示的提示 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const show = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++
    setToasts((list) => [...list.slice(-2), { id, message, tone }])
    window.setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), tone === 'error' ? 6000 : 2800)
  }, [])

  return { toasts, show }
}

/** 每隔 intervalMs 毫秒刷新一次当前时间，active 为 false 时停止 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  return now
}

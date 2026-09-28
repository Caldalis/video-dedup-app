import { Copy, Eraser, ScrollText } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import type { LogEntry } from '../lib/hooks'
import { Card, IconButton, cx } from './ui'

interface LogCardProps {
  entries: LogEntry[]
  onCopy: () => void
  onClear: () => void
}

export function LogCard({ entries, onCopy, onClear }: LogCardProps) {
  const listRef = useRef<HTMLDivElement>(null)
  // 停在底部时自动滚动到最新的日志；往上翻看时不打扰
  const stickToBottom = useRef(true)

  useLayoutEffect(() => {
    const list = listRef.current
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight
  }, [entries])

  return (
    <Card
      title="处理日志"
      icon={<ScrollText size={16} />}
      className="log-card"
      actions={
        <>
          <span className="badge">{entries.length}</span>
          <IconButton label="复制全部日志" onClick={onCopy} disabled={entries.length === 0}>
            <Copy size={14} />
          </IconButton>
          <IconButton label="清空日志" onClick={onClear} disabled={entries.length === 0}>
            <Eraser size={14} />
          </IconButton>
        </>
      }
    >
      <div
        ref={listRef}
        className="log-list"
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          const list = event.currentTarget
          stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24
        }}
      >
        {entries.length === 0 ? (
          <div className="log-empty">暂无日志</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={cx('log-line', `is-${entry.level}`)}>
              <span className="log-time">{entry.time}</span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

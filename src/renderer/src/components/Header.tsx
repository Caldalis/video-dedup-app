import { Monitor, Moon, Sun } from 'lucide-react'
import type { AppInfo, ThemeMode } from '../../../shared/ipc'
import { InfoPopover, cx } from './ui'

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="logo-gradient" x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-gradient)" />
      <path d="M8.5 10.6v10.8c0 .9 1 1.5 1.8 1l8.6-5.4c.7-.4.7-1.5 0-1.9l-8.6-5.4c-.8-.6-1.8 0-1.8.9Z" fill="#fff" opacity=".38" />
      <path d="M12.5 10.6v10.8c0 .9 1 1.5 1.8 1l8.6-5.4c.7-.4.7-1.5 0-1.9l-8.6-5.4c-.8-.6-1.8 0-1.8.9Z" fill="#fff" />
    </svg>
  )
}

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; icon: typeof Sun }> = [
  { mode: 'light', label: '浅色', icon: Sun },
  { mode: 'dark', label: '深色', icon: Moon },
  { mode: 'system', label: '跟随系统', icon: Monitor },
]

function ThemeSwitch({ value, onChange }: { value: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="外观">
      {THEME_OPTIONS.map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          aria-label={label}
          title={label}
          className={cx('segmented-item', value === mode && 'is-active')}
          onClick={() => onChange(mode)}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}

const SOURCE_LABELS = { bundled: '内置', system: '系统', env: '环境变量指定' } as const

function FFmpegStatus({ info }: { info: AppInfo | null }) {
  if (!info) return null
  const ffmpeg = info.ffmpeg
  const tone = !ffmpeg ? 'error' : ffmpeg.warning ? 'warn' : 'ok'
  const text = ffmpeg ? `FFmpeg ${ffmpeg.version ?? ''}`.trim() : '未找到 FFmpeg'
  return (
    <div className={cx('status-pill', `is-${tone}`)}>
      <span className="status-dot" />
      <span>{text}</span>
      <InfoPopover label="FFmpeg 详情">
        {ffmpeg ? (
          <>
            <p>
              版本 {ffmpeg.version ?? '未知'}（{SOURCE_LABELS[ffmpeg.source]}）
            </p>
            <p className="mono">{ffmpeg.path}</p>
            {ffmpeg.warning && <p className="text-warn">{ffmpeg.warning}</p>}
            <p className="muted">可以用环境变量 VIDEO_DEDUP_FFMPEG 指定要使用的 FFmpeg。</p>
          </>
        ) : (
          <p>{info.ffmpegMissingMessage}</p>
        )}
      </InfoPopover>
    </div>
  )
}

interface HeaderProps {
  info: AppInfo | null
  theme: ThemeMode
  onThemeChange: (mode: ThemeMode) => void
}

export function Header({ info, theme, onThemeChange }: HeaderProps) {
  return (
    <header className="titlebar">
      <div className="brand">
        <Logo />
        <div>
          <h1 className="brand-name">视频去重工具</h1>
          <div className="brand-sub">Video Dedup · 基于 FFmpeg</div>
        </div>
      </div>
      <div className="titlebar-actions">
        <FFmpegStatus info={info} />
        <ThemeSwitch value={theme} onChange={onThemeChange} />
      </div>
    </header>
  )
}

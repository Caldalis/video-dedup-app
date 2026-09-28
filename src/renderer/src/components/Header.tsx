import { Monitor, Moon, Sun } from 'lucide-react'
import { LANGUAGE_NAMES, LANGUAGES, type Language } from '../../../shared/i18n/language'
import type { AppInfo, ThemeMode } from '../../../shared/ipc'
import { useI18n } from '../lib/i18n'
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

const THEME_ICONS: Array<{ mode: ThemeMode; icon: typeof Sun }> = [
  { mode: 'light', icon: Sun },
  { mode: 'dark', icon: Moon },
  { mode: 'system', icon: Monitor },
]

function ThemeSwitch({ value, onChange }: { value: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  const { t } = useI18n()
  return (
    <div className="segmented" role="radiogroup" aria-label={t.header.theme}>
      {THEME_ICONS.map(({ mode, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          aria-label={t.header.themes[mode]}
          title={t.header.themes[mode]}
          className={cx('segmented-item', value === mode && 'is-active')}
          onClick={() => onChange(mode)}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  )
}

/** 语言切换：按钮上的语言名称用这种语言本身书写，界面是哪种语言都一样 */
function LanguageSwitch({ value, onChange }: { value: Language; onChange: (language: Language) => void }) {
  const { t } = useI18n()
  return (
    <div className="segmented" role="radiogroup" aria-label={t.header.language}>
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          role="radio"
          lang={language}
          aria-checked={value === language}
          aria-label={LANGUAGE_NAMES[language].full}
          title={LANGUAGE_NAMES[language].full}
          className={cx('segmented-item', 'is-text', value === language && 'is-active')}
          onClick={() => onChange(language)}
        >
          {LANGUAGE_NAMES[language].short}
        </button>
      ))}
    </div>
  )
}

function FFmpegStatus({ info }: { info: AppInfo | null }) {
  const { t } = useI18n()
  if (!info) return null
  const ffmpeg = info.ffmpeg
  const tone = !ffmpeg ? 'error' : ffmpeg.supported ? 'ok' : 'warn'
  const text = ffmpeg ? `FFmpeg ${ffmpeg.version ?? ''}`.trim() : t.header.ffmpegMissing
  return (
    <div className={cx('status-pill', `is-${tone}`)}>
      <span className="status-dot" />
      <span>{text}</span>
      <InfoPopover label={t.header.ffmpegDetails}>
        {ffmpeg ? (
          <>
            <p>{t.header.ffmpegVersion(ffmpeg.version, ffmpeg.source)}</p>
            <p className="mono">{ffmpeg.path}</p>
            {!ffmpeg.supported && <p className="text-warn">{t.ffmpeg.outdated(ffmpeg.version)}</p>}
            <p className="muted">{t.header.ffmpegEnvHint}</p>
          </>
        ) : (
          <p>{t.ffmpeg.missing(info.platform, info.packaged)}</p>
        )}
      </InfoPopover>
    </div>
  )
}

interface HeaderProps {
  info: AppInfo | null
  theme: ThemeMode
  onThemeChange: (mode: ThemeMode) => void
  language: Language
  onLanguageChange: (language: Language) => void
}

export function Header({ info, theme, onThemeChange, language, onLanguageChange }: HeaderProps) {
  const { t } = useI18n()
  return (
    <header className="titlebar">
      <div className="brand">
        <Logo />
        <div className="brand-text">
          <h1 className="brand-name">{t.appName}</h1>
          <div className="brand-sub">{t.appTagline}</div>
        </div>
      </div>
      <div className="titlebar-actions">
        <FFmpegStatus info={info} />
        <LanguageSwitch value={language} onChange={onLanguageChange} />
        <ThemeSwitch value={theme} onChange={onThemeChange} />
      </div>
    </header>
  )
}

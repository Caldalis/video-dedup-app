import { Check, Copy, Info, Minus, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', icon, className, children, ...props }: ButtonProps) {
  return (
    <button type="button" className={cx('btn', `btn-${variant}`, `btn-${size}`, className)} {...props}>
      {icon}
      {children && <span>{children}</span>}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
}

export function IconButton({ label, className, children, ...props }: IconButtonProps) {
  return (
    <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}

interface CardProps {
  title: string
  icon?: ReactNode
  actions?: ReactNode
  className?: string
  children: ReactNode
}

export function Card({ title, icon, actions, className, children }: CardProps) {
  return (
    <section className={cx('card', className)} aria-label={title}>
      <header className="card-header">
        <h2 className="card-title">
          {icon}
          {title}
        </h2>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}

/** 开关。放在可点击的卡片里时不会让卡片再切换一次 */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={(event) => {
        event.stopPropagation()
        onChange(!checked)
      }}
    >
      <span className="switch-thumb" />
    </button>
  )
}

interface StepperProps {
  value: string
  onChange: (value: string) => void
  step: number
  min: number
  max: number
  /** 小数位数 */
  decimals: number
  label: string
  invalid?: boolean
  disabled?: boolean
}

/** 带加减按钮的数字输入框。输入框里的内容原样保留，方便用户输入到一半时不被改写 */
export function Stepper({ value, onChange, step, min, max, decimals, label, invalid, disabled }: StepperProps) {
  const { t } = useI18n()
  const nudge = (direction: 1 | -1) => {
    const current = Number(value)
    const base = Number.isFinite(current) ? current : min
    const next = Math.min(max, Math.max(min, base + direction * step))
    onChange(next.toFixed(decimals))
  }
  return (
    <div className={cx('stepper', invalid && 'is-invalid')} onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label={t.ui.decrease(label)} disabled={disabled} onClick={() => nudge(-1)}>
        <Minus size={13} />
      </button>
      <input
        value={value}
        aria-label={label}
        aria-invalid={invalid}
        inputMode="decimal"
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" aria-label={t.ui.increase(label)} disabled={disabled} onClick={() => nudge(1)}>
        <Plus size={13} />
      </button>
    </div>
  )
}

/** 复制按钮：复制后短暂显示对勾 */
export function CopyButton({ text, label, onCopy }: { text: string; label: string; onCopy: (text: string) => void }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <IconButton
      label={copied ? t.ui.copied : label}
      className={cx('copy-btn', copied && 'is-done')}
      onClick={(event) => {
        event.stopPropagation()
        onCopy(text)
        setCopied(true)
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </IconButton>
  )
}

/** 点击后在按钮下方显示说明文字，点击其他地方或按 Esc 关闭 */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const popover = popoverRef.current
    const button = buttonRef.current
    if (!popover || !button) return
    // 弹出层显示在最上层，按按钮的位置摆放，并保证不超出窗口
    const place = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') return
      const anchor = button.getBoundingClientRect()
      const width = Math.min(320, window.innerWidth - 24)
      const left = Math.min(Math.max(12, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 12)
      popover.style.width = `${width}px`
      popover.style.left = `${left}px`
      popover.style.top = `${anchor.bottom + 8}px`
    }
    popover.addEventListener('beforetoggle', place)
    return () => popover.removeEventListener('beforetoggle', place)
  }, [])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="info-btn"
        popoverTarget={id}
        aria-label={label}
        title={label}
        onClick={(event) => event.stopPropagation()}
      >
        <Info size={14} />
      </button>
      <div ref={popoverRef} id={id} popover="auto" className="popover" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </>
  )
}

export function ProgressBar({ percent, tone = 'accent' }: { percent: number | null; tone?: 'accent' | 'success' }) {
  return (
    <div
      className={cx('progress', percent === null && 'is-indeterminate', tone === 'success' && 'is-success')}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <div className="progress-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
    </div>
  )
}

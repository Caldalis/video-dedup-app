import { Blend, Contrast, FingerprintPattern, RotateCcw, Scissors, SlidersHorizontal, SquareSplitHorizontal, Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import { FEATURES } from '../../../shared/features'
import {
  DEFAULT_FEATURES,
  FEATURE_KEYS,
  SAMPLING_RANDOM_RANGE,
  isValidInterval,
  isValidOpacity,
  parseInterval,
  parseOpacity,
  type FeatureKey,
  type FeatureOptions,
} from '../../../shared/options'
import { Button, Card, InfoPopover, Stepper, Switch, cx } from './ui'

/** 界面上的功能选项：两个数值保留输入框中的原始文字 */
export interface FeatureDraft extends Omit<FeatureOptions, 'maskOpacity' | 'samplingInterval'> {
  maskOpacity: string
  samplingInterval: string
}

export function defaultDraft(): FeatureDraft {
  return {
    ...DEFAULT_FEATURES,
    maskOpacity: String(DEFAULT_FEATURES.maskOpacity),
    samplingInterval: String(DEFAULT_FEATURES.samplingInterval),
  }
}

export function parseDraft(draft: FeatureDraft): FeatureOptions {
  return { ...draft, maskOpacity: parseOpacity(draft.maskOpacity), samplingInterval: parseInterval(draft.samplingInterval) }
}

const ICONS: Record<FeatureKey, ReactNode> = {
  mirror: <SquareSplitHorizontal size={18} />,
  rgbShift: <Blend size={18} />,
  timeJump: <Timer size={18} />,
  md5Change: <FingerprintPattern size={18} />,
  maskInvert: <Contrast size={18} />,
  frameSampling: <Scissors size={18} />,
}

interface FeatureCardProps {
  draft: FeatureDraft
  onChange: (draft: FeatureDraft) => void
  disabled: boolean
}

export function FeatureCard({ draft, onChange, disabled }: FeatureCardProps) {
  const selected = FEATURE_KEYS.filter((key) => draft[key]).length
  const update = (patch: Partial<FeatureDraft>) => onChange({ ...draft, ...patch })
  const opacityValid = isValidOpacity(parseOpacity(draft.maskOpacity))
  const interval = parseInterval(draft.samplingInterval)
  const intervalValid = isValidInterval(interval)

  const params: Partial<Record<FeatureKey, ReactNode>> = {
    maskInvert: (
      <>
        <div className="param">
          <span className="param-label">不透明度</span>
          <Stepper
            label="不透明度"
            value={draft.maskOpacity}
            onChange={(maskOpacity) => update({ maskOpacity })}
            step={0.01}
            min={0.01}
            max={1}
            decimals={2}
            invalid={!opacityValid}
            disabled={disabled}
          />
        </div>
        <p className={cx('param-hint', !opacityValid && 'text-danger')}>
          {opacityValid ? '0~1 之间，值越大画面越灰' : '需要大于 0、不超过 1'}
        </p>
      </>
    ),
    frameSampling: (
      <>
        <div className="param">
          <span className="param-label">间隔</span>
          <Stepper
            label="抽帧间隔"
            value={draft.samplingInterval}
            onChange={(samplingInterval) => update({ samplingInterval })}
            step={1}
            min={2}
            max={999}
            decimals={0}
            invalid={!intervalValid}
            disabled={disabled}
          />
          <span className="param-label">帧</span>
          <label className="check" onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={draft.samplingRandom}
              disabled={disabled}
              onChange={(event) => update({ samplingRandom: event.target.checked })}
            />
            随机间隔
          </label>
        </div>
        <p className={cx('param-hint', !intervalValid && 'text-danger')}>
          {!intervalValid
            ? '需要是不小于 2 的整数'
            : draft.samplingRandom
              ? `每 ${interval}~${interval + SAMPLING_RANDOM_RANGE - 1} 帧随机抽掉 1 帧`
              : `每 ${interval} 帧抽掉 1 帧`}
        </p>
      </>
    ),
  }

  return (
    <Card
      title="去重功能"
      icon={<SlidersHorizontal size={16} />}
      actions={
        <>
          <span className="badge">已选 {selected} 项</span>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => onChange(defaultDraft())} disabled={disabled}>
            恢复默认
          </Button>
        </>
      }
    >
      <div className="feature-grid">
        {FEATURES.map((feature) => {
          const checked = draft[feature.key]
          const toggle = () => !disabled && update({ [feature.key]: !checked })
          return (
            <div
              key={feature.key}
              className={cx('feature', checked && 'is-on', disabled && 'is-disabled')}
              onClick={toggle}
              data-feature={feature.key}
            >
              <div className="feature-head">
                <div className="feature-icon">{ICONS[feature.key]}</div>
                <div className="feature-text">
                  <div className="feature-name">
                    <span className="feature-label">{feature.name}</span>
                    <InfoPopover label={`${feature.name}说明`}>{feature.detail}</InfoPopover>
                  </div>
                  <div className="feature-summary">{feature.summary}</div>
                </div>
                <Switch checked={checked} onChange={toggle} label={feature.name} disabled={disabled} />
              </div>
              {checked && params[feature.key] && (
                // 参数区域里的点击不切换功能
                <div className="feature-params" onClick={(event) => event.stopPropagation()}>
                  {params[feature.key]}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// 处理参数的定义、默认值和校验。界面和主进程共用，不依赖 Node 或浏览器 API

// 时间跳跃：画面时间轴按正弦规律前后偏移的最大幅度（秒）和周期（秒）。
// 播放速度随之在 ±2π×0.04/8 ≈ ±3% 之间波动，0.04 秒的音画偏差低于人能察觉的程度
export const TIME_JUMP_AMPLITUDE = 0.04
export const TIME_JUMP_PERIOD = 8

// 视频抽帧的随机间隔：在“设定值”到“设定值 + 5”帧之间
export const SAMPLING_RANDOM_RANGE = 6

export interface FeatureOptions {
  mirror: boolean
  rgbShift: boolean
  timeJump: boolean
  md5Change: boolean
  maskInvert: boolean
  /** 反色蒙版的不透明度，大于 0、不超过 1 */
  maskOpacity: number
  frameSampling: boolean
  /** 每隔多少帧抽掉 1 帧，不小于 2 */
  samplingInterval: number
  samplingRandom: boolean
  /** 去除声音：输出的视频不带音轨 */
  removeAudio: boolean
}

export interface ProcessingOptions extends FeatureOptions {
  inputPath: string
  outputPath: string
}

/** 默认开启的功能：“时间跳跃”和“修改MD5值” */
export const DEFAULT_FEATURES: Readonly<FeatureOptions> = {
  mirror: false,
  rgbShift: false,
  timeJump: true,
  md5Change: true,
  maskInvert: false,
  maskOpacity: 0.03,
  frameSampling: false,
  samplingInterval: 5,
  samplingRandom: true,
  removeAudio: false,
}

export const FEATURE_KEYS = ['mirror', 'rgbShift', 'timeJump', 'md5Change', 'maskInvert', 'frameSampling', 'removeAudio'] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

/** 不改动画面的功能：只勾选这些时不需要重新编码视频 */
const COPY_FEATURES: readonly FeatureKey[] = ['md5Change', 'removeAudio']

/** 功能选项的问题：没有开启任何功能、不透明度不对、抽帧间隔不对。说明文字在界面文字的 problems 中 */
export type FeatureProblem = 'noFeatures' | 'opacity' | 'interval'

/** 解析输入框中的不透明度，格式不对时返回 NaN */
export function parseOpacity(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text)
}

/** 解析输入框中的抽帧间隔，不是整数时返回 NaN */
export function parseInterval(text: string): number {
  return /^\s*\d+\s*$/.test(text) ? Number.parseInt(text, 10) : Number.NaN
}

export function isValidOpacity(value: number): boolean {
  return value > 0 && value <= 1
}

export function isValidInterval(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 2
}

export function countSelected(features: FeatureOptions): number {
  return FEATURE_KEYS.filter((key) => features[key]).length
}

/** 检查功能选项，返回第一个问题；没有问题时返回 null */
export function validateFeatures(features: FeatureOptions): FeatureProblem | null {
  if (countSelected(features) === 0) return 'noFeatures'
  if (features.maskInvert && !isValidOpacity(features.maskOpacity)) return 'opacity'
  if (features.frameSampling && !isValidInterval(features.samplingInterval)) return 'interval'
  return null
}

/** 只勾选“修改MD5值”“去除声音”时直接复制视频流，不重新编码 */
export function isCopyOnly(features: FeatureOptions): boolean {
  const selected = FEATURE_KEYS.filter((key) => features[key])
  return selected.length > 0 && selected.every((key) => COPY_FEATURES.includes(key))
}

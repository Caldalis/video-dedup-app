import { SAMPLING_RANDOM_RANGE, TIME_JUMP_AMPLITUDE, TIME_JUMP_PERIOD, type FeatureOptions } from '../shared/options'

/**
 * 按勾选的功能生成 FFmpeg 视频滤镜列表。
 * random 用来生成随机抽帧的种子，返回 [0, 1) 之间的数，测试时可以替换
 */
export function buildVideoFilters(options: FeatureOptions, random: () => number = Math.random): string[] {
  const filters: string[] = []
  // 水平镜像
  if (options.mirror) {
    filters.push('hflip')
  }
  // 蒙版倒置：叠加一层不透明度为 o 的反色画面，输出 = 原值 + (反色值 - 原值) × o。
  // negval 是按亮度、色度各自的有效范围取反后的值
  if (options.maskInvert) {
    const expr = `'val+(negval-val)*${options.maskOpacity}'`
    filters.push(`lutyuv=y=${expr}:u=${expr}:v=${expr}`)
  }
  // RGB偏移：红色通道右移 1 个像素、蓝色通道下移 1 个像素，绿色通道不动（亮度大部分来自绿色，画面轮廓基本不动）。
  // 通道之间的错位是两者位移之差，这样任意两个通道在水平、垂直方向上都只差 1 个像素。
  // 输出为 4:2:0 时色度分辨率减半，错位会被抹平一部分，实测红色约 0.9、蓝色约 0.3 个像素
  if (options.rgbShift) {
    filters.push('rgbashift=rh=1:bv=1')
  }
  // 时间跳跃：每帧的显示时间加上 A×sin(2πt/T)，画面周期性地略快、略慢，总时长不变。
  // 先换成 1/90000 的时间基，免得 AVI 等以帧为单位的输入把不足一帧的偏移舍入掉
  if (options.timeJump) {
    filters.push(`settb=1/90000,setpts='PTS+${TIME_JUMP_AMPLITUDE}*sin(2*PI*T/${TIME_JUMP_PERIOD})/TB'`)
  }
  // 视频抽帧：每隔 N 帧抽掉 1 帧。保留原时间戳，抽掉的位置由前一帧顶上，音画保持同步
  if (options.frameSampling) {
    const n = options.samplingInterval
    if (options.samplingRandom) {
      // ld(0) 记录下一个要抽掉的帧序号；random(1) 以变量 1 为种子，种子每次处理都不同。
      // FFmpeg 把种子存成 double，取 2^32 ~ 2^52 之间的整数既能精确保存，又不会太小
      const seed = 2 ** 32 + Math.floor(random() * (2 ** 52 - 2 ** 32))
      const step = `${n}+floor(random(1)*${SAMPLING_RANDOM_RANGE})`
      filters.push(`select='if(eq(n,0),st(1,${seed});st(0,${step}-1));if(eq(n,ld(0)),st(0,n+${step})*0,1)'`)
    } else {
      filters.push(`select='mod(n+1,${n})'`)
    }
  }
  return filters
}

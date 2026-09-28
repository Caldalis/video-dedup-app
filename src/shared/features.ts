import { SAMPLING_RANDOM_RANGE, TIME_JUMP_AMPLITUDE, TIME_JUMP_PERIOD, type FeatureKey } from './options'

export interface FeatureInfo {
  key: FeatureKey
  name: string
  /** 功能卡片上的一句话说明 */
  summary: string
  /** 点开“说明”后显示的详细介绍 */
  detail: string
}

export const FEATURES: readonly FeatureInfo[] = [
  {
    key: 'mirror',
    name: '水平镜像',
    summary: '画面左右翻转',
    detail: '把画面左右翻转过来，就像照镜子一样。画面内容完整保留，不会被裁剪或遮挡。',
  },
  {
    key: 'rgbShift',
    name: 'RGB偏移',
    summary: '让红、绿、蓝通道错开1个像素',
    detail: '把红色通道向右、蓝色通道向下各移动1个像素，绿色通道不动，三个颜色通道彼此最多错开1个像素，产生轻微的色彩差异。',
  },
  {
    key: 'timeJump',
    name: '时间跳跃',
    summary: '让画面播放速度周期性轻微快慢波动',
    detail:
      `让画面的时间轴按正弦规律前后微调（最多约±${TIME_JUMP_AMPLITUDE}秒，周期${TIME_JUMP_PERIOD}秒），` +
      '播放速度随之在约±3%内周期性地略快、略慢，正常观看时看不出来。' +
      `帧数不变，总时长最多相差${TIME_JUMP_AMPLITUDE}秒，声音不受影响。输出为 AVI 时只能以整帧为单位调整。`,
  },
  {
    key: 'md5Change',
    name: '修改MD5值',
    summary: '写入随机信息，文件的 MD5 随之改变',
    detail:
      '在文件中写入一段随机的注释，每次输出的文件 MD5 都不一样；原视频的标题和日期不会带到输出文件中。' +
      '只勾选这一项时直接复制音视频流，不重新编码，画质无损、速度很快；' +
      '输出格式装不下原来的编码时（例如 WMV 转 MP4），会自动改为重新编码。',
  },
  {
    key: 'maskInvert',
    name: '蒙版倒置',
    summary: '叠加一层半透明的反色蒙版',
    detail: '在画面上叠加一层半透明的反色蒙版。不透明度范围0~1，默认0.03；值越大画面越灰，为1时完全反色。',
  },
  {
    key: 'frameSampling',
    name: '视频抽帧',
    summary: '每隔几帧去掉一帧',
    detail:
      '每 N 帧去掉 1 帧（默认 N 为 5），去掉的位置由前一帧补上，声音不受影响。' +
      `勾选“随机间隔”时，间隔在 N 到 N+${SAMPLING_RANDOM_RANGE - 1} 帧之间随机变化，每次处理去掉的位置都不同。`,
  },
]

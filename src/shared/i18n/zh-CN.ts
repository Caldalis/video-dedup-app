// 中文界面文字，也是其他语言字典的模板：Messages 类型由这里推导，其他语言必须提供同样的条目和参数
import type { FFmpegInfo, Md5Slot, ThemeMode } from '../ipc'
import { SAMPLING_RANDOM_RANGE, TIME_JUMP_AMPLITUDE, TIME_JUMP_PERIOD, type FeatureKey } from '../options'
import type { Stage } from '../types'

interface FeatureText {
  name: string
  /** 功能卡片上的一句话说明 */
  summary: string
  /** 点开“说明”后显示的详细介绍 */
  detail: string
}

const fileManagers = (platform: string | undefined) =>
  platform === 'darwin' ? '访达' : platform === 'win32' ? '资源管理器' : '文件管理器'

const logSources: Record<FFmpegInfo['source'], string> = {
  bundled: '随程序提供',
  system: '系统中安装',
  env: '环境变量 VIDEO_DEDUP_FFMPEG 指定',
}

export const zhCN = {
  appName: '视频去重工具',
  appTagline: 'Video Dedup · 基于 FFmpeg',
  standaloneNotice: '请用 pnpm dev 启动：界面需要在 Electron 中运行。',

  header: {
    theme: '外观',
    themes: { light: '浅色', dark: '深色', system: '跟随系统' } satisfies Record<ThemeMode, string>,
    language: '语言',
    ffmpegMissing: '未找到 FFmpeg',
    ffmpegDetails: 'FFmpeg 详情',
    ffmpegVersion: (version: string | null, source: FFmpegInfo['source']) =>
      `版本 ${version ?? '未知'}（${{ bundled: '内置', system: '系统', env: '环境变量指定' }[source]}）`,
    ffmpegEnvHint: '可以用环境变量 VIDEO_DEDUP_FFMPEG 指定要使用的 FFmpeg。',
  },

  ffmpeg: {
    outdated: (version: string | null) => `FFmpeg ${version} 版本过旧，本工具需要 5.1 及以上版本`,
    /** 找不到 FFmpeg 时告诉用户怎么办；packaged 为 true 表示打包后的正式版本 */
    missing: (platform: string, packaged: boolean) => {
      const after = '装好后不用重启程序，直接开始处理即可。'
      if (packaged) {
        return `未找到 FFmpeg，暂时无法处理视频。安装包中的 FFmpeg 可能被删除或被杀毒软件拦截，请重新安装本工具，或自行安装 FFmpeg。${after}`
      }
      const install =
        platform === 'darwin'
          ? '或在“终端”中执行 brew install ffmpeg 安装'
          : platform === 'win32'
            ? '或安装 FFmpeg 并把 ffmpeg.exe 所在的目录加入 PATH'
            : '或用系统的包管理器安装（例如 sudo apt install ffmpeg）'
      return `未找到 FFmpeg，暂时无法处理视频。请重新执行 pnpm install 下载 FFmpeg，${install}。${after}`
    },
  },

  file: {
    title: '视频文件',
    change: '更换',
    dropTitle: '拖入视频文件，或点击选择',
    dropHint: '支持 MP4、MOV、MKV、AVI、WMV、FLV、WebM 等格式',
    loading: '正在读取视频信息…',
    remove: '移除文件',
    noAudio: '无声音',
    originalMd5: '原始 MD5',
    outputTo: '输出到',
    changeOutput: '更改…',
    md5Computing: '计算中…',
    md5Failed: '计算失败',
    copyMd5: '复制 MD5',
  },

  /** 选择的文件不能处理的原因 */
  inputErrors: {
    invalidPath: '无效的文件路径',
    notAFile: '请选择视频文件，而不是文件夹',
    unreadable: (detail: string) => `无法读取文件：${detail}`,
    cannotRead: (reason: string) => `无法读取这个文件：${reason}`,
    noVideo: '这个文件中没有视频画面',
  },

  features: {
    title: '去重功能',
    selected: (count: number) => `已选 ${count} 项`,
    reset: '恢复默认',
    details: (name: string) => `${name}说明`,
    opacity: '不透明度',
    opacityHint: '0~1 之间，值越大画面越灰',
    opacityInvalid: '需要大于 0、不超过 1',
    interval: '间隔',
    intervalLabel: '抽帧间隔',
    frames: '帧',
    randomInterval: '随机间隔',
    intervalInvalid: '需要是不小于 2 的整数',
    samplingRandom: (from: number, to: number) => `每 ${from}~${to} 帧随机抽掉 1 帧`,
    samplingFixed: (interval: number) => `每 ${interval} 帧抽掉 1 帧`,
    items: {
      mirror: {
        name: '水平镜像',
        summary: '画面左右翻转',
        detail: '把画面左右翻转过来，就像照镜子一样。画面内容完整保留，不会被裁剪或遮挡。',
      },
      rgbShift: {
        name: 'RGB偏移',
        summary: '让红、绿、蓝通道错开1个像素',
        detail: '把红色通道向右、蓝色通道向下各移动1个像素，绿色通道不动，三个颜色通道彼此最多错开1个像素，产生轻微的色彩差异。',
      },
      timeJump: {
        name: '时间跳跃',
        summary: '让画面播放速度周期性轻微快慢波动',
        detail:
          `让画面的时间轴按正弦规律前后微调（最多约±${TIME_JUMP_AMPLITUDE}秒，周期${TIME_JUMP_PERIOD}秒），` +
          '播放速度随之在约±3%内周期性地略快、略慢，正常观看时看不出来。' +
          `帧数不变，总时长最多相差${TIME_JUMP_AMPLITUDE}秒，声音不受影响。输出为 AVI 时只能以整帧为单位调整。`,
      },
      md5Change: {
        name: '修改MD5值',
        summary: '写入随机信息，文件的 MD5 随之改变',
        detail:
          '在文件中写入一段随机的注释，每次输出的文件 MD5 都不一样；原视频的标题和日期不会带到输出文件中。' +
          '只勾选这一项时直接复制音视频流，不重新编码，画质无损、速度很快；' +
          '输出格式装不下原来的编码时（例如 WMV 转 MP4），会自动改为重新编码。',
      },
      maskInvert: {
        name: '蒙版倒置',
        summary: '叠加一层半透明的反色蒙版',
        detail: '在画面上叠加一层半透明的反色蒙版。不透明度范围0~1，默认0.03；值越大画面越灰，为1时完全反色。',
      },
      frameSampling: {
        name: '视频抽帧',
        summary: '每隔几帧去掉一帧',
        detail:
          '每 N 帧去掉 1 帧（默认 N 为 5），去掉的位置由前一帧补上，声音不受影响。' +
          `勾选“随机间隔”时，间隔在 N 到 N+${SAMPLING_RANDOM_RANGE - 1} 帧之间随机变化，每次处理去掉的位置都不同。`,
      },
    } satisfies Record<FeatureKey, FeatureText>,
  },

  /** 还不能开始处理的原因 */
  problems: {
    noInput: '还没有选择视频文件',
    loading: '正在读取视频信息…',
    noFeatures: '还没有开启任何功能',
    opacity: '蒙版倒置的不透明度需要是大于 0、不超过 1 的数字，例如 0.03',
    interval: '视频抽帧的间隔需要是不小于 2 的整数，例如 5',
  },

  process: {
    title: '处理',
    stages: {
      probe: '正在读取视频信息',
      encode: '正在重新编码',
      copy: '正在复制音视频流',
      cover: '正在嵌入封面缩略图',
      finalize: '正在保存',
    } satisfies Record<Stage, string>,
    cancelling: '正在取消…',
    preparing: '准备中',
    finishing: '收尾中',
    elapsed: (time: string) => `已用 ${time}`,
    remaining: (time: string) => `预计还需 ${time}`,
    done: '处理完成',
    took: (time: string) => `用时 ${time}`,
    newMd5: '新 MD5',
    showInFolder: (platform: string | undefined) => `在${fileManagers(platform)}中显示`,
    open: '打开',
    failed: '处理失败',
    failedDetail: '详细信息见下方的处理日志',
    cancelled: '已取消',
    cancelledDetail: '未生成输出文件，已有的同名文件也没有被改动',
    waiting: '等待选择视频',
    waitingDetail: '选择或拖入一个视频文件后即可开始处理',
    notReady: '还不能开始',
    ready: '准备就绪',
    copyOnly: '只修改MD5值：直接复制音视频流，不重新编码，速度很快',
    reencode: (codec: string) => `画面重新编码为 ${codec}，声音能直接复制就不重新编码`,
    /** 已选功能中“视频抽帧”的标签，固定间隔时 to 为 null */
    samplingChip: (name: string, from: number, to: number | null) => (to === null ? `${name} ${from}帧` : `${name} ${from}~${to}帧`),
    cancel: '取消',
    starting: '准备中…',
    start: '开始处理',
    restart: '重新处理',
    clear: '清空',
    clearHint: '清空文件、参数和日志',
  },

  log: {
    title: '处理日志',
    copyAll: '复制全部日志',
    clear: '清空日志',
    empty: '暂无日志',
  },

  /** 界面写入日志和屏幕下方提示的文字 */
  app: {
    ffmpegFound: (version: string | null, path: string, source: FFmpegInfo['source']) =>
      `FFmpeg ${version ?? '（版本未知）'}：${path}（${logSources[source]}）`,
    md5Done: (slot: Md5Slot, value: string) => `${slot === 'input' ? '原文件' : '输出文件'} MD5：${value}`,
    md5Failed: (slot: Md5Slot, message: string) => `无法计算${slot === 'input' ? '原文件' : '输出文件'}的 MD5：${message}`,
    opened: (path: string) => `打开视频：${path}`,
    outputChanged: (path: string) => `输出位置改为：${path}`,
    cleared: '已清空，参数恢复为默认值',
    starting: '开始处理',
    cannotStart: (message: string) => `无法开始：${message}`,
    finished: (time: string) => `处理完成，用时 ${time}`,
    failed: (message: string) => `处理失败：${message}`,
    cancelled: '已取消处理，未生成输出文件',
    cancelling: '正在取消…',
    copied: '已复制到剪贴板',
    copyFailed: (message: string) => `复制失败：${message}`,
    openFailed: (message: string) => `无法打开文件：${message}`,
    busy: '正在处理视频，暂时不能更换文件',
    dropHere: '松开鼠标，选择这个视频',
  },

  ui: {
    decrease: (label: string) => `减小${label}`,
    increase: (label: string) => `增大${label}`,
    copied: '已复制',
  },

  /** 用时：“0.6 秒”“12 秒”“3 分 05 秒”“1 小时 3 分” */
  units: {
    seconds: (value: string) => `${value} 秒`,
    minutes: (minutes: number, seconds: string) => `${minutes} 分 ${seconds} 秒`,
    hours: (hours: number, minutes: number) => `${hours} 小时 ${minutes} 分`,
  },

  /** 主进程的系统对话框 */
  dialogs: {
    openTitle: '打开视频',
    videoFiles: '视频文件',
    allFiles: '所有文件',
    saveTitle: '选择输出位置',
    extensionFiles: (ext: string) => `.${ext} 文件`,
    cancelJob: {
      message: '确定要取消当前的处理吗？',
      detail: '已经处理的部分会被丢弃，不会生成输出文件。',
      confirm: '取消处理',
      keep: '继续处理',
    },
    overwrite: { message: '输出文件已存在，是否覆盖？', confirm: '覆盖', cancel: '取消' },
    quit: { message: '正在处理视频，退出会取消当前的处理。确定要退出吗？', confirm: '退出', keep: '继续处理' },
  },

  /** 主进程检查参数时发现的问题 */
  errors: {
    invalidArgument: '无效的参数',
    invalidPath: '无效的文件路径',
    busy: '正在处理其他视频，请等待处理完成',
    noInput: '还没有选择视频文件',
    inputMissing: (path: string) => `找不到输入文件：\n${path}`,
    noOutput: '还没有设置输出位置',
    sameFile: '输出文件不能与输入文件相同，请选择其他输出路径',
    outputDirMissing: (dir: string) => `输出文件夹不存在：\n${dir}`,
  },

  /** macOS 的应用菜单 */
  menu: {
    about: (name: string) => `关于${name}`,
    services: '服务',
    hide: (name: string) => `隐藏${name}`,
    hideOthers: '隐藏其他',
    unhide: '全部显示',
    quit: (name: string) => `退出${name}`,
    file: '文件',
    open: '打开视频…',
    close: '关闭窗口',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '拷贝',
    paste: '粘贴',
    selectAll: '全选',
    view: '显示',
    reload: '重新载入',
    devTools: '开发者工具',
    fullScreen: '切换全屏幕',
    window: '窗口',
    minimize: '最小化',
    zoom: '缩放',
    front: '前置全部窗口',
  },

  /** 处理核心写入日志的文字和错误信息 */
  processor: {
    input: (path: string) => `输入：${path}`,
    output: (path: string) => `输出：${path}`,
    cannotReadInput: (reason: string) => `无法读取输入文件：${reason}`,
    noVideo: '输入文件中没有视频画面',
    duration: (seconds: string) => `时长：${seconds} 秒`,
    noDuration: '读不到视频时长，处理时不显示进度百分比',
    cannotWriteOutput: (message: string) => `无法写入输出文件（文件可能正被其他程序打开）：${message}`,
    tempDeleteFailed: (file: string, message: string) => `删除临时文件失败：${file}（${message}）`,
    saved: '输出文件已保存',
    effectMirror: '效果：水平镜像',
    effectMask: (opacity: number) => `效果：蒙版倒置，不透明度 ${opacity}`,
    effectRgbShift: '效果：RGB偏移',
    effectTimeJump: (amplitude: number, period: number) => `效果：时间跳跃，时间轴最多偏移 ±${amplitude} 秒，周期 ${period} 秒`,
    effectSamplingRandom: (from: number, to: number) => `效果：视频抽帧，每 ${from}~${to} 帧随机抽掉 1 帧`,
    effectSamplingFixed: (interval: number) => `效果：视频抽帧，每 ${interval} 帧抽掉 1 帧`,
    copyOnly: '只修改MD5值：复制音视频流，不重新编码',
    copyFallback: (ext: string, message: string) => `无法直接复制到 ${ext} 格式，改为重新编码：${message}`,
    reencode: '重新编码视频画面',
    aviTimeJump: '提示：AVI 只能以整帧为单位记录时间，时间跳跃的偏移会按帧取整',
    noVp9: '当前 FFmpeg 不支持 WebM 所需的 VP9 编码器（libvpx-vp9），请把输出文件改为 .mp4',
    noX264: '当前 FFmpeg 不包含 H.264 编码器（libx264），无法重新编码视频',
    audioCopy: '音频直接复制，不重新编码',
    audioReencode: (ext: string, codec: string) => `${ext} 格式不支持原音频编码，音频重新编码为 ${codec}`,
    noWebmAudio: '当前 FFmpeg 不支持 WebM 所需的音频编码器（libopus / libvorbis），请把输出文件改为 .mp4',
    noCoverSupport: (ext: string) => `${ext} 格式不支持内嵌封面缩略图，已跳过`,
    coverGenerating: '生成封面缩略图',
    noThumbnail: '没有截出封面图片',
    coverFailed: (message: string) => `无法嵌入封面缩略图，输出的视频不带封面：${message}`,
    coverEmbedded: '已嵌入封面缩略图',
    command: (command: string) => `命令：${command}`,
    cannotRunFFmpeg: (message: string) => `无法运行 FFmpeg：${message}`,
    /** FFmpeg 失败时的状态，code 为 null 表示被信号结束 */
    ffmpegExit: (code: number | null, signal: string | null) =>
      code === null ? `FFmpeg 被信号 ${signal} 结束` : `FFmpeg 返回错误码 ${code}`,
  },
}

export type Messages = typeof zhCN
export type ProcessorText = Messages['processor']

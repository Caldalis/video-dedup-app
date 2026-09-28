/** 用户取消了处理。这个错误不会显示给用户，界面有自己的说明 */
export class ProcessingCancelled extends Error {
  constructor() {
    super('Processing cancelled')
    this.name = 'ProcessingCancelled'
  }
}

/** FFmpeg 执行失败，message 中带有 FFmpeg 给出的原因 */
export class FFmpegError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FFmpegError'
  }
}

/** 无法处理的情况（读不出视频、缺少编码器、无法写入输出文件等），message 可以直接显示给用户 */
export class ProcessingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProcessingError'
  }
}

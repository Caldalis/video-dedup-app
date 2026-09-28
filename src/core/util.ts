const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 生成由字母和数字组成的随机字符串 */
export function randomString(length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += ALPHANUMERIC[Math.floor(Math.random() * ALPHANUMERIC.length)]
  }
  return result
}

/** 把命令行拼成便于阅读的一行，含空格或特殊字符的参数加上双引号 */
export function formatCommand(args: readonly string[]): string {
  return args
    .map((arg) => (arg === '' || /[\s"'$`\\|&;<>()*?!#~]/.test(arg) ? `"${arg.replace(/(["\\$`])/g, '\\$1')}"` : arg))
    .join(' ')
}

/** 把陆续收到的文本切成行。FFmpeg 的进度行以 \r 结尾，所以 \r、\n、\r\n 都算换行；空行会被丢掉 */
export class LineSplitter {
  private buffer = ''
  private readonly onLine: (line: string) => void

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine
  }

  push(chunk: string): void {
    this.buffer += chunk
    const parts = this.buffer.split(/\r\n|\r|\n/)
    this.buffer = parts.pop() ?? ''
    for (const part of parts) this.emit(part)
  }

  flush(): void {
    const rest = this.buffer
    this.buffer = ''
    this.emit(rest)
  }

  private emit(text: string): void {
    const line = text.trim()
    if (line) this.onLine(line)
  }
}

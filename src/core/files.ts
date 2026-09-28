import { createHash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'

/** 计算文件的 MD5 值，按 1MB 分块读取；signal 触发时停止计算并抛出 AbortError */
export async function md5File(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('md5')
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024, signal })) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

/** 默认输出路径：原文件所在目录，文件名末尾加 _dedup */
export function defaultOutputPath(input: string): string {
  const { dir, name, ext } = path.parse(input)
  return path.join(dir, `${name}_dedup${ext}`)
}

/** 判断两个路径是否指向同一个文件（包括大小写不同、符号链接等写法） */
export function isSameFile(a: string, b: string): boolean {
  try {
    const statA = statSync(a, { bigint: true })
    const statB = statSync(b, { bigint: true })
    return statA.dev === statB.dev && statA.ino === statB.ino
  } catch {
    // 其中一个文件还不存在时，比较规范化后的路径（Windows 的路径不区分大小写）
    const normalize = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
    return normalize(a) === normalize(b)
  }
}

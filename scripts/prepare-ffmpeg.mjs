// 准备打包进安装包的 FFmpeg：放在 build/ffmpeg/bin 中，打包时复制到安装包的 resources/ffmpeg（pnpm dist 会先执行这个脚本）。
// 大部分系统直接用 ffmpeg-static 下载的 FFmpeg；Apple 芯片 Mac 上 ffmpeg-static 的版本含有不能再分发的部分，
// 改用 Shaka Project 按 GPL 发布的静态版本（需要 macOS 15 及以上）。最后检查许可证和本工具用到的编码器，不符合时报错退出
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = path.join(ROOT, 'build', 'ffmpeg', 'bin')
const EXECUTABLE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

// Apple 芯片 Mac 用的 FFmpeg。固定版本并校验 SHA-256；换版本时同时更新 build/ffmpeg/SOURCES.md
const APPLE_SILICON = {
  url: 'https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.1.2-1/ffmpeg-osx-arm64',
  sha256: 'e7b9fcd97f95f333512d6e8b8ac24d9dbc08f189f36047695499bd7b57214b22',
}

// 本工具用到的编码器：H.264、VP9（WebM）、AAC、封面图的 JPEG；WebM 的声音用 Opus 或 Vorbis 其中之一
const REQUIRED_ENCODERS = ['libx264', 'libvpx-vp9', 'aac', 'mjpeg']
const WEBM_AUDIO_ENCODERS = ['libopus', 'libvorbis']

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 下载 Apple 芯片版的 FFmpeg 到 target。下载过的文件缓存在 node_modules/.cache 中，校验通过就不再下载 */
async function fetchAppleSilicon(target) {
  const cache = path.join(ROOT, 'node_modules', '.cache', 'video-dedup', `ffmpeg-osx-arm64-${APPLE_SILICON.sha256.slice(0, 12)}`)
  if (!existsSync(cache) || sha256(cache) !== APPLE_SILICON.sha256) {
    console.log(`下载 ${APPLE_SILICON.url}`)
    const response = await fetch(APPLE_SILICON.url)
    if (!response.ok) throw new Error(`下载 FFmpeg 失败：HTTP ${response.status}`)
    mkdirSync(path.dirname(cache), { recursive: true })
    writeFileSync(cache, Buffer.from(await response.arrayBuffer()))
    const actual = sha256(cache)
    if (actual !== APPLE_SILICON.sha256) {
      rmSync(cache, { force: true })
      throw new Error(`下载的 FFmpeg 校验失败：SHA-256 是 ${actual}，应为 ${APPLE_SILICON.sha256}`)
    }
  }
  copyFileSync(cache, target)
}

function run(ffmpeg, args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`运行 ffmpeg ${args.join(' ')} 失败：\n${result.stderr}`)
  return result.stdout + result.stderr
}

/** 检查许可证和编码器，返回版本信息（ffmpeg -version 的第一行） */
function check(ffmpeg) {
  const license = run(ffmpeg, ['-L'])
  if (!license.includes('GNU General Public License') || /nonfree|not legally redistributable/i.test(license)) {
    throw new Error(`这个 FFmpeg 不能按 GPL 再分发：\n${license}`)
  }
  // 每行的格式是 " V....D libx264   libx264 H.264 / AVC ..."，第二列是编码器名称
  const encoders = new Set(
    run(ffmpeg, ['-encoders'])
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[1]),
  )
  const missing = REQUIRED_ENCODERS.filter((name) => !encoders.has(name))
  if (!WEBM_AUDIO_ENCODERS.some((name) => encoders.has(name))) missing.push(WEBM_AUDIO_ENCODERS.join(' / '))
  if (missing.length > 0) throw new Error(`这个 FFmpeg 缺少本工具用到的编码器：${missing.join('、')}`)
  return run(ffmpeg, ['-version']).split('\n')[0]
}

const target = path.join(OUT_DIR, EXECUTABLE)
rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })
if (process.platform === 'darwin' && process.arch === 'arm64') {
  await fetchAppleSilicon(target)
} else {
  copyFileSync(path.join(ROOT, 'node_modules', 'ffmpeg-static', EXECUTABLE), target)
}
chmodSync(target, 0o755)
console.log(`${check(target)}\n已准备好：${path.relative(ROOT, target)}`)

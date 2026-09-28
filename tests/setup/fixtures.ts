// 用测试所用的 FFmpeg 生成测试素材。素材按 FFmpeg 分目录缓存，已经生成过的不会重新生成
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FFMPEG, FFMPEG_VERSION, FIXTURES_DIR, ffmpeg } from '../helpers/media'

const QUIET = ['-loglevel', 'error', '-y', '-nostdin']

function lavfiClip(size: string, rate: number, seconds: number): string[] {
  return [
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  ]
}

// 名称 → 生成命令（输出文件名由调用方加在最后）。后面的素材可以用前面生成好的素材
const FIXTURES: Array<[string, () => string[]]> = [
  ['s30.mp4', () => lavfiClip('640x360', 30, 16)],
  ['s24.mp4', () => lavfiClip('640x360', 24, 12)],
  ['s60.mp4', () => lavfiClip('640x360', 60, 10)],
  ['in.mkv', () => ['-i', src('s30.mp4'), '-t', '6', '-c:v', 'libx264', '-c:a', 'aac']],
  ['in.avi', () => ['-i', src('s30.mp4'), '-t', '6', '-c:v', 'mpeg4', '-c:a', 'libmp3lame']],
  ['in.mov', () => ['-i', src('s30.mp4'), '-t', '6', '-c:v', 'libx264', '-c:a', 'pcm_s16le']],
  ['in.webm', () => ['-i', src('s30.mp4'), '-t', '6', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus']],
  ['in.flv', () => ['-i', src('s30.mp4'), '-t', '6', '-c:v', 'libx264', '-c:a', 'aac']],
  ['in.wmv', () => ['-i', src('s30.mp4'), '-t', '6', '-c:v', 'wmv2', '-c:a', 'wmav2']],
  ['in.m4v', () => ['-i', src('s30.mp4'), '-t', '6', '-c', 'copy']],
  // 标题是 GBK 编码的“你好视频”，FFmpeg 会原样输出这些不是 UTF-8 的字节
  ['gbk.mkv', () => ['-i', src('s30.mp4'), '-i', src('gbk.ffmeta'), '-map_metadata', '1', '-t', '6', '-c', 'copy']],
  // 真正的奇数宽高（641x361）且是 4:4:4，必须先裁成偶数才能输出 yuv420p
  ['odd.mkv', () => ['-f', 'lavfi', '-i', 'testsrc2=size=642x362:rate=30:duration=3', '-vf', 'format=yuv444p,crop=641:361', '-c:v', 'ffv1']],
  // 可变帧率：与做过时间跳跃的视频一样，每帧的间隔在 1/24 秒上下 ±3% 波动（需要 -fps_mode vfr 才能保留）
  ['vfr.mp4', () => [
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=15',
    '-vf', "settb=1/90000,setpts='PTS+0.04*sin(2*PI*T/8)/TB'", '-fps_mode', 'vfr', '-enc_time_base:v', '1/90000',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  ]],
  // 取消测试用的长视频：60 秒 1080p
  ['long.mp4', () => [
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=60', '-f', 'lavfi', '-i', 'sine=duration=60',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  ]],
  ['audio_only.m4a', () => ['-f', 'lavfi', '-i', 'sine=duration=2', '-c:a', 'aac']],
  // 只有 1 秒的短视频：封面从中间取图
  ['short.mp4', () => lavfiClip('640x360', 30, 1)],
  // 手机竖拍的视频：画面按 640x360 存储，播放时按旋转信息转成竖屏
  ['rotated.mp4', () => ['-display_rotation:v:0', '90', '-i', src('in.m4v'), '-c', 'copy']],
  // 带 SRT 字幕的 MKV
  ['sub.mkv', () => ['-i', src('in.m4v'), '-i', src('sub.srt'), '-map', '0', '-map', '1', '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'srt']],
]

function src(name: string): string {
  return path.join(FIXTURES_DIR, name)
}

export default function setup(): void {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  const gbkTitle = Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xd3, 0xc6, 0xb5])
  writeFileSync(src('gbk.ffmeta'), Buffer.concat([Buffer.from(';FFMETADATA1\ntitle='), gbkTitle, Buffer.from('\n')]))
  writeFileSync(src('bad.mp4'), 'this is not a video')
  writeFileSync(src('sub.srt'), '1\n00:00:00,500 --> 00:00:02,000\n你好，字幕\n\n2\n00:00:02,500 --> 00:00:04,000\nsecond line\n')

  const missing = FIXTURES.filter(([name]) => !existsSync(src(name)))
  if (missing.length > 0) {
    console.log(`生成测试素材（FFmpeg ${FFMPEG_VERSION}: ${FFMPEG}）→ ${FIXTURES_DIR}`)
  }
  for (const [name, args] of missing) {
    // 先写到临时文件，生成完整后再改名，免得中途退出留下不完整的素材
    const partial = src(`partial-${name}`)
    const result = ffmpeg([...QUIET, ...args(), partial])
    if (result.status !== 0) throw new Error(`生成测试素材 ${name} 失败:\n${result.stderr}`)
    renameSync(partial, src(name))
  }
}

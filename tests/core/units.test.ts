// 不需要运行 FFmpeg 的单元测试：滤镜、参数校验、输出解析、路径和 MD5 等
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FFMPEG_ENV_VAR, isVersionSupported, locateFFmpeg, parseEncoders } from '../../src/core/ffmpeg'
import { defaultOutputPath, isSameFile, md5File } from '../../src/core/files'
import { buildVideoFilters } from '../../src/core/filters'
import { parseMediaInfo, timeToSeconds } from '../../src/core/probe'
import { formatCommand, LineSplitter, randomString } from '../../src/core/util'
import {
  DEFAULT_FEATURES,
  INTERVAL_ERROR,
  OPACITY_ERROR,
  isCopyOnly,
  parseInterval,
  parseOpacity,
  validateFeatures,
  type FeatureOptions,
} from '../../src/shared/options'

const NONE: FeatureOptions = { ...DEFAULT_FEATURES, timeJump: false, md5Change: false }
// 在 beforeAll 中创建：用 -t 只运行部分测试时，这个文件可能一个测试都不执行，afterAll 也就不会执行，
// 在文件顶层创建会留下空目录
let tmp = ''
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'video-dedup-units-'))
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('buildVideoFilters', () => {
  it('全部开启时的滤镜，顺序为 镜像、蒙版、RGB、时间跳跃、抽帧', () => {
    const all = { ...NONE, mirror: true, rgbShift: true, timeJump: true, maskInvert: true, frameSampling: true, samplingRandom: false }
    expect(buildVideoFilters(all)).toEqual([
      'hflip',
      "lutyuv=y='val+(negval-val)*0.03':u='val+(negval-val)*0.03':v='val+(negval-val)*0.03'",
      'rgbashift=rh=1:bv=1',
      "settb=1/90000,setpts='PTS+0.04*sin(2*PI*T/8)/TB'",
      "select='mod(n+1,5)'",
    ])
  })

  it('只勾选修改MD5值时没有滤镜（直接复制音视频流）', () => {
    expect(buildVideoFilters({ ...NONE, md5Change: true })).toEqual([])
    expect(isCopyOnly({ ...NONE, md5Change: true })).toBe(true)
    expect(isCopyOnly(DEFAULT_FEATURES)).toBe(false)
  })

  it('随机抽帧：种子是 2^32 ~ 2^52 之间的整数，间隔为 N ~ N+5', () => {
    for (const r of [0, 0.5, 0.999999999]) {
      const [filter] = buildVideoFilters({ ...NONE, frameSampling: true, samplingInterval: 7 }, () => r)
      const seed = Number(/st\(1,(\d+)\)/.exec(filter)?.[1])
      expect(Number.isSafeInteger(seed) && seed >= 2 ** 32 && seed <= 2 ** 52).toBe(true)
      expect(filter).toBe(
        `select='if(eq(n,0),st(1,${seed});st(0,7+floor(random(1)*6)-1));if(eq(n,ld(0)),st(0,n+7+floor(random(1)*6))*0,1)'`,
      )
    }
  })

  it('蒙版不透明度原样写入表达式', () => {
    expect(buildVideoFilters({ ...NONE, maskInvert: true, maskOpacity: 1 })[0]).toContain('*1\'')
    expect(buildVideoFilters({ ...NONE, maskInvert: true, maskOpacity: 0.5 })[0]).toContain('*0.5\'')
  })
})

describe('参数校验', () => {
  it('没有开启任何功能时不能开始', () => {
    expect(validateFeatures(NONE)).toBe('还没有开启任何功能')
    expect(validateFeatures(DEFAULT_FEATURES)).toBeNull()
  })

  it('不透明度需要大于 0、不超过 1', () => {
    for (const text of ['0.03', '1', ' 0.5 ', '1e-2']) {
      expect(validateFeatures({ ...NONE, maskInvert: true, maskOpacity: parseOpacity(text) })).toBeNull()
    }
    for (const text of ['0', '-0.1', '1.01', 'abc', '', ' ']) {
      expect(validateFeatures({ ...NONE, maskInvert: true, maskOpacity: parseOpacity(text) })).toBe(OPACITY_ERROR)
    }
    // 没有勾选蒙版倒置时不检查不透明度
    expect(validateFeatures({ ...DEFAULT_FEATURES, maskOpacity: Number.NaN })).toBeNull()
  })

  it('抽帧间隔需要是不小于 2 的整数', () => {
    for (const text of ['2', '5', ' 10 ']) {
      expect(validateFeatures({ ...NONE, frameSampling: true, samplingInterval: parseInterval(text) })).toBeNull()
    }
    for (const text of ['1', '0', '5.0', '2.5', '-3', 'x', '']) {
      expect(validateFeatures({ ...NONE, frameSampling: true, samplingInterval: parseInterval(text) })).toBe(INTERVAL_ERROR)
    }
  })
})

describe('parseMediaInfo', () => {
  const mp4 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:01:23.45, start: 0.000000, bitrate: 1234 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 1000 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)
  Stream #0:2[0x0]: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 640x360 [SAR 1:1 DAR 16:9], 90k tbr, 90k tbn (attached pic)
At least one output file must be specified`

  it('读取时长、画面和声音的信息', () => {
    expect(parseMediaInfo(mp4)).toEqual({
      duration: 83.45,
      hasVideo: true,
      hasAudio: true,
      video: { codec: 'h264', width: 1920, height: 1080, fps: 29.97, rotation: 0 },
      audio: { codec: 'aac', sampleRate: 44100, channels: 'stereo' },
      error: '',
    })
  })

  it('封面图不算画面：只有封面的音频文件没有视频', () => {
    const mp3 = `Input #0, mp3, from 'a.mp3':
  Duration: 00:03:00.00, start: 0.025057, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 320 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj444p(pc), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)`
    const info = parseMediaInfo(mp3)
    expect(info.hasVideo).toBe(false)
    expect(info.hasAudio).toBe(true)
  })

  it('打不开的文件：最后一行是原因', () => {
    const bad = `[mov,mp4,m4a,3gp,3g2,mj2 @ 0x7f8] moov atom not found
[in#0 @ 0x7f9] Error opening input: Invalid data found when processing input
Error opening input file bad.mp4.
Error opening input files: Invalid data found when processing input`
    const info = parseMediaInfo(bad)
    expect(info.hasVideo).toBe(false)
    expect(info.error).toBe('Error opening input files: Invalid data found when processing input')
  })

  it.each([
    ['FFmpeg 6/7', 'displaymatrix: rotation of -90.00 degrees'],
    ['FFmpeg 8/9', 'Display Matrix: rotation of -90.00 degrees'],
  ])('带旋转信息的视频（%s 的写法）：宽高按播放时的方向换算', (_version, sideData) => {
    const stderr = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Duration: 00:00:05.00, start: 0.000000, bitrate: 1234 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 1920x1080, 1000 kb/s, 30 fps, 30 tbr, 600 tbn (default)
    Metadata:
      handler_name    : Core Media Video
    Side data:
      ${sideData}
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)
    Side data:
      ${sideData}`
    expect(parseMediaInfo(stderr).video).toEqual({ codec: 'hevc', width: 1080, height: 1920, fps: 30, rotation: -90 })
  })

  it('时长为 N/A 时不显示进度', () => {
    expect(parseMediaInfo("Input #0, h264, from 'a.h264':\n  Duration: N/A, bitrate: N/A").duration).toBeNull()
  })

  it('timeToSeconds', () => {
    expect(timeToSeconds('01:02:03.5')).toBe(3723.5)
    expect(timeToSeconds('00:00:16')).toBe(16)
    expect(timeToSeconds('N/A')).toBe(-1)
  })
})

describe('FFmpeg 输出与命令', () => {
  it('parseEncoders 只读取分隔线以下的编码器名称', () => {
    const output = `Encoders:
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)`
    expect([...parseEncoders(output)]).toEqual(['libx264', 'aac'])
  })

  it('isVersionSupported：-fps_mode 需要 FFmpeg 5.1 及以上', () => {
    expect(isVersionSupported('6.0')).toBe(true)
    expect(isVersionSupported('5.1.2')).toBe(true)
    expect(isVersionSupported('n7.1')).toBe(true)
    expect(isVersionSupported('5.0.1')).toBe(false)
    expect(isVersionSupported('4.4.2-0ubuntu0.22.04.1')).toBe(false)
    expect(isVersionSupported('N-112345-g0123abcd')).toBe(true)
    expect(isVersionSupported(null)).toBe(true)
  })

  it('LineSplitter 把 \\r、\\n、\\r\\n 都当作换行，跨块的行也能拼好', () => {
    const lines: string[] = []
    const splitter = new LineSplitter((line) => lines.push(line))
    splitter.push('frame=1 time=00:00:01\rframe=2 ti')
    splitter.push('me=00:00:02\r\n\nlast')
    splitter.flush()
    expect(lines).toEqual(['frame=1 time=00:00:01', 'frame=2 time=00:00:02', 'last'])
  })

  it('formatCommand 给含空格和特殊字符的参数加引号', () => {
    expect(formatCommand(['ffmpeg', '-i', '/a b/c.mp4', '-vf', "setpts='PTS+1'", 'out.mp4'])).toBe(
      `ffmpeg -i "/a b/c.mp4" -vf "setpts='PTS+1'" out.mp4`,
    )
  })

  it('randomString 只含字母和数字', () => {
    expect(randomString(32)).toMatch(/^[A-Za-z0-9]{32}$/)
  })
})

describe('查找 FFmpeg', () => {
  const makeExecutable = (name: string) => {
    const dir = path.join(tmp, name)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    writeFileSync(file, '#!/bin/sh\n')
    chmodSync(file, 0o755)
    return file
  }

  it('顺序：环境变量 → 随程序提供的 → PATH；无效的路径会被跳过', () => {
    const envExe = makeExecutable('env')
    const bundledExe = makeExecutable('bundled')
    const systemExe = makeExecutable('system')
    const PATH = path.dirname(systemExe)

    expect(locateFFmpeg([bundledExe], { [FFMPEG_ENV_VAR]: envExe, PATH })).toEqual({ path: envExe, source: 'env' })
    expect(locateFFmpeg([bundledExe], { [FFMPEG_ENV_VAR]: '/no/such/ffmpeg', PATH })).toEqual({
      path: bundledExe,
      source: 'bundled',
    })
    expect(locateFFmpeg(['/no/such/ffmpeg'], { PATH })).toEqual({ path: systemExe, source: 'system' })
    if (process.platform !== 'win32') {
      // 没有执行权限的文件不算
      chmodSync(bundledExe, 0o644)
      expect(locateFFmpeg([bundledExe], { PATH })?.source).toBe('system')
    }
  })
})

describe('文件', () => {
  it('默认输出路径：原目录，文件名末尾加 _dedup', () => {
    expect(defaultOutputPath('/videos/a.b.mp4')).toBe(path.join('/videos', 'a.b_dedup.mp4'))
    expect(defaultOutputPath('/videos/clip')).toBe(path.join('/videos', 'clip_dedup'))
  })

  it('isSameFile 能识别符号链接和不同写法，文件不存在时比较路径', () => {
    const file = path.join(tmp, 'same.mp4')
    writeFileSync(file, 'x')
    const link = path.join(tmp, 'link.mp4')
    symlinkSync(file, link)
    expect(isSameFile(file, link)).toBe(true)
    expect(isSameFile(file, path.join(tmp, '.', 'same.mp4'))).toBe(true)
    expect(isSameFile(file, path.join(tmp, 'other.mp4'))).toBe(false)
    expect(isSameFile(path.join(tmp, 'n1.mp4'), path.join(tmp, 'sub', '..', 'n1.mp4'))).toBe(true)
  })

  it('md5File 与一次读完整个文件的结果相同，并且可以中途取消', async () => {
    const file = path.join(tmp, 'data.bin')
    const data = Buffer.alloc(3 * 1024 * 1024 + 123, 7)
    writeFileSync(file, data)
    expect(await md5File(file)).toBe(createHash('md5').update(data).digest('hex'))
    const controller = new AbortController()
    controller.abort()
    await expect(md5File(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

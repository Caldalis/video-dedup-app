// 界面测试：出错时的提示、快捷键与菜单、复制和打开文件、安全限制、设置文件损坏、重复启动
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ELECTRON,
  answerOpenDialog,
  assertBuilt,
  launch,
  logText,
  makeWorkDir,
  selectVideo,
  type Launched,
} from '../helpers/app'
import { FFMPEG, ROOT, fileMd5, fixture } from '../helpers/media'

assertBuilt()
const WORK = makeWorkDir('e2e-edge-')
const OUT = path.join(WORK, 'out')
mkdirSync(OUT)
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

describe('出错时的提示', () => {
  let ui: Launched
  beforeAll(async () => {
    ui = await launch(mkdtempSync(path.join(WORK, 'userdata-')))
  })
  afterAll(async () => {
    await ui?.app.close()
  })

  it('不是视频的文件、只有声音的文件：说明原因，不能开始处理', async () => {
    const { app, page } = ui
    const start = page.getByRole('button', { name: '开始处理' })

    await answerOpenDialog(app, fixture('bad.mp4'))
    await page.locator('.dropzone').click()
    await expect.poll(() => page.locator('.file-meta .text-danger').textContent()).toMatch(/无法读取这个文件：.*Invalid data/)
    expect(await page.locator('.status-title').textContent()).toBe('还不能开始')
    expect(await start.isDisabled()).toBe(true)
    // 不能处理的文件不需要选择输出位置
    expect(await page.getByRole('button', { name: '更改…' }).isDisabled()).toBe(true)

    await answerOpenDialog(app, fixture('audio_only.m4a'))
    await page.getByRole('button', { name: '更换' }).click()
    await expect.poll(() => page.locator('.file-meta .text-danger').textContent()).toContain('这个文件中没有视频画面')
    expect(await start.isDisabled()).toBe(true)
  })

  it('FFmpeg 处理失败：显示“处理失败”和 FFmpeg 给出的原因', async () => {
    const { page } = ui
    await selectVideo(ui, fixture('s30.mp4'), path.join(OUT, 'unknown.xyz'))
    await page.getByRole('button', { name: '开始处理' }).click()
    await page.getByText('处理失败', { exact: true }).waitFor({ timeout: 60_000 })
    expect(await page.locator('.error-box').textContent()).toMatch(/output format|Unable to/i)
    expect((await logText(page)).some((line) => line.startsWith('处理失败：FFmpeg'))).toBe(true)
    expect(await page.getByRole('button', { name: '重新处理' }).isEnabled()).toBe(true)
  })

  it('手机竖拍的视频（带旋转信息）：显示播放时的宽高', async () => {
    const { app, page } = ui
    await answerOpenDialog(app, fixture('rotated.mp4'))
    await page.getByRole('button', { name: '更换' }).click()
    await expect.poll(() => page.locator('.file-meta .chip').allTextContents()).toContain('360×640')
  })

  it('说明弹层：点击 ⓘ 打开，按 Esc 关闭', async () => {
    const { page } = ui
    await page.locator('[data-feature="timeJump"] .info-btn').click()
    await expect.poll(() => page.locator('.popover:popover-open').count()).toBe(1)
    expect(await page.locator('.popover:popover-open').textContent()).toContain('按正弦规律')
    await page.keyboard.press('Escape')
    await expect.poll(() => page.locator('.popover:popover-open').count()).toBe(0)
  })
})

describe('快捷操作', () => {
  let ui: Launched
  beforeAll(async () => {
    ui = await launch(mkdtempSync(path.join(WORK, 'userdata-')))
    // 不真的打开访达或播放器，也不改动本机的剪贴板，只记下要做什么
    await ui.app.evaluate(({ shell, clipboard }) => {
      const opened: string[] = []
      const copied: string[] = []
      Object.assign(globalThis, { opened, copied })
      shell.showItemInFolder = (file: string) => void opened.push(`show:${file}`)
      shell.openPath = async (file: string) => {
        opened.push(`open:${file}`)
        return ''
      }
      clipboard.writeText = async (text: string) => {
        copied.push(text)
      }
    })
  })
  afterAll(async () => {
    await ui?.app.close()
  })

  it('⌘/Ctrl+Enter 开始处理；完成后可以在访达中显示、打开输出文件', async () => {
    const { app, page } = ui
    const output = path.join(OUT, 'shortcut.mp4')
    await selectVideo(ui, fixture('s30.mp4'), output)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await page.getByText('处理完成', { exact: true }).waitFor({ timeout: 60_000 })

    await page.getByRole('button', { name: /中显示$/ }).click()
    await page.getByRole('button', { name: '打开', exact: true }).click()
    const opened = await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)
    expect(opened).toEqual([`show:${output}`, `open:${output}`])
  })

  it('复制 MD5：复制的是完整的 MD5 值', async () => {
    const { app, page } = ui
    await page.locator('.result .md5-value code').waitFor()
    await page.locator('.result').getByRole('button', { name: '复制 MD5' }).click()
    await page.getByText('已复制到剪贴板').waitFor()
    const copied = await app.evaluate(() => (globalThis as unknown as { copied: string[] }).copied)
    expect(copied).toEqual([fileMd5(path.join(OUT, 'shortcut.mp4'))])
  })

  it.runIf(process.platform === 'darwin')('macOS 菜单“文件 → 打开视频…”：打开选择文件的对话框', async () => {
    const { app, page } = ui
    await answerOpenDialog(app, fixture('in.mov'))
    await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()!.items.find((item) => item.label === '文件')!
      file.submenu!.items.find((item) => item.label === '打开视频…')!.click()
    })
    await expect.poll(() => page.locator('.file-name').textContent()).toBe('in.mov')
  })
})

describe('安全', () => {
  it('界面不能直接使用 Node.js，只有 window.api；不能打开新窗口或跳转到其他页面', async () => {
    const { app, page } = await launch(mkdtempSync(path.join(WORK, 'userdata-')))
    expect(await page.evaluate<string>('typeof require')).toBe('undefined')
    expect(await page.evaluate<string>('typeof process')).toBe('undefined')
    expect(await page.evaluate<string[]>('Object.keys(window.api).sort()')).toEqual(
      [
        'cancelJob', 'cancelMd5', 'chooseInput', 'chooseOutput', 'copyText', 'getAppInfo', 'getTheme', 'inspectInput',
        'md5', 'onJobEvent', 'onMenuCommand', 'openFile', 'pathForFile', 'setTheme', 'showInFolder', 'startJob',
      ].sort(),
    )
    const url = page.url()
    expect(await page.evaluate<boolean>("window.open('https://example.com') === null")).toBe(true)
    await page.evaluate("location.href = 'https://example.com'")
    await page.waitForTimeout(500)
    expect(page.url()).toBe(url)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    // 打包后的页面带有内容安全策略
    expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain(
      "script-src 'self'",
    )
    await app.close()
  })
})

describe('启动', () => {
  it('设置文件损坏时按默认设置启动', async () => {
    const userData = mkdtempSync(path.join(WORK, 'userdata-broken-'))
    writeFileSync(path.join(userData, 'settings.json'), '{ this is not json')
    const { app, page } = await launch(userData)
    expect(await page.getByRole('radio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe('true')
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system')
    await app.close()
  })

  it('只运行一个实例：再次启动时直接退出，已经打开的窗口保持不变', async () => {
    const userData = mkdtempSync(path.join(WORK, 'userdata-single-'))
    const { app } = await launch(userData)
    const second = spawn(ELECTRON, ['.', `--user-data-dir=${userData}`], { cwd: ROOT, stdio: 'ignore' })
    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        second.kill()
        resolve(-1)
      }, 15_000)
      second.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    expect(exitCode).toBe(0)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await app.close()
  })

  it.runIf(process.platform !== 'win32')('用环境变量 VIDEO_DEDUP_FFMPEG 指定的 FFmpeg 优先，路径中有空格也能用', async () => {
    // 一个转发给测试所用 FFmpeg 的脚本：路径与随程序提供的不同，才能看出用的是哪一个
    const custom = path.join(WORK, 'my ffmpeg')
    writeFileSync(custom, `#!/bin/sh\nexec "${FFMPEG}" "$@"\n`, { mode: 0o755 })
    const ui = await launch(mkdtempSync(path.join(WORK, 'userdata-')), { ...process.env, VIDEO_DEDUP_FFMPEG: custom })
    await expect.poll(async () => (await logText(ui.page))[0]).toMatch(/^FFmpeg \S+：/)
    expect((await logText(ui.page))[0].endsWith(`：${custom}（环境变量 VIDEO_DEDUP_FFMPEG 指定）`)).toBe(true)
    await selectVideo(ui, fixture('s30.mp4'), path.join(OUT, 'custom.mp4'))
    await ui.page.getByRole('button', { name: '开始处理' }).click()
    await ui.page.getByText('处理完成', { exact: true }).waitFor({ timeout: 60_000 })
    await ui.app.close()
  })
})

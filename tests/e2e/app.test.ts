// 界面测试：用 Playwright 启动构建好的程序（先执行 pnpm build），系统对话框由测试代替用户回答
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FILE_BUTTONS,
  answerMessageBoxes,
  answerOpenDialog,
  assertBuilt,
  launch as launchApp,
  logText,
  makeWorkDir,
  selectVideo,
  shownMessageBoxes,
  type Launched,
} from '../helpers/app'
import { ffmpegProcesses, fileMd5, fixture, leftovers } from '../helpers/media'

assertBuilt()
const WORK = makeWorkDir('e2e-')
const OUT = path.join(WORK, 'out')
const SHOTS = path.join(WORK, 'screenshots')
mkdirSync(OUT)
mkdirSync(SHOTS)
afterAll(() => {
  if (!process.env.KEEP_E2E_FILES) rmSync(WORK, { recursive: true, force: true })
})

/** lang 是模拟的系统语言，默认中文 */
const launch = (userData = mkdtempSync(path.join(WORK, 'userdata-')), lang?: string) => launchApp(userData, process.env, lang)

/** 读取用户数据目录中的设置文件，还没有写入时返回 null */
function savedSettings(userData: string): unknown {
  try {
    return JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'))
  } catch {
    return null
  }
}

describe('主要流程', () => {
  let ui: Launched
  beforeAll(async () => {
    ui = await launch()
  })
  afterAll(async () => {
    await ui?.app.close()
  })

  it('启动后：显示使用的 FFmpeg，“时间跳跃”和“修改MD5值”默认开启，还不能开始处理', async () => {
    const { page } = ui
    expect(await page.title()).toBe('视频去重工具')
    await expect.poll(() => page.locator('.status-pill').textContent()).toMatch(/^FFmpeg \S+/)
    const on = await page.locator('.feature.is-on .feature-label').allTextContents()
    expect(on).toEqual(['时间跳跃', '修改MD5值'])
    expect(await page.getByRole('button', { name: '开始处理' }).isDisabled()).toBe(true)
    expect(await page.locator('.status-title').textContent()).toBe('等待选择视频')
    expect((await logText(page))[0]).toMatch(/^FFmpeg .+（随程序提供|系统中安装|环境变量/)
  })

  it('选择视频：显示时长、分辨率、帧率和编码，原始 MD5 与文件一致，默认输出到原目录并加 _dedup', async () => {
    const { app, page } = ui
    await answerOpenDialog(app, fixture('s30.mp4'))
    await page.locator('.dropzone').click()
    // 视频信息和 MD5 分别读取，谁先完成不一定
    await expect
      .poll(() => page.locator('.file-meta .chip').allTextContents())
      .toEqual(expect.arrayContaining(['00:16', '640×360', '30 fps', 'H264 / AAC']))
    await page.locator('.md5-value code').waitFor()
    expect(await page.locator('.md5-value code').textContent()).toBe(fileMd5(fixture('s30.mp4')))
    await expect.poll(() => page.locator('.path-name').textContent()).toBe('s30_dedup.mp4')
    expect(await page.locator('.path-dir').textContent()).toBe(path.dirname(fixture('s30.mp4')))
    expect(await page.locator('.status-title').textContent()).toBe('准备就绪')
    await page.screenshot({ path: path.join(SHOTS, 'selected.png') })
  })

  it('参数有误时不能开始处理，并说明原因', async () => {
    const { page } = ui
    const start = page.getByRole('button', { name: '开始处理' })
    await page.locator('[data-feature="maskInvert"]').click()
    const opacity = page.getByLabel('不透明度', { exact: true })
    await opacity.fill('0')
    expect(await start.isDisabled()).toBe(true)
    expect(await page.locator('.status-detail').textContent()).toContain('不透明度需要是大于 0、不超过 1')
    await page.getByRole('button', { name: '增大不透明度' }).click()
    expect(await opacity.inputValue()).toBe('0.01')
    expect(await start.isDisabled()).toBe(false)
    // 展开后卡片中间是参数区域，点那里不会切换功能，所以点开关
    await page.getByRole('switch', { name: '蒙版倒置' }).click()
    expect(await page.getByRole('switch', { name: '蒙版倒置' }).getAttribute('aria-checked')).toBe('false')

    for (const name of ['时间跳跃', '修改MD5值']) await page.getByRole('switch', { name }).click()
    expect(await page.locator('.status-detail').textContent()).toBe('还没有开启任何功能')
    expect(await start.isDisabled()).toBe(true)
    await page.getByRole('button', { name: '恢复默认' }).click()
    expect(await page.locator('.feature.is-on .feature-label').allTextContents()).toEqual(['时间跳跃', '修改MD5值'])
  })

  it('处理完成：生成输出文件，显示新文件的 MD5，日志按顺序排列，不留临时文件', async () => {
    const { page } = ui
    const output = path.join(OUT, 'done.mp4')
    await selectVideo(ui, fixture('s30.mp4'), output)
    await page.locator('[data-feature="mirror"]').click()
    await page.getByRole('button', { name: '开始处理' }).click()
    await page.getByText('处理完成', { exact: true }).waitFor({ timeout: 60_000 })
    await page.locator('.result .md5-value code').waitFor()

    expect(existsSync(output)).toBe(true)
    expect(await page.locator('.result .md5-value code').textContent()).toBe(fileMd5(output))
    const lines = await logText(page)
    const saved = lines.indexOf('输出文件已保存')
    expect(saved).toBeGreaterThan(-1)
    expect(saved).toBeLessThan(lines.findIndex((line) => line.startsWith('处理完成，用时 ')))
    expect(lines).toContain('效果：水平镜像')
    expect(leftovers(OUT)).toEqual([])
    await page.screenshot({ path: path.join(SHOTS, 'done.png') })
  })

  it('输出文件已存在且不是在“另存为”中选的：先询问是否覆盖，选择取消时不处理', async () => {
    const { app, page } = ui
    const output = path.join(OUT, 'done.mp4')
    const before = fileMd5(output)
    await answerMessageBoxes(app, 1)
    await page.getByRole('button', { name: '重新处理' }).click()
    await expect.poll(() => shownMessageBoxes(app)).toEqual(['输出文件已存在，是否覆盖？'])
    await expect.poll(() => page.getByRole('button', { name: '开始处理' }).isEnabled()).toBe(true)
    expect(fileMd5(output)).toBe(before)
  })

  it('取消处理：确认后很快结束，不留下临时文件和 FFmpeg 进程', async () => {
    const { app, page } = ui
    // 输出为 WebM 时用 VP9 编码，比较慢，来得及取消
    await selectVideo(ui, fixture('long.mp4'), path.join(OUT, 'cancel.webm'))
    await page.getByRole('button', { name: '开始处理' }).click()
    await expect.poll(() => page.locator('.progress-percent').textContent(), { timeout: 30_000 }).toMatch(/^\d+%$/)
    await page.screenshot({ path: path.join(SHOTS, 'running.png') })
    await answerMessageBoxes(app, 0)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByText('已取消', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await shownMessageBoxes(app)).toEqual(['确定要取消当前的处理吗？'])
    expect(existsSync(path.join(OUT, 'cancel.webm'))).toBe(false)
    expect(leftovers(OUT)).toEqual([])
    expect(ffmpegProcesses(OUT)).toEqual([])
    expect(await logText(page)).toContain('已取消处理，未生成输出文件')
  })

  it('拖入文件：松开后选择这个视频', async () => {
    const { app, page } = ui
    const cdp = await app.context().newCDPSession(page)
    const data = { items: [], files: [fixture('in.mkv')], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
      await cdp.send('Input.dispatchDragEvent', { type, x: 300, y: 300, data })
    }
    await expect.poll(() => page.locator('.file-name').textContent()).toBe('in.mkv')
    await expect.poll(() => page.locator('.path-name').textContent()).toBe('in_dedup.mkv')
  })

  it('清空：文件、参数和日志都恢复到初始状态', async () => {
    const { page } = ui
    await page.locator('[data-feature="rgbShift"]').click()
    await page.getByRole('button', { name: '清空', exact: true }).click()
    expect(await page.locator('.dropzone').isVisible()).toBe(true)
    expect(await page.locator('.feature.is-on .feature-label').allTextContents()).toEqual(['时间跳跃', '修改MD5值'])
    expect(await logText(page)).toEqual(['已清空，参数恢复为默认值'])
  })
})

describe('外观', () => {
  it('浅色 / 深色 / 跟随系统：界面和系统界面一起切换，重新打开后保持上次的选择', async () => {
    const userData = mkdtempSync(path.join(WORK, 'userdata-theme-'))
    // 在页面中执行的表达式（测试代码的类型检查不包含浏览器的 DOM 类型）
    const background = (page: Page) => page.evaluate<string>('getComputedStyle(document.body).backgroundColor')

    let ui = await launch(userData)
    await ui.page.getByRole('radio', { name: '浅色' }).click()
    await expect.poll(() => background(ui.page)).toBe('rgb(244, 245, 248)')
    await ui.page.screenshot({ path: path.join(SHOTS, 'light.png') })
    await ui.page.getByRole('radio', { name: '深色' }).click()
    await expect.poll(() => background(ui.page)).toBe('rgb(12, 14, 19)')
    expect(await ui.app.evaluate(({ nativeTheme }) => [nativeTheme.themeSource, nativeTheme.shouldUseDarkColors])).toEqual([
      'dark',
      true,
    ])
    await ui.page.screenshot({ path: path.join(SHOTS, 'dark.png') })
    await ui.app.close()

    ui = await launch(userData)
    expect(await ui.page.getByRole('radio', { name: '深色' }).getAttribute('aria-checked')).toBe('true')
    expect(await background(ui.page)).toBe('rgb(12, 14, 19)')
    await ui.page.getByRole('radio', { name: '跟随系统' }).click()
    await expect.poll(() => ui.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system')
    expect(JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'))).toEqual({ theme: 'system' })
    await ui.app.close()
  })
})

describe('语言', () => {
  /** 页面上所有文字（包括隐藏的说明弹层）、aria-label 和 title 中含汉字的部分；语言切换按钮上的“中”“中文”除外 */
  const hanTexts = (page: Page) =>
    page.evaluate<string[]>(`(() => {
      const han = /\\p{Script=Han}/u
      const skip = (element) => element.closest('[lang="zh-CN"]')
      const found = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (han.test(node.textContent) && !skip(node.parentElement)) found.push(node.textContent)
      }
      for (const element of document.querySelectorAll('[aria-label], [title]')) {
        for (const value of [element.getAttribute('aria-label'), element.getAttribute('title')]) {
          if (value && han.test(value) && !skip(element)) found.push(value)
        }
      }
      return found
    })()`)

  it('系统语言是英文时显示英文界面：处理日志、系统对话框也是英文，页面上没有中文', async () => {
    const userData = mkdtempSync(path.join(WORK, 'userdata-en-'))
    const ui = await launch(userData, 'en-US')
    const { app, page } = ui
    try {
      expect(await page.title()).toBe('Video Dedup')
      expect(await page.evaluate<string>('document.documentElement.lang')).toBe('en')
      expect(await page.getByRole('radio', { name: 'English', exact: true }).getAttribute('aria-checked')).toBe('true')
      expect(await page.locator('.feature.is-on .feature-label').allTextContents()).toEqual(['Time jump', 'Change MD5'])
      expect(await page.locator('.status-title').textContent()).toBe('Waiting for a video')
      expect((await logText(page))[0]).toMatch(/^FFmpeg .+ \((bundled with the app|installed on the system|set by VIDEO_DEDUP_FFMPEG)\)$/)

      const output = path.join(OUT, 'english.mp4')
      await selectVideo(ui, fixture('in.mkv'), output, FILE_BUTTONS.en)
      await page.getByRole('switch', { name: 'Mirror', exact: true }).click()
      await page.getByRole('button', { name: 'Start processing', exact: true }).click()
      await page.getByText('Processing complete', { exact: true }).waitFor({ timeout: 60_000 })
      const lines = await logText(page)
      expect(lines).toContain('Effect: mirror')
      expect(lines).toContain('Output file saved')
      expect(lines.some((line) => line.startsWith('Done in '))).toBe(true)
      expect(await hanTexts(page)).toEqual([])

      // 英文比中文长：在最小窗口和常用宽度下各截一张图，检查排版
      for (const [width, height] of [
        [880, 600],
        [1100, 760],
        [1280, 820],
      ]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height])
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(SHOTS, `english-${width}.png`) })
      }

      await answerMessageBoxes(app, 1)
      await page.getByRole('button', { name: 'Process again', exact: true }).click()
      await expect.poll(() => shownMessageBoxes(app)).toEqual(['The output file already exists. Overwrite it?'])
      // 没有手动选择过语言，也没有改过外观，不写设置文件
      expect(existsSync(path.join(userData, 'settings.json'))).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('切换语言：界面、窗口标题和菜单立即改变，记住选择，重新打开后不再跟随系统', async () => {
    const userData = mkdtempSync(path.join(WORK, 'userdata-lang-'))
    const menuLabels = ({ app }: Launched) =>
      app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.slice(1).map((item) => item.label) ?? [])

    let ui = await launch(userData, 'en-US')
    await ui.page.getByRole('radio', { name: '中文', exact: true }).click()
    await expect.poll(() => ui.page.title()).toBe('视频去重工具')
    expect(await ui.page.evaluate<string>('document.documentElement.lang')).toBe('zh-CN')
    expect(await ui.page.locator('.status-title').textContent()).toBe('等待选择视频')
    expect(await ui.page.getByRole('button', { name: '开始处理', exact: true }).isDisabled()).toBe(true)
    if (process.platform === 'darwin') await expect.poll(() => menuLabels(ui)).toEqual(['文件', '编辑', '显示', '窗口'])
    await expect.poll(() => savedSettings(userData)).toEqual({ theme: 'system', language: 'zh-CN' })
    await ui.app.close()

    // 保存的选择优先于系统语言
    ui = await launch(userData, 'en-US')
    expect(await ui.page.title()).toBe('视频去重工具')
    expect(await ui.page.getByRole('radio', { name: '中文', exact: true }).getAttribute('aria-checked')).toBe('true')
    await ui.page.getByRole('radio', { name: 'English', exact: true }).click()
    await expect.poll(() => ui.page.title()).toBe('Video Dedup')
    if (process.platform === 'darwin') await expect.poll(() => menuLabels(ui)).toEqual(['File', 'Edit', 'View', 'Window'])
    await expect.poll(() => savedSettings(userData)).toEqual({ theme: 'system', language: 'en' })
    await ui.app.close()
  })
})

describe('关闭窗口', () => {
  it('正在处理时关闭窗口：确认后结束 FFmpeg、删除临时文件，再退出程序', async () => {
    const ui = await launch()
    const { app, page } = ui
    const output = path.join(OUT, 'closing.webm')
    writeFileSync(output, 'previous result')
    await selectVideo(ui, fixture('long.mp4'), output)
    await page.getByRole('button', { name: '开始处理' }).click()
    await expect.poll(() => page.locator('.progress-percent').textContent(), { timeout: 30_000 }).toMatch(/^\d+%$/)
    expect(ffmpegProcesses(OUT).length).toBeGreaterThan(0)

    await answerMessageBoxes(app, 0)
    const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await exited
    expect(ffmpegProcesses(OUT)).toEqual([])
    expect(leftovers(OUT)).toEqual([])
    expect(readFileSync(output, 'utf8')).toBe('previous result')
  })
})

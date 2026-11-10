// 批量处理的界面测试：多选、顺序处理、输出文件夹、取消、失败文件和覆盖确认
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  answerMessageBoxes,
  answerOpenDialogs,
  assertBuilt,
  hanTexts,
  launch as launchApp,
  logText,
  makeWorkDir,
  shownMessageBoxes,
} from '../helpers/app'
import { ffmpegProcesses, fileMd5, fixture, inspectFile, leftovers } from '../helpers/media'

assertBuilt()
const WORK = makeWorkDir('e2e-batch-')
afterAll(() => {
  if (!process.env.KEEP_E2E_FILES) rmSync(WORK, { recursive: true, force: true })
})

const launch = (userData = mkdtempSync(path.join(WORK, 'userdata-')), lang?: string) =>
  launchApp(userData, process.env, lang)

/** 每个测试用单独的工作目录，复制测试素材，避免输出文件互相影响 */
function inputDir(name: string): string {
  const dir = mkdtempSync(path.join(WORK, `${name}-`))
  mkdirSync(dir, { recursive: true })
  return dir
}

function copyFixture(name: string, dir: string, as: string): string {
  const target = path.join(dir, as)
  copyFileSync(fixture(name), target)
  return target
}

function videoStreams(file: string): number {
  return inspectFile(file).streams.filter((stream) => stream.type === 'Video' && !stream.attachedPic).length
}

describe('批量处理', () => {
  it('一次选择两个视频：显示文件列表，依次处理后每个文件都有输出，日志和结果正确', async () => {
    const dir = inputDir('basic')
    const first = copyFixture('s30.mp4', dir, 'first.mp4')
    const second = copyFixture('in.mkv', dir, 'second.mkv')
    const ui = await launch()
    try {
      await answerOpenDialogs(ui.app, { files: [first, second] })
      await ui.page.locator('.dropzone').click()
      await expect.poll(() => ui.page.locator('.batch-file').count()).toBe(2)
      expect(await ui.page.locator('.batch-file .file-name').allTextContents()).toEqual(['first.mp4', 'second.mkv'])
      // 两个文件的信息都读取完后才能开始
      await expect.poll(() => ui.page.locator('.status-title').textContent()).toBe('准备就绪')
      expect(await ui.page.locator('.status .status-detail').textContent()).toContain('将依次处理 2 个视频')
      expect(await ui.page.locator('.file-status').count()).toBe(0)
      await ui.page.screenshot({ path: path.join(WORK, 'batch-ready.png') })

      await ui.page.getByRole('button', { name: '开始处理', exact: true }).click()
      await ui.page.getByText('批量处理完成', { exact: true }).waitFor({ timeout: 60_000 })

      const firstOut = path.join(dir, 'first_dedup.mp4')
      const secondOut = path.join(dir, 'second_dedup.mkv')
      expect(existsSync(firstOut)).toBe(true)
      expect(existsSync(secondOut)).toBe(true)
      expect(videoStreams(firstOut)).toBe(1)
      expect(videoStreams(secondOut)).toBe(1)
      await expect.poll(() => ui.page.locator('.file-status').allTextContents()).toEqual(['完成', '完成'])
      expect(await ui.page.locator('.batch-result-name').allTextContents()).toEqual(['first_dedup.mp4', 'second_dedup.mkv'])
      expect(await ui.page.locator('.batch-result-status').allTextContents()).toEqual(['完成', '完成'])

      const lines = await logText(ui.page)
      expect(lines).toContain('第 1/2 个视频：first.mp4')
      expect(lines).toContain('第 2/2 个视频：second.mkv')
      expect(lines.some((line) => line.startsWith('批量处理完成：2 个视频，用时 '))).toBe(true)
      expect(leftovers(dir)).toEqual([])
      await ui.page.screenshot({ path: path.join(WORK, 'batch-done.png') })
    } finally {
      await ui.app.close()
    }
  })

  it('一次拖入多个文件：全部加入批量列表', async () => {
    const dir = inputDir('drop')
    const first = copyFixture('short.mp4', dir, 'drop1.mp4')
    const second = copyFixture('short.mp4', dir, 'drop2.mp4')
    const ui = await launch()
    try {
      const cdp = await ui.app.context().newCDPSession(ui.page)
      const data = { items: [], files: [first, second], dragOperationsMask: 1 }
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
        await cdp.send('Input.dispatchDragEvent', { type, x: 300, y: 300, data })
      }
      await expect.poll(() => ui.page.locator('.batch-file').count()).toBe(2)
      expect(await ui.page.locator('.batch-file .file-name').allTextContents()).toEqual(['drop1.mp4', 'drop2.mp4'])
    } finally {
      await ui.app.close()
    }
  })

  it('输出到指定文件夹：同名视频分别输出为 _dedup 和 _dedup_2，原文件不被改动', async () => {
    const dir = inputDir('folder')
    const dirA = path.join(dir, 'a')
    const dirB = path.join(dir, 'b')
    const outDir = path.join(dir, 'out')
    mkdirSync(dirA)
    mkdirSync(dirB)
    mkdirSync(outDir)
    const first = copyFixture('short.mp4', dirA, 'clip.mp4')
    const second = copyFixture('short.mp4', dirB, 'clip.mp4')
    const before = fileMd5(first)
    const ui = await launch()
    try {
      await answerOpenDialogs(ui.app, { files: [first, second], directory: outDir })
      await ui.page.locator('.dropzone').click()
      await expect.poll(() => ui.page.locator('.batch-file').count()).toBe(2)
      await ui.page.getByRole('button', { name: '更改…', exact: true }).click()
      await expect.poll(() => ui.page.locator('.path-name').textContent()).toBe(outDir)

      await ui.page.getByRole('button', { name: '开始处理', exact: true }).click()
      await ui.page.getByText('批量处理完成', { exact: true }).waitFor({ timeout: 60_000 })

      expect(existsSync(path.join(outDir, 'clip_dedup.mp4'))).toBe(true)
      expect(existsSync(path.join(outDir, 'clip_dedup_2.mp4'))).toBe(true)
      expect(fileMd5(first)).toBe(before)
      expect(leftovers(outDir)).toEqual([])
    } finally {
      await ui.app.close()
    }
  })

  it('取消批量处理：当前文件被丢弃，剩余文件标记为未处理，不留下输出文件和 FFmpeg 进程', async () => {
    const dir = inputDir('cancel')
    const first = copyFixture('long.mp4', dir, 'long.mp4')
    const second = copyFixture('s30.mp4', dir, 'second.mp4')
    const ui = await launch()
    try {
      await answerOpenDialogs(ui.app, { files: [first, second] })
      await ui.page.locator('.dropzone').click()
      await expect.poll(() => ui.page.locator('.batch-file').count()).toBe(2)
      await ui.page.getByRole('button', { name: '开始处理', exact: true }).click()
      await expect
        .poll(() => ui.page.locator('.progress-percent').textContent(), { timeout: 30_000 })
        .toMatch(/^\d+%$/)

      await answerMessageBoxes(ui.app, 0)
      await ui.page.getByRole('button', { name: '取消', exact: true }).click()
      await expect.poll(() => ui.page.locator('.status-title').textContent(), { timeout: 15_000 }).toBe('已取消')

      expect(await shownMessageBoxes(ui.app)).toEqual(['确定要取消当前的处理吗？'])
      await expect.poll(() => ui.page.locator('.file-status').allTextContents()).toEqual(['已取消', '未处理'])
      expect(existsSync(path.join(dir, 'long_dedup.mp4'))).toBe(false)
      expect(existsSync(path.join(dir, 'second_dedup.mp4'))).toBe(false)
      await ui.page.waitForTimeout(300)
      expect(ffmpegProcesses(dir)).toEqual([])
      expect(leftovers(dir)).toEqual([])
    } finally {
      await ui.app.close()
    }
  })

  it('批量中有无法处理的文件：不能开始，移除后恢复为单个文件界面', async () => {
    const dir = inputDir('invalid')
    const good = copyFixture('short.mp4', dir, 'good.mp4')
    const bad = copyFixture('bad.mp4', dir, 'broken.mp4')
    const ui = await launch()
    try {
      await answerOpenDialogs(ui.app, { files: [good, bad] })
      await ui.page.locator('.dropzone').click()
      await expect.poll(() => ui.page.locator('.batch-file').count()).toBe(2)
      await expect
        .poll(() => ui.page.locator('.status .status-detail').textContent())
        .toContain('有 1 个文件无法处理，请移除后重试')
      expect(await ui.page.getByRole('button', { name: '开始处理', exact: true }).isDisabled()).toBe(true)
      await expect.poll(() => ui.page.locator('.batch-file .text-danger').textContent()).toMatch(/无法读取这个文件/)

      await ui.page
        .locator('.batch-file')
        .filter({ hasText: 'broken.mp4' })
        .getByRole('button', { name: '移除文件' })
        .click()
      await expect.poll(() => ui.page.locator('.batch-file').count()).toBe(0)
      expect(await ui.page.locator('.file-name').textContent()).toBe('good.mp4')
      await expect.poll(() => ui.page.locator('.path-name').textContent()).toBe('good_dedup.mp4')
      expect(await ui.page.getByRole('button', { name: '开始处理', exact: true }).isEnabled()).toBe(true)
    } finally {
      await ui.app.close()
    }
  })

  it('批量输出文件已存在：只询问一次，选择取消时不处理，确认后覆盖', async () => {
    const dir = inputDir('overwrite')
    const first = copyFixture('short.mp4', dir, 'first.mp4')
    const second = copyFixture('short.mp4', dir, 'second.mp4')
    const firstOut = path.join(dir, 'first_dedup.mp4')
    const secondOut = path.join(dir, 'second_dedup.mp4')
    writeFileSync(firstOut, 'previous result')
    writeFileSync(secondOut, 'previous result')
    const ui = await launch()
    try {
      await answerOpenDialogs(ui.app, { files: [first, second] })
      await ui.page.locator('.dropzone').click()
      await expect.poll(() => ui.page.locator('.batch-file').count()).toBe(2)

      await answerMessageBoxes(ui.app, 1)
      await ui.page.getByRole('button', { name: '开始处理', exact: true }).click()
      await expect.poll(() => shownMessageBoxes(ui.app)).toEqual(['有 2 个输出文件已存在，是否全部覆盖？'])
      await expect.poll(() => ui.page.locator('.status-title').textContent()).toBe('准备就绪')
      expect(readFileSync(firstOut, 'utf8')).toBe('previous result')
      expect(readFileSync(secondOut, 'utf8')).toBe('previous result')

      await answerMessageBoxes(ui.app, 0)
      await ui.page.getByRole('button', { name: '开始处理', exact: true }).click()
      await ui.page.getByText('批量处理完成', { exact: true }).waitFor({ timeout: 60_000 })
      expect(readFileSync(firstOut, 'utf8')).not.toBe('previous result')
      expect(readFileSync(secondOut, 'utf8')).not.toBe('previous result')
    } finally {
      await ui.app.close()
    }
  })

  it('英文界面：批量处理的文字全部是英文，没有中文残留', async () => {
    const dir = inputDir('english')
    const first = copyFixture('short.mp4', dir, 'first.mp4')
    const second = copyFixture('short.mp4', dir, 'second.mp4')
    const ui = await launch(undefined, 'en-US')
    try {
      await answerOpenDialogs(ui.app, { files: [first, second] })
      await ui.page.locator('.dropzone').click()
      await expect.poll(() => ui.page.locator('.batch-file').count()).toBe(2)
      expect(await ui.page.getByRole('button', { name: 'Add files…', exact: true }).isVisible()).toBe(true)
      expect(await ui.page.locator('.status .status-detail').textContent()).toContain('2 videos will be processed one by one')
      expect(await hanTexts(ui.page)).toEqual([])

      await ui.page.getByRole('button', { name: 'Start processing', exact: true }).click()
      await ui.page.getByText('Batch processing complete', { exact: true }).waitFor({ timeout: 60_000 })
      await expect.poll(() => ui.page.locator('.file-status').allTextContents()).toEqual(['Done', 'Done'])
      expect(await hanTexts(ui.page)).toEqual([])
    } finally {
      await ui.app.close()
    }
  })
})

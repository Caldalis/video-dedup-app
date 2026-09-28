// 界面测试的公共部分：启动构建好的程序，以及代替用户回答系统对话框
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import electronPath from 'electron'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { expect } from 'vitest'
import { ROOT } from './media'

export interface Launched {
  app: ElectronApplication
  page: Page
}

/** 本次测试的工作目录：输出文件、截图、用户数据都放在这里 */
export function makeWorkDir(prefix: string): string {
  const base = path.join(os.tmpdir(), 'video-dedup-app-tests')
  mkdirSync(base, { recursive: true })
  return mkdtempSync(path.join(base, prefix))
}

export function assertBuilt(): void {
  if (!existsSync(path.join(ROOT, 'out', 'main', 'index.js'))) throw new Error('请先执行 pnpm build 构建程序')
}

/** Electron 程序的路径（electron 包在 Node 中导出的是可执行文件的路径） */
export const ELECTRON = electronPath as unknown as string

/**
 * 启动程序。用单独的用户数据目录，不影响本机的设置；不模拟浅色/深色，让程序自己决定。
 * lang 是模拟的系统语言（启动参数 --lang）：默认中文，大部分测试按中文文字查找界面元素，在任何语言的系统上结果都一样
 */
export async function launch(userData: string, env: NodeJS.ProcessEnv = process.env, lang = 'zh-CN'): Promise<Launched> {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: ['.', `--user-data-dir=${userData}`, `--lang=${lang}`],
    cwd: ROOT,
    colorScheme: null,
    env: env as Record<string, string>,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.status-pill')
  return { app, page }
}

/** 让“打开”对话框直接返回 file */
export async function answerOpenDialog(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] })
  }, file)
}

/** 让“另存为”对话框直接返回 file */
export async function answerSaveDialog(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: chosen })
  }, file)
}

/** 让提示框直接选择第 response 个按钮，并记下每次提示的内容 */
export async function answerMessageBoxes(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, button) => {
    const shown: string[] = []
    Object.assign(globalThis, { shownMessageBoxes: shown })
    dialog.showMessageBox = async (...args: unknown[]) => {
      shown.push((args.at(-1) as { message: string }).message)
      return { response: button, checkboxChecked: false }
    }
  }, response)
}

export async function shownMessageBoxes(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { shownMessageBoxes: string[] }).shownMessageBoxes)
}

export async function logText(page: Page): Promise<string[]> {
  return page.locator('.log-message').allTextContents()
}

/** 更换视频、更改输出位置这两个按钮在各种界面语言中的名称 */
export const FILE_BUTTONS = {
  'zh-CN': { change: '更换', changeOutput: '更改…' },
  en: { change: 'Change video', changeOutput: 'Change…' },
}

/** 选择输入文件（等到视频信息读取完），并把输出改到 output */
export async function selectVideo(
  { app, page }: Launched,
  input: string,
  output: string,
  buttons = FILE_BUTTONS['zh-CN'],
): Promise<void> {
  await answerOpenDialog(app, input)
  await page.locator('.dropzone').or(page.getByRole('button', { name: buttons.change, exact: true })).first().click()
  await expect.poll(() => page.locator('.file-name').textContent()).toBe(path.basename(input))
  await answerSaveDialog(app, output)
  // 读取完视频信息后“更改…”按钮才可用，click 会等到它可用
  await page.getByRole('button', { name: buttons.changeOutput, exact: true }).click()
  await expect.poll(() => page.locator('.path-name').textContent()).toBe(path.basename(output))
}

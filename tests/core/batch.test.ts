// BatchProcessor 集成测试：按顺序处理多个视频、单个失败后继续、取消，以及输出目录和重名处理
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { BatchProcessor, planBatchOutputs } from '../../src/core/batch'
import { DEFAULT_FEATURES, type FeatureOptions } from '../../src/shared/options'
import type { FileOutcome, Stage } from '../../src/shared/types'
import { FFMPEG, ffmpegProcesses, fixture, inspectFile, leftovers } from '../helpers/media'

const BASE = path.join(os.tmpdir(), 'video-dedup-app-tests')
mkdirSync(BASE, { recursive: true })
const OUT = mkdtempSync(path.join(BASE, 'batch-'))
afterAll(() => rmSync(OUT, { recursive: true, force: true }))

const NONE: FeatureOptions = { ...DEFAULT_FEATURES, timeJump: false, md5Change: false }

/** 每个测试用单独的输出目录，避免其他测试留下的同名输出文件影响结果 */
function caseDir(name: string): string {
  const dir = path.join(OUT, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function outputStreams(file: string): number {
  return inspectFile(file).streams.filter((stream) => stream.type === 'Video' && !stream.attachedPic).length
}

describe('批量处理', () => {
  it('按顺序处理列表中的每个视频，逐个报告日志、步骤和结果', async () => {
    const outDir = caseDir('sequential')
    const items = planBatchOutputs([fixture('s30.mp4'), fixture('short.mp4'), fixture('in.mkv')], outDir)
    const logs: Array<{ index: number; message: string }> = []
    const starts: number[] = []
    const stages: Array<{ index: number; stage: Stage }> = []
    const finished: FileOutcome[] = []
    const batch = new BatchProcessor(FFMPEG, {
      log: (index, message) => logs.push({ index, message }),
      stage: (index, stage) => stages.push({ index, stage }),
      fileStart: (index) => starts.push(index),
      fileFinished: (outcome) => finished.push(outcome),
    })

    const summary = await batch.run({ ...NONE, mirror: true, items })

    expect(summary.cancelled).toBe(false)
    expect(summary.outcomes.map((outcome) => outcome.status)).toEqual(['ok', 'ok', 'ok'])
    expect(starts).toEqual([0, 1, 2])
    expect(finished.map((outcome) => outcome.index)).toEqual([0, 1, 2])
    expect(stages.filter((entry) => entry.stage === 'encode').map((entry) => entry.index)).toEqual([0, 1, 2])
    expect(logs.some((entry) => entry.index === 1 && entry.message.includes('第 2/3 个视频'))).toBe(true)
    for (const [index, item] of items.entries()) {
      expect(existsSync(item.outputPath)).toBe(true)
      expect(outputStreams(item.outputPath)).toBe(1)
      expect(summary.outcomes[index].outputPath).toBe(item.outputPath)
      expect(summary.outcomes[index].seconds).toBeGreaterThan(0)
    }
    expect(leftovers(outDir)).toEqual([])
  })

  it('中间的文件处理失败时继续处理后面的文件，最后汇总每个文件的结果', async () => {
    const outDir = caseDir('failure')
    const items = planBatchOutputs([fixture('short.mp4'), fixture('bad.mp4'), fixture('s30.mp4')], outDir)
    const finished: FileOutcome[] = []
    const batch = new BatchProcessor(FFMPEG, { fileFinished: (outcome) => finished.push(outcome) })

    const summary = await batch.run({ ...NONE, md5Change: true, items })

    expect(summary.cancelled).toBe(false)
    expect(summary.outcomes.map((outcome) => outcome.status)).toEqual(['ok', 'failed', 'ok'])
    expect(finished.map((outcome) => outcome.status)).toEqual(['ok', 'failed', 'ok'])
    expect(summary.outcomes[1].message).toMatch(/无法读取输入文件|Invalid data/i)
    expect(existsSync(items[0].outputPath)).toBe(true)
    expect(existsSync(items[1].outputPath)).toBe(false)
    expect(existsSync(items[2].outputPath)).toBe(true)
    expect(leftovers(outDir)).toEqual([])
  })

  it('取消：结束正在处理的文件，剩余文件不再处理，不留下输出文件、临时文件或 FFmpeg 进程', async () => {
    const outDir = caseDir('cancel')
    const items = planBatchOutputs([fixture('long.mp4'), fixture('s30.mp4')], outDir)
    const batch = new BatchProcessor(FFMPEG)
    const running = batch.run({ ...NONE, mirror: true, items })
    running.catch(() => {})
    await sleep(2500)
    const before = ffmpegProcesses(OUT)
    const started = performance.now()
    batch.cancel()
    const summary = await running
    const seconds = (performance.now() - started) / 1000

    if (process.platform !== 'win32') expect(before.length).toBeGreaterThan(0)
    expect(seconds).toBeLessThan(6)
    expect(summary.cancelled).toBe(true)
    expect(summary.outcomes.map((outcome) => outcome.status)).toEqual(['cancelled', 'skipped'])
    expect(existsSync(items[0].outputPath)).toBe(false)
    expect(existsSync(items[1].outputPath)).toBe(false)
    await sleep(300)
    expect(ffmpegProcesses(OUT)).toEqual([])
    expect(leftovers(outDir)).toEqual([])
  })

  it('开始前取消：所有文件都标记为未处理，不执行任何 FFmpeg', async () => {
    const items = planBatchOutputs([fixture('short.mp4'), fixture('s30.mp4')], caseDir('before-cancel'))
    const batch = new BatchProcessor(FFMPEG)
    batch.cancel()
    const summary = await batch.run({ ...NONE, mirror: true, items })
    expect(summary.cancelled).toBe(true)
    expect(summary.outcomes.map((outcome) => outcome.status)).toEqual(['skipped', 'skipped'])
    for (const item of items) expect(existsSync(item.outputPath)).toBe(false)
  })

  it('输出到指定文件夹：不同目录中的同名视频分别输出为 _dedup 和 _dedup_2', async () => {
    const dirA = path.join(OUT, 'input-a')
    const dirB = path.join(OUT, 'input-b')
    const outDir = path.join(OUT, 'output')
    mkdirSync(dirA)
    mkdirSync(dirB)
    mkdirSync(outDir)
    copyFileSync(fixture('short.mp4'), path.join(dirA, 'clip.mp4'))
    copyFileSync(fixture('short.mp4'), path.join(dirB, 'clip.mp4'))
    const items = planBatchOutputs([path.join(dirA, 'clip.mp4'), path.join(dirB, 'clip.mp4')], outDir)
    expect(items.map((item) => path.basename(item.outputPath))).toEqual(['clip_dedup.mp4', 'clip_dedup_2.mp4'])

    const summary = await new BatchProcessor(FFMPEG).run({ ...NONE, md5Change: true, items })

    expect(summary.outcomes.map((outcome) => outcome.status)).toEqual(['ok', 'ok'])
    for (const item of items) {
      expect(existsSync(item.outputPath)).toBe(true)
      expect(path.dirname(item.outputPath)).toBe(outDir)
    }
    expect(leftovers(outDir)).toEqual([])
  })
})

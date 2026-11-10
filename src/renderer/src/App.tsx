import { Upload } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { messages } from '../../shared/i18n'
import type { Language } from '../../shared/i18n/language'
import type { AppInfo, InspectResult, JobEvent, JobResult, Md5Slot, MenuCommand, ThemeMode } from '../../shared/ipc'
import { validateFeatures } from '../../shared/options'
import { countOutcomes, type FilePhase } from '../../shared/types'
import { FeatureCard, defaultDraft, parseDraft, type FeatureDraft } from './components/FeatureCard'
import { FileCard, inputErrorText, type HashState, type InputError, type InputState } from './components/FileCard'
import { Header } from './components/Header'
import { LogCard } from './components/LogCard'
import { ProcessCard, type JobState } from './components/ProcessCard'
import { cx } from './components/ui'
import { basename, formatElapsed } from './lib/format'
import { useLog, useToasts } from './lib/hooks'
import { I18nContext } from './lib/i18n'

const api = window.api

export function App({ initialLanguage }: { initialLanguage: Language }) {
  const [language, setLanguage] = useState(initialLanguage)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [inputs, setInputs] = useState<InputState[]>([])
  const [inputMd5, setInputMd5] = useState<HashState>({ status: 'idle' })
  // confirmed：输出路径是在“另存为”对话框中选的，对话框已经确认过覆盖
  const [output, setOutput] = useState({ path: '', confirmed: false })
  // 批量处理的输出文件夹；null 表示输出到每个视频所在的目录
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [draft, setDraft] = useState<FeatureDraft>(defaultDraft)
  const [job, setJob] = useState<JobState>({ phase: 'idle' })
  const [outputMd5, setOutputMd5] = useState<HashState>({ status: 'idle' })
  const [dragging, setDragging] = useState(false)
  const log = useLog()
  const { toasts, show: toast } = useToasts()

  // 界面文字。已经写入的日志保持写入时的语言
  const t = messages(language)
  const busy = job.phase === 'starting' || job.phase === 'running'
  const isBatch = inputs.length > 1
  const inputErrorCount = inputs.filter((item) => item.error).length
  const features = parseDraft(draft)
  const featureProblem = validateFeatures(features)
  const problem =
    inputs.length === 0
      ? t.problems.noInput
      : inputs.some((item) => item.loading)
        ? t.problems.loading
        : isBatch && inputErrorCount > 0
          ? t.problems.invalidFiles(inputErrorCount)
          : !isBatch && inputs[0]?.error
            ? inputErrorText(inputs[0].error, t)
            : !isBatch && !output.path
              ? t.problems.noOutput
              : featureProblem
                ? t.problems[featureProblem]
                : null

  // 每次开始读取文件信息、计算 MD5 时加一，用来丢弃已经过期的结果（期间又换了文件或清空了界面）
  const md5Tokens = useRef({ input: 0, output: 0 })
  // 每个文件单独计数：移除某个文件后，它还没完成的读取结果会被丢弃
  const inspectTokens = useRef(new Map<string, number>())
  // 防止快速连点：按钮要到下一次渲染时才会变成不可用
  const starting = useRef(false)
  // 拖动经过子元素时会连续触发 dragenter / dragleave，用计数判断是否真的离开了窗口
  const dragDepth = useRef(0)

  function pathKey(file: string): string {
    return info?.platform === 'win32' || info?.platform === 'darwin' ? file.toLowerCase() : file
  }

  function logFFmpeg(appInfo: AppInfo) {
    const ffmpeg = appInfo.ffmpeg
    if (!ffmpeg) {
      log.append(t.ffmpeg.missing(appInfo.platform, appInfo.packaged), 'error')
      return
    }
    log.append(t.app.ffmpegFound(ffmpeg.version, ffmpeg.path, ffmpeg.source))
    if (!ffmpeg.supported) log.append(t.ffmpeg.outdated(ffmpeg.version), 'warn')
  }

  async function startMd5(slot: Md5Slot, path: string) {
    const token = ++md5Tokens.current[slot]
    const set = slot === 'input' ? setInputMd5 : setOutputMd5
    set({ status: 'computing' })
    const result = await api.md5(path, slot)
    if (token !== md5Tokens.current[slot]) return
    if (result.status === 'ok') {
      set({ status: 'done', value: result.value })
      log.append(t.app.md5Done(slot, result.value))
    } else if (result.status === 'error') {
      set({ status: 'error', message: result.message })
      log.append(t.app.md5Failed(slot, result.message), 'error')
    }
  }

  function resetMd5(slot: Md5Slot) {
    md5Tokens.current[slot]++
    void api.cancelMd5(slot)
    ;(slot === 'input' ? setInputMd5 : setOutputMd5)({ status: 'idle' })
  }

  function updateInput(path: string, patch: Partial<InputState>) {
    setInputs((list) => list.map((item) => (item.path === path ? { ...item, ...patch } : item)))
  }

  /** 丢弃这个路径还没完成的读取结果，避免清空或替换列表后仍写入过期的错误日志 */
  function invalidateInspect(path: string) {
    inspectTokens.current.set(path, (inspectTokens.current.get(path) ?? 0) + 1)
  }

  /** 读取一个文件的信息；同一路径开始新的读取时，旧的还没完成的结果会被丢弃 */
  async function inspect(path: string): Promise<InspectResult | null> {
    const token = (inspectTokens.current.get(path) ?? 0) + 1
    inspectTokens.current.set(path, token)
    const result = await api.inspectInput(path)
    if (inspectTokens.current.get(path) !== token) return null
    if (!result.ok) {
      const error: InputError = { kind: result.reason, detail: result.detail }
      updateInput(path, { loading: false, file: null, error })
      log.append(inputErrorText(error, t), 'error')
      return result
    }
    const media = result.file.media
    const error: InputError | null =
      media && !media.hasVideo ? (media.error ? { kind: 'cannotRead', detail: media.error } : { kind: 'noVideo' }) : null
    updateInput(path, { loading: false, name: result.file.name, file: result.file, error })
    if (error) log.append(inputErrorText(error, t), 'error')
    return result
  }

  /** 逐个读取文件信息，最多同时读取 4 个，一次选择很多文件时不会同时启动大量 FFmpeg */
  async function inspectAll(paths: string[]) {
    const queue = [...paths]
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length > 0) {
        const path = queue.shift()
        if (path === undefined) break
        await inspect(path)
      }
    })
    await Promise.all(workers)
  }

  /** 选择或添加视频。append 为 true 时保留列表中已有的文件 */
  async function selectInputs(paths: string[], append = false) {
    if (busy || paths.length === 0) return
    // 替换列表时，旧文件还没完成的读取结果直接丢弃
    if (!append) {
      for (const item of inputs) invalidateInspect(item.path)
    }
    const merged = append ? [...inputs] : []
    const seen = new Set(merged.map((item) => pathKey(item.path)))
    const added: string[] = []
    for (const path of paths) {
      const key = pathKey(path)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({ path, name: basename(path), loading: true, file: null, error: null })
      added.push(path)
    }
    if (added.length === 0) return

    setJob({ phase: 'idle' })
    setOutput({ path: '', confirmed: false })
    if (!append) setOutputDir(null)
    setInputs(merged)
    resetMd5('output')
    if (merged.length === 1) {
      void startMd5('input', merged[0].path)
    } else {
      resetMd5('input')
    }

    if (append) {
      for (const path of added) log.append(t.app.opened(path))
    } else if (merged.length === 1) {
      log.append(t.app.opened(merged[0].path))
    } else {
      log.append(t.app.openedMany(merged.length))
    }

    await inspectAll(added)
  }

  async function chooseInput(append = false) {
    if (busy) return
    const paths = await api.chooseInput()
    if (paths.length > 0) await selectInputs(paths, append)
  }

  async function chooseOutput() {
    if (inputs.length !== 1 || !inputs[0].file || inputs[0].error || busy) return
    const path = await api.chooseOutput(output.path || inputs[0].file.defaultOutput)
    if (!path) return
    setOutput({ path, confirmed: true })
    log.append(t.app.outputChanged(path))
  }

  async function chooseOutputDir() {
    if (!isBatch || busy) return
    const path = await api.chooseOutputDir()
    if (!path) return
    setOutputDir(path)
    log.append(t.app.outputDirChanged(path))
  }

  function resetOutputDir() {
    if (busy) return
    setOutputDir(null)
  }

  function removeInput(path: string) {
    if (busy) return
    invalidateInspect(path)
    const remaining = inputs.filter((item) => item.path !== path)
    setInputs(remaining)
    setJob({ phase: 'idle' })
    setOutput({ path: '', confirmed: false })
    resetMd5('output')
    if (remaining.length === 1) {
      void startMd5('input', remaining[0].path)
    } else {
      resetMd5('input')
    }
    if (remaining.length <= 1) setOutputDir(null)
  }

  function clearAll() {
    if (busy) return
    for (const item of inputs) invalidateInspect(item.path)
    setInputs([])
    resetMd5('input')
    resetMd5('output')
    setOutput({ path: '', confirmed: false })
    setOutputDir(null)
    setJob({ phase: 'idle' })
    setDraft(defaultDraft())
    log.clear()
    log.append(t.app.cleared)
  }

  async function start() {
    if (busy || starting.current || inputs.length === 0) return
    if (problem) {
      toast(problem, 'error')
      return
    }
    starting.current = true
    // 先固定这次要处理的文件、功能和输出位置，并把界面置为“准备中”。
    // 等待 FFmpeg 信息期间用户不能再增删文件，请求也不会使用被改动后的列表
    const selected = inputs.map((item) => item.path)
    const batchMode = selected.length > 1
    const selectedFeatures = { ...features }
    const selectedOutput = batchMode ? null : output.path
    const selectedOutputDir = batchMode ? outputDir : null
    const overwriteConfirmed = batchMode ? false : output.confirmed
    setJob({ phase: 'starting', total: selected.length, statuses: selected.map(() => 'pending') })
    resetMd5('output')
    try {
      // 启动时没找到 FFmpeg 的话再找一次：程序运行期间才装好的 FFmpeg 也能直接用上
      if (!info?.ffmpeg) {
        const appInfo = await api.getAppInfo()
        setInfo(appInfo)
        if (appInfo.ffmpeg) logFFmpeg(appInfo)
      }
      log.append(t.app.starting)
      const response = await api.startJob({
        options: {
          ...selectedFeatures,
          inputs: selected,
          outputPath: selectedOutput,
          outputDir: selectedOutputDir,
        },
        overwriteConfirmed,
      })
      if (response.status === 'started') {
        // 下次再输出到同一路径时需要重新确认覆盖
        if (!batchMode) setOutput((current) => ({ ...current, confirmed: false }))
        return
      }
      setJob((current) => (current.phase === 'starting' ? { phase: 'idle' } : current))
      if (response.status === 'invalid') {
        log.append(t.app.cannotStart(response.message), 'error')
        toast(response.message, 'error')
      }
    } catch (error) {
      setJob((current) => (current.phase === 'starting' ? { phase: 'idle' } : current))
      const message = (error as Error).message
      log.append(t.app.cannotStart(message), 'error')
      toast(message, 'error')
    } finally {
      starting.current = false
    }
  }

  /** 处理结束（成功、失败或取消） */
  function finish(result: JobResult) {
    switch (result.status) {
      case 'ok':
        setJob({ phase: 'done', outputPath: result.outputPath, seconds: result.seconds })
        log.append(t.app.finished(formatElapsed(result.seconds, t.units)), 'success')
        void startMd5('output', result.outputPath)
        break
      case 'batch': {
        const succeeded = result.outcomes.filter((outcome) => outcome.status === 'ok').length
        const failed = result.outcomes.filter((outcome) => outcome.status === 'failed').length
        const time = formatElapsed(result.seconds, t.units)
        setJob({ phase: 'batchDone', outcomes: result.outcomes, seconds: result.seconds })
        log.append(t.app.batchDone(succeeded, failed, time), failed > 0 ? 'warn' : 'success')
        break
      }
      case 'failed':
        setJob({ phase: 'failed', message: result.message })
        log.append(t.app.failed(result.message), 'error')
        break
      case 'cancelled':
        if (result.outcomes && result.outcomes.length > 1) {
          const outcomes = result.outcomes
          const { succeeded, failed, remaining } = countOutcomes(outcomes)
          setJob({ phase: 'cancelled', outcomes })
          log.append(t.app.batchCancelled(succeeded, failed, remaining))
        } else {
          setJob({ phase: 'cancelled' })
          log.append(t.app.cancelled)
        }
        break
    }
  }

  async function cancel() {
    if (job.phase !== 'running' || job.cancelling) return
    if (!(await api.cancelJob())) return
    setJob((current) => (current.phase === 'running' ? { ...current, cancelling: true } : current))
    log.append(t.app.cancelling)
  }

  async function copy(text: string) {
    try {
      await api.copyText(text)
      toast(t.app.copied, 'success')
    } catch (error) {
      toast(t.app.copyFailed((error as Error).message), 'error')
    }
  }

  async function openFile(path: string) {
    const error = await api.openFile(path)
    if (error) toast(t.app.openFailed(error), 'error')
  }

  function changeTheme(mode: ThemeMode) {
    setTheme(mode)
    void api.setTheme(mode)
  }

  function changeLanguage(next: Language) {
    if (next === language) return
    setLanguage(next)
    document.documentElement.lang = next
    document.title = messages(next).appName
    void api.setLanguage(next)
  }

  // 以下函数由 effect 注册的监听器调用。Effect Event 总能读到最新的状态，effect 不用因为状态变化而重新注册

  const onAppInfo = useEffectEvent((appInfo: AppInfo) => {
    setInfo(appInfo)
    logFFmpeg(appInfo)
  })

  // 处理过程中的日志、进度、步骤和结果
  const onJobEvent = useEffectEvent((event: JobEvent) => {
    switch (event.type) {
      case 'log':
        log.append(event.message, event.kind)
        break
      case 'finished':
        finish(event.result)
        break
      case 'fileStart':
        setJob((current) => {
          if (current.phase !== 'starting' && current.phase !== 'running') return current
          const statuses = current.statuses.map((status, index) => (index === event.index ? 'running' : status))
          if (current.phase === 'starting') {
            return {
              phase: 'running',
              total: current.total,
              statuses,
              index: event.index,
              stage: 'probe',
              percent: null,
              time: 0,
              speed: null,
              startedAt: Date.now(),
              cancelling: false,
            }
          }
          return {
            ...current,
            index: event.index,
            statuses,
            stage: 'probe',
            percent: null,
            time: 0,
            speed: null,
          }
        })
        break
      case 'fileFinished': {
        const outcome = event.outcome
        setJob((current) => {
          if (current.phase !== 'starting' && current.phase !== 'running') return current
          const statuses = current.statuses.map((status, index) => (index === outcome.index ? outcome.status : status))
          if (current.phase === 'starting') {
            return {
              phase: 'running',
              total: current.total,
              statuses,
              index: outcome.index,
              stage: 'probe',
              percent: null,
              time: 0,
              speed: null,
              startedAt: Date.now(),
              cancelling: false,
            }
          }
          return { ...current, statuses }
        })
        if (outcome.status === 'failed') {
          log.append(t.app.batchFileFailed(basename(outcome.inputPath), outcome.message ?? ''), 'error')
        }
        break
      }
      case 'stage':
        setJob((current) => {
          if (current.phase === 'starting') {
            const index = event.fileIndex ?? 0
            return {
              phase: 'running',
              total: current.total,
              statuses: current.statuses.map((status, i) => (i === index ? 'running' : status)),
              index,
              stage: event.stage,
              percent: null,
              time: 0,
              speed: null,
              startedAt: Date.now(),
              cancelling: false,
            }
          }
          if (current.phase !== 'running') return current
          const index = event.fileIndex ?? current.index
          const statuses = current.statuses.map((status, i) => (i === index ? 'running' : status))
          // 换到下一个文件（或者重新编码、复制）时，之前的进度不再适用
          const restart =
            (event.fileIndex !== undefined && event.fileIndex !== current.index) ||
            event.stage === 'encode' ||
            event.stage === 'copy'
          return { ...current, index, statuses, stage: event.stage, ...(restart ? { percent: null, time: 0, speed: null } : {}) }
        })
        break
      case 'progress': {
        const { percent, time, speed } = event.progress
        setJob((current) => (current.phase === 'running' ? { ...current, percent, time, speed } : current))
        break
      }
    }
  })

  // macOS 菜单中的“打开视频…”
  const onMenuCommand = useEffectEvent((command: MenuCommand) => {
    if (command === 'open') void chooseInput()
  })

  // 快捷键：Ctrl/⌘+O 选择文件（macOS 由菜单处理），Ctrl/⌘+Enter 开始处理
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    if (event.key === 'Enter') {
      event.preventDefault()
      void start()
    } else if (event.key.toLowerCase() === 'o' && info?.platform !== 'darwin') {
      event.preventDefault()
      void chooseInput()
    }
  })

  // 把视频文件拖到窗口任意位置即可选择，可以一次拖入多个
  const onDrag = useEffectEvent((event: DragEvent) => {
    const hasFiles = event.dataTransfer?.types.includes('Files') ?? false
    // 所有拖放都要阻止默认行为，否则浏览器会打开拖进来的文件
    event.preventDefault()
    if (event.type === 'dragover') {
      if (event.dataTransfer) event.dataTransfer.dropEffect = hasFiles && !busy ? 'copy' : 'none'
    } else if (event.type === 'dragenter' && hasFiles) {
      dragDepth.current++
      setDragging(true)
    } else if (event.type === 'dragleave' && hasFiles) {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    } else if (event.type === 'drop') {
      dragDepth.current = 0
      setDragging(false)
      const paths = Array.from(event.dataTransfer?.files ?? [])
        .map((file) => api.pathForFile(file))
        .filter((path): path is string => Boolean(path))
      if (paths.length === 0) return
      if (busy) {
        toast(t.app.busy, 'error')
        return
      }
      void selectInputs(paths)
    }
  })

  // 单个文件读取成功后显示默认输出路径（包括从批量列表中移除到只剩一个文件时）
  useEffect(() => {
    if (inputs.length !== 1) return
    const only = inputs[0]
    if (output.path || !only.file || only.error) return
    setOutput({ path: only.file.defaultOutput, confirmed: false })
  }, [inputs, output.path])

  useEffect(() => {
    // 开发模式下 React 会把 effect 执行两遍，active 保证只采用最后一次的结果、日志只写一次
    let active = true
    void api.getTheme().then((mode) => active && setTheme(mode))
    void api.getAppInfo().then((appInfo) => active && onAppInfo(appInfo))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => api.onJobEvent(onJobEvent), [])
  useEffect(() => api.onMenuCommand(onMenuCommand), [])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  useEffect(() => {
    const listener = (event: DragEvent) => onDrag(event)
    const types = ['dragenter', 'dragover', 'dragleave', 'drop'] as const
    for (const type of types) window.addEventListener(type, listener)
    return () => {
      for (const type of types) window.removeEventListener(type, listener)
    }
  }, [])

  // 批量处理中每个文件的最终状态，用于文件列表右侧的标记
  const fileStatuses: Record<string, FilePhase> = {}
  if (isBatch) {
    if (job.phase === 'starting' || job.phase === 'running') {
      inputs.forEach((item, index) => {
        fileStatuses[item.path] = job.statuses[index] ?? 'pending'
      })
    } else if (job.phase === 'batchDone') {
      for (const outcome of job.outcomes) fileStatuses[outcome.inputPath] = outcome.status
    } else if (job.phase === 'cancelled' && job.outcomes) {
      for (const outcome of job.outcomes) fileStatuses[outcome.inputPath] = outcome.status
    }
  }
  const inputSummaries = inputs.map((item) => ({ name: item.name, duration: item.file?.media?.duration ?? null }))

  return (
    <I18nContext value={{ language, t }}>
      <div className={cx('app', info?.platform === 'darwin' && 'is-mac')}>
        <Header info={info} theme={theme} onThemeChange={changeTheme} language={language} onLanguageChange={changeLanguage} />
        <main className="layout">
          <div className="column column-main">
            <FileCard
              inputs={inputs}
              inputMd5={inputMd5}
              output={output.path}
              outputDir={outputDir}
              statuses={fileStatuses}
              busy={busy}
              onChooseInput={() => void chooseInput()}
              onAddInput={() => void chooseInput(true)}
              onChooseOutput={() => void chooseOutput()}
              onChooseOutputDir={() => void chooseOutputDir()}
              onResetOutputDir={resetOutputDir}
              onRemove={removeInput}
              onCopy={(text) => void copy(text)}
            />
            <FeatureCard draft={draft} onChange={setDraft} disabled={busy} />
          </div>
          <div className="column column-side">
            <ProcessCard
              job={job}
              problem={problem}
              inputs={inputSummaries}
              features={features}
              outputPath={output.path}
              outputDir={outputDir}
              outputMd5={outputMd5}
              platform={info?.platform}
              onStart={() => void start()}
              onCancel={() => void cancel()}
              onClear={clearAll}
              onShowInFolder={(path) => void api.showInFolder(path)}
              onOpen={(path) => void openFile(path)}
              onCopy={(text) => void copy(text)}
            />
            <LogCard
              entries={log.entries}
              onCopy={() => void copy(log.entries.map((entry) => `[${entry.time}] ${entry.message}`).join('\n'))}
              onClear={log.clear}
            />
          </div>
        </main>

        {dragging && (
          <div className={cx('drop-overlay', busy && 'is-blocked')}>
            <div className="drop-overlay-inner">
              <Upload size={28} />
              <span>{busy ? t.app.busy : t.app.dropHere}</span>
            </div>
          </div>
        )}

        <div className="toasts" aria-live="polite">
          {toasts.map((item) => (
            <div key={item.id} className={cx('toast', `is-${item.tone}`)}>
              {item.message}
            </div>
          ))}
        </div>
      </div>
    </I18nContext>
  )
}

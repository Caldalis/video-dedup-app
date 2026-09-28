import { Upload } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { messages } from '../../shared/i18n'
import type { Language } from '../../shared/i18n/language'
import type { AppInfo, JobEvent, JobResult, Md5Slot, MenuCommand, ThemeMode } from '../../shared/ipc'
import { validateFeatures } from '../../shared/options'
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
  const [input, setInput] = useState<InputState | null>(null)
  const [inputMd5, setInputMd5] = useState<HashState>({ status: 'idle' })
  // confirmed：输出路径是在“另存为”对话框中选的，对话框已经确认过覆盖
  const [output, setOutput] = useState({ path: '', confirmed: false })
  const [draft, setDraft] = useState<FeatureDraft>(defaultDraft)
  const [job, setJob] = useState<JobState>({ phase: 'idle' })
  const [outputMd5, setOutputMd5] = useState<HashState>({ status: 'idle' })
  const [dragging, setDragging] = useState(false)
  const log = useLog()
  const { toasts, show: toast } = useToasts()

  // 界面文字。已经写入的日志保持写入时的语言
  const t = messages(language)
  const busy = job.phase === 'starting' || job.phase === 'running'
  const features = parseDraft(draft)
  const featureProblem = validateFeatures(features)
  const problem = !input
    ? t.problems.noInput
    : input.loading
      ? t.problems.loading
      : input.error
        ? inputErrorText(input.error, t)
        : featureProblem
          ? t.problems[featureProblem]
          : null

  // 每次开始读取文件信息、计算 MD5 时加一，用来丢弃已经过期的结果（期间又换了文件或清空了界面）
  const tokens = useRef({ inspect: 0, input: 0, output: 0 })
  // 防止快速连点：按钮要到下一次渲染时才会变成不可用
  const starting = useRef(false)
  // 拖动经过子元素时会连续触发 dragenter / dragleave，用计数判断是否真的离开了窗口
  const dragDepth = useRef(0)

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
    const token = ++tokens.current[slot]
    const set = slot === 'input' ? setInputMd5 : setOutputMd5
    set({ status: 'computing' })
    const result = await api.md5(path, slot)
    if (token !== tokens.current[slot]) return
    if (result.status === 'ok') {
      set({ status: 'done', value: result.value })
      log.append(t.app.md5Done(slot, result.value))
    } else if (result.status === 'error') {
      set({ status: 'error', message: result.message })
      log.append(t.app.md5Failed(slot, result.message), 'error')
    }
  }

  function resetMd5(slot: Md5Slot) {
    tokens.current[slot]++
    void api.cancelMd5(slot)
    ;(slot === 'input' ? setInputMd5 : setOutputMd5)({ status: 'idle' })
  }

  async function selectInput(path: string) {
    if (busy) return
    const token = ++tokens.current.inspect
    log.append(t.app.opened(path))
    setInput({ path, name: basename(path), loading: true, file: null, error: null })
    setOutput({ path: '', confirmed: false })
    setJob({ phase: 'idle' })
    resetMd5('output')
    void startMd5('input', path)

    const result = await api.inspectInput(path)
    if (token !== tokens.current.inspect) return
    if (!result.ok) {
      const error: InputError = { kind: result.reason, detail: result.detail }
      setInput({ path, name: basename(path), loading: false, file: null, error })
      log.append(inputErrorText(error, t), 'error')
      return
    }
    const media = result.file.media
    const error: InputError | null =
      media && !media.hasVideo ? (media.error ? { kind: 'cannotRead', detail: media.error } : { kind: 'noVideo' }) : null
    setInput({ path, name: result.file.name, loading: false, file: result.file, error })
    // 每次选择文件都重新生成默认输出路径，免得沿用上一个文件的输出路径，覆盖上一次的处理结果
    setOutput({ path: result.file.defaultOutput, confirmed: false })
    if (error) log.append(inputErrorText(error, t), 'error')
  }

  async function chooseInput() {
    if (busy) return
    const path = await api.chooseInput()
    if (path) await selectInput(path)
  }

  async function chooseOutput() {
    if (!input?.file || input.error || busy) return
    const path = await api.chooseOutput(output.path || input.file.defaultOutput)
    if (!path) return
    setOutput({ path, confirmed: true })
    log.append(t.app.outputChanged(path))
  }

  function removeInput() {
    if (busy) return
    tokens.current.inspect++
    resetMd5('input')
    resetMd5('output')
    setInput(null)
    setOutput({ path: '', confirmed: false })
    setJob({ phase: 'idle' })
  }

  function clearAll() {
    if (busy) return
    removeInput()
    setDraft(defaultDraft())
    log.clear()
    log.append(t.app.cleared)
  }

  async function start() {
    if (busy || starting.current || !input) return
    if (problem) {
      toast(problem, 'error')
      return
    }
    starting.current = true
    try {
      // 启动时没找到 FFmpeg 的话再找一次：程序运行期间才装好的 FFmpeg 也能直接用上
      if (!info?.ffmpeg) {
        const appInfo = await api.getAppInfo()
        setInfo(appInfo)
        if (appInfo.ffmpeg) logFFmpeg(appInfo)
      }
      setJob({ phase: 'starting' })
      resetMd5('output')
      log.append(t.app.starting)
      const response = await api.startJob({
        options: { ...features, inputPath: input.path, outputPath: output.path },
        overwriteConfirmed: output.confirmed,
      })
      if (response.status === 'started') {
        // 下次再输出到同一路径时需要重新确认覆盖
        setOutput((current) => ({ ...current, confirmed: false }))
        return
      }
      setJob((current) => (current.phase === 'starting' ? { phase: 'idle' } : current))
      if (response.status === 'invalid') {
        log.append(t.app.cannotStart(response.message), 'error')
        toast(response.message, 'error')
      }
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
      case 'failed':
        setJob({ phase: 'failed', message: result.message })
        log.append(t.app.failed(result.message), 'error')
        break
      case 'cancelled':
        setJob({ phase: 'cancelled' })
        log.append(t.app.cancelled)
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
      case 'stage':
        setJob((current) => {
          if (current.phase === 'starting') {
            return { phase: 'running', stage: event.stage, percent: null, time: 0, speed: null, startedAt: Date.now(), cancelling: false }
          }
          if (current.phase !== 'running') return current
          const restart = event.stage === 'encode' || event.stage === 'copy'
          return { ...current, stage: event.stage, ...(restart ? { percent: null, time: 0, speed: null } : {}) }
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

  // 把视频文件拖到窗口任意位置即可选择
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
      const file = event.dataTransfer?.files[0]
      if (!file) return
      if (busy) {
        toast(t.app.busy, 'error')
        return
      }
      const path = api.pathForFile(file)
      if (path) void selectInput(path)
    }
  })

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

  return (
    <I18nContext value={{ language, t }}>
      <div className={cx('app', info?.platform === 'darwin' && 'is-mac')}>
        <Header info={info} theme={theme} onThemeChange={changeTheme} language={language} onLanguageChange={changeLanguage} />
        <main className="layout">
          <div className="column column-main">
            <FileCard
              input={input}
              inputMd5={inputMd5}
              output={output.path}
              busy={busy}
              onChooseInput={() => void chooseInput()}
              onChooseOutput={() => void chooseOutput()}
              onRemove={removeInput}
              onCopy={(text) => void copy(text)}
            />
            <FeatureCard draft={draft} onChange={setDraft} disabled={busy} />
          </div>
          <div className="column column-side">
            <ProcessCard
              job={job}
              problem={problem}
              hasInput={input !== null}
              features={features}
              outputPath={output.path}
              duration={input?.file?.media?.duration ?? null}
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

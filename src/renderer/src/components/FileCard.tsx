import { CircleAlert, Film, FileVideoCamera, FolderOpen, LoaderCircle, Upload, X } from 'lucide-react'
import type { Messages } from '../../../shared/i18n'
import type { InputFile, InspectFailure } from '../../../shared/ipc'
import type { FilePhase } from '../../../shared/types'
import { basename, dirname, formatBytes, formatDuration, formatFps } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { Button, Card, CopyButton, IconButton, cx } from './ui'

export type HashState =
  | { status: 'idle' }
  | { status: 'computing' }
  | { status: 'done'; value: string }
  | { status: 'error'; message: string }

/**
 * 不能处理的原因：主进程读取文件失败的原因、FFmpeg 读不出这个文件（detail 是 FFmpeg 给出的原因）、没有视频画面。
 * 只记原因，显示时按当前语言生成说明
 */
export interface InputError {
  kind: InspectFailure | 'cannotRead' | 'noVideo'
  detail?: string
}

export function inputErrorText(error: InputError, t: Messages): string {
  switch (error.kind) {
    case 'invalidPath':
      return t.inputErrors.invalidPath
    case 'notAFile':
      return t.inputErrors.notAFile
    case 'unreadable':
      return t.inputErrors.unreadable(error.detail ?? '')
    case 'cannotRead':
      return t.inputErrors.cannotRead(error.detail ?? '')
    case 'noVideo':
      return t.inputErrors.noVideo
  }
}

export interface InputState {
  path: string
  name: string
  /** 正在读取视频信息 */
  loading: boolean
  file: InputFile | null
  /** 不能处理的原因（不是视频、读取失败等） */
  error: InputError | null
}

export function Md5Value({ state, onCopy }: { state: HashState; onCopy: (text: string) => void }) {
  const { t } = useI18n()
  switch (state.status) {
    case 'idle':
      return <span className="md5-value is-empty">—</span>
    case 'computing':
      return (
        <span className="md5-value is-pending">
          <LoaderCircle size={13} className="spin" />
          {t.file.md5Computing}
        </span>
      )
    case 'error':
      return (
        <span className="md5-value is-error" title={state.message}>
          {t.file.md5Failed}
        </span>
      )
    case 'done':
      return (
        <span className="md5-value">
          <code>{state.value}</code>
          <CopyButton text={state.value} label={t.file.copyMd5} onCopy={onCopy} />
        </span>
      )
  }
}

function mediaFacts(file: InputFile, t: Messages): string[] {
  const facts = [formatBytes(file.size)]
  const media = file.media
  if (!media) return facts
  if (media.duration) facts.push(formatDuration(media.duration))
  if (media.video?.width && media.video.height) facts.push(`${media.video.width}×${media.video.height}`)
  if (media.video?.fps) facts.push(formatFps(media.video.fps))
  const codecs = [media.video?.codec, media.audio?.codec].filter(Boolean).map((codec) => codec!.toUpperCase())
  if (codecs.length > 0) facts.push(codecs.join(' / '))
  if (media.video && !media.hasAudio) facts.push(t.file.noAudio)
  return facts
}

interface FileCardProps {
  inputs: InputState[]
  inputMd5: HashState
  output: string
  /** 批量处理的输出文件夹；null 表示输出到每个视频所在的目录 */
  outputDir: string | null
  /** 批量处理中每个文件的处理状态，按路径查找 */
  statuses: Record<string, FilePhase>
  busy: boolean
  onChooseInput: () => void
  onAddInput: () => void
  onChooseOutput: () => void
  onChooseOutputDir: () => void
  onResetOutputDir: () => void
  onRemove: (path: string) => void
  onCopy: (text: string) => void
}

function FileMeta({ input, t }: { input: InputState; t: Messages }) {
  if (input.loading) {
    return (
      <span className="muted">
        <LoaderCircle size={12} className="spin" /> {t.file.loading}
      </span>
    )
  }
  if (input.error) {
    return (
      <span className="text-danger">
        <CircleAlert size={13} /> {inputErrorText(input.error, t)}
      </span>
    )
  }
  if (!input.file) return null
  return (
    <>
      {mediaFacts(input.file, t).map((fact) => (
        <span key={fact} className="chip">
          {fact}
        </span>
      ))}
    </>
  )
}

export function FileCard({
  inputs,
  inputMd5,
  output,
  outputDir,
  statuses,
  busy,
  onChooseInput,
  onAddInput,
  onChooseOutput,
  onChooseOutputDir,
  onResetOutputDir,
  onRemove,
  onCopy,
}: FileCardProps) {
  const { t } = useI18n()
  const input = inputs.length === 1 ? inputs[0] : null
  const batch = inputs.length > 1

  return (
    <Card
      title={t.file.title}
      icon={<Film size={16} />}
      actions={
        inputs.length > 0 &&
        (batch ? (
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={onAddInput} disabled={busy}>
            {t.file.add}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={onChooseInput} disabled={busy}>
            {t.file.change}
          </Button>
        ))
      }
    >
      {inputs.length === 0 ? (
        <button type="button" className="dropzone" onClick={onChooseInput} disabled={busy}>
          <span className="dropzone-icon">
            <Upload size={22} />
          </span>
          <span className="dropzone-title">{t.file.dropTitle}</span>
          <span className="dropzone-hint">{t.file.dropHint}</span>
        </button>
      ) : batch ? (
        <div className="file-body">
          <div className="file-list">
            {inputs.map((item) => {
              const status = statuses[item.path]
              return (
                <div className="file-summary batch-file" key={item.path}>
                  <div className="file-thumb">
                    <FileVideoCamera size={20} />
                  </div>
                  <div className="file-main">
                    <div className="file-name" title={item.path}>
                      {item.name}
                    </div>
                    <div className="file-meta">
                      <FileMeta input={item} t={t} />
                    </div>
                  </div>
                  {status && (
                    <span className={cx('file-status', `is-${status}`)}>
                      {status === 'running' && <LoaderCircle size={12} className="spin" />}
                      {t.file.statuses[status]}
                    </span>
                  )}
                  <IconButton label={t.file.remove} onClick={() => onRemove(item.path)} disabled={busy}>
                    <X size={16} />
                  </IconButton>
                </div>
              )
            })}
          </div>

          <dl className="file-rows">
            <div className="file-row">
              <dt>{t.file.outputTo}</dt>
              <dd className="output-path">
                {outputDir ? (
                  <span className="path" title={outputDir}>
                    <span className="path-name">{outputDir}</span>
                  </span>
                ) : (
                  <span className="muted">{t.file.outputDirDefault}</span>
                )}
                <Button size="sm" onClick={onChooseOutputDir} disabled={busy}>
                  {t.file.changeOutput}
                </Button>
                {outputDir && (
                  <Button size="sm" variant="ghost" onClick={onResetOutputDir} disabled={busy}>
                    {t.file.resetOutputDir}
                  </Button>
                )}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        input && (
          <div className="file-body">
            <div className="file-summary">
              <div className="file-thumb">
                <FileVideoCamera size={20} />
              </div>
              <div className="file-main">
                <div className="file-name" title={input.path}>
                  {input.name}
                </div>
                <div className="file-meta">
                  <FileMeta input={input} t={t} />
                </div>
              </div>
              <IconButton label={t.file.remove} onClick={() => onRemove(input.path)} disabled={busy}>
                <X size={16} />
              </IconButton>
            </div>

            <dl className="file-rows">
              <div className="file-row">
                <dt>{t.file.originalMd5}</dt>
                <dd>
                  <Md5Value state={inputMd5} onCopy={onCopy} />
                </dd>
              </div>
              <div className="file-row">
                <dt>{t.file.outputTo}</dt>
                <dd className="output-path">
                  {output ? (
                    <span className="path" title={output}>
                      <span className="path-name">{basename(output)}</span>
                      <span className="path-dir">{dirname(output)}</span>
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                  {/* 读取完视频信息、确认可以处理后才需要选择输出位置 */}
                  <Button size="sm" onClick={onChooseOutput} disabled={busy || !input.file || input.error !== null}>
                    {t.file.changeOutput}
                  </Button>
                </dd>
              </div>
            </dl>
          </div>
        )
      )}
    </Card>
  )
}

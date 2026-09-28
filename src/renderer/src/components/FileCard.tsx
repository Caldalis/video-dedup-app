import { CircleAlert, Film, FileVideoCamera, FolderOpen, LoaderCircle, Upload, X } from 'lucide-react'
import type { Messages } from '../../../shared/i18n'
import type { InputFile, InspectFailure } from '../../../shared/ipc'
import { basename, dirname, formatBytes, formatDuration, formatFps } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { Button, Card, CopyButton, IconButton } from './ui'

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
  input: InputState | null
  inputMd5: HashState
  output: string
  busy: boolean
  onChooseInput: () => void
  onChooseOutput: () => void
  onRemove: () => void
  onCopy: (text: string) => void
}

export function FileCard({ input, inputMd5, output, busy, onChooseInput, onChooseOutput, onRemove, onCopy }: FileCardProps) {
  const { t } = useI18n()
  return (
    <Card
      title={t.file.title}
      icon={<Film size={16} />}
      actions={
        input && (
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={onChooseInput} disabled={busy}>
            {t.file.change}
          </Button>
        )
      }
    >
      {!input ? (
        <button type="button" className="dropzone" onClick={onChooseInput} disabled={busy}>
          <span className="dropzone-icon">
            <Upload size={22} />
          </span>
          <span className="dropzone-title">{t.file.dropTitle}</span>
          <span className="dropzone-hint">{t.file.dropHint}</span>
        </button>
      ) : (
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
                {input.loading ? (
                  <span className="muted">
                    <LoaderCircle size={12} className="spin" /> {t.file.loading}
                  </span>
                ) : input.error ? (
                  <span className="text-danger">
                    <CircleAlert size={13} /> {inputErrorText(input.error, t)}
                  </span>
                ) : input.file ? (
                  mediaFacts(input.file, t).map((fact) => (
                    <span key={fact} className="chip">
                      {fact}
                    </span>
                  ))
                ) : null}
              </div>
            </div>
            <IconButton label={t.file.remove} onClick={onRemove} disabled={busy}>
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
      )}
    </Card>
  )
}

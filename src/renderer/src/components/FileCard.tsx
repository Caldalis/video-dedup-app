import { CircleAlert, Film, FileVideoCamera, FolderOpen, LoaderCircle, Upload, X } from 'lucide-react'
import type { InputFile } from '../../../shared/ipc'
import { basename, dirname, formatBytes, formatDuration, formatFps } from '../lib/format'
import { Button, Card, CopyButton, IconButton } from './ui'

export type HashState =
  | { status: 'idle' }
  | { status: 'computing' }
  | { status: 'done'; value: string }
  | { status: 'error'; message: string }

export interface InputState {
  path: string
  name: string
  /** 正在读取视频信息 */
  loading: boolean
  file: InputFile | null
  /** 不能处理的原因（不是视频、读取失败等） */
  error: string | null
}

export function Md5Value({ state, onCopy }: { state: HashState; onCopy: (text: string) => void }) {
  switch (state.status) {
    case 'idle':
      return <span className="md5-value is-empty">—</span>
    case 'computing':
      return (
        <span className="md5-value is-pending">
          <LoaderCircle size={13} className="spin" />
          计算中…
        </span>
      )
    case 'error':
      return (
        <span className="md5-value is-error" title={state.message}>
          计算失败
        </span>
      )
    case 'done':
      return (
        <span className="md5-value">
          <code>{state.value}</code>
          <CopyButton text={state.value} label="复制 MD5" onCopy={onCopy} />
        </span>
      )
  }
}

function mediaFacts(file: InputFile): string[] {
  const facts = [formatBytes(file.size)]
  const media = file.media
  if (!media) return facts
  if (media.duration) facts.push(formatDuration(media.duration))
  if (media.video?.width && media.video.height) facts.push(`${media.video.width}×${media.video.height}`)
  if (media.video?.fps) facts.push(formatFps(media.video.fps))
  const codecs = [media.video?.codec, media.audio?.codec].filter(Boolean).map((codec) => codec!.toUpperCase())
  if (codecs.length > 0) facts.push(codecs.join(' / '))
  if (media.video && !media.hasAudio) facts.push('无声音')
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
  return (
    <Card
      title="视频文件"
      icon={<Film size={16} />}
      actions={
        input && (
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={onChooseInput} disabled={busy}>
            更换
          </Button>
        )
      }
    >
      {!input ? (
        <button type="button" className="dropzone" onClick={onChooseInput} disabled={busy}>
          <span className="dropzone-icon">
            <Upload size={22} />
          </span>
          <span className="dropzone-title">拖入视频文件，或点击选择</span>
          <span className="dropzone-hint">支持 MP4、MOV、MKV、AVI、WMV、FLV、WebM 等格式</span>
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
                    <LoaderCircle size={12} className="spin" /> 正在读取视频信息…
                  </span>
                ) : input.error ? (
                  <span className="text-danger">
                    <CircleAlert size={13} /> {input.error}
                  </span>
                ) : input.file ? (
                  mediaFacts(input.file).map((fact) => (
                    <span key={fact} className="chip">
                      {fact}
                    </span>
                  ))
                ) : null}
              </div>
            </div>
            <IconButton label="移除文件" onClick={onRemove} disabled={busy}>
              <X size={16} />
            </IconButton>
          </div>

          <dl className="file-rows">
            <div className="file-row">
              <dt>原始 MD5</dt>
              <dd>
                <Md5Value state={inputMd5} onCopy={onCopy} />
              </dd>
            </div>
            <div className="file-row">
              <dt>输出到</dt>
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
                  更改…
                </Button>
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Card>
  )
}

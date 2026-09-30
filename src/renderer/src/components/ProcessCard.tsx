import {
  Ban,
  CircleCheckBig,
  CircleX,
  Clapperboard,
  ExternalLink,
  FolderSearch,
  Gauge,
  LoaderCircle,
  Play,
  Sparkles,
  Square,
  Trash,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Messages } from '../../../shared/i18n'
import { FEATURE_KEYS, SAMPLING_RANDOM_RANGE, isCopyOnly, type FeatureOptions } from '../../../shared/options'
import type { Stage } from '../../../shared/types'
import { basename, extname, formatDuration, formatElapsed, formatSpeed } from '../lib/format'
import { useNow } from '../lib/hooks'
import { useI18n } from '../lib/i18n'
import { Md5Value, type HashState } from './FileCard'
import { Button, Card, ProgressBar, cx } from './ui'

export type JobState =
  | { phase: 'idle' }
  /** 已请求开始，主进程还在检查参数或询问是否覆盖 */
  | { phase: 'starting' }
  | {
      phase: 'running'
      stage: Stage
      percent: number | null
      time: number
      speed: number | null
      startedAt: number
      cancelling: boolean
    }
  | { phase: 'done'; outputPath: string; seconds: number }
  | { phase: 'failed'; message: string }
  | { phase: 'cancelled' }

interface ProcessCardProps {
  job: JobState
  /** 不能开始处理的原因，可以开始时为 null */
  problem: string | null
  hasInput: boolean
  features: FeatureOptions
  outputPath: string
  duration: number | null
  outputMd5: HashState
  /** 系统平台，决定“在访达中显示”按钮上文件管理器的名称 */
  platform: string | undefined
  onStart: () => void
  onCancel: () => void
  onClear: () => void
  onShowInFolder: (path: string) => void
  onOpen: (path: string) => void
  onCopy: (text: string) => void
}

function selectedChips(features: FeatureOptions, t: Messages): string[] {
  return FEATURE_KEYS.filter((key) => features[key]).map((key) => {
    const name = t.features.items[key].name
    if (key === 'maskInvert' && Number.isFinite(features.maskOpacity)) {
      return `${name} ${features.maskOpacity}`
    }
    if (key === 'frameSampling' && Number.isFinite(features.samplingInterval)) {
      const n = features.samplingInterval
      return t.process.samplingChip(name, n, features.samplingRandom ? n + SAMPLING_RANDOM_RANGE - 1 : null)
    }
    return name
  })
}

function StatusHeader({ tone, icon, title, detail }: { tone: string; icon: ReactNode; title: string; detail?: ReactNode }) {
  return (
    <div className={cx('status', `is-${tone}`)}>
      <div className="status-icon">{icon}</div>
      <div className="status-text">
        <div className="status-title">{title}</div>
        {detail && <div className="status-detail">{detail}</div>}
      </div>
    </div>
  )
}

export function ProcessCard(props: ProcessCardProps) {
  const { job, problem, hasInput, features, outputPath, duration, outputMd5 } = props
  const { t } = useI18n()
  const text = t.process
  const running = job.phase === 'running'
  const busy = running || job.phase === 'starting'
  const now = useNow(running)

  let body: ReactNode
  if (job.phase === 'running') {
    const elapsed = (now - job.startedAt) / 1000
    const remaining =
      duration && job.speed && job.speed > 0
        ? Math.max(0, (duration - job.time) / job.speed)
        : job.percent && job.percent >= 3
          ? (elapsed * (100 - job.percent)) / job.percent
          : null
    const showPercent = job.stage === 'encode' || job.stage === 'copy'
    body = (
      <>
        <StatusHeader
          tone="running"
          icon={<LoaderCircle size={20} className="spin" />}
          title={job.cancelling ? text.cancelling : `${text.stages[job.stage]}…`}
          detail={basename(outputPath)}
        />
        <div className="progress-block">
          <div className="progress-numbers">
            <span className="progress-percent">
              {showPercent && job.percent !== null ? `${job.percent}%` : job.stage === 'probe' ? text.preparing : text.finishing}
            </span>
            {job.speed !== null && showPercent && (
              <span className="progress-speed">
                <Gauge size={13} /> {formatSpeed(job.speed)}
              </span>
            )}
          </div>
          <ProgressBar percent={showPercent ? job.percent : job.stage === 'probe' ? null : 100} />
          <div className="progress-times">
            <span>{text.elapsed(formatDuration(elapsed))}</span>
            {showPercent && remaining !== null && <span>{text.remaining(formatDuration(remaining))}</span>}
          </div>
        </div>
      </>
    )
  } else if (job.phase === 'done') {
    body = (
      <>
        <StatusHeader
          tone="success"
          icon={<CircleCheckBig size={20} />}
          title={text.done}
          detail={text.took(formatElapsed(job.seconds, t.units))}
        />
        <div className="result">
          <div className="result-name" title={job.outputPath}>
            {basename(job.outputPath)}
          </div>
          <div className="result-md5">
            <span className="result-label">{text.newMd5}</span>
            <Md5Value state={outputMd5} onCopy={props.onCopy} />
          </div>
          <div className="result-actions">
            <Button size="sm" icon={<FolderSearch size={14} />} onClick={() => props.onShowInFolder(job.outputPath)}>
              {text.showInFolder(props.platform)}
            </Button>
            <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => props.onOpen(job.outputPath)}>
              {text.open}
            </Button>
          </div>
        </div>
      </>
    )
  } else if (job.phase === 'failed') {
    body = (
      <>
        <StatusHeader tone="error" icon={<CircleX size={20} />} title={text.failed} detail={text.failedDetail} />
        <pre className="error-box">{job.message}</pre>
      </>
    )
  } else if (job.phase === 'cancelled') {
    body = (
      <StatusHeader tone="muted" icon={<Ban size={20} />} title={text.cancelled} detail={text.cancelledDetail} />
    )
  } else if (!hasInput) {
    body = (
      <StatusHeader tone="muted" icon={<Clapperboard size={20} />} title={text.waiting} detail={text.waitingDetail} />
    )
  } else if (problem) {
    body = <StatusHeader tone="warn" icon={<TriangleAlert size={20} />} title={text.notReady} detail={problem} />
  } else {
    const copyOnly = isCopyOnly(features)
    const codec = extname(outputPath) === '.webm' ? 'VP9' : 'H.264'
    const muted = features.removeAudio
    const detail = copyOnly ? (muted ? text.copyMuted : text.copyOnly) : muted ? text.reencodeMuted(codec) : text.reencode(codec)
    body = (
      <>
        <StatusHeader
          tone="ready"
          icon={<Sparkles size={20} />}
          title={text.ready}
          detail={detail}
        />
        <div className="chips">
          {selectedChips(features, t).map((chip) => (
            <span key={chip} className="chip is-accent">
              {chip}
            </span>
          ))}
        </div>
      </>
    )
  }

  return (
    <Card title={text.title} icon={<Play size={16} />} className="process-card">
      <div className="process-body">{body}</div>
      <div className="process-actions">
        {running ? (
          <Button variant="danger" size="lg" icon={<Square size={14} />} onClick={props.onCancel} disabled={job.cancelling}>
            {job.cancelling ? text.cancelling : text.cancel}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            icon={busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}
            onClick={props.onStart}
            disabled={busy || problem !== null}
            title={problem ?? undefined}
          >
            {busy ? text.starting : job.phase === 'done' || job.phase === 'failed' ? text.restart : text.start}
          </Button>
        )}
        <Button size="lg" icon={<Trash size={15} />} onClick={props.onClear} disabled={busy} title={text.clearHint}>
          {text.clear}
        </Button>
      </div>
    </Card>
  )
}

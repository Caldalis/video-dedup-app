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
import { FEATURES } from '../../../shared/features'
import { SAMPLING_RANDOM_RANGE, isCopyOnly, type FeatureOptions } from '../../../shared/options'
import type { Stage } from '../../../shared/types'
import { basename, extname, formatDuration, formatElapsed, formatSpeed, STAGE_LABELS } from '../lib/format'
import { useNow } from '../lib/hooks'
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
  platformFileManager: string
  onStart: () => void
  onCancel: () => void
  onClear: () => void
  onShowInFolder: (path: string) => void
  onOpen: (path: string) => void
  onCopy: (text: string) => void
}

function selectedChips(features: FeatureOptions): string[] {
  return FEATURES.filter((feature) => features[feature.key]).map((feature) => {
    if (feature.key === 'maskInvert' && Number.isFinite(features.maskOpacity)) {
      return `${feature.name} ${features.maskOpacity}`
    }
    if (feature.key === 'frameSampling' && Number.isFinite(features.samplingInterval)) {
      const n = features.samplingInterval
      return features.samplingRandom ? `${feature.name} ${n}~${n + SAMPLING_RANDOM_RANGE - 1}帧` : `${feature.name} ${n}帧`
    }
    return feature.name
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
          title={job.cancelling ? '正在取消…' : `${STAGE_LABELS[job.stage]}…`}
          detail={basename(outputPath)}
        />
        <div className="progress-block">
          <div className="progress-numbers">
            <span className="progress-percent">
              {showPercent && job.percent !== null ? `${job.percent}%` : job.stage === 'probe' ? '准备中' : '收尾中'}
            </span>
            {job.speed !== null && showPercent && (
              <span className="progress-speed">
                <Gauge size={13} /> {formatSpeed(job.speed)}
              </span>
            )}
          </div>
          <ProgressBar percent={showPercent ? job.percent : job.stage === 'probe' ? null : 100} />
          <div className="progress-times">
            <span>已用 {formatDuration(elapsed)}</span>
            {showPercent && remaining !== null && <span>预计还需 {formatDuration(remaining)}</span>}
          </div>
        </div>
      </>
    )
  } else if (job.phase === 'done') {
    body = (
      <>
        <StatusHeader tone="success" icon={<CircleCheckBig size={20} />} title="处理完成" detail={`用时 ${formatElapsed(job.seconds)}`} />
        <div className="result">
          <div className="result-name" title={job.outputPath}>
            {basename(job.outputPath)}
          </div>
          <div className="result-md5">
            <span className="result-label">新 MD5</span>
            <Md5Value state={outputMd5} onCopy={props.onCopy} />
          </div>
          <div className="result-actions">
            <Button size="sm" icon={<FolderSearch size={14} />} onClick={() => props.onShowInFolder(job.outputPath)}>
              在{props.platformFileManager}中显示
            </Button>
            <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => props.onOpen(job.outputPath)}>
              打开
            </Button>
          </div>
        </div>
      </>
    )
  } else if (job.phase === 'failed') {
    body = (
      <>
        <StatusHeader tone="error" icon={<CircleX size={20} />} title="处理失败" detail="详细信息见下方的处理日志" />
        <pre className="error-box">{job.message}</pre>
      </>
    )
  } else if (job.phase === 'cancelled') {
    body = (
      <StatusHeader tone="muted" icon={<Ban size={20} />} title="已取消" detail="未生成输出文件，已有的同名文件也没有被改动" />
    )
  } else if (!hasInput) {
    body = (
      <StatusHeader tone="muted" icon={<Clapperboard size={20} />} title="等待选择视频" detail="选择或拖入一个视频文件后即可开始处理" />
    )
  } else if (problem) {
    body = <StatusHeader tone="warn" icon={<TriangleAlert size={20} />} title="还不能开始" detail={problem} />
  } else {
    const copyOnly = isCopyOnly(features)
    const codec = extname(outputPath) === '.webm' ? 'VP9' : 'H.264'
    body = (
      <>
        <StatusHeader
          tone="ready"
          icon={<Sparkles size={20} />}
          title="准备就绪"
          detail={copyOnly ? '只修改MD5值：直接复制音视频流，不重新编码，速度很快' : `画面重新编码为 ${codec}，声音能直接复制就不重新编码`}
        />
        <div className="chips">
          {selectedChips(features).map((chip) => (
            <span key={chip} className="chip is-accent">
              {chip}
            </span>
          ))}
        </div>
      </>
    )
  }

  return (
    <Card title="处理" icon={<Play size={16} />} className="process-card">
      <div className="process-body">{body}</div>
      <div className="process-actions">
        {running ? (
          <Button variant="danger" size="lg" icon={<Square size={14} />} onClick={props.onCancel} disabled={job.cancelling}>
            {job.cancelling ? '正在取消…' : '取消'}
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
            {busy ? '准备中…' : job.phase === 'done' || job.phase === 'failed' ? '重新处理' : '开始处理'}
          </Button>
        )}
        <Button size="lg" icon={<Trash size={15} />} onClick={props.onClear} disabled={busy} title="清空文件、参数和日志">
          清空
        </Button>
      </div>
    </Card>
  )
}

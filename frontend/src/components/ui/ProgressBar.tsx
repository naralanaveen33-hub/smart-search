import { motion } from 'framer-motion'
import { classNames } from '@/utils/format'

type Tone = 'accent' | 'ok' | 'warn' | 'bad' | 'muted'

const TONE_COLORS: Record<Tone, string> = {
  accent: 'var(--accent)',
  ok: 'var(--success)',
  warn: 'var(--warning)',
  bad: 'var(--danger)',
  muted: 'var(--border-strong)',
}

interface ProgressBarProps {
  value: number
  tone?: Tone
  height?: number
  label?: string
  showValue?: boolean
  className?: string
}

export function ProgressBar({
  value,
  tone = 'accent',
  height = 4,
  label,
  showValue = false,
  className,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className={classNames('w-full', className)}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && <span className="text-[11px] text-muted">{label}</span>}
          {showValue && <span className="tabular font-mono text-[11px] text-ink">{clamped}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
        className="w-full overflow-hidden rounded-full bg-surface-2 border border-line"
        style={{ height }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: TONE_COLORS[tone] }}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

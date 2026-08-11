import { Check, CircleDashed, Loader, TriangleAlert } from 'lucide-react'
import type { StageStatus } from '@/types'
import { classNames } from '@/utils/format'

const CONFIG: Record<StageStatus, { label: string; className: string; Icon: typeof Check }> = {
  waiting: {
    label: 'Waiting',
    className: 'text-subtle border-line bg-surface-2',
    Icon: CircleDashed,
  },
  in_progress: {
    label: 'In Progress',
    className: 'text-[var(--warning)] border-[var(--warning)]/35 bg-warn-soft',
    Icon: Loader,
  },
  completed: {
    label: 'Completed',
    className: 'text-[var(--success)] border-[var(--success)]/35 bg-ok-soft',
    Icon: Check,
  },
  error: {
    label: 'Error',
    className: 'text-[var(--danger)] border-[var(--danger)]/35 bg-bad-soft',
    Icon: TriangleAlert,
  },
}

export function StatusBadge({
  status,
  label,
  compact = false,
}: {
  status: StageStatus
  label?: string
  compact?: boolean
}) {
  const { label: defaultLabel, className, Icon } = CONFIG[status]
  return (
    <span
      className={classNames(
        'inline-flex items-center gap-1.5 rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        className,
      )}
    >
      <Icon size={11} className={status === 'in_progress' ? 'animate-spin' : undefined} />
      {!compact && (label ?? defaultLabel)}
    </span>
  )
}

export function Dot({ status }: { status: StageStatus }) {
  const colors: Record<StageStatus, string> = {
    waiting: 'var(--border-strong)',
    in_progress: 'var(--warning)',
    completed: 'var(--success)',
    error: 'var(--danger)',
  }
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: colors[status] }}
    />
  )
}

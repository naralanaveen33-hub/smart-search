import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { classNames } from '@/utils/format'

interface MetricCardProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'accent' | 'ok' | 'warn'
  index?: number
  animate?: boolean
}

const TONES = {
  default: 'text-ink',
  accent: 'text-accent',
  ok: 'text-[var(--success)]',
  warn: 'text-[var(--warning)]',
}

export function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
  index = 0,
  animate = true,
}: MetricCardProps) {
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.24), ease: 'easeOut' }}
      className="bg-surface border border-line rounded-[8px] p-4"
    >
      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className={classNames('tabular mt-1.5 text-[26px] leading-none font-semibold sm:text-[28px]', TONES[tone])}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11px] text-subtle">{hint}</p>}
    </motion.div>
  )
}

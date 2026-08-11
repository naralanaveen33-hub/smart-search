import type { HTMLAttributes, ReactNode } from 'react'
import { classNames } from '@/utils/format'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
  padded?: boolean
}

/** Flat surface with a single hairline border — no shadow, no gradient. */
export function Card({ children, padded = true, className, ...props }: CardProps) {
  return (
    <div
      className={classNames(
        'bg-surface border border-line rounded-[8px]',
        padded && 'p-5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <div className={classNames('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[12px] text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string
  title: string
  description?: string
}) {
  return (
    <div className="max-w-2xl">
      {eyebrow && (
        <p className="mb-2 font-mono text-[11px] tracking-[0.14em] text-accent uppercase">
          {eyebrow}
        </p>
      )}
      <h1 className="text-[22px] leading-tight font-semibold sm:text-[26px]">{title}</h1>
      {description && <p className="mt-2 text-[13px] leading-relaxed text-muted">{description}</p>}
    </div>
  )
}

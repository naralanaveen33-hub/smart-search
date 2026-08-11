import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { classNames } from '@/utils/format'

export { Button } from './Button'
export { Card, CardHeader, SectionTitle } from './Card'
export { MetricCard } from './MetricCard'
export { ProgressBar } from './ProgressBar'
export { StatusBadge, Dot } from './StatusBadge'

/* --------------------------------------------------------------- controls */

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={classNames(
        'h-9 w-full rounded-[6px] border border-line bg-surface px-3 text-[13px] text-ink',
        'placeholder:text-subtle focus:border-[var(--accent)] focus:outline-none',
        'transition-colors duration-100',
        className,
      )}
      {...props}
    />
  )
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={classNames(
        'h-9 rounded-[6px] border border-line bg-surface px-2.5 pr-7 text-[13px] text-ink',
        'focus:border-[var(--accent)] focus:outline-none cursor-pointer appearance-none',
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2371717a%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-[length:14px] bg-[right_8px_center] bg-no-repeat",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  id?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={classNames(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150',
        checked
          ? 'border-[var(--accent)] bg-[var(--accent)]'
          : 'border-line-strong bg-surface-2',
      )}
    >
      <span
        className={classNames(
          'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-150',
          checked ? 'left-[18px] bg-white dark:bg-[#0b0b0f]' : 'left-0.5 bg-[var(--border-strong)]',
        )}
      />
    </button>
  )
}

export function Radio({
  checked,
  onChange,
  label,
  name,
}: {
  checked: boolean
  onChange: () => void
  label: string
  name: string
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink select-none">
      <span className="relative flex h-4 w-4 items-center justify-center">
        <input
          type="radio"
          name={name}
          checked={checked}
          onChange={onChange}
          className="peer sr-only"
        />
        <span
          className={classNames(
            'h-4 w-4 rounded-full border transition-colors',
            checked ? 'border-[var(--accent)]' : 'border-line-strong',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus)] peer-focus-visible:outline-offset-2',
          )}
        />
        {checked && (
          <span className="absolute h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden />
        )}
      </span>
      {label}
    </label>
  )
}

/* ------------------------------------------------------------------ chrome */

export function Chip({
  children,
  onClick,
  active = false,
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const Component = onClick ? 'button' : 'span'
  return (
    <Component
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={classNames(
        'inline-flex items-center rounded-[4px] border px-2 py-1 text-[12px] transition-colors',
        active
          ? 'border-[var(--accent-border)] bg-accent-soft text-accent'
          : 'border-line bg-surface text-muted',
        onClick && 'hover:border-line-strong hover:text-ink cursor-pointer',
      )}
    >
      {children}
    </Component>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number }[]
  value: T
  onChange: (key: T) => void
}) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((tab) => {
        const active = tab.key === value
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={classNames(
              'relative -mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              active
                ? 'border-[var(--accent)] text-ink'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="tabular ml-1.5 font-mono text-[11px] text-subtle">{tab.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-subtle">{icon}</div>}
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error'
  children: ReactNode
}) {
  const styles = {
    info: 'border-[var(--accent-border)] bg-accent-soft text-accent',
    warn: 'border-[var(--warning)]/35 bg-warn-soft text-[var(--warning)]',
    error: 'border-[var(--danger)]/35 bg-bad-soft text-[var(--danger)]',
  }
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={classNames('rounded-[6px] border px-3 py-2 text-[12px]', styles[tone])}
    >
      {children}
    </div>
  )
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="tabular font-mono text-[12px] text-ink">{value}</span>
    </div>
  )
}

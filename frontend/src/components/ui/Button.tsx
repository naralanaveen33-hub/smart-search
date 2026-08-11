import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from '@/utils/format'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  iconRight?: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--accent)] text-white border border-[var(--accent)] hover:opacity-90 dark:text-[#0b0b0f]',
  secondary:
    'bg-surface text-ink border border-line hover:bg-surface-2 hover:border-line-strong',
  ghost: 'bg-transparent text-muted border border-transparent hover:text-ink hover:bg-surface-2',
  danger: 'bg-transparent text-[var(--danger)] border border-[var(--danger)] hover:bg-bad-soft',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-4 text-[13px] gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={classNames(
        'inline-flex items-center justify-center rounded-[6px] font-medium whitespace-nowrap',
        'transition-colors duration-100 select-none',
        'disabled:opacity-40 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  )
}

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-line text-muted transition-colors hover:text-ink"
      >
        {isDark ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className="flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {isDark ? <Sun size={15} strokeWidth={1.9} /> : <Moon size={15} strokeWidth={1.9} />}
      {isDark ? 'Light Mode' : 'Dark Mode'}
    </button>
  )
}

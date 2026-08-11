import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Menu, Play, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Logo, NAV_ITEMS, Sidebar } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'
import { useIndexing } from '@/hooks/useIndexing'
import { classNames } from '@/utils/format'

export function AppShell({
  children,
  onPresent,
}: {
  children: ReactNode
  onPresent: () => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { status, connected } = useIndexing()

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const current = NAV_ITEMS.find((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to),
  )

  return (
    <div className="min-h-dvh bg-bg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[212px] border-r border-line lg:block">
        <Sidebar onPresent={onPresent} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="fixed inset-y-0 left-0 z-50 w-[240px] border-r border-line lg:hidden"
            >
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
                className="absolute top-3.5 right-3 z-10 text-muted hover:text-ink"
              >
                <X size={16} />
              </button>
              <Sidebar onNavigate={() => setMobileOpen(false)} onPresent={onPresent} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-[212px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/95 px-4 backdrop-blur-[2px] sm:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
            className="text-muted hover:text-ink lg:hidden"
          >
            <Menu size={18} />
          </button>

          <Link to="/" className="lg:hidden">
            <Logo compact />
          </Link>

          <h1 className="hidden text-[13px] font-medium lg:block">{current?.label ?? 'SwiftSearch'}</h1>

          <div className="ml-auto flex items-center gap-2">
            <IndexBadge state={status?.state ?? 'idle'} live={connected} />
            <button
              type="button"
              onClick={onPresent}
              aria-label="Start presentation mode"
              className="flex h-8 items-center gap-1.5 rounded-[6px] border border-line px-2.5 text-[12px] text-muted transition-colors hover:text-ink"
            >
              <Play size={12} />
              <span className="hidden sm:inline">Present</span>
            </button>
            <span className="lg:hidden">
              <ThemeToggle compact />
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 pb-20 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>

      <MobileTabBar />
    </div>
  )
}

function IndexBadge({ state, live }: { state: string; live: boolean }) {
  const config: Record<string, { label: string; color: string }> = {
    idle: { label: 'No index', color: 'var(--border-strong)' },
    running: { label: 'Indexing', color: 'var(--warning)' },
    completed: { label: 'Index ready', color: 'var(--success)' },
    error: { label: 'Index error', color: 'var(--danger)' },
  }
  const { label, color } = config[state] ?? config.idle
  return (
    <span
      className="hidden items-center gap-1.5 rounded-[4px] border border-line px-2 py-1 text-[11px] text-muted sm:inline-flex"
      title={live ? 'Live event stream connected' : 'Event stream disconnected'}
    >
      <span
        className={classNames('h-1.5 w-1.5 rounded-full', state === 'running' && 'animate-pulse')}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}

/** Mobile: the five screens that matter during a demo. */
function MobileTabBar() {
  const items = NAV_ITEMS.filter((item) =>
    ['/', '/how-it-works', '/indexing', '/search', '/index-explorer'].includes(item.to),
  )
  const location = useLocation()

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface lg:hidden"
    >
      {items.map((item) => {
        const active =
          item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
        return (
          <Link
            key={item.to}
            to={item.to}
            className={classNames(
              'flex flex-col items-center gap-1 py-2.5 text-[10px] transition-colors',
              active ? 'text-accent' : 'text-muted',
            )}
          >
            <item.icon size={17} strokeWidth={1.9} />
            {item.label.split(' ')[0]}
          </Link>
        )
      })}
    </nav>
  )
}

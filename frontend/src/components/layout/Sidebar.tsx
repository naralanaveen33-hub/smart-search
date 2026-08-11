import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  Binary,
  FileText,
  Home,
  Layers,
  ListOrdered,
  Play,
  Search,
  Settings,
  Workflow,
} from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { classNames } from '@/utils/format'

export const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/how-it-works', label: 'How It Works', icon: Workflow },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/indexing', label: 'Indexing', icon: Layers },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/results', label: 'Results', icon: ListOrdered },
  { to: '/index-explorer', label: 'Index Explorer', icon: Binary },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="flex h-6 w-6 items-center justify-center rounded-[5px] border border-[var(--accent-border)] bg-accent-soft"
      >
        <Search size={13} className="text-accent" strokeWidth={2.5} />
      </span>
      {!compact && (
        <span className="text-[14px] font-semibold tracking-tight">
          Swift<span className="text-accent">Search</span>
        </span>
      )}
    </span>
  )
}

interface SidebarProps {
  onNavigate?: () => void
  onPresent: () => void
}

export function Sidebar({ onNavigate, onPresent }: SidebarProps) {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-14 items-center border-b border-line px-4">
        <Logo />
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={'end' in item ? item.end : false}
                onClick={onNavigate}
                className={({ isActive }) =>
                  classNames(
                    'flex items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] transition-colors',
                    isActive
                      ? 'bg-accent-soft text-accent font-medium'
                      : 'text-muted hover:bg-surface-2 hover:text-ink',
                  )
                }
              >
                <item.icon size={15} strokeWidth={1.9} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-1 border-t border-line p-3">
        <button
          type="button"
          onClick={onPresent}
          className="flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Play size={15} strokeWidth={1.9} />
          Presentation Mode
          <kbd className="ml-auto rounded-[3px] border border-line px-1 font-mono text-[10px] text-subtle">
            P
          </kbd>
        </button>
        <ThemeToggle />
      </div>
    </div>
  )
}

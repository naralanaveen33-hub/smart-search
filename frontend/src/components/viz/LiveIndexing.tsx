import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, HardDrive, Loader } from 'lucide-react'
import { ProgressBar } from '@/components/ui'
import type { BlockSummary, PostingEntry, TokenEntry } from '@/types'
import { classNames, formatBytes, formatNumber } from '@/utils/format'

/* ---------------------------------------------------------- memory meter */

export function MemoryMeter({
  used,
  entries,
  capacity,
  flushing,
}: {
  used: number
  entries: number
  capacity: number
  flushing?: boolean
}) {
  const tone = flushing ? 'warn' : used > 85 ? 'warn' : 'accent'
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-muted">Memory Usage</span>
        <span className="tabular font-mono text-[12.5px] font-medium text-ink">
          {used}% ({formatNumber(entries)} / {formatNumber(capacity)} entries)
        </span>
      </div>
      <ProgressBar value={used} tone={tone} height={6} />
      <AnimatePresence>
        {flushing && (
          <motion.p
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-1.5 font-mono text-[11px] font-semibold text-[var(--warning)]"
          >
            MEMORY FULL → WRITING BLOCK TO DISK
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ----------------------------------------------------------- token stream */

export function TokenStream({ tokens, dense = false }: { tokens: TokenEntry[]; dense?: boolean }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [tokens.length])

  if (!tokens.length) {
    return <p className="p-3 text-[12px] text-subtle">No tokens yet — start indexing to see the stream.</p>
  }

  return (
    <div className={classNames('overflow-y-auto', dense ? 'max-h-[180px]' : 'max-h-[260px]')}>
      <div className="space-y-0.5 p-2">
        <AnimatePresence initial={false}>
          {tokens.map((token, index) => (
            <motion.div
              key={`${token.document_id}-${token.position}-${index}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.14 }}
              className="flex items-baseline gap-2 font-mono text-[11px]"
            >
              <span className="w-[110px] shrink-0 truncate text-ink">{token.term}</span>
              <span className="text-subtle">→</span>
              <span className="text-accent">{token.document_id}</span>
              <span className="ml-auto text-subtle">pos {token.position}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------- current block table */

export function PostingsTable({
  entries,
  emptyMessage = 'The memory block is empty.',
  maxHeight = 260,
}: {
  entries: PostingEntry[]
  emptyMessage?: string
  maxHeight?: number
}) {
  if (!entries.length) {
    return <p className="p-3 text-[12px] text-subtle">{emptyMessage}</p>
  }
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-left">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line text-[10px] tracking-wide text-subtle uppercase">
            <th className="px-3 py-1.5 font-medium">Term</th>
            <th className="px-3 py-1.5 font-medium">Document ID</th>
            <th className="px-3 py-1.5 text-right font-medium">Position</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {entries.map((entry, index) => (
              <motion.tr
                key={`${entry.term}-${entry.document_id}-${entry.position}-${index}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border-b border-line last:border-0"
              >
                <td className="px-3 py-1.5 font-mono text-[11px] text-ink">{entry.term}</td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-accent">{entry.document_id}</td>
                <td className="tabular px-3 py-1.5 text-right font-mono text-[11px] text-muted">
                  {entry.position}
                </td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  )
}

/* --------------------------------------------------------------- blocks */

const BLOCK_STATUS: Record<BlockSummary['status'], { label: string; className: string }> = {
  writing: { label: 'Writing…', className: 'border-[var(--warning)] bg-warn-soft text-[var(--warning)]' },
  written: { label: 'Written', className: 'border-line bg-surface text-muted' },
  sorting: { label: 'Sorting…', className: 'border-[var(--warning)] bg-warn-soft text-[var(--warning)]' },
  sorted: { label: 'Sorted', className: 'border-[var(--success)]/40 bg-surface text-[var(--success)]' },
  merged: { label: 'Merged', className: 'border-[var(--success)]/40 bg-surface text-[var(--success)]' },
}

export function BlockGrid({
  blocks,
  activeId,
  onSelect,
  columns = 2,
}: {
  blocks: BlockSummary[]
  activeId?: number
  onSelect?: (id: number) => void
  columns?: number
}) {
  if (!blocks.length) {
    return (
      <p className="p-3 text-[12px] text-subtle">
        No blocks yet. Blocks appear each time the memory buffer fills.
      </p>
    )
  }

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      <AnimatePresence initial={false}>
        {blocks.map((block) => {
          const status = BLOCK_STATUS[block.status] ?? BLOCK_STATUS.written
          const interactive = Boolean(onSelect)
          const Component = interactive ? motion.button : motion.div
          return (
            <Component
              key={block.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={interactive ? () => onSelect?.(block.id) : undefined}
              className={classNames(
                'rounded-[6px] border p-2.5 text-left transition-colors',
                status.className,
                activeId === block.id && 'ring-1 ring-[var(--accent)]',
                interactive && 'hover:border-line-strong cursor-pointer',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium">
                  <HardDrive size={11} />
                  Block {block.id}
                </span>
                {block.status === 'writing' || block.status === 'sorting' ? (
                  <Loader size={11} className="animate-spin" />
                ) : (
                  <Check size={11} />
                )}
              </div>
              <p className="mt-1 text-[11px] opacity-80">{status.label}</p>
              <p className="tabular mt-0.5 font-mono text-[11px] opacity-70">
                {formatNumber(block.entries)} entries · {formatBytes(block.size_bytes)}
              </p>
              {block.first_term && (
                <p className="mt-1 truncate font-mono text-[10px] opacity-60">
                  {block.first_term} … {block.last_term}
                </p>
              )}
            </Component>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------ document preview */

export function DocumentPreview({
  text,
  title,
  terms,
}: {
  text: string
  title?: string
  terms: string[]
}) {
  if (!text) {
    return <p className="p-3 text-[12px] text-subtle">Select a document to preview it.</p>
  }

  // Highlight surface words whose stem prefix matches an indexed term.
  const stems = terms.map((t) => t.toLowerCase()).filter((t) => t.length > 2)
  const words = text.split(/(\s+)/)

  return (
    <div className="max-h-[260px] overflow-y-auto p-3">
      {title && <p className="mb-2 text-[12px] font-medium text-ink">{title}</p>}
      <p className="text-[12px] leading-relaxed text-muted">
        {words.map((word, index) => {
          const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '')
          const matched = clean.length > 2 && stems.some((stem) => clean.startsWith(stem))
          return matched ? (
            <span key={index} className="mark">
              {word}
            </span>
          ) : (
            <span key={index}>{word}</span>
          )
        })}
      </p>
    </div>
  )
}

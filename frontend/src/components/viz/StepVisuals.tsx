import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, ArrowRight, Check, HardDrive } from 'lucide-react'
import { ProgressBar } from '@/components/ui'
import { useReducedMotion } from '@/hooks/useAsync'
import type { ExplainStep } from '@/types'
import { classNames } from '@/utils/format'

/**
 * Reveals `total` items one at a time.
 *
 * - playing  → reveal progressively from the start
 * - paused   → freeze wherever the reveal had got to
 * - arriving at a step while paused → show the finished state, since there is
 *   no in-flight animation to freeze and empty panes would teach nothing
 * - reduced motion → always jump straight to the finished state
 */
function useReveal(
  total: number,
  playing: boolean,
  interval = 420,
  resetKey?: unknown,
) {
  const [count, setCount] = useState(playing ? 0 : total)
  const reduced = useReducedMotion()

  useEffect(() => {
    setCount(reduced || !playing ? total : 0)
    // `playing` is deliberately excluded: toggling pause must freeze the
    // current count, not restart or complete it. Only a new step or a new run
    // (resetKey) restarts the reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, total, reduced])

  useEffect(() => {
    if (reduced || !playing || count >= total) return
    const timer = window.setTimeout(() => setCount((c) => c + 1), interval)
    return () => window.clearTimeout(timer)
  }, [playing, count, total, interval, reduced])

  return { count, done: count >= total }
}

interface VisualProps {
  data: any
  playing: boolean
  resetKey: string
}

const ITEM = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: 0.18 },
}

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={classNames(
        'inline-block rounded-[4px] border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]',
        className,
      )}
    >
      {children}
    </span>
  )
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">{children}</p>
}

/* ------------------------------------------------------------- 1 documents */

function DocumentsVisual({ data, playing, resetKey }: VisualProps) {
  const documents: { id: string; text: string }[] = data?.documents ?? []
  const { count } = useReveal(documents.length, playing, 520, resetKey)

  return (
    <div className="space-y-2.5">
      <Caption>Corpus</Caption>
      <AnimatePresence initial={false}>
        {documents.slice(0, Math.max(count, 1)).map((doc) => (
          <motion.div
            key={doc.id}
            {...ITEM}
            className="flex items-start gap-3 rounded-[6px] border border-line bg-surface p-3"
          >
            <span className="rounded-[4px] border border-[var(--accent-border)] bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent">
              {doc.id}
            </span>
            <p className="text-[13px] text-ink">{doc.text}</p>
          </motion.div>
        ))}
      </AnimatePresence>
      <p className="text-[12px] text-muted">
        Each document receives a stable identifier. Every posting in the index refers back to one of
        these IDs.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------- 2 tokenization */

function TokenizationVisual({ data, playing, resetKey }: VisualProps) {
  const doc = data?.documents?.[0]
  const raw: string[] = doc?.raw ?? []
  const removed: string[] = doc?.removed ?? []
  const kept: string[] = doc?.kept ?? []
  const { count } = useReveal(raw.length + 1, playing, 380, resetKey)

  return (
    <div className="space-y-4">
      <div>
        <Caption>Raw text</Caption>
        <p className="mt-1.5 rounded-[6px] border border-line bg-surface p-3 text-[13px]">
          {doc?.text}
        </p>
      </div>

      <div className="flex justify-center text-subtle">
        <ArrowDown size={14} />
      </div>

      <div>
        <Caption>Split into tokens</Caption>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {raw.slice(0, count).map((token, index) => (
            <motion.span key={`${token}-${index}`} {...ITEM}>
              <Mono
                className={
                  removed.includes(token)
                    ? 'text-subtle line-through decoration-[var(--danger)]/60'
                    : 'text-ink'
                }
              >
                {token}
              </Mono>
            </motion.span>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {count > raw.length && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <Caption>After normalization</Caption>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {kept.map((term) => (
                <Mono key={term} className="border-[var(--accent-border)] bg-accent-soft text-accent">
                  {term}
                </Mono>
              ))}
            </div>
            {removed.length > 0 && (
              <p className="mt-2 text-[12px] text-muted">
                Stop words removed: {removed.map((r) => `"${r}"`).join(', ')}. Remaining terms are
                stemmed to a common root.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* -------------------------------------------------------- 3 block creation */

function BlockCreationVisual({ data, playing, resetKey }: VisualProps) {
  const pairs: { term: string; document_id: string }[] = data?.pairs ?? []
  const capacity: number = data?.capacity ?? 3
  const { count } = useReveal(pairs.length + 1, playing, 480, resetKey)

  const inMemory = pairs.slice(0, count)
  const flushed = Math.floor(inMemory.length / capacity)
  const current = inMemory.slice(flushed * capacity)
  const full = current.length === 0 && flushed > 0 && count <= pairs.length
  const used = Math.round((current.length / capacity) * 100)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Caption>Term-document pairs</Caption>
        <div className="mt-1.5 space-y-1">
          {pairs.slice(0, count).map((pair, index) => (
            <motion.div
              key={`${pair.term}-${index}`}
              {...ITEM}
              className="flex items-center gap-1.5 font-mono text-[11px]"
            >
              <span className="text-ink">{pair.term}</span>
              <ArrowRight size={10} className="text-subtle" />
              <span className="text-accent">{pair.document_id}</span>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <Caption>Memory block</Caption>
            <span className="tabular font-mono text-[10px] text-muted">
              {current.length} / {capacity}
            </span>
          </div>
          <div
            className={classNames(
              'min-h-[92px] rounded-[6px] border p-2 transition-colors',
              full ? 'border-[var(--warning)] bg-warn-soft' : 'border-line bg-surface',
            )}
          >
            <AnimatePresence mode="popLayout">
              {current.map((pair, index) => (
                <motion.div
                  key={`${pair.term}-${index}`}
                  layout
                  {...ITEM}
                  className="font-mono text-[11px] text-ink"
                >
                  {pair.term} · {pair.document_id}
                </motion.div>
              ))}
            </AnimatePresence>
            {full && (
              <p className="font-mono text-[11px] font-semibold text-[var(--warning)]">
                MEMORY FULL → FLUSHED
              </p>
            )}
          </div>
          <ProgressBar value={used} tone={used > 80 ? 'warn' : 'accent'} className="mt-2" />
        </div>

        <div>
          <Caption>Blocks on disk</Caption>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Array.from({ length: flushed }).map((_, index) => (
              <motion.span
                key={index}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-1.5 rounded-[4px] border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted"
              >
                <HardDrive size={11} />
                Block {index + 1}
              </motion.span>
            ))}
            {flushed === 0 && <span className="text-[12px] text-subtle">Nothing written yet</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- 4 sorting */

function SortingVisual({ data, playing, resetKey }: VisualProps) {
  const unsorted: string[] = data?.unsorted ?? []
  const sorted: string[] = data?.sorted ?? []
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState(playing && !reduced ? 0 : 1)

  useEffect(() => {
    setPhase(reduced || !playing ? 1 : 0)
    // Pausing freezes the current phase; only a new step or replay resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, reduced])

  useEffect(() => {
    if (!playing || phase >= 1 || reduced) return
    const timer = window.setTimeout(() => setPhase(1), 1100)
    return () => window.clearTimeout(timer)
  }, [playing, phase, reduced])

  const items = phase === 0 ? unsorted : sorted

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Caption>{phase === 0 ? 'Unsorted block' : 'Sorted block'}</Caption>
        {phase === 1 && <Check size={12} className="text-[var(--success)]" />}
      </div>

      <div className="w-full max-w-[220px] space-y-1">
        {items.map((term) => (
          <motion.div
            key={term}
            layout
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={classNames(
              'rounded-[4px] border px-2.5 py-1.5 font-mono text-[12px]',
              phase === 1
                ? 'border-[var(--accent-border)] bg-accent-soft text-accent'
                : 'border-line bg-surface text-ink',
            )}
          >
            {term}
          </motion.div>
        ))}
      </div>

      <p className="max-w-md text-[12px] leading-relaxed text-muted">
        A block is small by construction, so it can be sorted entirely in memory. Sorting is what
        makes the next stage cheap: two sorted lists merge in one linear pass, while unsorted lists
        would need random access across the whole collection.
      </p>
    </div>
  )
}

/* --------------------------------------------------------------- 5 merging */

function MergingVisual({ data, playing, resetKey }: VisualProps) {
  const blocks: { id: number; terms: string[] }[] = data?.blocks ?? []
  const merged: string[] = data?.merged ?? []
  const { count } = useReveal(merged.length, playing, 300, resetKey)

  return (
    <div className="space-y-4">
      <div>
        <Caption>Sorted blocks on disk</Caption>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          {blocks.slice(0, 3).map((block) => (
            <div key={block.id} className="rounded-[6px] border border-line bg-surface p-2">
              <p className="mb-1 font-mono text-[10px] text-subtle">BLOCK {block.id}</p>
              {block.terms.map((term, index) => (
                <p key={`${term}-${index}`} className="font-mono text-[11px] text-ink">
                  {term}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-center text-subtle">
        <ArrowDown size={14} />
      </div>

      <div>
        <Caption>K-way merge output</Caption>
        <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-[6px] border border-[var(--accent-border)] bg-accent-soft p-2.5">
          {merged.slice(0, count).map((term, index) => (
            <motion.span
              key={`${term}-${index}`}
              {...ITEM}
              className="font-mono text-[11px] text-accent"
            >
              {term}
            </motion.span>
          ))}
          {count === 0 && <span className="text-[11px] text-subtle">Waiting…</span>}
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-muted">
        The merge holds only one record per block in memory and repeatedly emits the smallest. The
        output arrives in global term order regardless of how many blocks exist.
      </p>
    </div>
  )
}

/* -------------------------------------------------------- 6 inverted index */

function InvertedIndexVisual({ data, playing, resetKey }: VisualProps) {
  const live: { term: string; documents: string[] }[] = data?.live ?? []
  const sample: { term: string; documents: string[] }[] = data?.index ?? []
  const entries = live.length ? live : sample
  const { count } = useReveal(entries.length, playing, 380, resetKey)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Caption>Term → postings list</Caption>
        {live.length > 0 && (
          <span className="rounded-[4px] border border-[var(--success)]/35 bg-ok-soft px-1.5 py-0.5 font-mono text-[10px] text-[var(--success)]">
            LIVE INDEX
          </span>
        )}
      </div>

      <div className="divide-y divide-[var(--border)] rounded-[6px] border border-line bg-surface">
        {entries.slice(0, Math.max(count, 1)).map((entry) => (
          <motion.div key={entry.term} {...ITEM} className="flex flex-wrap items-center gap-2 p-2.5">
            <span className="w-24 shrink-0 font-mono text-[12px] font-medium text-accent">
              {entry.term}
            </span>
            <ArrowRight size={11} className="shrink-0 text-subtle" />
            <span className="flex flex-wrap gap-1">
              {entry.documents.map((doc) => (
                <Mono key={doc} className="text-muted">
                  {doc}
                </Mono>
              ))}
            </span>
          </motion.div>
        ))}
      </div>

      <p className="text-[12px] leading-relaxed text-muted">
        Looking up a query term is now a single dictionary lookup followed by a scan of one postings
        list — never a scan of the collection.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- exports */

const VISUALS: Record<string, (props: VisualProps) => React.ReactElement> = {
  documents: DocumentsVisual,
  tokenization: TokenizationVisual,
  block_creation: BlockCreationVisual,
  sorting: SortingVisual,
  merging: MergingVisual,
  inverted_index: InvertedIndexVisual,
}

/**
 * Renders the visual for one pipeline stage.
 *
 * `playing` drives the animation; `runId` lets the caller replay the current
 * step (the Restart button) without changing steps.
 */
export function StepVisual({
  step,
  playing,
  runId = 0,
}: {
  step: ExplainStep
  playing: boolean
  runId?: number
}) {
  const Component = useMemo(() => VISUALS[step.key] ?? DocumentsVisual, [step.key])
  return <Component data={step.data} playing={playing} resetKey={`${step.key}:${runId}`} />
}

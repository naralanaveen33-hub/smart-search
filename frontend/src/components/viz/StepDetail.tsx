import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button, ProgressBar, StatusBadge, Tabs } from '@/components/ui'
import {
  BlockGrid,
  DocumentPreview,
  MemoryMeter,
  PostingsTable,
  TokenStream,
} from '@/components/viz/LiveIndexing'
import { useAsync } from '@/hooks/useAsync'
import { useIndexing } from '@/hooks/useIndexing'
import { api } from '@/services/api'
import type { StageKey } from '@/types'
import { classNames, formatDuration, formatNumber } from '@/utils/format'

type TabKey = 'current_block' | 'blocks' | 'tokens' | 'document'

const STAGE_FLOW: Record<StageKey, string[]> = {
  documents: ['Raw Documents', 'Assign Document IDs', 'Queued for Tokenization'],
  tokenization: ['Raw Text', 'Split Into Tokens', 'Normalize', 'Term-Document Pairs'],
  block_creation: ['Tokens Stream', 'Current Memory Block', 'Memory Full', 'Block Written to Disk'],
  sorting: ['Unsorted Block', 'Sort by Term', 'Sorted Block on Disk'],
  merging: ['Sorted Blocks', 'K-Way Merge', 'Globally Ordered Stream'],
  inverted_index: ['Merged Stream', 'Group by Term', 'Postings Lists', 'Inverted Index'],
}

const STAGE_NOTE: Record<StageKey, string> = {
  documents:
    'Every document is registered and given a stable ID. All postings reference these IDs.',
  tokenization:
    'Each document is split into tokens, lowercased, filtered against the stop word list and stemmed.',
  block_creation:
    'Postings accumulate in a fixed-size memory buffer. The instant it fills, the block is flushed to disk and the buffer is cleared.',
  sorting:
    'Each block is loaded back, sorted by (term, document, position) and rewritten. A block always fits in memory, which is why this sort is cheap.',
  merging:
    'All sorted blocks are merged with a k-way merge. Only one record per block is held in memory at any moment.',
  inverted_index:
    'The merged stream arrives in term order, so each postings list is contiguous and can be written in one pass.',
}

export function StepDetail({
  stageKey,
  onClose,
  onNavigate,
}: {
  stageKey: StageKey
  onClose: () => void
  onNavigate: (key: StageKey) => void
}) {
  const { status, pulse, activeDocument, currentTerm } = useIndexing()
  const [tab, setTab] = useState<TabKey>('current_block')
  const [selectedBlock, setSelectedBlock] = useState<number | undefined>()

  const stages = status?.stages ?? []
  const stageIndex = stages.findIndex((s) => s.key === stageKey)
  const stage = stages[stageIndex]
  const stats = status?.stats
  const flushing = Boolean(pulse && Date.now() - pulse.at < 1200 && pulse.kind === 'memory_full')

  const previewDocId = activeDocument ?? status?.token_stream.at(-1)?.document_id
  const { data: sourceDocument } = useAsync(
    () => (previewDocId ? api.documentText(previewDocId) : Promise.resolve(null)),
    [previewDocId],
  )
  const { data: blockDetail } = useAsync(
    () => (selectedBlock ? api.block(selectedBlock, 200) : Promise.resolve(null)),
    [selectedBlock, status?.state],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const activeFlowStep = useMemo(() => {
    const flow = STAGE_FLOW[stageKey]
    if (!stage) return 0
    if (stage.status === 'completed') return flow.length - 1
    if (stage.status === 'waiting') return -1
    if (stageKey === 'block_creation') return flushing ? 2 : 1
    return Math.min(flow.length - 2, Math.floor((stage.progress / 100) * flow.length))
  }, [stage, stageKey, flushing])

  if (!stage || !stats) return null

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'current_block', label: 'Current Block', count: status?.memory_block.length },
    { key: 'blocks', label: 'Blocks on Disk', count: status?.blocks.length },
    { key: 'tokens', label: 'Raw Tokens', count: status?.token_stream.length },
    { key: 'document', label: 'Document Preview' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${stage.label} detail`}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-[1040px] border border-line bg-bg sm:rounded-[8px]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.12em] text-subtle uppercase">
              Step {stageIndex + 1} of {stages.length}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <h2 className="text-[19px] font-semibold">{stage.label}</h2>
              <StatusBadge status={stage.status} />
            </div>
            <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-muted">
              {STAGE_NOTE[stageKey]}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close step detail"
            onClick={onClose}
            className="shrink-0 text-muted hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>

        {/* Flow */}
        <div className="border-b border-line px-5 py-4">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            {STAGE_FLOW[stageKey].map((label, index) => (
              <div key={label} className="flex items-center gap-2">
                <div
                  className={classNames(
                    'rounded-[5px] border px-2.5 py-1.5 font-mono text-[11px] transition-colors',
                    index === activeFlowStep
                      ? 'border-[var(--warning)] bg-warn-soft text-[var(--warning)]'
                      : index < activeFlowStep
                        ? 'border-[var(--success)]/40 bg-ok-soft text-[var(--success)]'
                        : 'border-line bg-surface text-subtle',
                  )}
                >
                  {label}
                </div>
                {index < STAGE_FLOW[stageKey].length - 1 && (
                  <>
                    <ChevronRight size={13} className="hidden shrink-0 text-subtle sm:block" />
                    <ArrowDown size={12} className="ml-2 shrink-0 text-subtle sm:hidden" />
                  </>
                )}
              </div>
            ))}
          </div>
          <ProgressBar value={stage.progress} tone={stage.status === 'completed' ? 'ok' : 'warn'} className="mt-3.5" />
        </div>

        {/* Live panes */}
        <div className="grid gap-4 border-b border-line p-5 lg:grid-cols-3">
          <section>
            <SectionLabel>Tokens Stream (Live)</SectionLabel>
            <div className="rounded-[6px] border border-line bg-surface">
              <TokenStream tokens={status?.token_stream ?? []} dense />
            </div>
          </section>

          <section>
            <SectionLabel>Current Memory Block</SectionLabel>
            <div
              className={classNames(
                'rounded-[6px] border bg-surface transition-colors',
                flushing ? 'border-[var(--warning)]' : 'border-line',
              )}
            >
              <PostingsTable
                entries={status?.memory_block ?? []}
                maxHeight={180}
                emptyMessage="Buffer empty — the last block was just flushed to disk."
              />
            </div>
          </section>

          <section>
            <SectionLabel>Blocks on Disk</SectionLabel>
            <div className="max-h-[180px] overflow-y-auto">
              <BlockGrid
                blocks={status?.blocks ?? []}
                columns={1}
                activeId={selectedBlock}
                onSelect={(id) => {
                  setSelectedBlock(id)
                  setTab('blocks')
                }}
              />
            </div>
          </section>
        </div>

        <div className="border-b border-line px-5 py-4">
          <MemoryMeter
            used={stats.memory_used}
            entries={stats.memory_entries}
            capacity={stats.memory_capacity}
            flushing={flushing}
          />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Documents" value={`${stats.documents_processed} / ${stats.documents_total}`} />
            <Stat label="Tokens" value={formatNumber(stats.tokens_generated)} />
            <Stat label="Current Block" value={stats.current_block || '—'} />
            <Stat label="Elapsed" value={formatDuration(stats.elapsed_seconds)} />
          </div>
          {currentTerm && (
            <p className="mt-3 font-mono text-[11px] text-subtle">
              Processing term: <span className="text-accent">{currentTerm}</span>
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="px-5">
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
        </div>
        <div className="px-5 pb-5">
          <div className="mt-3 rounded-[6px] border border-line bg-surface">
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                {tab === 'current_block' && <PostingsTable entries={status?.memory_block ?? []} />}
                {tab === 'blocks' && (
                  <div className="p-3">
                    <BlockGrid
                      blocks={status?.blocks ?? []}
                      columns={2}
                      activeId={selectedBlock}
                      onSelect={setSelectedBlock}
                    />
                    {blockDetail && (
                      <div className="mt-3 rounded-[6px] border border-line">
                        <p className="border-b border-line px-3 py-1.5 font-mono text-[11px] text-muted">
                          Block {blockDetail.block.id} contents
                          {blockDetail.truncated && ' (first 200 entries)'}
                        </p>
                        <PostingsTable entries={blockDetail.entries} maxHeight={200} />
                      </div>
                    )}
                  </div>
                )}
                {tab === 'tokens' && <TokenStream tokens={status?.token_stream ?? []} />}
                {tab === 'document' && (
                  <DocumentPreview
                    text={sourceDocument?.text ?? ''}
                    title={sourceDocument?.title}
                    terms={(status?.token_stream ?? []).map((t) => t.term)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <Button
            size="sm"
            icon={<ChevronLeft size={14} />}
            disabled={stageIndex === 0}
            onClick={() => onNavigate(stages[stageIndex - 1].key)}
          >
            {stageIndex > 0 ? stages[stageIndex - 1].label : 'Previous'}
          </Button>
          <Button
            size="sm"
            iconRight={<ChevronRight size={14} />}
            disabled={stageIndex === stages.length - 1}
            onClick={() => onNavigate(stages[stageIndex + 1].key)}
          >
            {stageIndex < stages.length - 1 ? stages[stageIndex + 1].label : 'Next'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">{children}</p>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[6px] border border-line bg-surface px-2.5 py-2">
      <p className="text-[10px] tracking-wide text-subtle uppercase">{label}</p>
      <p className="tabular mt-0.5 font-mono text-[16px] font-medium text-ink">{value}</p>
    </div>
  )
}

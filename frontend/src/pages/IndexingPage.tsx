import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, Layers, Play, RotateCcw, Search } from 'lucide-react'
import { Banner, Button, Card, ProgressBar, SectionTitle, StatusBadge } from '@/components/ui'
import { BlockGrid, MemoryMeter, TokenStream } from '@/components/viz/LiveIndexing'
import { StepDetail } from '@/components/viz/StepDetail'
import { useIndexing } from '@/hooks/useIndexing'
import type { StageKey } from '@/types'
import { classNames, formatBytes, formatDuration, formatNumber } from '@/utils/format'

export function IndexingPage() {
  const { status, start, reset, starting, error, connected, pulse, activeDocument } = useIndexing()
  const [openStage, setOpenStage] = useState<StageKey | null>(null)

  const running = status?.state === 'running'
  const stats = status?.stats
  const flushing = Boolean(pulse && Date.now() - pulse.at < 1200 && pulse.kind === 'memory_full')

  const handleStart = useCallback(async () => {
    try {
      await start()
    } catch {
      /* surfaced through `error` */
    }
  }, [start])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle
          eyebrow="Live Process"
          title="Indexing"
          description="Watch the BSBI engine build the inverted index in real time. Click any stage to open its live detail view."
        />
        <div className="flex gap-2">
          <Button
            variant="primary"
            icon={<Play size={13} />}
            onClick={handleStart}
            disabled={running || starting}
          >
            {running ? 'Indexing…' : starting ? 'Starting…' : 'Build Index'}
          </Button>
          <Button icon={<RotateCcw size={13} />} onClick={() => void reset()} disabled={running}>
            Reset
          </Button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {!connected && running && (
        <Banner tone="warn">Live stream disconnected — falling back to polling.</Banner>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        {/* Pipeline */}
        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold">Pipeline</h2>
            <span className="font-mono text-[11px] text-subtle">
              {activeDocument ? `Processing ${activeDocument}` : `${status?.stages.filter((s) => s.status === 'completed').length ?? 0} / 6 complete`}
            </span>
          </div>

          <ol>
            {(status?.stages ?? []).map((stage, index) => (
              <li key={stage.key}>
                <button
                  type="button"
                  onClick={() => setOpenStage(stage.key)}
                  className="group flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-2"
                >
                  <span
                    className={classNames(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border font-mono text-[11px]',
                      stage.status === 'completed'
                        ? 'border-[var(--success)]/40 bg-ok-soft text-[var(--success)]'
                        : stage.status === 'in_progress'
                          ? 'border-[var(--warning)] bg-warn-soft text-[var(--warning)]'
                          : stage.status === 'error'
                            ? 'border-[var(--danger)]/40 bg-bad-soft text-[var(--danger)]'
                            : 'border-line text-subtle',
                    )}
                  >
                    {index + 1}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium">{stage.label}</span>
                      <StatusBadge status={stage.status} />
                      {stage.status === 'in_progress' && (
                        <span className="tabular font-mono text-[11px] text-[var(--warning)]">
                          {stage.progress}%
                        </span>
                      )}
                    </span>
                    {stage.status === 'in_progress' && (
                      <ProgressBar value={stage.progress} tone="warn" className="mt-2" />
                    )}
                  </span>

                  <ChevronRight
                    size={14}
                    className="shrink-0 text-subtle transition-colors group-hover:text-ink"
                  />
                </button>
              </li>
            ))}
          </ol>

          {status?.state === 'completed' && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
              <p className="text-[12px] text-muted">
                Index built — {formatNumber(stats?.unique_terms ?? 0)} unique terms across{' '}
                {formatNumber(stats?.documents_total ?? 0)} documents.
              </p>
              <Link to="/search">
                <Button size="sm" variant="primary" icon={<Search size={13} />}>
                  Search the index
                </Button>
              </Link>
            </div>
          )}
        </Card>

        {/* Live stats */}
        <div className="space-y-4">
          <Card padded={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold">Live Stats</h2>
              {running && (
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--warning)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--warning)]" />
                  LIVE
                </span>
              )}
            </div>
            <dl className="px-4 py-1">
              {[
                ['Documents Processed', formatNumber(stats?.documents_processed ?? 0)],
                ['Tokens Generated', formatNumber(stats?.tokens_generated ?? 0)],
                ['Blocks Created', formatNumber(stats?.blocks_created ?? 0)],
                ['Current Block', stats?.current_block || '—'],
                ['Unique Terms', formatNumber(stats?.unique_terms ?? 0)],
                ['Index Size', formatBytes(stats?.index_size_bytes ?? 0)],
                ['Elapsed Time', formatDuration(stats?.elapsed_seconds ?? 0)],
              ].map(([label, value]) => (
                <div
                  key={label as string}
                  className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0"
                >
                  <dt className="text-[12.5px] text-muted">{label}</dt>
                  <dd className="tabular font-mono text-[14px] font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-line px-4 py-3">
              <MemoryMeter
                used={stats?.memory_used ?? 0}
                entries={stats?.memory_entries ?? 0}
                capacity={stats?.memory_capacity ?? 0}
                flushing={flushing}
              />
            </div>
          </Card>

          <Card padded={false}>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-[13px] font-semibold">Blocks on Disk</h2>
            </div>
            <div className="max-h-[240px] overflow-y-auto p-3">
              <BlockGrid
                blocks={status?.blocks ?? []}
                columns={1}
                onSelect={() => setOpenStage('block_creation')}
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Token stream */}
      <Card padded={false}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold">Token Stream</h2>
          <span className="font-mono text-[11px] text-subtle">
            last {status?.token_stream.length ?? 0} of {formatNumber(stats?.tokens_generated ?? 0)}
          </span>
        </div>
        <TokenStream tokens={status?.token_stream ?? []} />
      </Card>

      {(status?.state === 'idle' || !status) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Banner>
            <span className="flex items-center gap-2">
              <Layers size={12} />
              No index yet. Press <strong>Build Index</strong> to run the BSBI pipeline over your
              corpus.
            </span>
          </Banner>
        </motion.div>
      )}

      <AnimatePresence>
        {openStage && (
          <StepDetail
            stageKey={openStage}
            onClose={() => setOpenStage(null)}
            onNavigate={setOpenStage}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

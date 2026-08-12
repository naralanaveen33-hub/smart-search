import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Binary, Search } from 'lucide-react'
import { Banner, Card, EmptyState, Input, SectionTitle, Tabs } from '@/components/ui'
import { useAsync, useDebounced } from '@/hooks/useAsync'
import { useIndexing } from '@/hooks/useIndexing'
import { api } from '@/services/api'
import { formatNumber } from '@/utils/format'

type TabKey = 'postings' | 'statistics' | 'frequency'

const PAGE_SIZE = 8

export function IndexExplorerPage() {
  const { status } = useIndexing()
  const [term, setTerm] = useState('')
  const [seeded, setSeeded] = useState(false)
  const [tab, setTab] = useState<TabKey>('postings')
  const [page, setPage] = useState(0)
  const debounced = useDebounced(term, 250)

  const { data: info, loading, error } = useAsync(
    () => (debounced.trim() ? api.term(debounced.trim()) : Promise.resolve(null)),
    [debounced, status?.state],
  )
  const { data: vocabulary } = useAsync(
    async () => {
      const prefix = debounced.trim().slice(0, 3)
      const matched = await api.vocabulary(prefix, 12)
      if (!prefix || matched.total > 0) return { ...matched, filtered: Boolean(prefix) }
      // Nothing in the index starts with what was typed. Falling back to the
      // most common terms keeps the panel usable — otherwise a term that misses
      // empties the one control that could get the user back to a real term,
      // and a perfectly good index looks empty.
      return { ...(await api.vocabulary('', 12)), filtered: false }
    },
    [debounced.slice(0, 3), status?.state],
  )

  // The starting term comes from the index itself. A hardcoded default only
  // exists in the bundled demo corpus, so on any other corpus the page would
  // open on "not in the vocabulary".
  useEffect(() => {
    if (seeded || term || !vocabulary?.terms.length) return
    setSeeded(true)
    setTerm(vocabulary.terms[0].term)
  }, [vocabulary, seeded, term])

  useEffect(() => setPage(0), [debounced])

  const postings = info?.postings ?? []
  const pageCount = Math.max(1, Math.ceil(postings.length / PAGE_SIZE))
  const visible = postings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const stats = useMemo(() => {
    if (!info?.found) return []
    const totalPositions = postings.reduce((sum, p) => sum + p.term_frequency, 0)
    return [
      { label: 'Document Frequency (df)', value: formatNumber(info.document_frequency) },
      { label: 'Total Occurrences (cf)', value: formatNumber(info.total_occurrences) },
      { label: 'Inverse Document Frequency', value: info.idf.toFixed(4) },
      {
        label: 'Average Occurrences per Document',
        value: (totalPositions / Math.max(1, postings.length)).toFixed(2),
      },
      { label: 'Postings List Length', value: formatNumber(postings.length) },
      { label: 'Normalized Term', value: info.normalized },
    ]
  }, [info, postings])

  if (!status?.index_ready) {
    return (
      <div className="space-y-6">
        <SectionTitle
          eyebrow="Inverted Index"
          title="Index Explorer"
          description="Inspect the inverted index directly — postings lists, term statistics and document frequencies."
        />
        <Card padded={false}>
          <EmptyState
            icon={<Binary size={22} />}
            title="No index available"
            description="Build the index first, then every term in the vocabulary becomes inspectable here."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Inverted Index"
        title="Index Explorer"
        description="Explore the inverted index. Every number below is read straight from the postings list built by the BSBI run."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
        <div className="space-y-4">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle"
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search terms…"
              aria-label="Term to inspect"
              className="h-10 pl-9"
            />
          </div>

          {error && <Banner tone="error">{error}</Banner>}

          {loading && !info && term.trim() && <Card className="h-48 animate-pulse" />}

          {info && !info.found && (
            <Card padded={false}>
              <EmptyState
                title={`"${term}" is not in the vocabulary`}
                description={`The query normalizes to "${info.normalized}", which has no postings list. The index holds ${formatNumber(vocabulary?.total ?? 0)} terms — pick one from the vocabulary panel.`}
              />
            </Card>
          )}

          {/* Keyed off the live input, not the debounced copy: the seeded term
              lands in the box 250ms before it reaches the query, and gating on
              the debounced value flashes "Pick a term" over a filled box. */}
          {!term.trim() && (
            <Card padded={false}>
              <EmptyState
                icon={<Binary size={22} />}
                title="Pick a term"
                description="Type a term above, or choose one from the vocabulary panel, to see its postings list."
              />
            </Card>
          )}

          {info?.found && (
            <>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
                      Term
                    </p>
                    <p className="mt-0.5 font-mono text-[22px] font-semibold text-accent">
                      {info.normalized}
                    </p>
                    {info.normalized !== info.term.toLowerCase() && (
                      <p className="mt-0.5 text-[11px] text-subtle">
                        stemmed from &ldquo;{info.term}&rdquo;
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-5">
                    {[
                      ['Doc Frequency', formatNumber(info.document_frequency)],
                      ['Occurrences', formatNumber(info.total_occurrences)],
                      ['IDF', info.idf.toFixed(3)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[10px] tracking-wide text-subtle uppercase">{label}</p>
                        <p className="tabular mt-0.5 font-mono text-[18px] font-medium text-ink">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              <Card padded={false}>
                <div className="px-4 pt-1">
                  <Tabs
                    tabs={[
                      { key: 'postings', label: 'Postings', count: postings.length },
                      { key: 'statistics', label: 'Term Statistics' },
                      { key: 'frequency', label: 'Document Frequency' },
                    ]}
                    value={tab}
                    onChange={setTab}
                  />
                </div>

                {tab === 'postings' && (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[420px] text-left">
                        <thead>
                          <tr className="border-b border-line text-[10px] tracking-wide text-subtle uppercase">
                            <th className="px-4 py-2 font-medium">Document ID</th>
                            <th className="px-4 py-2 font-medium">Title</th>
                            <th className="px-4 py-2 font-medium">Positions</th>
                            <th className="px-4 py-2 text-right font-medium">tf</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.map((posting) => (
                            <tr key={posting.document_id} className="border-b border-line last:border-0">
                              <td className="px-4 py-2 font-mono text-[11px] text-accent">
                                {posting.document_id}
                              </td>
                              <td className="max-w-[180px] truncate px-4 py-2 text-[12px] text-muted">
                                {posting.title}
                              </td>
                              <td className="px-4 py-2 font-mono text-[11px] text-ink">
                                {posting.positions.slice(0, 12).join(', ')}
                                {posting.positions.length > 12 && ' …'}
                              </td>
                              <td className="tabular px-4 py-2 text-right font-mono text-[11px] text-muted">
                                {posting.term_frequency}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {pageCount > 1 && (
                      <div className="flex items-center justify-center gap-1 border-t border-line px-4 py-2.5">
                        {Array.from({ length: pageCount }).map((_, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => setPage(index)}
                            aria-current={page === index}
                            className={`h-7 min-w-7 rounded-[4px] border px-2 font-mono text-[11px] transition-colors ${
                              page === index
                                ? 'border-[var(--accent-border)] bg-accent-soft text-accent'
                                : 'border-line text-muted hover:text-ink'
                            }`}
                          >
                            {index + 1}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {tab === 'statistics' && (
                  <dl className="px-4 py-1">
                    {stats.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0"
                      >
                        <dt className="text-[12px] text-muted">{item.label}</dt>
                        <dd className="tabular font-mono text-[12px] text-ink">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {tab === 'frequency' && (
                  <div className="space-y-2 p-4">
                    {postings.map((posting) => {
                      const max = Math.max(...postings.map((p) => p.term_frequency), 1)
                      return (
                        <div key={posting.document_id} className="flex items-center gap-3">
                          <span className="w-[86px] shrink-0 font-mono text-[11px] text-accent">
                            {posting.document_id}
                          </span>
                          <div className="h-4 flex-1 overflow-hidden rounded-[3px] border border-line bg-surface-2">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(posting.term_frequency / max) * 100}%` }}
                              transition={{ duration: 0.3, ease: 'easeOut' }}
                              className="h-full bg-[var(--accent)]"
                            />
                          </div>
                          <span className="tabular w-8 shrink-0 text-right font-mono text-[11px] text-muted">
                            {posting.term_frequency}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>

        {/* Vocabulary */}
        <Card padded={false} className="h-fit">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold">Vocabulary</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {vocabulary?.filtered
                ? `${formatNumber(vocabulary.total)} matching terms`
                : `Most frequent of ${formatNumber(vocabulary?.total ?? 0)} terms`}
            </p>
          </div>
          <ul className="max-h-[420px] overflow-y-auto">
            {(vocabulary?.terms ?? []).map((item) => (
              <li key={item.term}>
                <button
                  type="button"
                  onClick={() => setTerm(item.term)}
                  className="flex w-full items-baseline justify-between gap-2 border-b border-line px-4 py-2 text-left transition-colors last:border-0 hover:bg-surface-2"
                >
                  <span className="truncate font-mono text-[12px] text-ink">{item.term}</span>
                  <span className="tabular shrink-0 font-mono text-[11px] text-subtle">
                    {item.document_frequency}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

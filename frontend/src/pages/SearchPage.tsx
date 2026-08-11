import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Clock, Search as SearchIcon, TrendingUp } from 'lucide-react'
import { Banner, Button, Card, Chip, Radio, SectionTitle } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { useIndexing } from '@/hooks/useIndexing'
import { useSearch } from '@/hooks/useSearch'
import { api } from '@/services/api'
import type { SearchMode } from '@/types'
import { formatRelativeTime } from '@/utils/format'

const MODES: { key: SearchMode; label: string; hint: string }[] = [
  { key: 'all', label: 'All', hint: 'Rank every document containing any query term' },
  { key: 'and', label: 'AND', hint: 'Only documents containing every term' },
  { key: 'or', label: 'OR', hint: 'Any term matches' },
  { key: 'phrase', label: 'Phrase', hint: 'Terms must appear consecutively' },
]

export function SearchPage() {
  const navigate = useNavigate()
  const { status } = useIndexing()
  const { query, mode, setMode, run, loading, error } = useSearch()
  const [text, setText] = useState(query)
  const { data: history, reload } = useAsync(() => api.searchHistory(), [])

  const submit = useCallback(
    async (value?: string) => {
      const q = (value ?? text).trim()
      if (!q) return
      setText(q)
      const result = await run(q)
      reload()
      if (result) navigate('/results')
    },
    [text, run, navigate, reload],
  )

  const indexReady = status?.index_ready

  return (
    <div className="mx-auto max-w-2xl space-y-7 py-4 sm:py-10">
      <SectionTitle title="Search" description="Find relevant information instantly." />

      {!indexReady && (
        <Banner tone="warn">
          No index has been built yet.{' '}
          <button
            type="button"
            onClick={() => navigate('/indexing')}
            className="underline underline-offset-2"
          >
            Build the index
          </button>{' '}
          to start searching.
        </Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle"
            />
            <input
              autoFocus
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Search the index…"
              aria-label="Search query"
              className="h-11 w-full rounded-[6px] border border-line bg-surface pr-3 pl-9 text-[14px] text-ink transition-colors placeholder:text-subtle focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={loading || !text.trim()}
            icon={<SearchIcon size={15} />}
          >
            <span className="hidden sm:inline">{loading ? 'Searching…' : 'Search'}</span>
          </Button>
        </div>
      </form>

      <fieldset>
        <legend className="mb-2.5 text-[12px] font-medium text-muted">Search Mode</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {MODES.map((item) => (
            <span key={item.key} title={item.hint}>
              <Radio
                name="search-mode"
                label={item.label}
                checked={mode === item.key}
                onChange={() => setMode(item.key)}
              />
            </span>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-subtle">
          {MODES.find((m) => m.key === mode)?.hint}
        </p>
      </fieldset>

      <section>
        <h2 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
          <TrendingUp size={12} />
          Popular Searches
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {(history?.popular ?? []).map((item) => (
            <Chip key={item} onClick={() => void submit(item)}>
              {item}
            </Chip>
          ))}
        </div>
      </section>

      {(history?.history.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <Clock size={12} />
            Recent Searches
          </h2>
          <Card padded={false}>
            <ul>
              {history!.history.slice(0, 6).map((item, index) => (
                <motion.li
                  key={`${item.query}-${item.created_at}-${index}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.03 }}
                  className="border-b border-line last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => void submit(item.query)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <Clock size={12} className="shrink-0 text-subtle" />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{item.query}</span>
                    <span className="tabular shrink-0 font-mono text-[11px] text-subtle">
                      {item.results} results
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-subtle sm:block">
                      {formatRelativeTime(item.created_at)}
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  )
}

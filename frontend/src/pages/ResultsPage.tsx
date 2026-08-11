import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search as SearchIcon, SlidersHorizontal } from 'lucide-react'
import { Banner, Button, Card, EmptyState, Select } from '@/components/ui'
import { ResultCard } from '@/components/search/ResultCard'
import { useAsync } from '@/hooks/useAsync'
import { useSearch } from '@/hooks/useSearch'
import { api } from '@/services/api'
import type { SortMode } from '@/types'
import { classNames, formatSeconds } from '@/utils/format'

export function ResultsPage() {
  const navigate = useNavigate()
  const { query, response, loading, error, sort, run, page, pageCount, goToPage } = useSearch()
  const { data: settings } = useAsync(() => api.settings(), [])

  const changeSort = useCallback(
    async (next: SortMode) => {
      await run(undefined, { sort: next, offset: 0 })
    },
    [run],
  )

  if (!response && !loading) {
    return (
      <Card padded={false}>
        <EmptyState
          icon={<SearchIcon size={22} />}
          title="No search yet"
          description="Run a query from the Search screen to see ranked results here."
          action={
            <Button variant="primary" onClick={() => navigate('/search')}>
              Go to Search
            </Button>
          }
        />
      </Card>
    )
  }

  const results = response?.results ?? []
  const firstOnPage = (response?.offset ?? 0) + 1
  const lastOnPage = (response?.offset ?? 0) + results.length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">
            Results for <span className="text-accent">&ldquo;{response?.query ?? query}&rdquo;</span>
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            <span className="tabular font-medium text-ink">{response?.total ?? 0}</span> result
            {response?.total === 1 ? '' : 's'} found ({formatSeconds(response?.took_seconds)}) ·{' '}
            {response?.candidates_examined ?? 0} candidate documents examined
            {response?.normalized_terms.length ? (
              <>
                {' '}
                · query terms:{' '}
                <span className="font-mono text-subtle">
                  {response.normalized_terms.join(', ')}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <SlidersHorizontal size={13} className="text-subtle" />
          <label htmlFor="sort" className="text-[12px] text-muted">
            Sort by
          </label>
          <Select
            id="sort"
            value={sort}
            onChange={(event) => void changeSort(event.target.value as SortMode)}
          >
            <option value="relevance">Relevance</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </Select>
          <Button size="sm" onClick={() => navigate('/search')} icon={<SearchIcon size={13} />}>
            New search
          </Button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-28 animate-pulse rounded-[8px] border border-line bg-surface" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={<SearchIcon size={22} />}
            title="No documents matched"
            description="Try a different search mode — AND and Phrase are strict, All and OR are broader."
            action={
              <Button variant="primary" onClick={() => navigate('/search')}>
                Adjust your query
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {results.map((result, index) => (
              <ResultCard
                key={result.document_id}
                result={result}
                rank={index}
                highlight={settings?.highlight_results ?? true}
              />
            ))}
          </div>

          {pageCount > 1 && (
            <nav
              aria-label="Result pages"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
            >
              <p className="tabular text-[12px] text-muted">
                Showing {firstOnPage}–{lastOnPage} of {response?.total ?? 0}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  icon={<ChevronLeft size={14} />}
                  disabled={page === 0 || loading}
                  onClick={() => void goToPage(page - 1)}
                >
                  Previous
                </Button>
                {Array.from({ length: pageCount })
                  .slice(0, 8)
                  .map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-label={`Page ${index + 1}`}
                      aria-current={page === index ? 'page' : undefined}
                      onClick={() => void goToPage(index)}
                      className={classNames(
                        'h-8 min-w-8 rounded-[4px] border px-2 font-mono text-[12px] transition-colors',
                        page === index
                          ? 'border-[var(--accent-border)] bg-accent-soft text-accent'
                          : 'border-line text-muted hover:text-ink',
                      )}
                    >
                      {index + 1}
                    </button>
                  ))}
                {pageCount > 8 && <span className="px-1 text-[12px] text-subtle">…</span>}
                <Button
                  size="sm"
                  iconRight={<ChevronRight size={14} />}
                  disabled={!response?.has_more || loading}
                  onClick={() => void goToPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '@/services/api'
import type { SearchMode, SearchResponse, SortMode } from '@/types'

interface RunOptions {
  mode?: SearchMode
  sort?: SortMode
  offset?: number
  limit?: number
}

interface SearchContextValue {
  query: string
  mode: SearchMode
  sort: SortMode
  response: SearchResponse | null
  loading: boolean
  error: string | null
  /** Zero-based index of the page currently shown. */
  page: number
  pageCount: number
  setQuery: (query: string) => void
  setMode: (mode: SearchMode) => void
  setSort: (sort: SortMode) => void
  run: (query?: string, options?: RunOptions) => Promise<SearchResponse | null>
  goToPage: (page: number) => Promise<SearchResponse | null>
}

const SearchContext = createContext<SearchContextValue | null>(null)

/**
 * Shared between the Search screen and the Results screen.
 *
 * Paging is server-side: each page is a separate request with its own
 * limit/offset, so the client never holds more results than it displays.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('all')
  const [sort, setSort] = useState<SortMode>('relevance')
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (next?: string, options: RunOptions = {}) => {
      const text = (next ?? query).trim()
      const nextMode = options.mode ?? mode
      const nextSort = options.sort ?? sort
      if (!text) return null

      setQuery(text)
      setMode(nextMode)
      setSort(nextSort)
      setLoading(true)
      setError(null)
      try {
        const result = await api.search({
          query: text,
          mode: nextMode,
          sort: nextSort,
          offset: options.offset ?? 0,
          // `limit` is omitted so the backend applies the results-per-page
          // setting, unless the caller asks for a specific size.
          ...(options.limit ? { limit: options.limit } : {}),
        })
        setResponse(result)
        return result
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed')
        setResponse(null)
        return null
      } finally {
        setLoading(false)
      }
    },
    [query, mode, sort],
  )

  const pageSize = response?.limit || 20
  const page = response ? Math.floor(response.offset / pageSize) : 0
  const pageCount = response ? Math.max(1, Math.ceil(response.total / pageSize)) : 0

  const goToPage = useCallback(
    (target: number) => run(undefined, { offset: Math.max(0, target) * pageSize }),
    [run, pageSize],
  )

  const value = useMemo(
    () => ({
      query, mode, sort, response, loading, error, page, pageCount,
      setQuery, setMode, setSort, run, goToPage,
    }),
    [query, mode, sort, response, loading, error, page, pageCount, run, goToPage],
  )

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}

export function useSearch() {
  const context = useContext(SearchContext)
  if (!context) throw new Error('useSearch must be used inside SearchProvider')
  return context
}

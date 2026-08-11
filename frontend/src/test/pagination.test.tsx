import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchProvider, useSearch } from '@/hooks/useSearch'
import { ResultsPage } from '@/pages/ResultsPage'
import { api } from '@/services/api'
import type { SearchResponse, SearchResult } from '@/types'

function makeResult(id: number): SearchResult {
  return {
    document_id: `DOC_${String(id).padStart(3, '0')}`,
    title: `Document ${id}`,
    snippet: `Snippet for document ${id}`,
    score: 10 - id * 0.1,
    relevance: 100 - id,
    matched_terms: ['machin'],
    highlight_terms: ['machine'],
    file_name: `doc${id}.txt`,
    page: null,
    doc_length: 100,
    term_details: [],
    signals: [],
  }
}

const TOTAL = 12
const PAGE_SIZE = 5

function makeResponse(offset: number): SearchResponse {
  const results = Array.from({ length: Math.min(PAGE_SIZE, TOTAL - offset) }, (_, i) =>
    makeResult(offset + i + 1),
  )
  return {
    query: 'machine learning',
    normalized_terms: ['machin', 'learn'],
    mode: 'all',
    total: TOTAL,
    took_seconds: 0.003,
    results,
    candidates_examined: TOTAL,
    limit: PAGE_SIZE,
    offset,
    has_more: offset + results.length < TOTAL,
  }
}

/** Kicks off the initial search so ResultsPage has something to show. */
function Harness() {
  const { run, response } = useSearch()
  return (
    <>
      <button type="button" onClick={() => void run('machine learning')}>
        start
      </button>
      <span data-testid="offset">{response?.offset ?? 'none'}</span>
      <ResultsPage />
    </>
  )
}

describe('server-side pagination', () => {
  beforeEach(() => {
    vi.spyOn(api, 'settings').mockResolvedValue({
      block_size: 250, max_memory_mb: 512, language: 'english',
      use_stop_words: true, use_stemming: true, bm25_enabled: true,
      case_sensitive: false, phrase_search: true, highlight_results: true,
      results_per_page: PAGE_SIZE, step_delay: 0.12,
    })
    vi.spyOn(api, 'search').mockImplementation(async ({ offset = 0 }) => makeResponse(offset))
  })

  afterEach(() => vi.restoreAllMocks())

  async function startSearch() {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SearchProvider>
          <Harness />
        </SearchProvider>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'start' }))
    await screen.findByText('Document 1')
    return user
  }

  it('requests only one page at a time', async () => {
    await startSearch()

    expect(api.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'machine learning', offset: 0 }),
    )
    // The page size comes from the backend setting, not a client-side slice.
    expect(vi.mocked(api.search).mock.calls[0][0]).not.toHaveProperty('limit')
    expect(screen.getAllByRole('article')).toHaveLength(PAGE_SIZE)
  })

  it('fetches the next page from the server rather than slicing locally', async () => {
    const user = await startSearch()
    vi.mocked(api.search).mockClear()

    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ offset: PAGE_SIZE })),
    )
    expect(await screen.findByText('Document 6')).toBeInTheDocument()
    expect(screen.queryByText('Document 1')).not.toBeInTheDocument()
  })

  it('reports the range and total across pages', async () => {
    const user = await startSearch()
    expect(screen.getByText(`Showing 1–${PAGE_SIZE} of ${TOTAL}`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByText(`Showing 6–10 of ${TOTAL}`)).toBeInTheDocument()
  })

  it('jumps to a numbered page', async () => {
    const user = await startSearch()
    vi.mocked(api.search).mockClear()

    await user.click(screen.getByRole('button', { name: 'Page 3' }))

    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ offset: PAGE_SIZE * 2 })),
    )
    expect(await screen.findByText('Document 11')).toBeInTheDocument()
  })

  it('disables Previous on the first page and Next on the last', async () => {
    const user = await startSearch()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Page 3' }))
    await screen.findByText('Document 11')
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled()
  })

  it('returns to the first page when the sort changes', async () => {
    const user = await startSearch()
    await user.click(screen.getByRole('button', { name: /next/i }))
    await screen.findByText('Document 6')
    vi.mocked(api.search).mockClear()

    await user.selectOptions(screen.getByLabelText('Sort by'), 'newest')

    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'newest', offset: 0 }),
      ),
    )
  })
})

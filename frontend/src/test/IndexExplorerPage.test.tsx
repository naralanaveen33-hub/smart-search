import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexExplorerPage } from '@/pages/IndexExplorerPage'
import { IndexingProvider } from '@/hooks/useIndexing'
import { api } from '@/services/api'
import type { IndexStatus, TermInfo } from '@/types'

/**
 * The explorer used to open on a hardcoded term and filter the vocabulary
 * panel by that term's prefix. On any corpus without that word — i.e. every
 * corpus but the bundled demo one — the page opened on "not in the vocabulary"
 * with an empty panel beside it, which reads as "the index was not saved".
 */

const READY_STATUS = {
  state: 'completed',
  stages: [],
  stats: {},
  blocks: [],
  memory_block: [],
  token_stream: [],
  error: null,
  index_ready: true,
} as unknown as IndexStatus

const TERM_HIT: TermInfo = {
  term: 'invoice',
  normalized: 'invoic',
  found: true,
  document_frequency: 2,
  total_occurrences: 5,
  idf: 0.81,
  postings: [
    { document_id: 'DOC_001', title: 'Q3 Invoices', positions: [4, 19], term_frequency: 2 },
  ],
}

const TERM_MISS: TermInfo = {
  term: 'zzz',
  normalized: 'zzz',
  found: false,
  document_frequency: 0,
  total_occurrences: 0,
  idf: 0,
  postings: [],
}

/** The real endpoint: a prefix that matches nothing returns nothing. */
function vocabularyFor(prefix: string) {
  const all = [
    { term: 'invoic', document_frequency: 9 },
    { term: 'payment', document_frequency: 7 },
  ]
  const terms = all.filter((t) => t.term.startsWith(prefix))
  return Promise.resolve({ terms, total: prefix ? terms.length : all.length })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <IndexingProvider>
        <IndexExplorerPage />
      </IndexingProvider>
    </MemoryRouter>,
  )
}

describe('IndexExplorerPage on a corpus without the demo vocabulary', () => {
  beforeEach(() => {
    vi.spyOn(api, 'indexStatus').mockResolvedValue(READY_STATUS)
    vi.spyOn(api, 'vocabulary').mockImplementation((prefix = '') => vocabularyFor(prefix))
  })
  afterEach(() => vi.restoreAllMocks())

  it('opens on a term taken from the index rather than a hardcoded one', async () => {
    vi.spyOn(api, 'term').mockResolvedValue(TERM_HIT)
    renderPage()

    // The most frequent term in the index seeds the input...
    await waitFor(() => expect(api.term).toHaveBeenCalledWith('invoic'))
    // ...and its postings render, so the page never opens on an empty state.
    expect(await screen.findByText('Q3 Invoices')).toBeInTheDocument()
  })

  it('keeps the vocabulary panel populated when the term misses', async () => {
    vi.spyOn(api, 'term').mockImplementation((term: string) =>
      Promise.resolve(term === 'zzz' ? TERM_MISS : TERM_HIT),
    )
    renderPage()
    await screen.findByText('Q3 Invoices')

    // A term the corpus does not contain — the old default 'machine' was this
    // case on every corpus but the demo one.
    await userEvent.clear(screen.getByLabelText('Term to inspect'))
    await userEvent.type(screen.getByLabelText('Term to inspect'), 'zzz')

    await screen.findByText(/is not in the vocabulary/i)
    // The panel is the way out of a missed term, so it must not be empty.
    expect(await screen.findByRole('button', { name: /invoic/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /payment/ })).toBeInTheDocument()
    expect(screen.getByText(/Most frequent of 2 terms/i)).toBeInTheDocument()
  })

  it('still filters the panel while a typed prefix matches', async () => {
    vi.spyOn(api, 'term').mockResolvedValue(TERM_HIT)
    renderPage()
    await screen.findByText('Q3 Invoices')

    await userEvent.clear(screen.getByLabelText('Term to inspect'))
    await userEvent.type(screen.getByLabelText('Term to inspect'), 'pay')

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /invoic/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /payment/ })).toBeInTheDocument()
    expect(screen.getByText(/1 matching terms/i)).toBeInTheDocument()
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { IndexingProvider } from '@/hooks/useIndexing'
import { api, ApiError } from '@/services/api'
import type { DocumentSummary } from '@/types'

const doc: DocumentSummary = {
  id: 'DOC_001',
  title: 'Machine Learning Introduction',
  file_name: 'ml.txt',
  size_bytes: 2048,
  status: 'ready',
  source: 'demo',
  uploaded_at: new Date().toISOString(),
  indexed: true,
  term_count: 117,
  preview: 'Machine learning is a field of artificial intelligence.',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <IndexingProvider>
        <DocumentsPage />
      </IndexingProvider>
    </MemoryRouter>,
  )
}

describe('DocumentsPage API failure handling', () => {
  beforeEach(() => {
    vi.spyOn(api, 'indexStatus').mockRejectedValue(new ApiError('backend down', 0))
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the corpus when the API works', async () => {
    vi.spyOn(api, 'listDocuments').mockResolvedValue({ documents: [doc], total: 1 })
    renderPage()
    expect(await screen.findByText('Machine Learning Introduction')).toBeInTheDocument()
    expect(screen.queryByText(/Corpus unavailable/i)).not.toBeInTheDocument()
  })

  it('reports an unreachable backend instead of an empty corpus', async () => {
    vi.spyOn(api, 'listDocuments').mockRejectedValue(
      new ApiError('Cannot reach the SwiftSearch backend. Is it running?', 0),
    )
    renderPage()

    // The misleading empty state must not appear...
    await waitFor(() => expect(screen.getByText(/Corpus unavailable/i)).toBeInTheDocument())
    expect(screen.queryByText('No documents yet')).not.toBeInTheDocument()
    // ...and the reason is shown.
    expect(screen.getByText(/Could not load the corpus/i)).toBeInTheDocument()
    expect(screen.getByText(/Cannot reach the SwiftSearch backend/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('still shows the genuine empty state when the API returns no documents', async () => {
    vi.spyOn(api, 'listDocuments').mockResolvedValue({ documents: [], total: 0 })
    renderPage()
    expect(await screen.findByText('No documents yet')).toBeInTheDocument()
    expect(screen.queryByText(/Corpus unavailable/i)).not.toBeInTheDocument()
  })

  it('explains why a delete was refused', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    vi.spyOn(api, 'listDocuments').mockResolvedValue({ documents: [doc], total: 1 })
    vi.spyOn(api, 'deleteDocument').mockRejectedValue(
      new ApiError('This action requires the admin token.', 401),
    )
    renderPage()

    await user.click(await screen.findByRole('button', { name: /delete/i }))
    expect(await screen.findByText(/requires the admin token/i)).toBeInTheDocument()
  })
})

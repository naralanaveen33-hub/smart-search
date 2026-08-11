import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ResultCard } from '@/components/search/ResultCard'
import type { SearchResult } from '@/types'

const result: SearchResult = {
  document_id: 'DOC_001',
  title: 'Machine Learning Introduction',
  snippet: 'Machine learning is a field of artificial intelligence.',
  score: 12.45,
  relevance: 98,
  matched_terms: ['machin', 'learn'],
  highlight_terms: ['machine', 'learning'],
  file_name: 'ml.txt',
  page: 4,
  doc_length: 120,
  term_details: [
    { term: 'machin', term_frequency: 4, document_frequency: 3, idf: 0.693, contribution: 1.42 },
  ],
  signals: [
    { label: 'Query terms matched', detail: '2 of 2 terms found', passed: true },
    { label: 'Term frequency', detail: 'Highest term frequency: 4', passed: true },
  ],
}

describe('ResultCard', () => {
  it('shows the title, score, relevance and document metadata', () => {
    render(<ResultCard result={result} rank={0} />)
    expect(screen.getByText('Machine Learning Introduction')).toBeInTheDocument()
    expect(screen.getByText('98%')).toBeInTheDocument()
    expect(screen.getByText(/12\.45/)).toBeInTheDocument()
    expect(screen.getByText(/Page 4/)).toBeInTheDocument()
  })

  it('highlights matched terms in the snippet', () => {
    const { container } = render(<ResultCard result={result} rank={0} />)
    const marks = Array.from(container.querySelectorAll('mark')).map((m) => m.textContent)
    expect(marks).toEqual(['Machine', 'learning'])
  })

  it('does not highlight when highlighting is disabled', () => {
    const { container } = render(<ResultCard result={result} rank={0} highlight={false} />)
    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })

  it('reveals the ranking explanation on demand', async () => {
    const user = userEvent.setup()
    render(<ResultCard result={result} rank={0} />)

    expect(screen.queryByText(/Why this result ranked here/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /why this result/i }))

    expect(screen.getByText(/Why this result ranked here/i)).toBeInTheDocument()
    expect(screen.getByText('Query terms matched')).toBeInTheDocument()
    expect(screen.getByText(/BM25 contribution per term/i)).toBeInTheDocument()
    expect(screen.getByText('0.693')).toBeInTheDocument()
  })
})

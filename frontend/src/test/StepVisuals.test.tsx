import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StepVisual } from '@/components/viz/StepVisuals'
import type { ExplainStep } from '@/types'

// Real timers: React 19's scheduler does not cooperate with faked ones, and the
// reveal intervals are short enough to wait out.
const step: ExplainStep = {
  key: 'documents',
  label: 'Documents',
  description: 'Documents are collected and assigned unique document IDs.',
  data: {
    documents: [
      { id: 'DOC_001', text: 'Machine learning is powerful.' },
      { id: 'DOC_002', text: 'Machine learning algorithms are useful.' },
      { id: 'DOC_003', text: 'Inverted indexes make search fast.' },
    ],
  },
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('StepVisual play/pause', () => {
  it('reveals items progressively while playing', async () => {
    render(<StepVisual step={step} playing runId={0} />)

    // The first item always shows, so the pane is never blank.
    expect(screen.getByText('DOC_001')).toBeInTheDocument()
    expect(screen.queryByText('DOC_002')).not.toBeInTheDocument()

    expect(await screen.findByText('DOC_002', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(await screen.findByText('DOC_003', {}, { timeout: 2000 })).toBeInTheDocument()
  })

  it('freezes where it was when paused, and resumes from there', async () => {
    const { rerender } = render(<StepVisual step={step} playing runId={0} />)
    await screen.findByText('DOC_002', {}, { timeout: 2000 })

    rerender(<StepVisual step={step} playing={false} runId={0} />)
    await wait(1200)
    expect(screen.queryByText('DOC_003')).not.toBeInTheDocument()
    expect(screen.getByText('DOC_002')).toBeInTheDocument()

    rerender(<StepVisual step={step} playing runId={0} />)
    expect(await screen.findByText('DOC_003', {}, { timeout: 2000 })).toBeInTheDocument()
  })

  it('shows the finished state when a step is opened while paused', () => {
    render(<StepVisual step={step} playing={false} runId={0} />)
    expect(screen.getByText('DOC_001')).toBeInTheDocument()
    expect(screen.getByText('DOC_002')).toBeInTheDocument()
    expect(screen.getByText('DOC_003')).toBeInTheDocument()
  })

  it('replays the current step when runId changes', async () => {
    const { rerender } = render(<StepVisual step={step} playing runId={0} />)
    await screen.findByText('DOC_003', {}, { timeout: 3000 })

    rerender(<StepVisual step={step} playing runId={1} />)
    await waitFor(() => expect(screen.queryByText('DOC_003')).not.toBeInTheDocument())
    expect(await screen.findByText('DOC_003', {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('switches visuals when the step changes', async () => {
    const { rerender } = render(<StepVisual step={step} playing runId={0} />)
    await screen.findByText('DOC_003', {}, { timeout: 3000 })

    const tokenization: ExplainStep = {
      key: 'tokenization',
      label: 'Tokenization',
      description: 'Text is split into individual terms.',
      data: {
        documents: [
          {
            document_id: 'DOC_001',
            text: 'Machine learning is powerful.',
            raw: ['Machine', 'learning', 'is', 'powerful'],
            kept: ['machin', 'learn', 'power'],
            removed: ['is'],
          },
        ],
      },
    }
    rerender(<StepVisual step={tokenization} playing runId={0} />)
    await waitFor(() => expect(screen.queryByText('DOC_003')).not.toBeInTheDocument())
    expect(screen.getByText('Raw text')).toBeInTheDocument()
  })
})

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { StepVisual } from '@/components/viz/StepVisuals'
import { useAsync } from '@/hooks/useAsync'
import { useIndexing } from '@/hooks/useIndexing'
import { api } from '@/services/api'
import type { ExplainStep, SearchResponse } from '@/types'
import { classNames, formatSeconds } from '@/utils/format'

const DEMO_QUERY = 'machine learning'
const AUTOPLAY_MS = 7000

interface Slide {
  key: string
  title: string
  caption: string
  render: (playing: boolean, runId: number) => React.ReactNode
}

/**
 * Request real fullscreen while presenting, and release it on exit.
 *
 * Fullscreen is a progressive enhancement: it can be refused (no user
 * gesture, an iframe without `allowfullscreen`, or a browser that lacks the
 * API), in which case the overlay still covers the viewport. Leaving
 * fullscreen by any route — including the browser's own Escape — exits
 * presentation mode, so the two never disagree.
 */
function useFullscreen(onExit: () => void) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const element = document.documentElement
    let cancelled = false

    const enter = async () => {
      if (!element.requestFullscreen || document.fullscreenElement) return
      try {
        await element.requestFullscreen()
        if (!cancelled) setActive(true)
      } catch {
        // Fullscreen unavailable or denied — the overlay is enough.
      }
    }
    void enter()

    const onChange = () => {
      if (!document.fullscreenElement && !cancelled) {
        setActive(false)
        onExit()
      }
    }
    document.addEventListener('fullscreenchange', onChange)

    return () => {
      cancelled = true
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => undefined)
      }
    }
  }, [onExit])

  return active
}

export function PresentationMode({ onExit }: { onExit: () => void }) {
  const { status } = useIndexing()
  const { data: explain } = useAsync(() => api.explain(), [])
  const { data: search } = useAsync(
    () =>
      status?.index_ready
        ? api.search({ query: DEMO_QUERY, mode: 'all', limit: 5 }).catch(() => null)
        : Promise.resolve(null),
    [status?.index_ready],
  )

  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [runId, setRunId] = useState(0)
  useFullscreen(onExit)

  const slides = useMemo(
    () => buildSlides(explain?.steps ?? [], search ?? null),
    [explain, search],
  )
  const total = slides.length || 9

  const go = useCallback(
    (next: number) => setIndex(((next % total) + total) % total),
    [total],
  )

  const togglePlay = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (!wasPlaying) setRunId((id) => id + 1)
      return !wasPlaying
    })
  }, [])

  useEffect(() => {
    if (!playing || !slides.length) return
    const timer = window.setTimeout(() => {
      setIndex((current) => {
        if (current + 1 >= slides.length) {
          setPlaying(false)
          return current
        }
        return current + 1
      })
    }, AUTOPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [playing, index, slides.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit()
      if (event.key === 'ArrowRight') go(index + 1)
      if (event.key === 'ArrowLeft') go(index - 1)
      if (event.key === ' ') {
        event.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, go, onExit, togglePlay])

  const slide = slides[index]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex flex-col bg-bg"
      role="dialog"
      aria-modal="true"
      aria-label="Presentation mode"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-accent uppercase">
            Presentation Mode
          </p>
          <h2 className="mt-0.5 text-[14px] font-semibold">
            SwiftSearch — Blocked Sort-Based Indexing
          </h2>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1.5 rounded-[6px] border border-line px-2.5 py-1.5 text-[12px] text-muted transition-colors hover:text-ink"
        >
          <X size={13} />
          Exit
        </button>
      </header>

      {/* Slide */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-5 py-8">
          <AnimatePresence mode="wait">
            {slide && (
              <motion.section
                key={slide.key}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.26, ease: 'easeOut' }}
              >
                <p className="font-mono text-[11px] tracking-[0.14em] text-subtle uppercase">
                  Step {index + 1} of {total}
                </p>
                <h3 className="mt-2 text-[30px] leading-tight font-semibold tracking-tight sm:text-[36px]">
                  {slide.title}
                </h3>
                <p className="mt-2.5 max-w-2xl text-[16px] leading-relaxed text-muted">
                  {slide.caption}
                </p>
                <div className="mt-7 rounded-[8px] border border-line bg-surface p-5">
                  {slide.render(playing, runId)}
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Controls */}
      <footer className="border-t border-line px-5 py-3.5">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            aria-label="Previous step"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            className="flex h-9 w-9 items-center justify-center rounded-[6px] border border-line text-muted transition-colors hover:text-ink disabled:opacity-35"
          >
            <ChevronLeft size={15} />
          </button>

          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={togglePlay}
            className="flex h-9 w-9 items-center justify-center rounded-[6px] border border-[var(--accent)] bg-[var(--accent)] text-white transition-opacity hover:opacity-90 dark:text-[#0b0b0f]"
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>

          <button
            type="button"
            aria-label="Next step"
            onClick={() => go(index + 1)}
            disabled={index >= total - 1}
            className="flex h-9 w-9 items-center justify-center rounded-[6px] border border-line text-muted transition-colors hover:text-ink disabled:opacity-35"
          >
            <ChevronRight size={15} />
          </button>

          <div className="mx-2 flex flex-1 gap-1">
            {slides.map((item, i) => (
              <button
                key={item.key}
                type="button"
                aria-label={`Go to ${item.title}`}
                onClick={() => go(i)}
                className={classNames(
                  'h-1 flex-1 rounded-full transition-colors',
                  i === index
                    ? 'bg-[var(--accent)]'
                    : i < index
                      ? 'bg-[var(--accent)]/40'
                      : 'bg-[var(--border)]',
                )}
              />
            ))}
          </div>

          <span className="tabular shrink-0 font-mono text-[12px] text-muted">
            {index + 1} / {total}
          </span>
        </div>
      </footer>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ slides */

function buildSlides(steps: ExplainStep[], search: SearchResponse | null): Slide[] {
  const pipeline: Slide[] = steps.map((step) => ({
    key: step.key,
    title: step.label,
    caption: step.description,
    render: (playing: boolean, runId: number) => (
      <StepVisual step={step} playing={playing} runId={runId} />
    ),
  }))

  const searchSlides: Slide[] = [
    {
      key: 'search',
      title: 'Search',
      caption:
        'A query goes through exactly the same pipeline as a document: split, normalized and stemmed, so its terms can be found in the dictionary.',
      render: () => <QuerySlide search={search} />,
    },
    {
      key: 'bm25',
      title: 'BM25 Ranking',
      caption:
        'Candidate documents are scored with BM25. Term frequency is damped, rare terms weigh more, and long documents are normalized.',
      render: () => <RankingSlide search={search} />,
    },
    {
      key: 'results',
      title: 'Ranked Results',
      caption:
        'Documents are returned in descending score order, each with the snippet, the matched terms and its BM25 score.',
      render: () => <ResultsSlide search={search} />,
    },
  ]

  return [...pipeline, ...searchSlides]
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-subtle">{children}</p>
}

function QuerySlide({ search }: { search: SearchResponse | null }) {
  if (!search) return <Placeholder>Build the index to run the live search demo.</Placeholder>
  return (
    <div className="space-y-4">
      <div className="rounded-[6px] border border-line bg-surface-2 px-3 py-2.5 font-mono text-[13px]">
        {search.query}
      </div>
      <p className="font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">Query terms</p>
      <div className="flex flex-wrap gap-1.5">
        {search.normalized_terms.map((term) => (
          <span
            key={term}
            className="rounded-[4px] border border-[var(--accent-border)] bg-accent-soft px-2 py-1 font-mono text-[12px] text-accent"
          >
            {term}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
        {[
          ['Candidates', search.candidates_examined],
          ['Matches', search.total],
          ['Latency', formatSeconds(search.took_seconds)],
        ].map(([label, value]) => (
          <div key={label as string}>
            <p className="text-[10px] tracking-wide text-subtle uppercase">{label}</p>
            <p className="tabular mt-0.5 font-mono text-[19px] font-medium text-ink">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function RankingSlide({ search }: { search: SearchResponse | null }) {
  const top = search?.results[0]
  if (!top) return <Placeholder>Build the index to see live BM25 scoring.</Placeholder>
  return (
    <div className="space-y-3">
      <p className="text-[13px] font-medium">{top.title}</p>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line text-[10px] tracking-wide text-subtle uppercase">
            <th className="py-1.5 font-medium">Term</th>
            <th className="py-1.5 text-right font-medium">tf</th>
            <th className="py-1.5 text-right font-medium">df</th>
            <th className="py-1.5 text-right font-medium">idf</th>
            <th className="py-1.5 text-right font-medium">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {top.term_details.map((detail) => (
            <tr key={detail.term} className="border-b border-line last:border-0">
              <td className="py-1.5 font-mono text-[12px] text-accent">{detail.term}</td>
              <td className="tabular py-1.5 text-right font-mono text-[12px]">
                {detail.term_frequency}
              </td>
              <td className="tabular py-1.5 text-right font-mono text-[12px]">
                {detail.document_frequency}
              </td>
              <td className="tabular py-1.5 text-right font-mono text-[12px]">
                {detail.idf.toFixed(3)}
              </td>
              <td className="tabular py-1.5 text-right font-mono text-[12px] text-ink">
                {detail.contribution.toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line pt-3 font-mono text-[12px]">
        Total BM25 score: <span className="text-accent">{top.score.toFixed(3)}</span>
      </p>
    </div>
  )
}

function ResultsSlide({ search }: { search: SearchResponse | null }) {
  if (!search?.results.length) return <Placeholder>Build the index to see live results.</Placeholder>
  return (
    <ol className="space-y-2.5">
      {search.results.slice(0, 4).map((result, position) => (
        <motion.li
          key={result.document_id}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: position * 0.08 }}
          className="flex items-start gap-3 rounded-[6px] border border-line p-3"
        >
          <span className="mt-0.5 font-mono text-[12px] text-subtle">{position + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{result.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{result.snippet}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[12px] text-accent">{result.relevance}%</p>
            <p className="tabular font-mono text-[11px] text-subtle">{result.score.toFixed(2)}</p>
          </div>
        </motion.li>
      ))}
    </ol>
  )
}

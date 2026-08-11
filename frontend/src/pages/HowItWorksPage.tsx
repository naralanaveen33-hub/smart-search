import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { Banner, Button, Card, SectionTitle } from '@/components/ui'
import { StepVisual } from '@/components/viz/StepVisuals'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/services/api'
import { classNames } from '@/utils/format'

const AUTOPLAY_MS = 6500

export function HowItWorksPage() {
  const { data, loading, error } = useAsync(() => api.explain(), [])
  const steps = data?.steps ?? []
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(false)
  // Bumped to replay the current step's visual without changing steps.
  const [runId, setRunId] = useState(0)

  const go = useCallback(
    (index: number) => {
      if (!steps.length) return
      setActive(((index % steps.length) + steps.length) % steps.length)
    },
    [steps.length],
  )

  const togglePlay = useCallback(() => {
    setPlaying((wasPlaying) => {
      // Starting playback replays the current visual from the beginning;
      // pausing simply freezes it where it is.
      if (!wasPlaying) setRunId((id) => id + 1)
      return !wasPlaying
    })
  }, [])

  const restart = useCallback(() => {
    setPlaying(false)
    setRunId((id) => id + 1)
    go(0)
  }, [go])

  // Autoplay advances through the six stages, wrapping at the end.
  useEffect(() => {
    if (!playing || !steps.length) return
    const timer = window.setTimeout(() => {
      setActive((current) => (current + 1) % steps.length)
    }, AUTOPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [playing, active, steps.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.key === 'ArrowRight') go(active + 1)
      if (event.key === 'ArrowLeft') go(active - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, go])

  const step = steps[active]

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="BSBI Pipeline"
        title="How SwiftSearch Works"
        description="See how documents become a searchable inverted index. Every example below is produced by the real tokenizer and the real block, sort and merge routines."
      />

      {error && <Banner tone="error">{error}</Banner>}
      {loading && <Card className="h-64 animate-pulse" />}

      {step && (
        <div className="grid gap-5 lg:grid-cols-[248px_1fr]">
          {/* Stage list */}
          <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {steps.map((item, index) => {
              const isActive = index === active
              const isDone = index < active
              return (
                <li key={item.key} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => go(index)}
                    aria-current={isActive ? 'step' : undefined}
                    className={classNames(
                      'flex w-full items-center gap-2.5 rounded-[6px] border px-3 py-2.5 text-left transition-colors',
                      isActive
                        ? 'border-[var(--accent-border)] bg-accent-soft'
                        : 'border-line bg-surface hover:border-line-strong',
                    )}
                  >
                    <span
                      className={classNames(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] font-mono text-[10px]',
                        isActive
                          ? 'bg-[var(--accent)] text-white dark:text-[#0b0b0f]'
                          : isDone
                            ? 'border border-[var(--success)]/40 bg-ok-soft text-[var(--success)]'
                            : 'border border-line text-subtle',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span
                      className={classNames(
                        'text-[13px] whitespace-nowrap',
                        isActive ? 'font-medium text-accent' : 'text-muted',
                      )}
                    >
                      {item.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          {/* Detail pane */}
          <Card padded={false}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
              <div>
                <p className="font-mono text-[11px] tracking-[0.12em] text-subtle uppercase">
                  Step {active + 1} of {steps.length}
                </p>
                <h2 className="mt-1 text-[17px] font-semibold">{step.label}</h2>
                <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted">
                  {step.description}
                </p>
              </div>
            </div>

            <div className="min-h-[300px] p-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step.key}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <StepVisual step={step} playing={playing} runId={runId} />
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
              <Button
                size="sm"
                icon={<ChevronLeft size={14} />}
                onClick={() => go(active - 1)}
                disabled={active === 0}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant={playing ? 'secondary' : 'primary'}
                icon={playing ? <Pause size={13} /> : <Play size={13} />}
                onClick={togglePlay}
              >
                {playing ? 'Pause' : 'Play Animation'}
              </Button>
              <Button size="sm" icon={<RotateCcw size={13} />} onClick={restart}>
                Restart
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                iconRight={<ChevronRight size={14} />}
                onClick={() => go(active + 1)}
                disabled={active === steps.length - 1}
              >
                Next
              </Button>
            </div>

            <div className="flex gap-1 px-4 pb-4">
              {steps.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  aria-label={`Go to ${item.label}`}
                  onClick={() => go(index)}
                  className={classNames(
                    'h-1 flex-1 rounded-full transition-colors',
                    index <= active ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
                  )}
                />
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

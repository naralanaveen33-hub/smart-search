import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui'

const STORAGE_KEY = 'swiftsearch-welcomed'

const STEPS = [
  { title: 'Explore How It Works', body: 'Walk through the six BSBI stages with live examples.', to: '/how-it-works' },
  { title: 'Upload Documents', body: 'Six demo documents are already loaded — add your own any time.', to: '/documents' },
  { title: 'Build the Index', body: 'Watch blocks fill, flush, sort and merge in real time.', to: '/indexing' },
  { title: 'Search', body: 'Query the index and see exactly why each result ranked where it did.', to: '/search' },
]

/** First-run guide. No authentication, no blocking — the demo runs immediately. */
export function WelcomeDialog() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!window.localStorage.getItem(STORAGE_KEY)) setOpen(true)
  }, [])

  const dismiss = () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4"
          onClick={(event) => event.target === event.currentTarget && dismiss()}
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
            className="w-full max-w-md rounded-[8px] border border-line bg-surface"
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 id="welcome-title" className="text-[16px] font-semibold">
                  Welcome to SwiftSearch
                </h2>
                <p className="mt-1 text-[12px] text-muted">
                  A working search engine that shows you how its own index is built.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={dismiss}
                className="shrink-0 text-subtle hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <ol className="px-5 py-3">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="flex items-start gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-line font-mono text-[10px] text-subtle">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{step.title}</p>
                    <p className="mt-0.5 text-[12px] text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
              <Button onClick={dismiss}>Explore on my own</Button>
              <Button
                variant="primary"
                iconRight={<ArrowRight size={13} />}
                onClick={() => {
                  dismiss()
                  navigate('/how-it-works')
                }}
              >
                Start the tour
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

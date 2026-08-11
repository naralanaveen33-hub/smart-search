import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, FileText, X } from 'lucide-react'
import type { SearchResult } from '@/types'
import { classNames, highlightParts } from '@/utils/format'

export function ResultCard({
  result,
  rank,
  highlight = true,
}: {
  result: SearchResult
  rank: number
  highlight?: boolean
}) {
  const [open, setOpen] = useState(false)
  const parts = highlight
    ? highlightParts(result.snippet, result.highlight_terms)
    : [{ text: result.snippet, match: false }]

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(rank * 0.03, 0.2) }}
      className="rounded-[8px] border border-line bg-surface"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[14px] leading-snug font-semibold text-ink">{result.title}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-subtle">
              <span className="text-accent">{result.document_id}</span>
              {result.file_name && <span>· {result.file_name}</span>}
              {result.page && <span>· Page {result.page}</span>}
              <span>· {result.doc_length} terms</span>
            </p>
          </div>
          <span
            className="tabular shrink-0 rounded-[4px] border border-[var(--accent-border)] bg-accent-soft px-1.5 py-0.5 font-mono text-[12px] font-medium text-accent"
            title="Relevance relative to the top result"
          >
            {result.relevance}%
          </span>
        </div>

        <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
          {parts.map((part, index) =>
            part.match ? (
              <mark key={index} className="mark">
                {part.text}
              </mark>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="tabular font-mono text-[11px] text-muted">
            BM25 Score: <span className="text-ink">{result.score.toFixed(2)}</span>
          </span>
          <span className="font-mono text-[11px] text-muted">
            Matched: {result.matched_terms.join(', ') || '—'}
          </span>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="ml-auto flex items-center gap-1 text-[12px] text-accent transition-opacity hover:opacity-80"
          >
            Why this result?
            <ChevronDown
              size={12}
              className={classNames('transition-transform', open && 'rotate-180')}
            />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-t border-line"
          >
            <div className="space-y-4 p-4">
              <div>
                <p className="mb-2 font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
                  Why this result ranked here
                </p>
                <ul className="space-y-1.5">
                  {result.signals.map((signal) => (
                    <li key={signal.label} className="flex items-start gap-2">
                      {signal.passed ? (
                        <Check size={13} className="mt-0.5 shrink-0 text-[var(--success)]" />
                      ) : (
                        <X size={13} className="mt-0.5 shrink-0 text-subtle" />
                      )}
                      <span className="text-[12px]">
                        <span className={signal.passed ? 'text-ink' : 'text-muted'}>
                          {signal.label}
                        </span>
                        <span className="text-subtle"> — {signal.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-2 font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
                  BM25 contribution per term
                </p>
                <div className="overflow-x-auto rounded-[6px] border border-line">
                  <table className="w-full min-w-[380px] text-left">
                    <thead>
                      <tr className="border-b border-line text-[10px] tracking-wide text-subtle uppercase">
                        <th className="px-3 py-1.5 font-medium">Term</th>
                        <th className="px-3 py-1.5 text-right font-medium">tf</th>
                        <th className="px-3 py-1.5 text-right font-medium">df</th>
                        <th className="px-3 py-1.5 text-right font-medium">idf</th>
                        <th className="px-3 py-1.5 text-right font-medium">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.term_details.map((detail) => (
                        <tr key={detail.term} className="border-b border-line last:border-0">
                          <td className="px-3 py-1.5 font-mono text-[11px] text-accent">
                            {detail.term}
                          </td>
                          <td className="tabular px-3 py-1.5 text-right font-mono text-[11px]">
                            {detail.term_frequency}
                          </td>
                          <td className="tabular px-3 py-1.5 text-right font-mono text-[11px]">
                            {detail.document_frequency}
                          </td>
                          <td className="tabular px-3 py-1.5 text-right font-mono text-[11px]">
                            {detail.idf.toFixed(3)}
                          </td>
                          <td className="tabular px-3 py-1.5 text-right font-mono text-[11px] text-ink">
                            {detail.contribution.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-surface-2">
                        <td className="px-3 py-1.5 text-[11px] font-medium" colSpan={4}>
                          Total BM25 score
                        </td>
                        <td className="tabular px-3 py-1.5 text-right font-mono text-[11px] font-semibold text-accent">
                          {result.score.toFixed(3)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
                <FileText size={11} className="mt-0.5 shrink-0" />
                Each term contributes idf × (tf × (k1 + 1)) / (tf + k1 × (1 − b + b × |d| / avgdl)),
                with k1 = 1.2 and b = 0.75.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  )
}

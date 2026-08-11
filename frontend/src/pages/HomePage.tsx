import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Workflow } from 'lucide-react'
import { Button, MetricCard } from '@/components/ui'
import { PipelineDiagram } from '@/components/viz/PipelineDiagram'
import { useAsync } from '@/hooks/useAsync'
import { useIndexing } from '@/hooks/useIndexing'
import { api } from '@/services/api'
import { formatBytes, formatNumber } from '@/utils/format'

export function HomePage() {
  const { status } = useIndexing()
  const { data: analytics } = useAsync(() => api.analytics(), [status?.state])

  const stats = [
    { label: 'Documents', value: formatNumber(analytics?.documents ?? 0) },
    { label: 'Unique Terms', value: formatNumber(analytics?.unique_terms ?? 0) },
    { label: 'Index Size', value: formatBytes(analytics?.index_size_bytes ?? 0) },
    { label: 'Searches', value: formatNumber(analytics?.searches ?? 0) },
  ]

  return (
    <div className="space-y-10 py-4 sm:py-8">
      <section className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
        >
          <p className="mb-3 font-mono text-[11px] tracking-[0.14em] text-accent uppercase">
            Blocked Sort-Based Indexing
          </p>
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-tight sm:text-[42px]">
            Smart Search.
            <br />
            <span className="text-accent">Lightning Fast.</span>
          </h1>
          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-muted">
            SwiftSearch is a search engine built using Blocked Sort-Based Indexing for efficient
            indexing and fast, relevant search results.
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link to="/documents">
              <Button variant="primary" size="lg" iconRight={<ArrowRight size={14} />}>
                Get Started
              </Button>
            </Link>
            <Link to="/how-it-works">
              <Button size="lg" icon={<Workflow size={14} />}>
                How It Works
              </Button>
            </Link>
          </div>

          <p className="mt-6 text-[12px] text-subtle">
            {status?.index_ready
              ? 'An index is ready — jump straight to Search.'
              : 'Six demo documents are loaded. Build the index to start searching.'}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-[8px] border border-line bg-surface p-6 sm:p-8"
        >
          <PipelineDiagram />
        </motion.div>
      </section>

      <section aria-label="Index statistics">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <MetricCard key={stat.label} label={stat.label} value={stat.value} index={index} />
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            step: '01',
            title: 'Bounded memory',
            body: 'Postings accumulate until memory fills, then the block is flushed to disk. Nothing but one block ever needs to fit in RAM.',
          },
          {
            step: '02',
            title: 'Sorted blocks merge cheaply',
            body: 'Each block is sorted on its own, so all blocks can be merged in a single linear pass with a k-way merge.',
          },
          {
            step: '03',
            title: 'Ranked with BM25',
            body: 'Queries retrieve postings lists, score candidates with BM25 and return the top results with an explanation.',
          },
        ].map((item, index) => (
          <motion.div
            key={item.step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1 + index * 0.06 }}
            className="rounded-[8px] border border-line bg-surface p-5"
          >
            <p className="font-mono text-[11px] text-accent">{item.step}</p>
            <h3 className="mt-2 text-[13px] font-semibold">{item.title}</h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{item.body}</p>
          </motion.div>
        ))}
      </section>
    </div>
  )
}

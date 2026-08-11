import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { api, eventsUrl } from '@/services/api'
import type { IndexEvent, IndexStatus, StageKey } from '@/types'

interface Pulse {
  kind: 'memory_full' | 'block_written'
  blockId?: number
  at: number
}

interface IndexingContextValue {
  status: IndexStatus | null
  connected: boolean
  starting: boolean
  error: string | null
  pulse: Pulse | null
  activeDocument?: string
  currentTerm?: string
  start: (payload?: { block_size?: number; step_delay?: number }) => Promise<void>
  reset: () => Promise<void>
  refresh: () => Promise<void>
  stageOf: (key: StageKey) => IndexStatus['stages'][number] | undefined
}

const EMPTY_STATUS: IndexStatus = {
  state: 'idle',
  stages: [
    { key: 'documents', label: 'Documents', status: 'waiting', progress: 0 },
    { key: 'tokenization', label: 'Tokenization', status: 'waiting', progress: 0 },
    { key: 'block_creation', label: 'Block Creation', status: 'waiting', progress: 0 },
    { key: 'sorting', label: 'Sorting', status: 'waiting', progress: 0 },
    { key: 'merging', label: 'Merging', status: 'waiting', progress: 0 },
    { key: 'inverted_index', label: 'Inverted Index', status: 'waiting', progress: 0 },
  ],
  stats: {
    documents_total: 0, documents_processed: 0, tokens_generated: 0,
    postings_generated: 0, blocks_created: 0, current_block: 0, memory_entries: 0,
    memory_capacity: 0, memory_used: 0, peak_memory_entries: 0, peak_memory_used: 0,
    unique_terms: 0, index_size_bytes: 0,
    elapsed_seconds: 0, merge_progress: 0, avg_block_size: 0,
  },
  blocks: [],
  memory_block: [],
  token_stream: [],
  error: null,
  index_ready: false,
}

const IndexingContext = createContext<IndexingContextValue | null>(null)

/**
 * Single source of truth for indexing state.
 *
 * The SSE stream drives the UI; the REST status endpoint is used for the
 * initial paint and as a fallback if the stream drops.
 */
export function IndexingProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [connected, setConnected] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pulse, setPulse] = useState<Pulse | null>(null)
  const [activeDocument, setActiveDocument] = useState<string | undefined>()
  const [currentTerm, setCurrentTerm] = useState<string | undefined>()
  const sourceRef = useRef<EventSource | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.indexStatus())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load index status')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const source = new EventSource(eventsUrl)
    sourceRef.current = source

    const handle = (raw: MessageEvent) => {
      try {
        const event = JSON.parse(raw.data) as IndexEvent
        setConnected(true)
        setStatus((previous) => ({ ...(previous ?? EMPTY_STATUS), ...event }))
        if (event.active_document) setActiveDocument(event.active_document)
        if (event.current_term) setCurrentTerm(event.current_term)
        if (event.event === 'memory_full' || event.event === 'block_written') {
          setPulse({ kind: event.event, blockId: event.block_id, at: Date.now() })
        }
        if (event.type === 'error' && event.error) setError(event.error)
      } catch {
        /* ignore malformed frames */
      }
    }

    source.addEventListener('progress', handle)
    source.addEventListener('completed', handle)
    source.addEventListener('error', handle as EventListener)
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [])

  // If the stream is down while a run is active, poll so the UI still moves.
  useEffect(() => {
    if (connected || status?.state !== 'running') return
    const timer = window.setInterval(() => void refresh(), 700)
    return () => window.clearInterval(timer)
  }, [connected, status?.state, refresh])

  const start = useCallback(
    async (payload: { block_size?: number; step_delay?: number } = {}) => {
      setStarting(true)
      setError(null)
      setPulse(null)
      try {
        setStatus(await api.startIndex(payload))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start indexing')
        throw err
      } finally {
        setStarting(false)
      }
    },
    [],
  )

  const reset = useCallback(async () => {
    try {
      setStatus(await api.resetIndex())
      setPulse(null)
      setError(null)
    } catch (err) {
      // Reset is admin-guarded on protected deployments, and refused while a
      // build is running. Either way the user needs to be told why.
      setError(err instanceof Error ? err.message : 'Could not reset the index')
    }
  }, [])

  const stageOf = useCallback(
    (key: StageKey) => status?.stages.find((stage) => stage.key === key),
    [status],
  )

  const value = useMemo(
    () => ({
      status: status ?? EMPTY_STATUS,
      connected, starting, error, pulse, activeDocument, currentTerm,
      start, reset, refresh, stageOf,
    }),
    [status, connected, starting, error, pulse, activeDocument, currentTerm, start, reset, refresh, stageOf],
  )

  return <IndexingContext.Provider value={value}>{children}</IndexingContext.Provider>
}

export function useIndexing() {
  const context = useContext(IndexingContext)
  if (!context) throw new Error('useIndexing must be used inside IndexingProvider')
  return context
}

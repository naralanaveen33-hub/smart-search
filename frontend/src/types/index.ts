export type StageKey =
  | 'documents'
  | 'tokenization'
  | 'block_creation'
  | 'sorting'
  | 'merging'
  | 'inverted_index'

export type StageStatus = 'waiting' | 'in_progress' | 'completed' | 'error'
export type IndexState = 'idle' | 'running' | 'completed' | 'error'
export type SearchMode = 'all' | 'and' | 'or' | 'phrase'
export type SortMode = 'relevance' | 'newest' | 'oldest'

export interface Health {
  status: string
  version: string
  index_ready: boolean
  supabase: boolean
  documents: number
}

export interface DocumentSummary {
  id: string
  title: string
  file_name: string
  size_bytes: number
  status: string
  source: string
  uploaded_at: string | null
  indexed: boolean
  term_count: number
  preview: string
}

export interface StageState {
  key: StageKey
  label: string
  status: StageStatus
  progress: number
}

export interface IndexStats {
  documents_total: number
  documents_processed: number
  tokens_generated: number
  postings_generated: number
  blocks_created: number
  current_block: number
  memory_entries: number
  memory_capacity: number
  memory_used: number
  peak_memory_entries: number
  peak_memory_used: number
  unique_terms: number
  index_size_bytes: number
  elapsed_seconds: number
  merge_progress: number
  avg_block_size: number
}

export interface BlockSummary {
  id: number
  name: string
  entries: number
  status: 'writing' | 'written' | 'sorting' | 'sorted' | 'merged'
  size_bytes: number
  first_term: string | null
  last_term: string | null
  created_ms: number
  sorted_ms: number
}

export interface PostingEntry {
  term: string
  document_id: string
  position: number
}

export interface TokenEntry {
  term: string
  raw: string
  document_id: string
  position: number
}

export interface IndexStatus {
  state: IndexState
  stages: StageState[]
  stats: IndexStats
  blocks: BlockSummary[]
  memory_block: PostingEntry[]
  token_stream: TokenEntry[]
  error: string | null
  index_ready: boolean
}

/** SSE frame — a full status snapshot plus which stage moved. */
export interface IndexEvent extends IndexStatus {
  type: 'progress' | 'completed' | 'error'
  stage?: StageKey
  status?: StageStatus
  progress?: number
  event?: 'memory_full' | 'block_written' | 'final_flush'
  block_id?: number
  active_document?: string
  current_term?: string
}

export interface BlockDetail {
  block: BlockSummary
  entries: PostingEntry[]
  truncated: boolean
}

export interface TermPosting {
  document_id: string
  title: string
  positions: number[]
  term_frequency: number
}

export interface TermInfo {
  term: string
  normalized: string
  found: boolean
  document_frequency: number
  total_occurrences: number
  postings: TermPosting[]
  idf: number
}

export interface TermDetail {
  term: string
  term_frequency: number
  document_frequency: number
  idf: number
  contribution: number
}

export interface RankingSignal {
  label: string
  detail: string
  passed: boolean
}

export interface SearchResult {
  document_id: string
  title: string
  snippet: string
  score: number
  relevance: number
  matched_terms: string[]
  highlight_terms: string[]
  file_name: string
  page: number | null
  doc_length: number
  term_details: TermDetail[]
  signals: RankingSignal[]
}

export interface SearchResponse {
  query: string
  normalized_terms: string[]
  mode: SearchMode
  total: number
  took_seconds: number
  results: SearchResult[]
  candidates_examined: number
  limit: number
  offset: number
  has_more: boolean
}

export interface SearchHistoryItem {
  query: string
  mode: string
  results: number
  took_seconds: number
  created_at: string
}

export interface TimeseriesPoint {
  label: string
  value: number
}

export interface Analytics {
  documents: number
  unique_terms: number
  index_size_bytes: number
  searches: number
  avg_response_ms: number
  indexing_seconds: number
  blocks: number
  avg_block_size: number
  peak_memory_entries: number
  peak_memory_used: number
  block_capacity: number
  documents_over_time: TimeseriesPoint[]
  searches_over_time: TimeseriesPoint[]
  response_time_over_time: TimeseriesPoint[]
  top_terms: { term: string; occurrences: number; documents: number }[]
  top_queries: { query: string; count: number }[]
}

export interface AppSettings {
  block_size: number
  max_memory_mb: number
  language: string
  use_stop_words: boolean
  use_stemming: boolean
  bm25_enabled: boolean
  case_sensitive: boolean
  phrase_search: boolean
  highlight_results: boolean
  results_per_page: number
  step_delay: number
}

export interface MemoryBudget {
  requested_block_size: number
  effective_block_size: number
  max_postings_in_budget: number
  bytes_per_posting: number
  capped: boolean
}

export interface LanguageSupport {
  current: string
  supported: string[]
  note: string
}

export interface ExplainStep {
  key: StageKey
  label: string
  description: string
  data: Record<string, any>
}

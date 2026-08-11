import type {
  Analytics,
  AppSettings,
  BlockDetail,
  DocumentSummary,
  ExplainStep,
  Health,
  IndexStatus,
  LanguageSupport,
  MemoryBudget,
  SearchHistoryItem,
  SearchMode,
  SearchResponse,
  SortMode,
  TermInfo,
} from '@/types'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiError('Cannot reach the SwiftSearch backend. Is it running?', 0)
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) detail = body.detail[0]?.msg ?? detail
    } catch {
      /* keep the default message */
    }
    throw new ApiError(detail, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  health: () => request<Health>('/health'),

  // documents
  listDocuments: () => request<{ documents: DocumentSummary[]; total: number }>('/documents'),
  uploadDocuments: (files: File[]) => {
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    return request<{ uploaded: DocumentSummary[]; skipped: { file_name: string; reason: string }[] }>(
      '/documents/upload',
      { method: 'POST', body: form },
    )
  },
  deleteDocument: (id: string) => request<{ deleted: string }>(`/documents/${id}`, { method: 'DELETE' }),
  documentText: (id: string) => request<{ id: string; title: string; text: string }>(`/documents/${id}/text`),
  seedDocuments: () => request<{ added: number }>('/documents/seed', { method: 'POST' }),

  // indexing
  startIndex: (payload: { block_size?: number; step_delay?: number; document_ids?: string[] } = {}) =>
    request<IndexStatus>('/index/start', { method: 'POST', body: JSON.stringify(payload) }),
  indexStatus: () => request<IndexStatus>('/index/status'),
  resetIndex: () => request<IndexStatus>('/index/reset', { method: 'POST' }),
  blocks: () => request<{ blocks: IndexStatus['blocks'] }>('/index/blocks'),
  block: (id: number, limit = 200) => request<BlockDetail>(`/index/block/${id}?limit=${limit}`),
  term: (term: string) => request<TermInfo>(`/index/term/${encodeURIComponent(term)}`),
  vocabulary: (prefix = '', limit = 20) =>
    request<{ terms: { term: string; document_frequency: number }[]; total: number }>(
      `/index/vocabulary?prefix=${encodeURIComponent(prefix)}&limit=${limit}`,
    ),
  explain: () => request<{ steps: ExplainStep[] }>('/index/explain'),

  // search
  /** Omit `limit` to use the configured results-per-page setting. */
  search: (payload: {
    query: string
    mode?: SearchMode
    sort?: SortMode
    limit?: number
    offset?: number
  }) => request<SearchResponse>('/search', { method: 'POST', body: JSON.stringify(payload) }),
  searchHistory: () => request<{ history: SearchHistoryItem[]; popular: string[] }>('/search/history'),

  // analytics + settings
  analytics: () => request<Analytics>('/analytics'),
  settings: () => request<AppSettings>('/settings'),
  updateSettings: (payload: AppSettings) =>
    request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  memoryBudget: () => request<MemoryBudget>('/settings/memory'),
  languages: () => request<LanguageSupport>('/settings/languages'),
}

export const eventsUrl = `${BASE}/index/events`

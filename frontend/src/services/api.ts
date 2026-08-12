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

/**
 * Where the backend lives.
 *
 * In development this is the relative `/api`, which the Vite dev server proxies
 * to the local FastAPI process. In production it must be the absolute URL of
 * the deployed API, supplied at build time as VITE_API_URL — Vite inlines it
 * into the bundle, so it cannot be changed after the build.
 *
 * The value is normalised so the common ways of writing it all work:
 *
 *   https://api.example.com        -> https://api.example.com/api
 *   https://api.example.com/api    -> https://api.example.com/api
 *   https://api.example.com/api/   -> https://api.example.com/api
 *
 * Without this, a trailing slash produced `//index/explain` and omitting the
 * suffix produced requests to `/index/explain`, while adding it twice produced
 * `/api/api/index/explain`.
 */
export function resolveApiBase(configured?: string): string {
  const raw = (configured ?? '').trim().replace(/\/+$/, '')
  if (!raw) return '/api'
  return raw.endsWith('/api') ? raw : `${raw}/api`
}

const BASE = resolveApiBase(import.meta.env.VITE_API_URL)

/**
 * Shared secret for the endpoints that destroy data (document delete, index
 * reset, demo seed). It is entered by the operator under Settings and kept in
 * localStorage — it is never baked into the bundle, so a visitor who has not
 * been given the token simply cannot reach those endpoints.
 */
const ADMIN_TOKEN_KEY = 'swiftsearch-admin-token'

export function getAdminToken(): string {
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAdminToken(token: string): void {
  try {
    const trimmed = token.trim()
    if (trimmed) window.localStorage.setItem(ADMIN_TOKEN_KEY, trimmed)
    else window.localStorage.removeItem(ADMIN_TOKEN_KEY)
  } catch {
    /* storage unavailable — the header is simply omitted */
  }
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Delays before re-attempting a request that never reached the server.
 *
 * Free hosting tiers (Render, Fly, Railway) suspend an idle instance and only
 * start it again when a request arrives. That cold start takes far longer than
 * the browser will wait, so the first call after a quiet period always fails
 * even though nothing is wrong. Retrying across ~35s covers a typical wake-up;
 * a backend that is genuinely down still fails, just a little later.
 */
const WAKE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 18_000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Whether a failed attempt can be safely repeated.
 *
 * Only requests that never reached the server are retried, and only when the
 * method carries no side effect — replaying an upload or an index start could
 * duplicate work the server may in fact have received.
 */
function isReplayable(init?: RequestInit): boolean {
  const method = (init?.method ?? 'GET').toUpperCase()
  return method === 'GET' || method === 'HEAD'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken()
  const headers: Record<string, string> = {}
  if (!(init?.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (token) headers['X-Admin-Token'] = token

  const send = () =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    })

  let response: Response
  try {
    response = await send()
  } catch (firstError) {
    // fetch() rejects with an opaque TypeError for every network-level
    // failure, and the browser deliberately withholds the reason. Two causes
    // dominate: the instance is asleep and still starting, or the response
    // lacked an Access-Control-Allow-Origin header and the browser discarded
    // it. Retry first — a sleeping backend answers once it is awake.
    let recovered: Response | null = null
    if (isReplayable(init)) {
      for (const delay of WAKE_RETRY_DELAYS_MS) {
        await sleep(delay)
        try {
          recovered = await send()
          break
        } catch {
          /* still waking, or genuinely unreachable — keep trying */
        }
      }
    }

    if (!recovered) {
      const crossOrigin = BASE.startsWith('http') && !BASE.startsWith(window.location.origin)
      throw new ApiError(
        crossOrigin
          ? `Could not reach the API at ${BASE}. On free hosting the server sleeps when idle ` +
            'and can take up to a minute to wake — if it was idle, wait a moment and retry. ' +
            `Otherwise it is down, or it is not allowing requests from ${window.location.origin} ` +
            '(add that origin to CORS_ORIGINS on the backend; the browser console shows a CORS ' +
            'error when that is the cause).'
          : 'Cannot reach the SwiftSearch backend. Is it running?',
        0,
      )
    }
    response = recovered
    void firstError
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

  // A misconfigured deployment answers API calls with the SPA's index.html:
  // the static host rewrites unknown paths to it and returns 200, so the
  // request looks successful and only fails inside JSON.parse with
  // "Unexpected token '<'". Diagnose it here instead of leaking that.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    const servedBy = BASE.startsWith('http') ? BASE : `${window.location.origin}${BASE}`
    throw new ApiError(
      `Expected JSON from ${servedBy}${path} but received ${contentType || 'an unknown content type'}. ` +
        'The frontend is pointing at itself rather than the backend — set VITE_API_URL ' +
        'to your API URL (for example https://your-api.onrender.com/api) and redeploy.',
      response.status,
    )
  }

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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/services/api'

/**
 * When VITE_API_URL is missing in a deployed build, requests fall back to a
 * relative /api and the static host answers them with the SPA's index.html at
 * HTTP 200. The old behaviour surfaced this to the user as
 * "Unexpected token '<', "<!doctype "... is not valid JSON".
 */
function respondWithSpaHtml() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('<!doctype html><html><body>SwiftSearch</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  )
}

describe('HTML served in place of JSON', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports the misconfiguration instead of a JSON parse error', async () => {
    respondWithSpaHtml()

    await expect(api.explain()).rejects.toThrowError(ApiError)
    await expect(api.explain()).rejects.toThrow(/Expected JSON/)
    await expect(api.explain()).rejects.toThrow(/VITE_API_URL/)
    // The cryptic parser message must not reach the user.
    await expect(api.explain()).rejects.not.toThrow(/Unexpected token/)
  })

  it('names the endpoint that failed', async () => {
    respondWithSpaHtml()
    await expect(api.explain()).rejects.toThrow(/\/api\/index\/explain/)
  })

  it('applies to every endpoint, not just How It Works', async () => {
    respondWithSpaHtml()
    for (const call of [
      () => api.health(),
      () => api.listDocuments(),
      () => api.analytics(),
      () => api.settings(),
      () => api.indexStatus(),
      () => api.term('machine'),
      () => api.search({ query: 'machine learning' }),
    ]) {
      await expect(call()).rejects.toThrow(/Expected JSON/)
    }
  })

  it('still parses genuine JSON responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ steps: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(api.explain()).resolves.toEqual({ steps: [] })
  })

  it('still surfaces real API errors from the backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'No index has been built yet.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(api.search({ query: 'x' })).rejects.toThrow(/No index has been built yet/)
  })
})

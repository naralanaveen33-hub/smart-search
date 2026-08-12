import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '@/services/api'

/**
 * Free hosting tiers suspend an idle instance and only start it when a request
 * arrives. That first request fails at the network level — fetch() rejects with
 * an opaque TypeError — even though the backend is healthy and about to answer.
 *
 * Timers are faked so the retry delays cost no real time; each test advances
 * them manually while the request is in flight.
 */
const networkFailure = () => Promise.reject(new TypeError('Failed to fetch'))

const jsonOk = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/** Let the retry loop run to completion without waiting for wall-clock time. */
async function drainRetries() {
  for (let i = 0; i < 8; i += 1) {
    await vi.runAllTimersAsync()
  }
}

describe('cold start on a sleeping backend', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('recovers when the instance wakes on a later attempt', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(networkFailure)
      .mockImplementationOnce(networkFailure)
      .mockImplementation(() => jsonOk({ documents: [], total: 0 }))

    const pending = api.listDocuments()
    await drainRetries()

    await expect(pending).resolves.toEqual({ documents: [], total: 0 })
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(2)
  })

  it('gives up with a message naming both causes when it never wakes', async () => {
    // The wording under test is the deployed one, which only applies when the
    // API lives on another origin. Tests otherwise run with VITE_API_URL unset,
    // so the module is reloaded with a cross-origin base for this case.
    vi.stubEnv('VITE_API_URL', 'https://swiftsearch-api.example.com/api')
    vi.resetModules()
    const { api: deployedApi } = await import('@/services/api')

    vi.spyOn(globalThis, 'fetch').mockImplementation(networkFailure)

    const pending = deployedApi.listDocuments()
    const assertion = expect(pending).rejects.toThrow(/sleeps when idle/)
    await drainRetries()
    await assertion

    await expect(pending).rejects.toThrow(/CORS_ORIGINS/)
    await expect(pending).rejects.toThrow(/https:\/\/swiftsearch-api\.example\.com\/api/)

    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('never replays a request that could duplicate server-side work', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(networkFailure)

    const pending = api.startIndex({})
    const assertion = expect(pending).rejects.toThrowError(ApiError)
    await drainRetries()
    await assertion

    // A POST that may have reached the server is attempted exactly once.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the server answers, even with an error status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'No index has been built yet.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const pending = api.indexStatus()
    const assertion = expect(pending).rejects.toThrow(/No index has been built yet/)
    await drainRetries()
    await assertion

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

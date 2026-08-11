import { useCallback, useEffect, useRef, useState } from 'react'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** Fetch-on-mount with a manual reload, guarding against stale responses. */
export function useAsync<T>(factory: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const requestId = useRef(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(factory, deps)

  useEffect(() => {
    const id = ++requestId.current
    let cancelled = false
    setLoading(true)
    run()
      .then((result) => {
        if (cancelled || id !== requestId.current) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled || id !== requestId.current) return
        setError(err instanceof Error ? err.message : 'Something went wrong')
      })
      .finally(() => {
        if (!cancelled && id === requestId.current) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [run, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload }
}

/** Debounce a rapidly-changing value (search-as-you-type inputs). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** True when the user has asked the OS to reduce motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])
  return reduced
}

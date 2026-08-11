import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// jsdom implements neither of these, and both are used by the app shell.
class MockEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
vi.stubGlobal('EventSource', MockEventSource)

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
})

// Some jsdom builds omit localStorage; the theme hook depends on it.
if (!('localStorage' in window) || !window.localStorage) {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      },
    },
  })
}

window.scrollTo = vi.fn()
Element.prototype.scrollIntoView = vi.fn()

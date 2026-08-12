import { describe, expect, it } from 'vitest'
import { resolveApiBase } from '@/services/api'

describe('resolveApiBase', () => {
  it('falls back to the dev proxy path when unset', () => {
    expect(resolveApiBase(undefined)).toBe('/api')
    expect(resolveApiBase('')).toBe('/api')
    expect(resolveApiBase('   ')).toBe('/api')
  })

  it('appends /api when the deployment URL omits it', () => {
    expect(resolveApiBase('https://swiftsearch-api.onrender.com')).toBe(
      'https://swiftsearch-api.onrender.com/api',
    )
  })

  it('does not duplicate /api when it is already present', () => {
    expect(resolveApiBase('https://swiftsearch-api.onrender.com/api')).toBe(
      'https://swiftsearch-api.onrender.com/api',
    )
  })

  it('strips trailing slashes so paths never double up', () => {
    expect(resolveApiBase('https://swiftsearch-api.onrender.com/api/')).toBe(
      'https://swiftsearch-api.onrender.com/api',
    )
    expect(resolveApiBase('https://swiftsearch-api.onrender.com///')).toBe(
      'https://swiftsearch-api.onrender.com/api',
    )
  })

  it('never produces a doubled or empty path segment', () => {
    const inputs = [
      'https://x.onrender.com',
      'https://x.onrender.com/',
      'https://x.onrender.com/api',
      'https://x.onrender.com/api/',
      '  https://x.onrender.com/api  ',
    ]
    for (const input of inputs) {
      const url = `${resolveApiBase(input)}/index/explain`
      expect(url).toBe('https://x.onrender.com/api/index/explain')
      expect(url).not.toContain('/api/api')
      expect(url).not.toContain('//index')
    }
  })
})

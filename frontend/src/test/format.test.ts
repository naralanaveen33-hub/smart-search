import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDuration,
  formatNumber,
  formatSeconds,
  highlightParts,
} from '@/utils/format'

describe('formatBytes', () => {
  it('scales through the units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB')
  })
})

describe('formatDuration', () => {
  it('renders mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(84)).toBe('01:24')
    expect(formatDuration(3600)).toBe('60:00')
  })
})

describe('formatSeconds', () => {
  it('switches to milliseconds below one second', () => {
    expect(formatSeconds(0.012)).toBe('12 ms')
    expect(formatSeconds(1.5)).toBe('1.50 s')
  })
})

describe('formatNumber', () => {
  it('groups thousands and tolerates nullish input', () => {
    expect(formatNumber(68920)).toBe('68,920')
    expect(formatNumber(null)).toBe('0')
  })
})

describe('highlightParts', () => {
  it('marks whole words that start with a matched term', () => {
    const parts = highlightParts('Machine learning is powerful', ['machine', 'learning'])
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['Machine', 'learning'])
  })

  it('rebuilds the original text exactly', () => {
    const text = 'The inverted index maps terms to documents.'
    expect(highlightParts(text, ['index']).map((p) => p.text).join('')).toBe(text)
  })

  it('returns a single part when there is nothing to highlight', () => {
    expect(highlightParts('nothing here', [])).toEqual([{ text: 'nothing here', match: false }])
  })

  it('does not break on regex metacharacters', () => {
    expect(() => highlightParts('a (b) c', ['(b'])).not.toThrow()
  })
})

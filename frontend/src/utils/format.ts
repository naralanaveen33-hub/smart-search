export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '0'
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

export function formatDuration(seconds: number | undefined | null): string {
  const total = Math.max(0, Math.floor(seconds ?? 0))
  const minutes = Math.floor(total / 60)
  const remainder = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export function formatSeconds(seconds: number | undefined | null): string {
  if (!seconds) return '0 ms'
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`
  return `${seconds.toFixed(2)} s`
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Split text so matched terms can be wrapped in <mark> without dangerouslySetInnerHTML. */
export function highlightParts(text: string, terms: string[]): { text: string; match: boolean }[] {
  const cleaned = terms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!cleaned.length) return [{ text, match: false }]
  const pattern = new RegExp(`\\b(${cleaned.join('|')})\\w*`, 'gi')
  const parts: { text: string; match: boolean }[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false })
    parts.push({ text: match[0], match: true })
    cursor = start + match[0].length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false })
  return parts
}

export function classNames(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

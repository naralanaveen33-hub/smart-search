import { useEffect, useMemo, useState } from 'react'
import { Check, Info, Moon, Sun } from 'lucide-react'
import { Banner, Button, Card, Input, SectionTitle, Select, Toggle } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/services/api'
import type { AppSettings } from '@/types'
import { classNames } from '@/utils/format'

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const { data, loading, error, reload } = useAsync(() => api.settings(), [])
  const { data: languages } = useAsync(() => api.languages(), [])
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (data) setDraft(data)
  }, [data])

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
    setSaved(false)
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      await api.updateSettings(draft)
      setSaved(true)
      reload()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  const dirty = Boolean(draft && data && JSON.stringify(draft) !== JSON.stringify(data))

  // How the memory budget translates into a block-size ceiling. Mirrors the
  // backend's BYTES_PER_POSTING estimate so the hint updates as you type.
  const BYTES_PER_POSTING = 120
  const budget = useMemo(() => {
    const maxPostings = draft
      ? Math.floor((draft.max_memory_mb * 1024 * 1024) / BYTES_PER_POSTING)
      : 0
    const effective = draft ? Math.max(1, Math.min(draft.block_size, maxPostings)) : 0
    return { maxPostings, effective, capped: Boolean(draft && effective < draft.block_size) }
  }, [draft])

  // Tokenization settings only take effect on the next build.
  const needsReindex = Boolean(
    draft &&
      data &&
      (draft.use_stemming !== data.use_stemming ||
        draft.use_stop_words !== data.use_stop_words ||
        draft.case_sensitive !== data.case_sensitive),
  )

  return (
    <div className="max-w-2xl space-y-6">
      <SectionTitle
        eyebrow="Configuration"
        title="Settings"
        description="Indexing and search behaviour. Changes to indexing settings apply on the next build."
      />

      {error && <Banner tone="error">{error}</Banner>}
      {saveError && <Banner tone="error">{saveError}</Banner>}
      {loading && !draft && <Card className="h-40 animate-pulse" />}

      {/* Appearance */}
      <Card>
        <h2 className="text-[13px] font-semibold">Appearance</h2>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px]">Theme</p>
            <p className="mt-0.5 text-[12px] text-muted">Applied instantly and remembered.</p>
          </div>
          <div className="flex rounded-[6px] border border-line p-0.5">
            {(['light', 'dark'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTheme(option)}
                className={classNames(
                  'flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[12px] capitalize transition-colors',
                  theme === option ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink',
                )}
              >
                {option === 'light' ? <Sun size={12} /> : <Moon size={12} />}
                {option}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {draft && (
        <>
          <Card>
            <h2 className="text-[13px] font-semibold">Indexing</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Block size is the number of postings held in memory before a block is flushed to disk —
              the core BSBI parameter.
            </p>
            <div className="mt-4 space-y-3.5">
              <Field label="Block Size (in memory)" hint="postings per block">
                <Input
                  type="number"
                  min={10}
                  max={1000000}
                  value={draft.block_size}
                  onChange={(e) => update('block_size', Number(e.target.value))}
                  className="w-40"
                />
              </Field>
              <Field
                label="Maximum Memory"
                hint={`MB — caps the block at ~${budget.maxPostings.toLocaleString()} postings`}
              >
                <Input
                  type="number"
                  min={1}
                  max={8192}
                  value={draft.max_memory_mb}
                  onChange={(e) => update('max_memory_mb', Number(e.target.value))}
                  className="w-40"
                />
              </Field>
              {budget.capped && (
                <Banner tone="warn">
                  The memory budget caps the block at{' '}
                  <strong>{budget.effective.toLocaleString()}</strong> postings, below the requested{' '}
                  {draft.block_size.toLocaleString()}. Indexing will produce more, smaller blocks.
                </Banner>
              )}
              <Field
                label="Language"
                hint={languages?.note ?? 'Only English is supported'}
              >
                <span className="inline-flex h-9 items-center rounded-[6px] border border-line bg-surface-2 px-3 text-[13px] text-muted">
                  English
                </span>
              </Field>
              <Field label="Stop Words" hint="remove very common words">
                <Toggle
                  label="Stop words"
                  checked={draft.use_stop_words}
                  onChange={(v) => update('use_stop_words', v)}
                />
              </Field>
              <Field label="Stemming" hint="Porter stemmer">
                <Toggle
                  label="Stemming"
                  checked={draft.use_stemming}
                  onChange={(v) => update('use_stemming', v)}
                />
              </Field>
              <Field label="Animation Pacing" hint="seconds between pipeline steps">
                <Input
                  type="number"
                  step={0.02}
                  min={0}
                  max={2}
                  value={draft.step_delay}
                  onChange={(e) => update('step_delay', Number(e.target.value))}
                  className="w-40"
                />
              </Field>
            </div>
          </Card>

          <Card>
            <h2 className="text-[13px] font-semibold">Search</h2>
            <div className="mt-4 space-y-3.5">
              <Field label="BM25 Ranking" hint="disable to rank by match count only">
                <Toggle
                  label="BM25"
                  checked={draft.bm25_enabled}
                  onChange={(v) => update('bm25_enabled', v)}
                />
              </Field>
              <Field label="Case Sensitive">
                <Toggle
                  label="Case sensitive"
                  checked={draft.case_sensitive}
                  onChange={(v) => update('case_sensitive', v)}
                />
              </Field>
              <Field label="Phrase Search">
                <Toggle
                  label="Phrase search"
                  checked={draft.phrase_search}
                  onChange={(v) => update('phrase_search', v)}
                />
              </Field>
              <Field label="Highlight Results">
                <Toggle
                  label="Highlight results"
                  checked={draft.highlight_results}
                  onChange={(v) => update('highlight_results', v)}
                />
              </Field>
              <Field label="Results Per Page">
                <Select
                  value={draft.results_per_page}
                  onChange={(e) => update('results_per_page', Number(e.target.value))}
                  className="w-40"
                >
                  {[10, 20, 25, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <div className="sticky bottom-4 flex items-center justify-end gap-3">
            {needsReindex && (
              <span className="flex items-center gap-1.5 text-[12px] text-[var(--warning)]">
                <Info size={13} />
                Rebuild the index for tokenization changes to apply
              </span>
            )}
            {saved && !dirty && (
              <span className="flex items-center gap-1.5 text-[12px] text-[var(--success)]">
                <Check size={13} />
                Saved
              </span>
            )}
            <Button onClick={() => setDraft(data)} disabled={!dirty || saving}>
              Discard
            </Button>
            <Button variant="primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-3.5 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13px]">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-subtle">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

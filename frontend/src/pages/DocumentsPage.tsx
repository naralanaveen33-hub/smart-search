import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, FileText, Layers, Trash2, Upload, X } from 'lucide-react'
import { Banner, Button, Card, EmptyState, SectionTitle } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { useIndexing } from '@/hooks/useIndexing'
import { api } from '@/services/api'
import { classNames, formatBytes, formatRelativeTime } from '@/utils/format'

const ACCEPT = '.txt,.pdf,.docx,.md'

interface Pending {
  file: File
  status: 'ready' | 'uploading' | 'done' | 'error'
  message?: string
}

export function DocumentsPage() {
  const navigate = useNavigate()
  const { start, status } = useIndexing()
  const { data, loading, error: loadError, reload } = useAsync(() => api.listDocuments(), [])
  const [pending, setPending] = useState<Pending[]>([])
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).filter((file) =>
      ACCEPT.split(',').some((ext) => file.name.toLowerCase().endsWith(ext)),
    )
    const rejected = Array.from(files).length - incoming.length
    if (rejected > 0) {
      setNotice({ tone: 'error', text: `${rejected} file(s) skipped — only TXT, PDF, DOCX and MD are supported.` })
    }
    setPending((current) => [
      ...current,
      ...incoming.map((file) => ({ file, status: 'ready' as const })),
    ])
  }, [])

  const upload = useCallback(async () => {
    const files = pending.filter((p) => p.status === 'ready').map((p) => p.file)
    if (!files.length) return
    setBusy(true)
    setPending((current) =>
      current.map((p) => (p.status === 'ready' ? { ...p, status: 'uploading' as const } : p)),
    )
    try {
      const result = await api.uploadDocuments(files)
      const skipped = new Map(result.skipped.map((s) => [s.file_name, s.reason]))
      setPending((current) =>
        current.map((p) =>
          skipped.has(p.file.name)
            ? { ...p, status: 'error' as const, message: skipped.get(p.file.name) }
            : { ...p, status: 'done' as const },
        ),
      )
      setNotice({ tone: 'info', text: `${result.uploaded.length} document(s) added.` })
      reload()
    } catch (err) {
      setPending((current) =>
        current.map((p) => (p.status === 'uploading' ? { ...p, status: 'error' as const } : p)),
      )
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Upload failed' })
    } finally {
      setBusy(false)
    }
  }, [pending, reload])

  const startIndexing = useCallback(async () => {
    setBusy(true)
    try {
      await start()
      navigate('/indexing')
    } catch {
      setNotice({ tone: 'error', text: 'Could not start indexing.' })
    } finally {
      setBusy(false)
    }
  }, [start, navigate])

  const documents = data?.documents ?? []
  const readyCount = pending.filter((p) => p.status === 'ready').length

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Corpus"
        title="Upload Documents"
        description="Add documents to build your search index. Supported formats: TXT, PDF, DOCX and MD."
      />

      {loadError && (
        <Banner tone="error">
          Could not load the corpus — {loadError}. The documents below may be incomplete;
          nothing has been deleted.
        </Banner>
      )}
      {notice && <Banner tone={notice.tone === 'error' ? 'error' : 'info'}>{notice.text}</Banner>}

      {/* Drop zone — the whole box is the click target, not just the link inside it. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Add documents: drop files here or press Enter to browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          // Moving between children fires dragleave; only clear on a real exit.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          addFiles(event.dataTransfer.files)
        }}
        className={classNames(
          'cursor-pointer rounded-[8px] border border-dashed p-10 text-center transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
          dragging ? 'border-[var(--accent)] bg-accent-soft' : 'border-line-strong bg-surface hover:border-line-strong hover:bg-surface-2',
        )}
      >
        <Upload size={20} className="mx-auto text-subtle" strokeWidth={1.6} />
        <p className="mt-3 text-[14px] font-medium">Drag &amp; drop your files here</p>
        <p className="mt-1 text-[12px] text-muted">or</p>
        <p className="mt-1 text-[13px] font-medium text-accent underline underline-offset-2">
          click to browse
        </p>
        <p className="mt-3 font-mono text-[11px] text-subtle">Supports .txt · .pdf · .docx · .md</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          // The input sits inside the clickable zone; without this its own click
          // bubbles back into the zone's onClick and re-opens the picker.
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {/* Selected files */}
      <AnimatePresence>
        {pending.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card padded={false}>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-[13px] font-semibold">Selected files</h2>
                <button
                  type="button"
                  onClick={() => setPending([])}
                  className="text-[12px] text-muted hover:text-ink"
                >
                  Clear
                </button>
              </div>
              <ul>
                {pending.map((item, index) => (
                  <li
                    key={`${item.file.name}-${index}`}
                    className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0"
                  >
                    <FileText size={14} className="shrink-0 text-subtle" />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{item.file.name}</span>
                    <span className="tabular shrink-0 font-mono text-[11px] text-muted">
                      {formatBytes(item.file.size)}
                    </span>
                    <StatusPill status={item.status} message={item.message} />
                    <button
                      type="button"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => setPending((c) => c.filter((_, i) => i !== index))}
                      className="shrink-0 text-subtle hover:text-ink"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2 px-4 py-3">
                <Button variant="primary" onClick={upload} disabled={!readyCount || busy}>
                  Upload {readyCount > 0 ? `${readyCount} file${readyCount > 1 ? 's' : ''}` : ''}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Corpus */}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold">Corpus</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {documents.length} document{documents.length === 1 ? '' : 's'} ·{' '}
              {documents.filter((d) => d.indexed).length} indexed
            </p>
          </div>
          <Button
            variant="primary"
            icon={<Layers size={14} />}
            onClick={startIndexing}
            disabled={!documents.length || busy || status?.state === 'running'}
          >
            {status?.state === 'running' ? 'Indexing…' : 'Start Indexing'}
          </Button>
        </div>

        {loading ? (
          <div className="p-4">
            {[0, 1, 2].map((n) => (
              <div key={n} className="mb-2 h-10 animate-pulse rounded-[6px] bg-surface-2" />
            ))}
          </div>
        ) : loadError ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="Corpus unavailable"
            description="The backend could not be reached, so the document list could not be loaded. Your documents are safe."
            action={<Button onClick={reload}>Try again</Button>}
          />
        ) : documents.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="No documents yet"
            description="Upload a file above, or restore the bundled demo corpus."
            action={
              <Button
                onClick={async () => {
                  try {
                    await api.seedDocuments()
                    reload()
                  } catch (err) {
                    setNotice({
                      tone: 'error',
                      text: err instanceof Error ? err.message : 'Could not load demo documents',
                    })
                  }
                }}
              >
                Load demo documents
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] tracking-wide text-subtle uppercase">
                  <th className="px-4 py-2 font-medium">Document</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">Terms</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] text-accent">{doc.id}</span>
                        <span className="truncate text-[13px]">{doc.title}</span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-subtle">
                        {doc.file_name}
                        {doc.uploaded_at ? ` · ${formatRelativeTime(doc.uploaded_at)}` : ''}
                      </p>
                    </td>
                    <td className="tabular px-4 py-2.5 font-mono text-[11px] text-muted">
                      {formatBytes(doc.size_bytes)}
                    </td>
                    <td className="tabular px-4 py-2.5 font-mono text-[11px] text-muted">
                      {doc.term_count || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={classNames(
                          'inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[11px]',
                          doc.indexed
                            ? 'border-[var(--success)]/35 bg-ok-soft text-[var(--success)]'
                            : 'border-line bg-surface-2 text-muted',
                        )}
                      >
                        {doc.indexed && <Check size={10} />}
                        {doc.indexed ? 'Indexed' : 'Ready'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        aria-label={`Delete ${doc.title}`}
                        onClick={async () => {
                          try {
                            await api.deleteDocument(doc.id)
                            reload()
                          } catch (err) {
                            setNotice({
                              tone: 'error',
                              text: err instanceof Error ? err.message : 'Could not delete document',
                            })
                          }
                        }}
                        className="text-subtle transition-colors hover:text-[var(--danger)]"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function StatusPill({ status, message }: { status: Pending['status']; message?: string }) {
  const config = {
    ready: { label: 'Ready', className: 'border-line bg-surface-2 text-muted' },
    uploading: { label: 'Uploading…', className: 'border-[var(--warning)]/35 bg-warn-soft text-[var(--warning)]' },
    done: { label: 'Uploaded', className: 'border-[var(--success)]/35 bg-ok-soft text-[var(--success)]' },
    error: { label: message ?? 'Failed', className: 'border-[var(--danger)]/35 bg-bad-soft text-[var(--danger)]' },
  }[status]

  return (
    <span
      className={classNames(
        'shrink-0 rounded-[4px] border px-1.5 py-0.5 text-[11px] whitespace-nowrap',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}

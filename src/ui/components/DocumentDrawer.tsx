/**
 * The document drawer: pick a policy, read it, run it.
 *
 * Real publications are listed first and always visible; the ones we wrote sit behind a toggle,
 * because a document we authored must never be mistaken for a published one. Clicking a title
 * opens the actual file, which is what makes the provenance checkable rather than asserted.
 *
 * Running one is the whole pipeline, not a lookup: parse, extract commitments against the six
 * levers, map to Params, then run the engine at the fidelity the shipped fixtures use. That takes
 * about ten seconds and the drawer says what it is doing rather than pretending to be instant.
 */

import { useEffect, useState } from 'react'
import { Glyph } from './Glyph'
import { navigate } from '../lib/router'
import { setRun } from '../lib/store'
import type { Metrics } from '@/contracts/metrics'

interface DocumentEntry {
  id: string
  kind: 'real' | 'generated'
  file: string
  title: string
  publisher: string
  date: string
  pages: number
  note: string
}

interface ExtractResponse {
  document: { filename: string; chars: number; pages: number }
  rows?: Record<string, unknown>[]
  params?: unknown
  rejected?: { text: string; span: string; reason: string }[]
  truncated?: boolean
  charsRead?: number
  error?: string
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(payload?.error ?? `Request failed (${response.status})`)
  return payload
}

export function DocumentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [documents, setDocuments] = useState<DocumentEntry[]>([])
  const [showGenerated, setShowGenerated] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [stage, setStage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (!open || documents.length) return
    fetch('/api/documents')
      .then((r) => r.json())
      .then((d: { documents?: DocumentEntry[] }) => setDocuments(d.documents ?? []))
      .catch(() => setError('Could not load the document list. Is the API running?'))
  }, [open, documents.length])

  // Escape closes, like every other dismissible thing.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /** Shared tail: parameters in, engine run, worlds screen. */
  const runExtracted = async (extracted: ExtractResponse, filename: string, sizeBytes: number) => {
    setRun({
      document: { filename, sizeBytes },
      commitments: (extracted.rows ?? []).map((r, i) => ({ id: `c${i + 1}`, ...r })) as never,
      rejected: extracted.rejected ?? [],
      truncated: extracted.truncated ? { charsRead: extracted.charsRead ?? 0 } : null,
      extracted: true,
    })

    setStage('Running the engine across three worlds')
    setRun({ stage: 'Running the engine across three worlds' })
    const run = await postJson<{ metrics: Metrics }>('/api/run', { params: extracted.params })

    setRun({ liveMetrics: run.metrics, hasRun: true, stage: null })
    setStage(null)
    setBusy(null)
    onClose()
    navigate('/worlds')
  }

  const runCatalogued = async (doc: DocumentEntry) => {
    setBusy(doc.id)
    setError(null)
    try {
      setStage('Reading the document and extracting its commitments')
      setRun({ stage: 'Reading the document and extracting its commitments' })
      const extracted = await postJson<ExtractResponse>(`/api/documents/${doc.id}/extract`)
      await runExtracted(extracted, doc.title, 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
      setStage(null)
      setRun({ stage: null })
    }
  }

  const runDropped = async (file: File) => {
    setBusy('dropped')
    setError(null)
    try {
      setStage('Reading the document and extracting its commitments')
      setRun({ stage: 'Reading the document and extracting its commitments' })
      const bytes = new Uint8Array(await file.arrayBuffer())
      // Chunked: String.fromCharCode(...bytes) blows the call stack on anything board-paper sized.
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      }
      const extracted = await postJson<ExtractResponse>('/api/extract', {
        filename: file.name,
        contentBase64: btoa(binary),
        notes: '',
      })
      await runExtracted(extracted, file.name, file.size)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
      setStage(null)
      setRun({ stage: null })
    }
  }

  const real = documents.filter((d) => d.kind === 'real')
  const generated = documents.filter((d) => d.kind === 'generated')
  const running = busy !== null

  const Row = ({ doc }: { doc: DocumentEntry }) => (
    <li className="doc">
      <div className="row between gap-3">
        <a
          className="doc__title"
          href={`/api/documents/${doc.id}`}
          target="_blank"
          rel="noreferrer"
          title="Open the document in a new tab"
        >
          {doc.title}
          <Glyph name="arrow" size={13} />
        </a>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={running}
          onClick={() => void runCatalogued(doc)}
        >
          {busy === doc.id ? 'Running' : 'Run'}
        </button>
      </div>
      <p className="tiny muted mt-2">
        {doc.publisher} · {doc.date} · {doc.pages} {doc.pages === 1 ? 'page' : 'pages'}
      </p>
      <p className="small mt-2">{doc.note}</p>
    </li>
  )

  return (
    <>
      <div className="drawer__scrim" data-open={open} onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer"
        data-open={open}
        aria-hidden={!open}
        aria-label="Policy documents"
      >
        <div className="drawer__head">
          <h2 className="h3">Documents</h2>
          <button type="button" className="btn btn--ghost" onClick={onClose} aria-label="Close">
            <Glyph name="cross" size={14} />
          </button>
        </div>

        <div className="drawer__body">
          <p className="small muted">
            Running one reads the document, extracts what it commits to, and runs the engine on
            those parameters. It takes about ten seconds, because it is actually running.
          </p>

          {error && <p className="note mt-4">{error}</p>}

          {running && (
            <div className="panel panel--sunk mt-4">
              <div className="panel__body">
                <p className="small">{stage}</p>
                <p className="tiny muted mt-2">
                  Sixty sampled runs across three worlds. This is the same fidelity the published
                  figures use.
                </p>
              </div>
            </div>
          )}

          <h3 className="label mt-6">Published policy</h3>
          <ul className="docs mt-3">
            {real.map((d) => (
              <Row key={d.id} doc={d} />
            ))}
          </ul>

          <div className="toggle mt-5">
            <span className="small">
              Show documents we wrote
              <span className="tiny muted" style={{ display: 'block' }}>
                Test fixtures with known answers. Not real publications.
              </span>
            </span>
            <button
              type="button"
              className="toggle__switch"
              aria-pressed={showGenerated}
              aria-label="Show documents we wrote"
              onClick={() => setShowGenerated((v) => !v)}
            >
              <span className="toggle__knob" />
            </button>
          </div>

          {showGenerated && (
            <ul className="docs mt-3">
              {generated.map((d) => (
                <Row key={d.id} doc={d} />
              ))}
            </ul>
          )}

          <h3 className="label mt-6">Or use your own</h3>
          <label
            className="dropzone mt-3"
            data-over={over}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const file = e.dataTransfer.files[0]
              if (file && !running) void runDropped(file)
            }}
          >
            <input
              type="file"
              className="sr-only"
              accept=".pdf,.docx,.md,.txt"
              disabled={running}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void runDropped(file)
              }}
            />
            <Glyph name="upload" size={20} />
            <p className="small mt-2">Drop a policy document here</p>
            <p className="tiny muted mt-2">PDF, DOCX, Markdown or plain text</p>
          </label>
        </div>
      </aside>
    </>
  )
}

/**
 * Upload. Drop a document, run it.
 *
 * A real policymaker has a document, not a parameter vector. Sliders exist afterwards, as
 * adjustment, never as the way in.
 *
 * The file goes to the API rather than being read here, because extraction needs an OpenAI key
 * and a key shipped to the browser is a key published.
 */

import { useRef, useState } from 'react'
import { Glyph } from '../components/Glyph'
import { navigate } from '../lib/router'
import { setRun, useRun } from '../lib/store'

export function Upload() {
  const run = useRun()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | undefined>()
  const [error, setError] = useState<string | null>(null)
  const doc = run.document

  const accept = (chosen: File | undefined) => {
    if (!chosen) return
    setError(null)
    setFile(chosen)
    setRun({ document: { filename: chosen.name, sizeBytes: chosen.size } })
  }

  const start = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      // Chunked rather than spread: String.fromCharCode(...bytes) blows the call stack on
      // anything larger than a short document, which is most real board papers.
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      }

      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentBase64: btoa(binary),
          notes: run.notes,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error ?? `Extraction failed (${response.status})`)

      // The screen renders `rows`, not raw commitments: rows carry the label, bounds, source tag
      // and citation the parameter panel needs, with the corpus and baseline gaps already filled.
      // The model's own output is deliberately not the render shape — it knows about levers and
      // spans, and nothing about how to present a source tag.
      setRun({
        document: { filename: file.name, sizeBytes: file.size },
        commitments: (payload.rows ?? []).map(
          (r: Record<string, unknown>, i: number) => ({ id: `c${i + 1}`, ...r }),
        ),
        rejected: payload.rejected ?? [],
        truncated: payload.truncated ? { charsRead: payload.charsRead } : null,
        params: payload.params ?? null,
        extracted: true,
      })
      navigate('/parameters')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const takeDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    accept(e.dataTransfer.files?.[0])
  }

  return (
    <section className="page">
      <div className="focal">
        <h1 className="h1">Drop in the policy.</h1>
        <p className="lead mt-4">
          A board paper, a service specification, a strategy. Whatever you already wrote.
        </p>

        <label
          className="dropzone mt-5"
          data-over={over}
          data-loaded={Boolean(doc)}
          // A drop only fires if the default is prevented on BOTH dragenter and dragover; handling
          // only dragover leaves the drop silently refused.
          onDragEnter={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={takeDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.md,.txt"
            className="sr-only"
            onChange={(e) => accept(e.target.files?.[0] ?? undefined)}
          />
          {doc ? (
            <div className="stack gap-2" style={{ alignItems: 'center' }}>
              <span style={{ color: 'var(--blue)' }}>
                <Glyph name="document" size={26} />
              </span>
              <strong>{doc.filename}</strong>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={(e) => {
                  e.preventDefault()
                  setRun({ document: null })
                  if (inputRef.current) inputRef.current.value = ''
                }}
              >
                Choose another
              </button>
            </div>
          ) : (
            <div className="stack gap-2" style={{ alignItems: 'center' }}>
              <span className="muted">
                <Glyph name="upload" size={26} />
              </span>
              <strong>Drop a document, or choose one</strong>
              <div className="formats mt-2">
                {['PDF', 'DOCX', 'MD', 'TXT'].map((f) => (
                  <span className="format" key={f}>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </label>

        <textarea
          className="mt-4"
          aria-label="Anything else we should know? Optional"
          value={run.notes}
          onChange={(e) => setRun({ notes: e.target.value })}
          placeholder="Add any extra information here"
        />

        <button
          type="button"
          className="btn btn--primary btn--lg mt-4"
          onClick={start}
          disabled={!doc || busy}
        >
          {busy ? 'Reading the document…' : 'Run the sandbox'}
          {!busy && <Glyph name="arrow" size={16} />}
        </button>

        {/* Extraction is the one part of this that can fail for a reason the user can act on —
            no key, a scanned PDF, a model timeout. Say which, rather than falling back to a
            fixture and presenting it as a reading of their document. */}
        {error && (
          <p className="note mt-4" role="alert">
            {error}
          </p>
        )}

        {/* What the button is about to do, in the same colours /about uses for the pipeline. */}
        <ol className="next-steps mt-5">
          <li className="next-step next-step--model">
            <span className="next-step__glyph">
              <Glyph name="document" size={13} />
            </span>
            Read the document
          </li>
          <li className="next-step">
            <span className="next-step__glyph">
              <Glyph name="flag" size={13} />
            </span>
            Show you the parameters
          </li>
          <li className="next-step next-step--engine">
            <span className="next-step__glyph">
              <Glyph name="sweep" size={13} />
            </span>
            Run three worlds
          </li>
        </ol>
      </div>
    </section>
  )
}

/**
 * Upload. The entry to the mode, and the first fifteen seconds of the demo.
 *
 * A real policymaker has a document, not a parameter vector. Asking them to know that "shift care
 * to the community" means setting six sliders is the barrier that keeps tools like this unused.
 * Sliders still exist, but afterwards, as adjustment — never as the way in.
 *
 * Nothing here touches the network: the file is read for its name and size only, and extraction
 * is served from the fixture. That is stated on screen rather than implied.
 */

import { useRef, useState } from 'react'
import { Glyph } from '../components/Glyph'
import { navigate } from '../lib/router'
import { setRun, useRun } from '../lib/store'
import { extraction } from '../data'

const ACCEPT = '.pdf,.docx,.md,.txt'

export function Upload() {
  const run = useRun()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [notes, setNotes] = useState(run.notes)
  const [busy, setBusy] = useState(false)

  const accept = (file: File | undefined) => {
    if (!file) return
    setRun({ document: { filename: file.name, sizeBytes: file.size } })
  }

  const start = () => {
    setBusy(true)
    setRun({ notes })
    // A beat, so the extraction step is legible rather than instant-and-invisible.
    window.setTimeout(() => {
      setBusy(false)
      navigate('/parameters')
    }, 650)
  }

  const doc = run.document

  return (
    <section className="section wrap" style={{ borderTop: 0 }}>
      <div className="prose stack gap-4">
        <h1 className="h1">Drop in the policy.</h1>
        <p className="lead">
          A board paper, a service specification, an ICB strategy, a chapter of the plan. Whatever
          you already wrote. It gets read for the operational commitments it contains, and each one
          becomes a parameter you can see and change before anything runs.
        </p>
      </div>

      <div className="mt-6 stack gap-4" style={{ maxWidth: '46rem' }}>
        <label
          className="dropzone"
          data-over={over}
          data-loaded={Boolean(doc)}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            accept(e.dataTransfer.files?.[0])
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => accept(e.target.files?.[0] ?? undefined)}
          />
          {doc ? (
            <div className="stack gap-2" style={{ alignItems: 'center' }}>
              <span style={{ color: 'var(--blue)' }}>
                <Glyph name="document" size={28} />
              </span>
              <strong>{doc.filename}</strong>
              <span className="tiny muted num">{(doc.sizeBytes / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={(e) => {
                  e.preventDefault()
                  setRun({ document: null })
                  if (inputRef.current) inputRef.current.value = ''
                }}
              >
                Choose a different file
              </button>
            </div>
          ) : (
            <div className="stack gap-2" style={{ alignItems: 'center' }}>
              <span className="muted">
                <Glyph name="upload" size={28} />
              </span>
              <strong>Drop a document, or choose one</strong>
              <span className="tiny muted">PDF, DOCX, MD or TXT</span>
            </div>
          )}
        </label>

        <div className="stack gap-2">
          <label className="label" htmlFor="notes">
            Anything else we should know? Optional
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Assume no extra headcount. We only care about the over-65s. This rolls out in January."
          />
          <p className="tiny muted">
            Constraints that are never written in the document. Passed to extraction as context,
            never as a parameter override on its own.
          </p>
        </div>

        <div className="row between">
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={start}
            disabled={!doc || busy}
          >
            {busy ? 'Reading the document…' : 'Run the sandbox'}
            {!busy && <Glyph name="arrow" size={16} />}
          </button>
          {!doc && <p className="tiny muted">Choose a document to continue.</p>}
        </div>

        <p className="tiny muted mt-2">
          Extraction is served from a cached run of{' '}
          <span className="num">{extraction.document.filename}</span> for this build. The gesture is
          real, the inference is not live, and it is said here rather than discovered later.
        </p>
      </div>
    </section>
  )
}

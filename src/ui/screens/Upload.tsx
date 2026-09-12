/**
 * Upload. Drop a document, run it.
 *
 * A real policymaker has a document, not a parameter vector. Sliders exist afterwards, as
 * adjustment, never as the way in. Nothing here touches the network.
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
  const doc = run.document

  const accept = (file: File | undefined) => {
    if (!file) return
    setRun({ document: { filename: file.name, sizeBytes: file.size } })
  }

  const start = () => {
    setBusy(true)
    window.setTimeout(() => {
      setBusy(false)
      navigate('/parameters')
    }, 600)
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
          placeholder="Anything else we should know? Optional."
        />

        <button
          type="button"
          className="btn btn--primary btn--lg mt-4"
          onClick={start}
          disabled={!doc || busy}
        >
          {busy ? 'Reading…' : 'Run the sandbox'}
          {!busy && <Glyph name="arrow" size={16} />}
        </button>

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

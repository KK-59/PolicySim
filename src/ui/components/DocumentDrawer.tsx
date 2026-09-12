/**
 * The document shelf.
 *
 * A catalogue, not a control panel. Nothing here runs anything: you drag a document onto the
 * drop zone the way you would drag in your own, and the pipeline treats it identically. A "run"
 * button beside a shipped document would make a real result look like a canned one, which is the
 * opposite of what this project is trying to demonstrate.
 *
 * Real publications and the ones we wrote are two separate shelves rather than one list with a
 * badge, because a document we authored must never be mistaken for a published one.
 */

import { useEffect, useState } from 'react'
import { Glyph } from './Glyph'

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

type Shelf = 'real' | 'generated'

export function DocumentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [documents, setDocuments] = useState<DocumentEntry[]>([])
  const [shelf, setShelf] = useState<Shelf>('real')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || documents.length) return
    fetch('/api/documents')
      .then((r) => r.json())
      .then((d: { documents?: DocumentEntry[] }) => setDocuments(d.documents ?? []))
      .catch(() => setError('Could not load the documents. Is the API running?'))
  }, [open, documents.length])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const shown = documents.filter((d) => d.kind === shelf)

  return (
    <>
      <div className="drawer__scrim" data-open={open} onClick={onClose} aria-hidden="true" />
      <aside className="drawer" data-open={open} aria-hidden={!open} aria-label="Policy documents">
        <div className="drawer__head">
          <h2 className="h3">Documents</h2>
          <button type="button" className="btn btn--ghost" onClick={onClose} aria-label="Close">
            <Glyph name="cross" size={14} />
          </button>
        </div>

        <div className="shelfswitch" role="group" aria-label="Which documents to show">
          <button
            type="button"
            className="shelfswitch__tab"
            aria-pressed={shelf === 'real'}
            onClick={() => setShelf('real')}
          >
            Real published policies
          </button>
          <button
            type="button"
            className="shelfswitch__tab"
            aria-pressed={shelf === 'generated'}
            onClick={() => setShelf('generated')}
          >
            Generated policies
          </button>
        </div>

        <div className="drawer__body">
          <p className="small muted">
            {shelf === 'real'
              ? 'Published by NHS England and the Department of Health and Social Care. Open one to read it.'
              : 'Written by us as test fixtures. We know what each one should extract to, which is how we check the reading is right rather than merely plausible.'}
          </p>

          {error && <p className="note mt-4">{error}</p>}

          <ul className="shelf mt-4">
            {shown.map((doc) => (
              <li
                key={doc.id}
                className="card"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/x-policysim-document',
                    `${doc.id}|${doc.title}`,
                  )
                  e.dataTransfer.effectAllowed = 'copy'
                }}
              >
                <span className="card__grip" aria-hidden="true">
                  <Glyph name="document" size={18} />
                </span>
                <div className="card__body">
                  <a
                    className="card__title"
                    href={`/api/documents/${doc.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {doc.title}
                  </a>
                  <p className="tiny muted mt-2">
                    {doc.publisher} &middot; {doc.date} &middot; {doc.pages}{' '}
                    {doc.pages === 1 ? 'page' : 'pages'}
                  </p>
                  <p className="small mt-2">{doc.note}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="tiny muted mt-5">
            Drag one onto the drop zone to read and run it. Clicking the title opens the document
            itself.
          </p>
        </div>
      </aside>
    </>
  )
}

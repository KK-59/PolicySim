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
import { setRun } from '../lib/store'

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
  // The shelf sits on top of the page, so while a card is in flight it has to get out of the
  // way: the drop zone is underneath it and an overlay cannot be dropped through.
  const [dragging, setDragging] = useState(false)

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
    // Close on an outside click from the document rather than from a scrim element. A full-screen
    // scrim would sit over the drop zone and intercept every drag, which is exactly what it did.
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest('.drawer') && !target?.closest('.docs-trigger')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open, onClose])

  const shown = documents.filter((d) => d.kind === shelf)

  return (
    <>
      <div
        className="drawer__scrim"
        data-open={open}
        data-dragging={dragging}
        aria-hidden="true"
      />
      <aside
        className="drawer"
        data-open={open}
        data-dragging={dragging}
        aria-hidden={!open}
        aria-label="Policy documents"
      >
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
            data-kind="real"
            aria-pressed={shelf === 'real'}
            onClick={() => setShelf('real')}
          >
            Real published policies
          </button>
          <button
            type="button"
            className="shelfswitch__tab"
            data-kind="generated"
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
                className={`card card--${doc.kind}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    'application/x-policysim-document',
                    `${doc.id}|${doc.title}`,
                  )
                  e.dataTransfer.effectAllowed = 'copy'
                  setDragging(true)
                  setRun({ draggingDoc: true })
                  // Out of the way immediately. A drag already in flight survives its source
                  // being unmounted, so closing here costs nothing and clears the whole screen.
                  onClose()
                }}
                onDragEnd={() => {
                  setDragging(false)
                  setRun({ draggingDoc: false })
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
                    // A browser drags an anchor as a link by default, and that link drag wins
                    // over the card's. Grabbing the title then produced a URL drop the drop zone
                    // could not read. The card still drags; the title still opens the document.
                    draggable={false}
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

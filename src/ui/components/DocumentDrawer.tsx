/**
 * The document shelf, and the card you pull off it.
 *
 * The drag is pointer-driven, not HTML5 drag-and-drop. Native DnD kept dying here for reasons
 * that were all real and all different: an anchor drags as a link and pre-empts its own card, a
 * full-screen scrim silently eats the drop, and Chrome cancels a drag outright when the source's
 * ancestor is hidden or made `pointer-events: none` mid-gesture, which is exactly what closing
 * the shelf did. Following the pointer ourselves has none of those failure modes: the card is a
 * fixed-position element that tracks the cursor, and releasing anywhere is a drop.
 *
 * Nothing here runs anything on its own. A card is a document; dropping it is the same act as
 * dropping a file you brought yourself.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
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

interface Flying {
  doc: DocumentEntry
  x: number
  y: number
  dx: number
  dy: number
}

/** Below this the gesture is a click, not a drag, so the title link still works. */
const DRAG_THRESHOLD = 6

export function DocumentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [documents, setDocuments] = useState<DocumentEntry[]>([])
  const [shelf, setShelf] = useState<Shelf>('real')
  const [error, setError] = useState<string | null>(null)
  const [flying, setFlying] = useState<Flying | null>(null)
  const armed = useRef<{ doc: DocumentEntry; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!open || documents.length) return
    fetch('/api/documents')
      .then((r) => r.json())
      .then((d: { documents?: DocumentEntry[] }) => setDocuments(d.documents ?? []))
      .catch(() => setError('Could not load the documents. Is the API running?'))
  }, [open, documents.length])

  useEffect(() => {
    if (!open || flying) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
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
  }, [open, flying, onClose])

  // Dropping LOADS the document; it does not read it. The user presses the same button they
  // would press for a file of their own, and nothing happens behind their back.
  const drop = useCallback(
    (doc: DocumentEntry) => {
      setFlying(null)
      onClose()
      setRun({
        pendingDoc: { id: doc.id, title: doc.title },
        document: { filename: doc.title, sizeBytes: 0 },
      })
    },
    [onClose],
  )

  // The gesture. Move past the threshold and the card lifts off the shelf and follows the cursor;
  // release anywhere at all and it is dropped.
  useEffect(() => {
    if (!open) return

    const onMove = (e: PointerEvent) => {
      const start = armed.current
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!flying && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      e.preventDefault()
      setFlying((prev) =>
        prev
          ? { ...prev, x: e.clientX, y: e.clientY }
          : { doc: start.doc, x: e.clientX, y: e.clientY, dx: -110, dy: -28 },
      )
    }

    const onUp = () => {
      const start = armed.current
      armed.current = null
      if (flying && start) drop(start.doc)
      else setFlying(null)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      armed.current = null
      setFlying(null)
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, flying, drop])

  const shown = documents.filter((d) => d.kind === shelf)

  return (
    <>
      <div className="drawer__scrim" data-open={open} aria-hidden="true" />

      <aside
        className="drawer"
        data-open={open}
        data-dragging={flying !== null}
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
                data-lifted={flying?.doc.id === doc.id}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  armed.current = { doc, x: e.clientX, y: e.clientY }
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
                    draggable={false}
                    onClick={(e) => {
                      // A drag that happened to start on the title must not also open the file.
                      if (flying) e.preventDefault()
                    }}
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
            Drag one out and let go anywhere to load it. Clicking the title opens the document
            itself.
          </p>
        </div>
      </aside>

      {/* The card in flight, and the whole page saying it will catch it. */}
      {flying && (
        <>
          <div className="dropveil" aria-hidden="true">
            <div className="dropveil__card">
              <Glyph name="upload" size={26} />
              <strong className="mt-2">Let go anywhere to read this policy</strong>
            </div>
          </div>
          <div
            className={`card card--${flying.doc.kind} card--flying`}
            style={{ left: flying.x + flying.dx, top: flying.y + flying.dy }}
            aria-hidden="true"
          >
            <span className="card__grip">
              <Glyph name="document" size={18} />
            </span>
            <div className="card__body">
              <span className="card__title">{flying.doc.title}</span>
            </div>
          </div>
        </>
      )}
    </>
  )
}

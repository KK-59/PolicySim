/**
 * A forty-line store. The run state has to survive a route change and nothing more, so a context
 * provider and a reducer would be ceremony around one object.
 */

import { useSyncExternalStore } from 'react'
import { extraction, type Commitment } from '../data'
import type { Metrics } from '@/contracts/metrics'

export interface RunState {
  /** Null until a document has been dropped. Guards /parameters and /worlds. */
  document: { filename: string; sizeBytes: number } | null
  notes: string
  /** Commitments as the user has them now: extraction output plus any edits. */
  commitments: Commitment[]
  /** True once the sandbox has been run at least once this session. */
  hasRun: boolean
  /**
   * True once a real document has been read by the API.
   *
   * Until then the commitments on screen are the worked example the store seeds itself with, and
   * the parameters screen says so. One flag rather than inferring it from `document`, because a
   * filename is set the moment a file is chosen and long before anything has been read.
   */
  extracted: boolean
  /** What the model rejected: spans it produced that are not in the document. */
  rejected: { text: string; span: string; reason: string }[]
  /** Set when the document was longer than the model could be sent in one call. */
  truncated: { charsRead: number } | null
  /**
   * Outcomes the engine produced for THIS document, or null while the screen is showing the
   * precomputed baseline. The worlds screen renders whichever it has and says which, because a
   * fixture presented as the user's result is the one thing this project may not do.
   */
  liveMetrics: Metrics | null
  /**
   * The Params the document mapped to, kept so the run can happen where the user asks for it
   * rather than the moment the document is read. Opaque here on purpose: the store does not need
   * to know the shape, only to carry it from the reading to the run.
   */
  params: unknown | null
  /** What the run is doing right now. Null when idle. A real run takes about ten seconds. */
  stage: string | null
  /**
   * A document card is in flight.
   *
   * Dragging out of a fixed overlay onto a small target underneath it is a gesture that has to be
   * aimed, and the overlay is in the way of the aim. While this is true the whole viewport
   * accepts the drop instead, so there is nothing to hit.
   */
  draggingDoc: boolean
}

const initial: RunState = {
  document: null,
  // Empty, not seeded from the fixture. Prefilled text in a box the user is meant to fill in
  // reads as something they typed, and it would be sent to extraction as their context.
  notes: '',
  commitments: extraction.commitments,
  hasRun: false,
  extracted: false,
  rejected: [],
  truncated: null,
  liveMetrics: null,
  params: null,
  stage: null,
  draggingDoc: false,
}

let state: RunState = initial
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function setRun(patch: Partial<RunState>) {
  state = { ...state, ...patch }
  emit()
}

export function setCommitment(id: string, value: number) {
  state = {
    ...state,
    commitments: state.commitments.map((c) => (c.id === id ? { ...c, value } : c)),
  }
  emit()
}

export function resetRun() {
  state = initial
  emit()
}

export function useRun(): RunState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => initial,
  )
}

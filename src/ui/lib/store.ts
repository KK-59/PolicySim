/**
 * A forty-line store. The run state has to survive a route change and nothing more, so a context
 * provider and a reducer would be ceremony around one object.
 */

import { useSyncExternalStore } from 'react'
import { extraction, type Commitment } from '../data'

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
   * Engine output for THIS policy, once it has been run. Null until then, and the worlds screen
   * falls back to the precomputed baseline sweep — which is also the offline path when there is
   * no API to call.
   */
  result: { metrics: unknown; sweep: unknown } | null
  running: boolean
  /**
   * A document taken off the shelf and dropped, waiting to be read.
   *
   * Dropping loads it into the box; it is not read until the user asks for it, exactly as when
   * they choose a file of their own.
   */
  pendingDoc: { id: string; title: string } | null
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
  result: null,
  running: false,
  pendingDoc: null,
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

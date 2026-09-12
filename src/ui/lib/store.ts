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
}

const initial: RunState = {
  document: null,
  notes: extraction.document.notes,
  commitments: extraction.commitments,
  hasRun: false,
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

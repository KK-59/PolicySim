/**
 * Watcher: poll NHS-SIM until it answers, then get out of the way.
 * OWNER: Oriol. PRD §8.2 step 1.
 *
 * This existed for the case where the sim was not up yet. It is up, so this stays deliberately
 * thin: one health probe on an interval, resolving on the first success. The snapshot is the
 * caller's job (scripts/watch.mjs), because a watcher that also pulls is a watcher you cannot
 * reuse for the live loop.
 */

import type { NhsSimClient } from './nhssim-client.ts'

export interface ProbeOptions {
  /** Default 2 minutes, matching the task list. Shorten it when a run is waiting on the result. */
  intervalMs?: number
  /** Default 60, so the default watch gives up after roughly two hours rather than never. */
  maxAttempts?: number
  /** Called before each attempt, for CLI output. Keeps this module free of console noise. */
  onAttempt?: (attempt: number) => void
}

export interface ProbeResult {
  attempts: number
  elapsedMs: number
  /** Whatever /healthz returned, unparsed. */
  body: unknown
}

/**
 * Resolve on the first successful GET /healthz. Rejects only when maxAttempts is exhausted,
 * carrying the last error, because "the sim never came up" is the one outcome worth failing on.
 */
export async function probeUntilUp(
  client: NhsSimClient,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const intervalMs = options.intervalMs ?? 120_000
  const maxAttempts = options.maxAttempts ?? 60
  const started = Date.now()
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options.onAttempt?.(attempt)
    try {
      const body = await client.get<unknown>('/healthz')
      return { attempts: attempt, elapsedMs: Date.now() - started, body }
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts) await sleep(intervalMs)
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`NHS-SIM did not answer /healthz after ${maxAttempts} attempts: ${reason}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

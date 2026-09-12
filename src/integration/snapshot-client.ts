/**
 * Snapshot client: one bulk pull of NHS-SIM to disk, raw.
 * OWNER: Oriol. PRD §4.1. CONSUMED BY: calibration.ts (and nothing else reads the server).
 *
 * Reads are the scarce resource, so this is bulk-only: one request per site via
 * /api/sites/{site}/view, which returns the whole site (counters, resources, population) in a
 * single payload. The one permitted exception is a 20-40 patient cohort for the drill-down.
 *
 * Every response is written untouched, so parsing happens downstream, never in the fetch, and a
 * schema surprise costs a re-parse rather than a re-pull.
 *
 * A partial snapshot is still a useful snapshot: every target runs through Promise.allSettled
 * and failures are recorded in the manifest instead of aborting the run. The manifest is what
 * downstream code trusts, so it is written even when every target failed.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NhsSimClient } from './nhssim-client.ts'
import type { Site } from '../contracts/action.ts'

/** Every site the team key has scope for. Each one costs exactly one read. */
export const SNAPSHOT_SITES: readonly Site[] = [
  'control', 'gp', 'hospital', 'community',
  'pharmacy', 'diagnostics', 'referrals', 'wearables', 'legacy',
]

/** Drill-down cohort size. The task list allows 20-40; anything more is a per-patient read budget we do not have. */
export const COHORT_SIZE = 30

/**
 * Pulled anyway, because a snapshot that quietly skips a site hides a scope change, but their
 * failure is expected: control answers 403 (organiser token only) and legacy 501 (wants a
 * browser session first). Both verified against the live server on 2026-09-12.
 */
const OPERATOR_ONLY_SITES: readonly Site[] = ['control', 'legacy']

/** The wearables endpoints page at 500 max, so one page each is the whole bulk read we get. */
const WEARABLES_PAGE = 500

export interface SnapshotTarget {
  /** Also the file stem: <name>.json inside the snapshot directory. */
  name: string
  path: string
  query?: Record<string, string | number>
  /**
   * Verified live: this target refuses a team key no matter what, so its failure says nothing
   * about the run. Still attempted and still recorded, but it must not make the run look broken.
   */
  optional?: boolean
}

export interface SnapshotFileRecord {
  name: string
  endpoint: string
  /** File name written, or null when the request failed and nothing was written. */
  file: string | null
  outcome: 'ok' | 'failed'
  /** Bytes on disk. 0 for a failure. */
  bytes: number
  durationMs: number
  /** HTTP status where the server gave one; null for a timeout or transport error. */
  status: number | null
  error?: string
}

export interface SnapshotManifest {
  /** Wall-clock ISO of the pull, and the name of the directory it lives in. */
  timestamp: string
  dir: string
  baseUrl: string
  /** Sim clock at pull time, from /api/clock. null when that read failed. */
  now: number | null
  cohortSize: number
  totalBytes: number
  files: SnapshotFileRecord[]
  /** Every target that failed, optional ones included. Empty array means the snapshot is complete. */
  failed: string[]
  /**
   * The subset of `failed` that was never reachable with a team key (control, legacy).
   * Callers judging whether a run went wrong should look at failed minus this.
   */
  expectedFailures: string[]
}

/** True when something actually went wrong, as opposed to a target our key was never allowed to read. */
export function snapshotIsComplete(manifest: SnapshotManifest): boolean {
  return manifest.failed.every((name) => manifest.expectedFailures.includes(name))
}

/**
 * Directory names come from the ISO timestamp with `:` and `.` swapped for `-`.
 * A colon is legal on APFS but breaks on anything that touches these paths from a shell,
 * and these directories get tarred and passed around on demo day.
 */
export function snapshotDirName(at: Date = new Date()): string {
  return at.toISOString().replace(/[:.]/g, '-')
}

export function snapshotTargets(): SnapshotTarget[] {
  return [
    { name: 'clock', path: '/api/clock' },
    { name: 'team', path: '/api/team' },
    { name: 'catalogue', path: '/api/catalogue' },
    { name: 'healthz', path: '/healthz' },
    ...SNAPSHOT_SITES.map((site) => ({
      name: `site-${site}`,
      path: `/api/sites/${site}/view`,
      optional: OPERATOR_ONLY_SITES.includes(site),
    })),
    { name: 'wearables-devices', path: '/api/sites/wearables/devices', query: { limit: WEARABLES_PAGE } },
    { name: 'wearables-readings', path: '/api/sites/wearables/readings', query: { limit: WEARABLES_PAGE } },
    // The one non-bulk read the task list allows, and it is still a single request.
    { name: 'cohort', path: '/api/sites/gp/patients', query: { offset: 0, limit: COHORT_SIZE } },
  ]
}

/**
 * Pull every target into `<outDir>/<timestamp>/` and return the manifest that was written
 * alongside them. Never throws for a failed target; check `manifest.failed`.
 */
export async function snapshotAll(
  client: NhsSimClient,
  outDir = 'snapshot',
  now: Date = new Date(),
): Promise<SnapshotManifest> {
  const timestamp = now.toISOString()
  const dirName = snapshotDirName(now)
  const dir = join(outDir, dirName)
  await mkdir(dir, { recursive: true })

  const targets = snapshotTargets()
  const settled = await Promise.allSettled(targets.map((t) => fetchAndWrite(client, dir, t)))

  const pulled: PulledTarget[] = settled.map((outcome, i) => {
    const target = targets[i]!
    if (outcome.status === 'fulfilled') return outcome.value
    // fetchAndWrite already converts request failures into records, so a rejection here is a
    // disk failure, still recorded rather than thrown, so the rest of the pull survives.
    return {
      record: {
        name: target.name,
        endpoint: target.path,
        file: null,
        outcome: 'failed',
        bytes: 0,
        durationMs: 0,
        status: null,
        error: errorMessage(outcome.reason),
      },
      simNow: null,
    }
  })

  const files = pulled.map((p) => p.record)

  const manifest: SnapshotManifest = {
    timestamp,
    dir,
    baseUrl: client.baseUrl,
    now: simNowOf(pulled),
    cohortSize: COHORT_SIZE,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    files,
    failed: files.filter((f) => f.outcome === 'failed').map((f) => f.name),
    expectedFailures: targets.filter((t) => t.optional).map((t) => t.name),
  }

  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return manifest
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The payloads carry the sim clock, so `now` comes back with the record rather than a re-read of disk. */
interface PulledTarget {
  record: SnapshotFileRecord
  simNow: number | null
}

async function fetchAndWrite(
  client: NhsSimClient,
  dir: string,
  target: SnapshotTarget,
): Promise<PulledTarget> {
  const started = Date.now()
  const base = { name: target.name, endpoint: target.path }
  try {
    const payload = await client.get<unknown>(target.path, target.query)
    const file = `${target.name}.json`
    const body = JSON.stringify(payload)
    await writeFile(join(dir, file), body, 'utf8')
    return {
      record: {
        ...base,
        file,
        outcome: 'ok',
        bytes: Buffer.byteLength(body, 'utf8'),
        durationMs: Date.now() - started,
        status: 200,
      },
      simNow: simNowIn(payload),
    }
  } catch (err) {
    return {
      record: {
        ...base,
        file: null,
        outcome: 'failed',
        bytes: 0,
        durationMs: Date.now() - started,
        status: statusOf(err),
        error: errorMessage(err),
      },
      simNow: null,
    }
  }
}

/** /api/clock is authoritative; a site view's `now` is the fallback when that one read failed. */
function simNowOf(pulled: PulledTarget[]): number | null {
  const clock = pulled.find((p) => p.record.name === 'clock')
  if (clock?.simNow != null) return clock.simNow
  return pulled.find((p) => p.simNow != null)?.simNow ?? null
}

function simNowIn(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as { now?: unknown }).now
  return typeof value === 'number' ? value : null
}

function statusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const status = (err as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

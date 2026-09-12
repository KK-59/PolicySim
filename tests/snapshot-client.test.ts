/**
 * Snapshot client tests. OWNER: Oriol.
 *
 * fetch is mocked in every case. Nothing here touches sim.animahacks.com: reads are the scarce
 * resource, and a test suite that spends them is a test suite nobody runs twice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NhsSimClient, type ClientConfig } from '../src/integration/nhssim-client.ts'
import { COHORT_SIZE, snapshotAll, snapshotDirName, snapshotIsComplete, snapshotTargets, type SnapshotManifest } from '../src/integration/snapshot-client.ts'

const CONFIG: ClientConfig = {
  baseUrl: 'https://sim.test',
  teamKey: 'test-key',
  timeoutMs: 1000,
  // No retries: a failing target should be recorded immediately, not slept over.
  maxRetries: 0,
}

/** Mocked fetch that answers by path, and 500s on any path listed in `fail`. */
function mockFetch(fail: string[] = []): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: URL | string) => {
    const url = new URL(String(input))
    if (fail.some((f) => url.pathname.includes(f))) {
      return new Response(JSON.stringify({ error: 'site_down', message: 'site unavailable' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const body = url.pathname === '/api/clock'
      ? { now: 1789992120000, paused: true, events: [] }
      : { now: 1789992120000, path: url.pathname, items: [] }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

let outDir: string

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'policysim-snapshot-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(outDir, { recursive: true, force: true })
})

async function readManifest(dir: string): Promise<SnapshotManifest> {
  return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as SnapshotManifest
}

describe('snapshotTargets', () => {
  it('is bulk-only apart from the single allowed cohort read', () => {
    const targets = snapshotTargets()
    const perPatient = targets.filter((t) => /\/patients/.test(t.path))
    expect(perPatient).toHaveLength(1)
    expect(perPatient[0]?.query?.limit).toBe(COHORT_SIZE)
    expect(COHORT_SIZE).toBeGreaterThanOrEqual(20)
    expect(COHORT_SIZE).toBeLessThanOrEqual(40)
  })

  it('marks only the sites a team key cannot read as optional', () => {
    const optional = snapshotTargets().filter((t) => t.optional).map((t) => t.name)
    expect(optional).toEqual(['site-control', 'site-legacy'])
  })

  it('covers every site view exactly once', () => {
    const views = snapshotTargets().filter((t) => t.path.endsWith('/view'))
    expect(views).toHaveLength(9)
    expect(new Set(views.map((t) => t.path)).size).toBe(9)
  })
})

describe('snapshotAll', () => {
  it('writes a timestamped directory with one file per target plus the manifest', async () => {
    vi.stubGlobal('fetch', mockFetch())
    const at = new Date('2026-09-12T13:20:00.123Z')

    const manifest = await snapshotAll(new NhsSimClient(CONFIG), outDir, at)

    // Directory name is the ISO timestamp made shell-safe; the manifest keeps the real ISO.
    expect(manifest.dir).toBe(join(outDir, '2026-09-12T13-20-00-123Z'))
    expect(snapshotDirName(at)).toBe('2026-09-12T13-20-00-123Z')
    expect(manifest.timestamp).toBe('2026-09-12T13:20:00.123Z')

    const written = await readdir(manifest.dir)
    expect(written).toContain('manifest.json')
    expect(written).toContain('site-gp.json')
    expect(written).toContain('cohort.json')
    expect(written.sort()).toEqual([...snapshotTargets().map((t) => `${t.name}.json`), 'manifest.json'].sort())
  })

  it('records byte size, outcome and sim clock in the manifest', async () => {
    vi.stubGlobal('fetch', mockFetch())

    const manifest = await snapshotAll(new NhsSimClient(CONFIG), outDir)
    const onDisk = await readManifest(manifest.dir)

    expect(onDisk).toEqual(manifest)
    expect(manifest.now).toBe(1789992120000)
    expect(manifest.failed).toEqual([])
    expect(manifest.baseUrl).toBe('https://sim.test')
    expect(manifest.files.every((f) => f.outcome === 'ok' && f.status === 200)).toBe(true)

    const gp = manifest.files.find((f) => f.name === 'site-gp')
    const body = await readFile(join(manifest.dir, 'site-gp.json'), 'utf8')
    expect(gp?.bytes).toBe(Buffer.byteLength(body, 'utf8'))
    expect(gp?.endpoint).toBe('/api/sites/gp/view')
    expect(manifest.totalBytes).toBe(manifest.files.reduce((sum, f) => sum + f.bytes, 0))
  })

  it('records a failing site without losing the others', async () => {
    vi.stubGlobal('fetch', mockFetch(['/api/sites/hospital/']))

    const manifest = await snapshotAll(new NhsSimClient(CONFIG), outDir)

    expect(manifest.failed).toEqual(['site-hospital'])
    const hospital = manifest.files.find((f) => f.name === 'site-hospital')
    expect(hospital?.outcome).toBe('failed')
    expect(hospital?.status).toBe(500)
    expect(hospital?.file).toBeNull()
    expect(hospital?.bytes).toBe(0)
    expect(hospital?.error).toContain('site unavailable')
    // hospital is not an expected failure, so the run counts as incomplete.
    expect(snapshotIsComplete(manifest)).toBe(false)

    // The other eight sites still landed, and the manifest is still on disk and valid.
    const written = await readdir(manifest.dir)
    expect(written).not.toContain('site-hospital.json')
    expect(written).toContain('site-gp.json')
    expect((await readManifest(manifest.dir)).failed).toEqual(['site-hospital'])
  })

  it('does not call a run broken when only the operator-only sites fail', async () => {
    vi.stubGlobal('fetch', mockFetch(['/api/sites/control/', '/api/sites/legacy/']))

    const manifest = await snapshotAll(new NhsSimClient(CONFIG), outDir)

    expect(manifest.failed).toEqual(['site-control', 'site-legacy'])
    expect(manifest.expectedFailures).toEqual(['site-control', 'site-legacy'])
    expect(snapshotIsComplete(manifest)).toBe(true)
  })

  it('still writes a valid manifest when every target fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))

    const manifest = await snapshotAll(new NhsSimClient(CONFIG), outDir)

    expect(manifest.failed).toHaveLength(snapshotTargets().length)
    expect(manifest.now).toBeNull()
    expect(manifest.totalBytes).toBe(0)
    expect(await readdir(manifest.dir)).toEqual(['manifest.json'])
    expect((await readManifest(manifest.dir)).files.every((f) => f.status === null)).toBe(true)
  })

  it('falls back to a site view for the sim clock when /api/clock fails', async () => {
    vi.stubGlobal('fetch', mockFetch(['/api/clock']))

    const manifest = await snapshotAll(new NhsSimClient(CONFIG), outDir)

    expect(manifest.failed).toEqual(['clock'])
    expect(manifest.now).toBe(1789992120000)
  })

  it('sends the team key on every request and reads each endpoint once', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)

    await snapshotAll(new NhsSimClient(CONFIG), outDir)

    expect(fetchMock).toHaveBeenCalledTimes(snapshotTargets().length)
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-key')
      expect(init.method).toBe('GET')
    }
  })
})

/**
 * npm run watch: probe NHS-SIM until it answers, then take one snapshot.
 * OWNER: Oriol. PRD §8.2 step 1.
 *
 * The sim is up, so in practice this fires on attempt 1 and exits. It stays here for the case
 * where the server goes down mid-hackathon and we want a snapshot the moment it returns.
 *
 * Interval and attempt cap come from argv so a run that is waiting on this can shorten them:
 *   npm run watch -- 30000 20
 */

import 'dotenv/config'
import { NhsSimClient } from '../src/integration/nhssim-client.ts'
import { probeUntilUp } from '../src/integration/watcher.ts'
import { snapshotAll } from '../src/integration/snapshot-client.ts'

const intervalMs = Number(process.argv[2] ?? 120_000)
const maxAttempts = Number(process.argv[3] ?? 60)

const client = new NhsSimClient()
const up = await probeUntilUp(client, {
  intervalMs,
  maxAttempts,
  onAttempt: (n) => console.log(`probe ${n} ${new Date().toISOString()}`),
})
console.log(`up after ${up.attempts} attempt(s), ${up.elapsedMs}ms`)

const manifest = await snapshotAll(client, 'snapshot')
console.log(`snapshot ${manifest.dir}: ${manifest.files.length - manifest.failed.length}/${manifest.files.length} files, ${(manifest.totalBytes / 1024).toFixed(1)} KB`)
const unexpected = manifest.failed.filter((name) => !manifest.expectedFailures.includes(name))
if (unexpected.length > 0) console.log(`failed: ${unexpected.join(', ')}`)

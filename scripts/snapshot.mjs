/**
 * npm run snapshot: one bulk pull of NHS-SIM into snapshot/<timestamp>/.
 * OWNER: Oriol.
 *
 * Thin on purpose. Everything that could be wrong lives in snapshot-client.ts, where it is
 * testable; this file only loads the key, builds the client and prints what landed.
 */

import 'dotenv/config'
import { NhsSimClient } from '../src/integration/nhssim-client.ts'
import { snapshotAll, snapshotIsComplete } from '../src/integration/snapshot-client.ts'

export function printManifest(manifest) {
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`
  console.log(`\nsnapshot ${manifest.dir}`)
  console.log(`sim clock now: ${manifest.now ?? 'unknown'}`)
  for (const file of manifest.files) {
    const expected = manifest.expectedFailures.includes(file.name)
    const label = file.outcome === 'ok' ? 'ok     ' : expected ? 'skipped' : 'FAILED '
    const line = file.outcome === 'ok'
      ? `  ${label} ${file.name.padEnd(20)} ${kb(file.bytes).padStart(10)}  ${file.durationMs}ms`
      : `  ${label} ${file.name.padEnd(20)} ${file.status ?? 'no status'}  ${file.error}`
    console.log(line)
  }
  console.log(`\n${manifest.files.length - manifest.failed.length}/${manifest.files.length} files, ${kb(manifest.totalBytes)} total`)
  const unexpected = manifest.failed.filter((name) => !manifest.expectedFailures.includes(name))
  if (unexpected.length > 0) console.log(`failed: ${unexpected.join(', ')}`)
}

const manifest = await snapshotAll(new NhsSimClient(), 'snapshot')
printManifest(manifest)

// A partial snapshot is still written, but the exit code has to say so for CI and for the watcher.
// Sites our key was never allowed to read do not count: they fail identically on every run.
process.exit(snapshotIsComplete(manifest) ? 0 : 1)

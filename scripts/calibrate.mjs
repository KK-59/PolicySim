/**
 * Calibration handoff CLI — the Kaavya integration moment, run as a command.
 * OWNER: Oriol.
 *
 * Reads the live world, derives engine parameters, and writes them in Kaavya's `Params` shape.
 * Also refreshes fixtures/params.mock.json, so the UI renders real numbers with real source
 * tags rather than an empty object.
 *
 *   npm run calibrate                 # live read, both sites
 *   npm run calibrate -- --offline    # re-derive from the handoff already on disk
 */
import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import { NhsSimClient } from '../src/integration/nhssim-client.ts'
import { calibrateFromLive, writeCalibrationHandoff } from '../src/integration/calibration.ts'
import { toParams, calibrationFromHandoff } from '../src/integration/calibration-to-params.ts'

const offline = process.argv.includes('--offline')
const HANDOFF = 'fixtures/params.calibrated.json'
// NOT params.live.json: scripts/build-ui-data.ts owns that file and writes BASELINE into it,
// and src/ui/data imports it. Two writers on one path means whichever ran last wins and the
// interface silently renders the loser.
const PARAMS = 'fixtures/params.measured.json'
// Elsa's parameter panel renders this. Real calibrated numbers with real source tags.
const MOCK = 'fixtures/params.mock.json'

let gp
let hospital

if (offline) {
  gp = calibrationFromHandoff(JSON.parse(await readFile(HANDOFF, 'utf8')))
  console.log(`  offline: re-derived from ${HANDOFF}`)
} else {
  const client = new NhsSimClient()
  // The GP view cannot see A&E demand at all, so urgent and complex arrivals need the hospital
  // site. Capacities and routing stay GP-side.
  ;[gp, hospital] = await Promise.all([
    calibrateFromLive(client, { site: 'gp' }),
    calibrateFromLive(client, { site: 'hospital' }).catch((err) => {
      console.log(`  hospital read failed (${err.message}); falling back to measured defaults`)
      return undefined
    }),
  ])
  await writeCalibrationHandoff(gp, HANDOFF)
  console.log(`  wrote ${HANDOFF}`)
}

const params = toParams(gp, hospital ? { hospital } : {})

await writeFile(PARAMS, JSON.stringify(params, null, 2))
await writeFile(MOCK, JSON.stringify(params, null, 2))

// Count the leaves so the handoff can be eyeballed rather than trusted.
const leaves = []
const walk = (node, path = '') => {
  for (const [k, v] of Object.entries(node ?? {})) {
    if (v && typeof v === 'object' && 'value' in v && 'source' in v) leaves.push({ path: `${path}${k}`, ...v })
    else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${path}${k}.`)
  }
}
walk(params)

const bySource = leaves.reduce((acc, l) => ({ ...acc, [l.source]: (acc[l.source] ?? 0) + 1 }), {})
const noRange = leaves.filter((l) => !l.range)
const noCite = leaves.filter((l) => l.source !== 'assumed' && !l.citation)

console.log(`  wrote ${PARAMS} and ${MOCK}`)
console.log(`\n  ${leaves.length} parameters: ${Object.entries(bySource).map(([s, n]) => `${n} ${s}`).join(', ')}`)
console.log(`  arrivals/day: ${(params.arrivals.perDay.routine.value + params.arrivals.perDay.urgent.value + params.arrivals.perDay.complex.value).toFixed(2)}`)
console.log(`  ${noRange.length} without a sampling range (the three worlds collapse on these)`)
if (noCite.length) console.log(`  WARNING ${noCite.length} non-assumed without a citation: ${noCite.map((l) => l.path).join(', ')}`)
console.log('')

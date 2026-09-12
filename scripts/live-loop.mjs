/**
 * Live loop CLI — the rehearsal run, and the thing we record for the demo.
 * OWNER: Oriol.
 *
 * Reads a plan fixture, walks a clinician through it one action at a time, then applies the
 * approved ones to the real NHS-SIM world and prints what the world did back.
 *
 *   npm run liveloop                       # approve every action (rehearsal)
 *   npm run liveloop -- --reject a4        # reject one, prove it never reaches the wire
 *   npm run liveloop -- --plan <path>
 */
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { NhsSimClient } from '../src/integration/nhssim-client.ts'
import { createApprovalGate } from '../src/agent/approval.ts'
import { runLiveLoop } from '../src/agent/live-loop.ts'

const argv = process.argv.slice(2)
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i === -1 ? fallback : argv[i + 1]
}
const planPath = arg('--plan', 'fixtures/plan.home-first.json')
const rejected = new Set(argv.filter((a, i) => argv[i - 1] === '--reject'))

const plan = JSON.parse(await readFile(planPath, 'utf8'))
const client = new NhsSimClient()

/**
 * Retarget the plan onto a patient whose discharge letter is still unreviewed.
 *
 * The document workflow is ONE-SHOT: sent -> assign -> review -> file. Once a rehearsal
 * reviews a letter it can never be reviewed again, so a fixture pinned to one patient works
 * exactly once and then fails on stage. This repoints the plan at live state every run.
 * Pass --patient <id> to force one, or --no-retarget to use the fixture as authored.
 */
async function retarget(plan, wanted) {
  const [docs, msg] = await Promise.all([
    client.get('/api/sites/gp/documents'),
    client.get('/api/sites/gp/messaging-workspace'),
  ])
  const convos = new Map(
    msg.resources.filter((r) => r.kind === 'conversation').map((c) => [c.patientId, c]),
  )
  const candidates = docs.resources.filter(
    (r) => r.status === 'sent' && convos.has(r.patientId) && (!wanted || r.patientId === wanted),
  )
  const doc = candidates[0]
  if (!doc) throw new Error(wanted ? `No unreviewed letter for ${wanted}` : 'No unreviewed letters left')
  const convo = convos.get(doc.patientId)
  const patient = (docs.patients ?? []).find((p) => p.id === doc.patientId)

  plan.patientId = doc.patientId
  for (const step of plan.actions) {
    step.action.patientId = doc.patientId
    if (step.action.type === 'process_document') {
      step.action.resourceId = doc.id
      step.action.expectedVersion = doc.version
    }
    if (step.action.type === 'messaging_action') {
      step.action.resourceId = convo.id
      step.action.expectedVersion = convo.version
    }
  }
  return { patient, doc, convo }
}

if (!argv.includes('--no-retarget')) {
  const t = await retarget(plan, arg('--patient', undefined))
  console.log(`  Retargeted onto ${t.doc.patientId} ${t.patient?.name ?? ''}`)
  console.log(`  letter ${t.doc.id} v${t.doc.version} (${t.doc.status}), conversation ${t.convo.id} v${t.convo.version}`)
  if (t.patient?.goals) console.log(`  goals: ${t.patient.goals.join('; ')}`)
}

console.log(`\n  Plan: ${plan.id}`)
console.log(`  Patient: ${plan.patientId}`)
console.log(`  ${plan.rationale}\n`)

// The approval gate. Every action gets its own decision, standing in for the clinician
// tapping approve on Elsa's screen. Nothing is auto-approved, which is the point.
const gate = createApprovalGate(plan, { approver: 'Oriol (rehearsal)' })
for (const planned of gate.pending()) {
  const verdict = rejected.has(planned.id) ? 'reject' : 'approve'
  const mark = verdict === 'approve' ? 'APPROVED' : 'REJECTED'
  console.log(`  [${mark}] ${planned.id}  ${planned.action.type.padEnd(20)} ${planned.tier}`)
  console.log(`             ${planned.rationale}`)
  gate.submitDecision(planned.id, verdict)
}

const snap = gate.snapshot()
console.log(`\n  ${snap.approved} approved, ${snap.rejected} rejected, ${snap.pending} pending\n`)
console.log('  Applying to the live world...\n')

const result = await runLiveLoop(client, plan, gate.decisions(), {
  approver: 'Oriol (rehearsal)',
  // Pinned rather than learned: attribution must be stable from the first event, and a
  // coordinator task belongs in the GP's queue whichever site the conflict happened on.
  teamId: 'team14',
  coordinatorSite: 'gp',
  onStep: (step) => {
    const a = step.applied
    const tag = a.outcome === 'applied' ? 'OK  ' : a.outcome === 'rejected' ? 'SKIP' : 'FAIL'
    console.log(`  ${tag} ${step.planned.id} ${step.planned.action.type}`)
    if (a.result?.id) console.log(`       -> ${a.result.kind} ${a.result.id} v${a.result.version}`)
    if (a.fallback) console.log(`       -> FALLBACK ${a.fallback.kind}: ${a.fallback.reason} (${a.fallback.attempts} attempts)`)
    if (a.error) console.log(`       -> error: ${a.error}`)
    if (step.advancedMinutes) console.log(`       clock +${step.advancedMinutes}min, ${step.observed.length} events`)
  },
})

const applied = result.applied.filter((a) => a.outcome === 'applied').length
const fallbacks = result.applied.filter((a) => a.fallback)
const ours = result.observed.filter((e) => e.causedByUs)

console.log(`\n  ---- result ----`)
console.log(`  applied            ${applied}/${result.applied.length}`)
console.log(`  fallbacks fired    ${fallbacks.length}${fallbacks.length ? ' (' + fallbacks.map((f) => f.fallback.kind).join(', ') + ')' : ''}`)
console.log(`  sim time           ${new Date(result.startSimTime).toISOString()} -> ${new Date(result.endSimTime).toISOString()}`)
console.log(`  observed events    ${result.observed.length} (${ours.length} caused by us)`)
if (result.observationGaps.length) {
  console.log(`  OBSERVATION GAPS   ${result.observationGaps.length} window(s) never seen:`)
  for (const g of result.observationGaps) {
    console.log(`                     after ${g.afterActionId}, ${g.minutes}min lost: ${g.error}`)
  }
}
console.log(`  handoff            fixtures/observed.live.json + fixtures/run.live.json\n`)

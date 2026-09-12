import { useEffect, useMemo, useState } from 'react'
import type {
  CommunityExperimentResult,
  ExperimentProgress,
} from '../../clinical/prevention/controlled-experiment'
import { LIVE_EXPERIMENT_LIMITS, type PolicyDraft } from '../../extraction/policy-workbench'
import { Glyph } from './Glyph'

interface WorkbenchData {
  policy: PolicyDraft
  liveSupported: boolean
}

interface Eligibility {
  available?: boolean
  count?: number | null
  note?: string
  error?: string
}

interface ExperimentJob {
  status: 'queued' | 'running' | 'complete' | 'failed'
  progress: ExperimentProgress
  result?: CommunityExperimentResult
  error?: string
}

const POPULATIONS: Array<{ value: PolicyDraft['population']['rule']; label: string }> = [
  { value: 'due_within_horizon', label: 'Open tasks due during the policy period' },
  { value: 'overdue_task', label: 'Overdue care tasks' },
  { value: 'open_urgent_gp_task', label: 'Open urgent GP tasks' },
  { value: 'recent_discharge', label: 'Patients with a recent discharge record' },
]

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`)
  return payload
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return 'Not available'
  if (unit === 'hours') return `${value.toLocaleString('en-GB')} h`
  if (unit === 'percent') return `${value.toLocaleString('en-GB')}%`
  return value.toLocaleString('en-GB')
}

function formatDelta(value: number | null, unit: string): string {
  if (value === null) return 'Not available'
  const suffix = unit === 'hours' ? ' h' : unit === 'percent' ? ' pp' : ''
  return `${value > 0 ? '+' : ''}${value.toLocaleString('en-GB')}${suffix}`
}

export function ObservedRehearsal({ policyName }: { policyName: string }) {
  const [policy, setPolicy] = useState<PolicyDraft | null>(null)
  const [eligibility, setEligibility] = useState<Eligibility | null>(null)
  const [approved, setApproved] = useState(false)
  const [checking, setChecking] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ExperimentProgress | null>(null)
  const [result, setResult] = useState<CommunityExperimentResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void requestJson<WorkbenchData>('/api/policy')
      .then((data) => setPolicy(data.policy))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  const hasIntegratedAction = Boolean(
    policy?.intervention.createGpTask
      || policy?.intervention.sendMessage
      || policy?.intervention.orderTest,
  )
  const canRun = Boolean(eligibility?.available && eligibility.count && hasIntegratedAction)
  const runPatientCount = policy && eligibility?.count
    ? Math.min(
        eligibility.count,
        policy.constraints.maxPerDay * Math.ceil(policy.horizonHours / 24),
      )
    : 0

  const actionSummary = useMemo(() => {
    if (!policy) return ''
    const actions = ['community visit']
    if (policy.intervention.createGpTask) actions.push('GP follow-up task')
    if (policy.intervention.sendMessage) actions.push('patient message')
    if (policy.intervention.orderTest) actions.push(`${(policy.intervention.panelId ?? 'fbc').toUpperCase()} test`)
    return actions.join(' + ')
  }, [policy])

  function update(mutator: (draft: PolicyDraft) => void) {
    if (!policy) return
    const next = structuredClone(policy)
    mutator(next)
    setPolicy(next)
    setEligibility(null)
    setApproved(false)
    setResult(null)
    setProgress(null)
    setError(null)
  }

  async function checkEligibility() {
    if (!policy) return
    setChecking(true)
    setEligibility(null)
    setApproved(false)
    setError(null)
    try {
      const next = await requestJson<Eligibility>('/api/policy/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy }),
      })
      setEligibility(next)
    } catch (cause) {
      setEligibility({ error: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setChecking(false)
    }
  }

  async function runExperiment() {
    if (!policy || !approved || !canRun) return
    setRunning(true)
    setError(null)
    setResult(null)
    setProgress({ percent: 0, stage: 'Queued', detail: 'Preparing the controlled comparison' })
    try {
      const queued = await requestJson<{ jobId: string }>('/api/policy/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy, confirm: true }),
      })
      for (;;) {
        const job = await requestJson<ExperimentJob>(`/api/policy/run/${queued.jobId}`)
        setProgress(job.progress)
        if (job.status === 'complete' && job.result) {
          setResult(job.result)
          break
        }
        if (job.status === 'failed') throw new Error(job.error ?? 'The simulator experiment failed')
        await new Promise((resolve) => window.setTimeout(resolve, 1_000))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  if (!policy) {
    return (
      <section className="observed section mt-7">
        <h2 className="h2">Observed rehearsal</h2>
        <p className="muted mt-3" aria-live="polite">
          {error ?? 'Connecting to the synthetic-world service…'}
        </p>
      </section>
    )
  }

  return (
    <section className="observed section mt-7" aria-labelledby="observed-title">
      <div className="observed__intro">
        <div>
          <h2 className="h2" id="observed-title">Observed rehearsal</h2>
          <p className="lead mt-3">
            Test how {policyName} becomes work for individual synthetic patients, then compare
            what Anima records against a do-nothing control.
          </p>
        </div>
        <span className="observed__status"><Glyph name="check" size={14} /> Anima API</span>
      </div>

      <p className="note mt-5" role="note">
        <Glyph name="warning" size={13} />
        <span>
          The population forecast above comes from the uploaded parameters. Patient eligibility
          and actions are operational choices, so review them here before anything is written.
        </span>
      </p>

      <div className="observed__controls mt-5">
        <label className="observed__field observed__field--wide">
          <span>Eligible population</span>
          <select
            value={policy.population.rule}
            onChange={(event) => update((draft) => {
              const selected = POPULATIONS.find((item) => item.value === event.target.value)
              if (selected) draft.population = { rule: selected.value, label: selected.label }
            })}
          >
            {POPULATIONS.map((population) => (
              <option value={population.value} key={population.value}>{population.label}</option>
            ))}
          </select>
        </label>
        <label className="observed__field">
          <span>Patients per day</span>
          <input
            className="num"
            type="number"
            min={1}
            max={LIVE_EXPERIMENT_LIMITS.maxPerDay}
            value={policy.constraints.maxPerDay}
            onChange={(event) => update((draft) => {
              draft.constraints.maxPerDay = Math.min(
                LIVE_EXPERIMENT_LIMITS.maxPerDay,
                Math.max(1, Number(event.target.value)),
              )
            })}
          />
        </label>
        <label className="observed__field">
          <span>Policy period</span>
          <span className="observed__input-unit">
            <input
              className="num"
              type="number"
              min={1}
              max={LIVE_EXPERIMENT_LIMITS.maxHorizonHours / 24}
              value={Math.ceil(policy.horizonHours / 24)}
              onChange={(event) => update((draft) => {
                draft.horizonHours = Math.min(
                  LIVE_EXPERIMENT_LIMITS.maxHorizonHours / 24,
                  Math.max(1, Number(event.target.value)),
                ) * 24
              })}
            />
            days
          </span>
        </label>
      </div>

      <fieldset className="observed__actions mt-4">
        <legend>Integrated actions in Policy B</legend>
        <label>
          <input
            type="checkbox"
            checked={Boolean(policy.intervention.createGpTask)}
            onChange={(event) => update((draft) => { draft.intervention.createGpTask = event.target.checked })}
          />
          <span><strong>GP task</strong><small>Ask the practice to review the follow-up</small></span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(policy.intervention.sendMessage)}
            onChange={(event) => update((draft) => { draft.intervention.sendMessage = event.target.checked })}
          />
          <span><strong>Patient message</strong><small>Queue a synthetic SMS reminder</small></span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(policy.intervention.orderTest)}
            onChange={(event) => update((draft) => { draft.intervention.orderTest = event.target.checked })}
          />
          <span><strong>Diagnostic test</strong><small>Order a routine FBC</small></span>
        </label>
      </fieldset>

      <div className="observed__arms mt-5" aria-label="Comparison design">
        <div><span>Control</span><strong>Do nothing</strong><small>Advance time, send no actions</small></div>
        <div><span>Policy A</span><strong>Visit only</strong><small>Community visit for each selected patient</small></div>
        <div><span>Policy B</span><strong>Integrated</strong><small>{actionSummary}</small></div>
      </div>

      <div className="observed__run mt-5">
        <button className="btn btn--secondary" type="button" onClick={() => void checkEligibility()} disabled={checking || running}>
          {checking ? 'Checking cohort…' : 'Check eligible cohort'}
        </button>
        <div className="observed__eligibility" aria-live="polite">
          {eligibility?.error
            ? <span className="observed__error">{eligibility.error}</span>
            : eligibility?.count != null
              ? <><strong className="num">{eligibility.count}</strong><span>eligible patients visible</span></>
              : <span className="muted">Check the cohort before approval</span>}
        </div>
      </div>

      {eligibility?.count != null && eligibility.count > 0 && (
        <div className="observed__approval mt-4">
          <label>
            <input
              type="checkbox"
              checked={approved}
              disabled={!hasIntegratedAction || running}
              onChange={(event) => setApproved(event.target.checked)}
            />
            <span>
              Approve both policy batches for {runPatientCount} patients in fresh synthetic worlds.
              Control receives no actions.
            </span>
          </label>
          <button className="btn btn--primary" type="button" disabled={!approved || !canRun || running} onClick={() => void runExperiment()}>
            {running ? 'Running comparison…' : 'Run observed comparison'}
          </button>
        </div>
      )}

      {!hasIntegratedAction && (
        <p className="tiny muted mt-3">Select at least one integrated action so Policy B differs from Policy A.</p>
      )}

      {progress && (
        <div className="observed__progress mt-5" aria-live="polite">
          <div><strong>{progress.stage}</strong><span className="num">{progress.percent}%</span></div>
          <div className="observed__track"><span style={{ transform: `scaleX(${progress.percent / 100})` }} /></div>
          <p className="tiny muted">{progress.detail}</p>
        </div>
      )}

      {error && (
        <p className="note mt-4" role="alert"><Glyph name="warning" size={13} /><span>{error}</span></p>
      )}

      {result && <ObservedResults result={result} />}
    </section>
  )
}

function ObservedResults({ result }: { result: CommunityExperimentResult }) {
  return (
    <div className="observed__results mt-7">
      <div className="row between">
        <div>
          <h3 className="h3">What the simulator recorded</h3>
          <p className="small muted mt-2">Operational outcomes from three matched synthetic worlds.</p>
        </div>
        <span className="observed__run-id num">Run {result.experimentId.slice(0, 8)}</span>
      </div>

      <div className="observed__summary mt-4">
        <span><strong className="num">{result.eligiblePatients}</strong> eligible</span>
        <span><strong className="num">{result.acceptedActions}</strong> accepted</span>
        <span><strong className="num">{result.rejectedActions}</strong> rejected</span>
      </div>

      <div className="tablewrap mt-4">
        <table className="observed__table">
          <thead>
            <tr>
              <th>Observed measure</th>
              <th className="n">Control</th>
              <th className="n">Visit only</th>
              <th className="n">Integrated</th>
              <th className="n">B − Control</th>
            </tr>
          </thead>
          <tbody>
            {result.outcomes.map((outcome) => (
              <tr key={outcome.label}>
                <td>
                  <strong>{outcome.label}</strong>
                  <small>{outcome.source}</small>
                </td>
                <td className="n num">{formatValue(outcome.control, outcome.unit)}</td>
                <td className="n num">{formatValue(outcome.baseline, outcome.unit)}</td>
                <td className="n num">{formatValue(outcome.intervention, outcome.unit)}</td>
                <td className="n num observed__delta">{formatDelta(outcome.deltaB, outcome.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="disclosure mt-5">
        <summary><Glyph name="document" size={14} /> API evidence and coverage</summary>
        <div className="disclosure__body">
          <p className="small muted">{result.note}</p>
          <div className="tablewrap mt-4">
            <table>
              <thead><tr><th>Service</th><th className="n">Control</th><th className="n">Policy A</th><th className="n">Policy B</th></tr></thead>
              <tbody>{result.observedSites.map((site) => (
                <tr key={site.site}>
                  <td>{site.site}</td>
                  <td className="n num">{site.controlReturned}/{site.controlTotal}</td>
                  <td className="n num">{site.baselineReturned}/{site.baselineTotal}</td>
                  <td className="n num">{site.interventionReturned}/{site.interventionTotal}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="tiny muted mt-4">
            {result.actionReceipts.length} patient-level API receipts retained for audit.
          </p>
        </div>
      </details>
    </div>
  )
}

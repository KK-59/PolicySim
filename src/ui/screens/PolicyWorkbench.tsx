import { useEffect, useMemo, useState } from "react"
import type { CommunityExperimentResult, ExperimentProgress } from "../../clinical/prevention/controlled-experiment.ts"
import type { ActionPreview, OutcomeDefinition, PolicyDraft } from "../../extraction/policy-workbench.ts"

interface WorkbenchData {
  policy: PolicyDraft
  examples: Array<{ id: string; label: string; text: string }>
  preview: ActionPreview[]
  outcomes: OutcomeDefinition[]
  liveSupported: boolean
  disclaimer: string
}

interface Eligibility {
  available?: boolean
  count?: number | null
  examples?: Array<{ patientId?: string; title: string; dueAt?: number; priority: string }>
  note?: string
  error?: string
}

interface Job {
  status: "queued" | "running" | "complete" | "failed"
  progress: ExperimentProgress
  result?: CommunityExperimentResult
  error?: string
}

const actionLabels: Record<string, string> = {
  schedule_visit: "Schedule community visit",
  create_task: "Create GP follow-up task",
  messaging_action: "Send simulated message",
  book_appointment: "Book appointment",
  order_test: "Order diagnostic test",
  place_pharmacy_order: "Place pharmacy order",
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? "The request could not be completed")
  return data
}

function interactionSummary(policy: PolicyDraft): string {
  if (policy.kind !== "community") return actionLabels[policy.intervention.action] ?? policy.intervention.action
  const items = ["Community visit"]
  if (policy.intervention.createGpTask) items.push("GP task")
  if (policy.intervention.sendMessage) items.push((policy.intervention.messageChannel ?? "sms").toUpperCase())
  if (policy.intervention.orderTest) items.push(`${(policy.intervention.panelId ?? "fbc").toUpperCase()} test`)
  return items.join(" + ")
}

function value(value: number | null, unit: string): string {
  if (value === null) return "Unavailable"
  if (unit === "hours") return `${value} h`
  if (unit === "percent") return `${value}%`
  return String(value)
}

function signed(value: number | null, unit: string): string {
  if (value === null) return "Unavailable"
  return `${value > 0 ? "+" : ""}${value}${unit === "hours" ? " h" : unit === "percent" ? " pp" : ""}`
}

export function PolicyWorkbench() {
  const [data, setData] = useState<WorkbenchData | null>(null)
  const [text, setText] = useState("")
  const [eligibility, setEligibility] = useState<Eligibility | null>(null)
  const [approved, setApproved] = useState(false)
  const [progress, setProgress] = useState<ExperimentProgress | null>(null)
  const [result, setResult] = useState<CommunityExperimentResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const hasDifference = Boolean(data?.policy.intervention.createGpTask || data?.policy.intervention.sendMessage || data?.policy.intervention.orderTest)
  const canRun = Boolean(data?.liveSupported && eligibility?.available && eligibility.count && hasDifference)

  async function loadEligibility(policy: PolicyDraft) {
    setEligibility(null)
    try {
      setEligibility(await requestJson<Eligibility>("/api/policy/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      }))
    } catch (cause) {
      setEligibility({ error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  useEffect(() => {
    void requestJson<WorkbenchData>("/api/policy").then((next) => {
      setData(next)
      setText(next.policy.sourceText)
      return loadEligibility(next.policy)
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  async function interpret(nextText = text) {
    setBusy(true)
    setError("")
    setApproved(false)
    setResult(null)
    try {
      const next = await requestJson<WorkbenchData>("/api/policy/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nextText }),
      })
      setData(next)
      setText(nextText)
      await loadEligibility(next.policy)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function updatePolicy(mutator: (policy: PolicyDraft) => void) {
    if (!data) return
    const policy = structuredClone(data.policy)
    mutator(policy)
    setApproved(false)
    setResult(null)
    try {
      const next = await requestJson<WorkbenchData>("/api/policy/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      })
      const merged = { ...data, ...next }
      setData(merged)
      await loadEligibility(merged.policy)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function run() {
    if (!data || !approved) return
    setBusy(true)
    setError("")
    setProgress({ percent: 0, stage: "Queued", detail: "Starting controlled comparison" })
    try {
      const queued = await requestJson<{ jobId: string }>("/api/policy/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy: data.policy, confirm: true }),
      })
      for (;;) {
        const job = await requestJson<Job>(`/api/policy/run/${queued.jobId}`)
        setProgress(job.progress)
        if (job.status === "complete" && job.result) {
          setResult(job.result)
          break
        }
        if (job.status === "failed") throw new Error(job.error ?? "The simulator experiment failed")
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const maxValues = useMemo(() => result?.outcomes.map((row) =>
    Math.max(1, ...[row.control, row.baseline, row.intervention].filter((item): item is number => typeof item === "number").map(Math.abs))
  ) ?? [], [result])

  if (!data) return <main className="loading">{error || "Connecting to policy services..."}</main>
  const policy = data.policy
  const intervention = policy.intervention

  return <>
    <header>
      <div className="header-inner">
        <div className="brand"><strong>Policy Workbench</strong><span className="badge">{result ? "Observed" : "Preview"}</span></div>
        <span className="api-note">Anima synthetic world</span>
      </div>
    </header>
    <main>
      {error && <div className="error" role="alert">{error}</div>}
      <h1>Turn a policy into measurable action</h1>
      <p className="subtitle">Describe the change, inspect every interaction, then compare observed simulator outcomes.</p>
      <div className="system-strip">
        <div className="system-cell"><span>Environment</span><strong>SIMULATION ONLY</strong></div>
        <div className="system-cell"><span>Evidence mode</span><strong>{result ? "OBSERVED" : "PREVIEW"}</strong></div>
        <div className="system-cell"><span>Policy family</span><strong>{policy.kind.toUpperCase()}</strong></div>
        <div className="system-cell"><span>API link</span><strong className="live">READY</strong></div>
      </div>

      <section className="section">
        <div className="section-head"><h2>1. Write the policy</h2><span className="section-note">Choose an example or write your own</span></div>
        <div className="panel composer">
          <div className="examples">{data.examples.map((example) =>
            <button className={text === example.text ? "example active" : "example"} key={example.id} onClick={() => { setText(example.text); void interpret(example.text) }}>{example.label}</button>
          )}</div>
          <textarea value={text} onChange={(event) => setText(event.target.value)} aria-label="Policy text" />
          <div className="composer-actions"><span className="status">Nothing runs until you approve the action plan.</span><button className="primary" disabled={busy} onClick={() => void interpret()}>{busy ? "Working..." : "Interpret policy"}</button></div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>2. Review the interpretation</h2><span className="section-note">All allocation rules stay visible</span></div>
        <div className="panel">
          <div className="workflow">
            <div className="step active">Who<strong>{policy.population.label}</strong></div>
            <div className="step">Do what<strong>{interactionSummary(policy)}</strong></div>
            <div className="step">Within<strong>{policy.constraints.maxPerDay} per day</strong></div>
            <div className="step">Measure after<strong>{policy.horizonHours} hours</strong></div>
          </div>
          <div className="parameter-grid">
            <div className="field"><span className="label">Population rule</span><div className="field-value">{policy.population.label}</div></div>
            <div className="field"><span className="label">Primary intervention</span><div className="field-value">{actionLabels[intervention.action]}</div></div>
            <div className="field"><label>Maximum per day</label><input type="number" min="1" max="100" value={policy.constraints.maxPerDay} onChange={(event) => void updatePolicy((draft) => { draft.constraints.maxPerDay = Number(event.target.value) })} /></div>
            <div className="field"><label>Observation window, hours</label><input type="number" min="1" max="1440" value={policy.horizonHours} onChange={(event) => void updatePolicy((draft) => { draft.horizonHours = Number(event.target.value) })} /></div>
            <div className="field"><span className="label">Allocation order</span><div className="field-value">Oldest due first</div></div>
            <div className="field"><span className="label">Experiment method</span><div className="field-value">Three matched simulator worlds</div></div>
            {policy.kind === "community" && <>
              <Toggle label="Create GP task" detail="One auditable follow-up task per selected patient" checked={Boolean(intervention.createGpTask)} onChange={(checked) => void updatePolicy((draft) => { draft.intervention.createGpTask = checked })} />
              <TextField label="GP task title" value={intervention.taskTitle ?? ""} onChange={(value) => void updatePolicy((draft) => { draft.intervention.taskTitle = value })} />
              <Toggle label="Send patient message" detail="Synthetic message only" checked={Boolean(intervention.sendMessage)} onChange={(checked) => void updatePolicy((draft) => { draft.intervention.sendMessage = checked })} />
              <Select label="Message channel" value={intervention.messageChannel ?? "sms"} options={["sms", "email"]} onChange={(value) => void updatePolicy((draft) => { draft.intervention.messageChannel = value as "sms" | "email" })} />
              <Toggle label="Allow replies" detail="Keep the simulated conversation open" checked={intervention.allowReply ?? true} onChange={(checked) => void updatePolicy((draft) => { draft.intervention.allowReply = checked })} />
              <TextField label="Message subject" value={intervention.messageSubject ?? ""} onChange={(value) => void updatePolicy((draft) => { draft.intervention.messageSubject = value })} />
              <TextField label="Message body" value={intervention.messageBody ?? ""} onChange={(value) => void updatePolicy((draft) => { draft.intervention.messageBody = value })} />
              <Toggle label="Order diagnostic test" detail="Explicit synthetic GP test order" checked={Boolean(intervention.orderTest)} onChange={(checked) => void updatePolicy((draft) => { draft.intervention.orderTest = checked })} />
              <Select label="Test panel" value={intervention.panelId ?? "fbc"} options={["fbc", "ue", "hba1c", "lft", "crp", "lipids"]} onChange={(value) => void updatePolicy((draft) => { draft.intervention.panelId = value as typeof draft.intervention.panelId })} />
              <Select label="Test priority" value={intervention.priority ?? "routine"} options={["routine", "urgent"]} onChange={(value) => void updatePolicy((draft) => { draft.intervention.priority = value as "routine" | "urgent" })} />
              <Select label="Collection" value={intervention.collection ?? "next-round"} options={["now", "next-round"]} onChange={(value) => void updatePolicy((draft) => { draft.intervention.collection = value as "now" | "next-round" })} />
            </>}
            {policy.kind === "appointments" &&
              <Select label="Appointment mode" value={intervention.mode ?? "in-person"} options={["in-person", "telephone", "video", "online"]} onChange={(value) => void updatePolicy((draft) => { draft.intervention.mode = value as typeof draft.intervention.mode })} />}
            {policy.kind === "diagnostics" && <>
              <Select label="Test panel" value={intervention.panelId ?? "fbc"} options={["fbc", "ue", "hba1c", "lft", "crp", "lipids"]} onChange={(value) => void updatePolicy((draft) => { draft.intervention.panelId = value as typeof draft.intervention.panelId })} />
              <Select label="Priority" value={intervention.priority ?? "routine"} options={["routine", "urgent"]} onChange={(value) => void updatePolicy((draft) => { draft.intervention.priority = value as "routine" | "urgent" })} />
              <Select label="Collection" value={intervention.collection ?? "next-round"} options={["now", "next-round"]} onChange={(value) => void updatePolicy((draft) => { draft.intervention.collection = value as "now" | "next-round" })} />
            </>}
            {policy.kind === "pharmacy" && <>
              <div className="field"><label>Target reorder multiple</label><input type="number" min="1" max="10" step="0.1" value={intervention.targetRatio ?? 1.5} onChange={(event) => void updatePolicy((draft) => { draft.intervention.targetRatio = Number(event.target.value) })} /></div>
              <div className="field"><label>Maximum spend, pounds</label><input type="number" min="0" value={(policy.constraints.maxSpendPence ?? 0) / 100} onChange={(event) => void updatePolicy((draft) => { draft.constraints.maxSpendPence = Math.round(Number(event.target.value) * 100) })} /></div>
            </>}
          </div>
          <div className="review-note">People are selected by an explicit resource rule and oldest due time. There is no ranking or health score.</div>
        </div>
      </section>

      <div className="layout">
        <div>
          <section className="section">
            <div className="section-head"><h2>3. Inspect the action plan</h2><span className="section-note">{data.preview.length} representative payloads</span></div>
            <div className="panel">{data.preview.map((item) =>
              <details key={item.ordinal} open={item.ordinal === 1}>
                <summary>{item.ordinal}. <span className="action-name">{actionLabels[String(item.action.type)] ?? String(item.action.type)}</span> at {item.site}</summary>
                <pre>{JSON.stringify(item.action, null, 2)}</pre>
                <div className="review-note">Resolved at run time: {item.requiresResolution.join("; ")}</div>
              </details>
            )}</div>
          </section>
          {result && <Results result={result} maxValues={maxValues} />}
        </div>

        <div>
          <section className="section">
            <div className="section-head"><h2>Outcome contract</h2><span className="section-note">Defined before execution</span></div>
            <div className="panel"><table><thead><tr><th>Observed measure</th><th>Source</th></tr></thead><tbody>{data.outcomes.map((outcome) =>
              <tr key={outcome.key}><td><strong>{outcome.label}</strong><div className="requirements">{outcome.unit}</div></td><td className="outcome-source">{outcome.source}</td></tr>
            )}</tbody></table></div>
          </section>
          <section className="section">
            <div className="section-head"><h2>4. Run the comparison</h2><span className="section-note">Batch approval required</span></div>
            <div className="panel run-panel">
              <p>Creates three fresh matching worlds. Control receives no action; Policy A receives visits; Policy B receives the integrated bundle. All clocks advance equally.</p>
              <div className="policy-arms">
                <div className="policy-arm arm-control"><span>Control</span><strong>Do nothing</strong><p>No interactions. Time still advances.</p></div>
                <div className="policy-arm arm-a"><span>Policy A</span><strong>Visit only</strong><p>Community visit for every eligible patient.</p></div>
                <div className="policy-arm arm-b"><span>Policy B</span><strong>Integrated follow-up</strong><p>{interactionSummary(policy)}</p></div>
              </div>
              <div className={`eligibility-readout ${eligibility?.error || eligibility?.count === 0 || !hasDifference ? "is-empty" : eligibility?.count ? "is-ready" : "is-loading"}`}>
                <div><span>Shared eligible cohort</span><strong>{eligibility?.error ? "Check failed" : eligibility?.count != null ? `${eligibility.count} visible` : "Checking"}</strong></div>
                <p>{eligibility?.error ?? (!data.liveSupported ? "This policy family is available for preview; its live resolver is not implemented." : !hasDifference ? "Enable at least one extra Policy B interaction." : eligibility?.note ?? "Reading the configured synthetic world.")}</p>
              </div>
              {progress && <div className="run-progress"><div className="progress-head"><strong>{progress.stage}</strong><span>{progress.percent}%</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${progress.percent}%` }} /></div><div className="progress-detail">{progress.detail}</div></div>}
              <label className="confirm"><input type="checkbox" disabled={!canRun || busy} checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>Approve both policy batches in fresh synthetic worlds. Control receives no actions.</span></label>
              <button className="primary" disabled={!canRun || !approved || busy} onClick={() => void run()}>{busy ? "Comparison active" : "Run controlled comparison"}</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  </>
}

function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="field"><label className="field-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong><small>{detail}</small></span></label></div>
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="field"><label>{label}</label><input key={value} type="text" defaultValue={value} onBlur={(event) => onChange(event.target.value)} /></div>
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <div className="field"><label>{label}</label><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></div>
}

function Results({ result, maxValues }: { result: CommunityExperimentResult; maxValues: number[] }) {
  return <section className="section results-section">
    <div className="section-head"><h2>5. Policy comparison</h2><span className="section-note">{result.experimentId.slice(0, 8)}</span></div>
    <div className="panel">
      <div className="result-summary">
        {[["Control actions", result.policyArms.control.accepted], ["Shared cohort", result.eligiblePatients], ["Policy A accepted", result.policyArms.a.accepted], ["Policy B accepted", result.policyArms.b.accepted], ["Total rejected", result.rejectedActions]].map(([label, number]) =>
          <div className="result-stat" key={String(label)}><span>{label}</span><strong>{number}</strong></div>
        )}
      </div>
      <div className="comparison-chart">
        <div className="comparison-head"><div><strong>Observed controlled comparison</strong><span>Each group is scaled within its own measure</span></div></div>
        <div className="comparison-rows">{result.outcomes.map((metric, index) =>
          <div className="comparison-row" key={metric.label}>
            <div className="comparison-label"><strong>{metric.label}</strong><span>{metric.unit}</span></div>
            <div className="metric-bars">{([["Control", metric.control, "control-bar"], ["Policy A", metric.baseline, "baseline-bar"], ["Policy B", metric.intervention, "policy-bar"]] as const).map(([label, number, className]) =>
              <div className="bar-line" key={label}><span>{label}</span><div className="bar-track"><i className={`bar-fill ${className}`} style={{ width: `${number === null ? 0 : Math.abs(number) / (maxValues[index] ?? 1) * 100}%` }} /></div><b>{value(number, metric.unit)}</b></div>
            )}</div>
            <div className="delta-stack"><span>A - C <strong>{signed(metric.deltaA, metric.unit)}</strong></span><span>B - C <strong>{signed(metric.deltaB, metric.unit)}</strong></span><span>B - A <strong>{signed(metric.difference, metric.unit)}</strong></span></div>
          </div>
        )}</div>
      </div>
      <details className="coverage-list"><summary>API observation coverage / {result.observedSites.length} services</summary>{result.observedSites.map((site) =>
        <div className="coverage-row" key={site.site}><strong>{site.site}</strong><span>Control {site.controlReturned}/{site.controlTotal}</span><span>Policy A {site.baselineReturned}/{site.baselineTotal}</span><span>Policy B {site.interventionReturned}/{site.interventionTotal}</span></div>
      )}</details>
      <details className="receipt-list"><summary>Action receipts / {result.actionReceipts.length}</summary>{result.actionReceipts.map((receipt, index) =>
        <div className="receipt" key={index}><span>Policy {receipt.arm.toUpperCase()}</span><span>{receipt.patientId}</span><span className="receipt-action">{receipt.site} / {receipt.actionType}</span><strong className={receipt.accepted ? "receipt-ok" : "receipt-failed"}>{receipt.accepted ? "ACCEPTED" : "REJECTED"}</strong></div>
      )}</details>
    </div>
    <p className="footnote">{result.note}</p>
  </section>
}

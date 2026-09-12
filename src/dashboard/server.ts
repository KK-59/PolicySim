import "dotenv/config"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import { runCommunityExperiment, type CommunityExperimentResult, type ExperimentProgress } from "../clinical/prevention/controlled-experiment.ts"
import type { Resource, SiteView } from "../clinical/prevention/simulation-types.ts"
import { NhsSimClient } from "../integration/nhssim-client.ts"
import {
  PolicyDraftSchema,
  interpretPolicy,
  outcomeDefinitions,
  policyExamples,
  previewActions,
  selectEligiblePatients,
} from "../extraction/policy-workbench.ts"

interface ExperimentJob {
  status: "queued" | "running" | "complete" | "failed"
  progress: ExperimentProgress
  result?: CommunityExperimentResult
  error?: string
  createdAt: number
}

const jobs = new Map<string, ExperimentJob>()
const port = Number(process.env.API_PORT ?? 4174)

function policyData(sourceText: string = policyExamples[0].text) {
  const policy = interpretPolicy(sourceText)
  return {
    policy,
    examples: policyExamples,
    preview: previewActions(policy),
    outcomes: outcomeDefinitions(policy),
    liveSupported: policy.kind === "community",
    disclaimer: "Outcomes are simulator resource counts and elapsed times, not inferred clinical effects.",
  }
}

async function eligibility(policyInput: unknown) {
  const policy = PolicyDraftSchema.parse(policyInput)
  if (policy.kind !== "community") {
    return { available: false, count: null, examples: [], note: "Live execution currently supports community policies only." }
  }

  const client = new NhsSimClient()
  const [gp, community] = await Promise.all([
    client.get<SiteView>("/api/sites/gp/view", { offset: 0, limit: 500 }),
    client.get<SiteView>("/api/sites/community/view", { offset: 0, limit: 500 }),
  ])
  const resources = [...gp.resources, ...community.resources]
  const patientIds = selectEligiblePatients(policy, resources, gp.now)
  const selected = new Set(patientIds)
  return {
    available: true,
    count: patientIds.length,
    examples: resources
      .filter((resource: Resource) => resource.patientId && selected.has(resource.patientId) && /task/i.test(resource.kind))
      .sort((a: Resource, b: Resource) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt))
      .slice(0, 3)
      .map((resource: Resource) => ({ patientId: resource.patientId, title: resource.title, dueAt: resource.dueAt, priority: resource.priority })),
    checkedAt: gp.now,
    resourceCount: resources.length,
    note: "Read-only check against the configured synthetic world. Fresh experiment worlds are checked again before actions are sent.",
  }
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 64 * 1024) throw new Error("Request body is too large")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
  response.end(JSON.stringify(value))
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/api/health") return sendJson(response, { ok: true })
    if (url.pathname === "/api/policy" && request.method === "GET") return sendJson(response, policyData())

    if (url.pathname === "/api/policy/interpret" && request.method === "POST") {
      const body = await requestJson(request) as { text?: unknown }
      if (typeof body.text !== "string") throw new Error("Policy text is required")
      return sendJson(response, policyData(body.text))
    }

    if (url.pathname === "/api/policy/preview" && request.method === "POST") {
      const body = await requestJson(request) as { policy?: unknown }
      const policy = PolicyDraftSchema.parse(body.policy)
      return sendJson(response, { policy, preview: previewActions(policy), outcomes: outcomeDefinitions(policy), liveSupported: policy.kind === "community" })
    }

    if (url.pathname === "/api/policy/eligibility" && request.method === "POST") {
      const body = await requestJson(request) as { policy?: unknown }
      return sendJson(response, await eligibility(body.policy))
    }

    if (url.pathname === "/api/policy/run" && request.method === "POST") {
      const body = await requestJson(request) as { policy?: unknown; confirm?: unknown }
      if (body.confirm !== true) throw new Error("Explicit experiment confirmation is required")
      const policy = PolicyDraftSchema.parse(body.policy)
      const jobId = randomUUID()
      const job: ExperimentJob = {
        status: "queued",
        progress: { percent: 0, stage: "Queued", detail: "Waiting to start the controlled experiment" },
        createdAt: Date.now(),
      }
      jobs.set(jobId, job)
      void runCommunityExperiment(policy, (progress) => {
        job.status = "running"
        job.progress = progress
      }).then((result) => {
        job.status = "complete"
        job.progress = { percent: 100, stage: "Complete", detail: "Control-adjusted observed outcomes are ready" }
        job.result = result
      }).catch((error) => {
        job.status = "failed"
        job.error = error instanceof Error ? error.message : String(error)
        job.progress = { ...job.progress, stage: "Experiment failed", detail: job.error }
      })
      return sendJson(response, { jobId, status: job.status, progress: job.progress }, 202)
    }

    const match = url.pathname.match(/^\/api\/policy\/run\/([0-9a-f-]+)$/i)
    if (match && request.method === "GET") {
      const job = jobs.get(match[1]!)
      return job ? sendJson(response, job) : sendJson(response, { error: "Experiment job not found" }, 404)
    }

    sendJson(response, { error: "Not found" }, 404)
  } catch (error) {
    sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 400)
  }
})

server.listen(port, "127.0.0.1", () => {
  console.log(`Policy API: http://127.0.0.1:${port}`)
})

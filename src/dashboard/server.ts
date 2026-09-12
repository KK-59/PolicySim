import "dotenv/config"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { parseDocument } from "../extraction/parse.ts"
import { extractCommitments } from "../extraction/commitments.ts"
import { toParams } from "../extraction/to-params.ts"
import { BASELINE } from "../contracts/baseline.ts"
import { runWorlds } from "../worlds/index.ts"
import { run } from "../engine/index.ts"
import { sweepLever } from "../worlds/sweep.ts"
import { selectWorlds } from "../worlds/select.ts"
import SEED from "../../fixtures/seed-state.json" with { type: "json" }
import type { Params } from "../contracts/params.ts"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { extname, join } from "node:path"
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

const DOCUMENTS_DIR = "documents"

interface DocumentEntry {
  id: string
  kind: "real" | "generated"
  file: string
  title: string
  publisher: string
  date: string
  pages: number
  note: string
}

let manifestCache: { documents: DocumentEntry[] } | undefined

/** Read once. The catalogue does not change while the server is up. */
async function documentManifest(): Promise<{ documents: DocumentEntry[] }> {
  if (!manifestCache) {
    const raw = await readFile(join(DOCUMENTS_DIR, "manifest.json"), "utf8")
    manifestCache = JSON.parse(raw) as { documents: DocumentEntry[] }
  }
  return manifestCache
}

/**
 * Read a document and turn it into parameters. Shared by the upload route and the catalogue
 * route, because "a document the user dragged in" and "a document we ship" differ only in where
 * the bytes came from, and nothing downstream should be able to tell them apart.
 *
 * Returns `params` as well as `rows`: the rows are what the parameters screen renders, and the
 * params are what the engine needs. Computing the params and discarding them is what left the
 * worlds screen showing a precomputed baseline no matter what anyone uploaded.
 */
async function extractFrom(bytes: Uint8Array, filename: string, notes: string) {
  const document = await parseDocument(bytes, filename)

  // A PDF of scanned pages parses to almost nothing. Saying so beats sending an empty
  // document to the model and rendering whatever it invents to fill the silence.
  if (document.chars < 200) {
    throw new Error(
      `Only ${document.chars} characters of text came out of ${filename}. `
      + "If it is a scan, it needs OCR — there is no text layer to read.",
    )
  }

  const extraction = await extractCommitments(document.text, { notes: notes || undefined })
  const mapped = await toParams(extraction.commitments)

  return {
    document: {
      filename,
      format: document.format,
      pages: document.pages,
      chars: document.chars,
      extractedAt: Date.now(),
      notes,
    },
    commitments: extraction.commitments,
    rejected: extraction.rejected,
    rows: mapped.rows,
    params: mapped.params,
    model: extraction.model,
    charsRead: extraction.charsRead,
    truncated: extraction.truncated,
  }
}

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

/**
 * Body size caps.
 *
 * The policy endpoints take a small JSON object and 64KB is a reasonable guard on them. Uploads
 * are a different shape entirely: a 24-page board paper is a few megabytes before base64 adds a
 * third, so the same cap rejected every real document while passing every test fixture.
 */
const SMALL_BODY = 64 * 1024
const UPLOAD_BODY = 32 * 1024 * 1024
/** A Params object with every leaf and its citation. Bigger than SMALL_BODY, nowhere near an upload. */
const PARAMS_BODY = 1024 * 1024

async function requestJson(request: IncomingMessage, maxBytes = SMALL_BODY): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      // Name both numbers. "Too large" leaves the user guessing whether they are over by a
      // kilobyte or a hundred megabytes, and the answer changes what they do next.
      throw new Error(
        `Request body is too large: over ${(maxBytes / 1024 / 1024).toFixed(1)}MB. `
        + "A document this size needs splitting, or the relevant chapter extracting first.",
      )
    }
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

    /**
     * Read an uploaded policy document.
     *
     * The document arrives base64-encoded in JSON rather than as multipart, because the whole
     * exchange is one file and a hand-rolled multipart parser is more code than the feature.
     *
     * Server-side because the OpenAI key lives here. A key shipped to the browser is a key
     * published, and this is the only part of the product that needs one.
     */
    if (url.pathname === "/api/extract" && request.method === "POST") {
      const body = await requestJson(request, UPLOAD_BODY) as {
        filename?: unknown
        contentBase64?: unknown
        notes?: unknown
      }
      if (typeof body.filename !== "string" || typeof body.contentBase64 !== "string") {
        throw new Error("filename and contentBase64 are required")
      }

      const bytes = new Uint8Array(Buffer.from(body.contentBase64, "base64"))
      return sendJson(response, await extractFrom(bytes, body.filename, typeof body.notes === "string" ? body.notes : ""))
    }

    // The same read, for a document already on disk. A catalogued PDF does not need to travel to
    // the browser and back again just to be read.
    const docExtract = url.pathname.match(/^\/api\/documents\/([a-z0-9-]+)\/extract$/i)
    if (docExtract && request.method === "POST") {
      const manifest = await documentManifest()
      const entry = manifest.documents.find((d) => d.id === docExtract[1])
      if (!entry) return sendJson(response, { error: "No such document" }, 404)
      const bytes = new Uint8Array(await readFile(join(DOCUMENTS_DIR, entry.file)))
      return sendJson(response, await extractFrom(bytes, entry.file.split("/").pop() ?? entry.file, ""))
    }

    // --- documents -----------------------------------------------------------------------
    // The catalogue the drawer renders. `kind` separates a real publication from one we wrote,
    // and the interface is required to keep them visibly apart.
    if (url.pathname === "/api/documents" && request.method === "GET") {
      return sendJson(response, await documentManifest())
    }

    // Served BY ID, never by path. A path parameter here would be a directory traversal waiting
    // to happen; an id can only ever resolve to a file the manifest already names.
    const doc = url.pathname.match(/^\/api\/documents\/([a-z0-9-]+)$/i)
    if (doc && request.method === "GET") {
      const manifest = await documentManifest()
      const entry = manifest.documents.find((d) => d.id === doc[1])
      if (!entry) return sendJson(response, { error: "No such document" }, 404)

      const bytes = await readFile(join(DOCUMENTS_DIR, entry.file))
      const type = extname(entry.file) === ".pdf" ? "application/pdf" : "text/markdown; charset=utf-8"
      response.writeHead(200, {
        "Content-Type": type,
        // Inline so a click opens it in a tab rather than downloading it. Seeing the real
        // publication is the point: it is what makes the provenance checkable.
        "Content-Disposition": `inline; filename="${entry.file.split("/").pop()}"`,
        "Content-Length": bytes.byteLength,
      })
      return response.end(bytes)
    }

    if (url.pathname === "/api/run" && request.method === "POST") {
      const body = await requestJson(request) as { levers?: unknown; samples?: unknown }
      const overrides = (body.levers ?? {}) as Record<string, number>

      // Rebuild from BASELINE and apply only the lever values. The client never sends a whole
      // Params: it has no business setting a measured capacity or a service time, and accepting
      // one would let the page silently redefine the world it claims to be simulating.
      const policy: Params = structuredClone(BASELINE)
      const levers = policy.levers as unknown as Record<string, { value: number; bounds: readonly [number, number] }>
      for (const [path, value] of Object.entries(overrides)) {
        const key = path.startsWith("levers.") ? path.slice("levers.".length) : path
        const leaf = levers[key]
        if (!leaf || typeof value !== "number" || !Number.isFinite(value)) continue
        leaf.value = Math.min(leaf.bounds[1], Math.max(leaf.bounds[0], value))
      }

      const samples = typeof body.samples === "number" ? Math.min(60, Math.max(8, body.samples)) : 24
      const horizonDays = 450

      const metrics = runWorlds(policy, { samples, horizonDays, baseline: BASELINE })

      // Sweep the constraint the plan turns on, with the policy's own position marked.
      const positions = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]
      const chosen = policy.levers.communityCapacityMultiplier.value
      const nearest = positions.reduce(
        (best, v, i) => (Math.abs(v - chosen) < Math.abs((positions[best] as number) - chosen) ? i : best),
        0,
      )
      const sweep = sweepLever(policy, {
        path: "levers.communityCapacityMultiplier",
        label: "Community capacity",
        unit: "x current",
        baseValue: BASELINE.capacities.communitySlotsPerDay.value,
        baseUnit: "visits per day",
        positions,
        policyIndex: nearest,
        samples: Math.min(samples, 20),
        horizonDays,
      })

      return sendJson(response, { metrics, sweep, ranAt: Date.now(), samples, horizonDays })
    }

    /**
     * A traced window of the simulation, for the world view.
     *
     * Separate from /api/run because the costs are opposite: a run is seconds of sampling and a
     * small result, this is one run and a large one. Asking for both at once would make the
     * result screen wait on a payload it does not use.
     *
     * The window is short by construction. Fourteen sim-days is about five thousand events, which
     * is a scrubber someone can actually drag; a year would be a download.
     */
    if (url.pathname === "/api/world" && request.method === "POST") {
      const body = await requestJson(request) as {
        levers?: unknown
        days?: unknown
        world?: unknown
      }
      const overrides = (body.levers ?? {}) as Record<string, number>
      const days = typeof body.days === "number" ? Math.min(28, Math.max(3, body.days)) : 14
      const wanted = body.world === "optimistic" || body.world === "pessimistic"
        ? body.world
        : "realistic" as const

      const policy: Params = structuredClone(BASELINE)
      const levers = policy.levers as unknown as Record<string, { value: number; bounds: readonly [number, number] }>
      for (const [path, value] of Object.entries(overrides)) {
        const key = path.startsWith("levers.") ? path.slice("levers.".length) : path
        const leaf = levers[key]
        if (!leaf || typeof value !== "number" || !Number.isFinite(value)) continue
        leaf.value = Math.min(leaf.bounds[1], Math.max(leaf.bounds[0], value))
      }

      // Which of the three worlds to watch.
      //
      // Not a re-roll: the same draws, seed and scoring as the sweep, so the pessimistic world
      // scrubbed here is the pessimistic world the chart was drawn from. Watching a differently
      // sampled pessimistic run would be a second answer to the same question.
      const selected = selectWorlds(policy, { samples: 16, horizonDays: 450, seed: 1 })[wanted]

      // Warm up first, then watch. Opening on an empty waiting room would show a neighbourhood
      // that has just been switched on rather than one that has been running.
      const DAY = 1440
      const warmupDays = 60
      const world = structuredClone(selected.params)
      world.sim.warmupDays = warmupDays
      world.sim.horizonDays = warmupDays + days

      // Start from the real world's open work, placed at the moment the window opens.
      //
      // This is the PRD's claim made literal: the simulator is ground truth, and the engine picks
      // up where it left off. The people in the queue at t=0 are the ones NHS-SIM actually has
      // waiting, with the time they have already waited carried over. Everything after is ours,
      // and the page says so.
      const traceOpts = { from: warmupDays * DAY, to: (warmupDays + days) * DAY }
      const outcome = run(world, selected.seed, {
        trace: traceOpts,
        seedItems: SEED.items,
        seedAt: warmupDays * DAY,
      })

      /**
       * The same world with the policy switched off.
       *
       * Same seed, same parameter draw, same seeded backlog, same arrival stream — only the
       * levers differ. That makes the difference between the two traces the policy's effect and
       * nothing else, which is the whole reason for running a seeded simulation rather than
       * observing a real one. Two runs you cannot hold everything else constant between can only
       * be compared statistically; these can be compared item by item.
       */
      const control = structuredClone(selected.params)
      control.sim.warmupDays = warmupDays
      control.sim.horizonDays = warmupDays + days
      for (const key of Object.keys(overrides)) {
        const k = key.startsWith("levers.") ? key.slice("levers.".length) : key
        const baseLeaf = (BASELINE.levers as unknown as Record<string, { value: number }>)[k]
        const ctlLeaf = (control.levers as unknown as Record<string, { value: number }>)[k]
        if (baseLeaf && ctlLeaf) ctlLeaf.value = baseLeaf.value
      }
      const controlOutcome = run(control, selected.seed, {
        trace: traceOpts,
        seedItems: SEED.items,
        seedAt: warmupDays * DAY,
      })

      return sendJson(response, {
        world: wanted,
        seed: { capturedAt: SEED.capturedAt, items: SEED.items.length, source: SEED.source },
        windowStart: warmupDays * DAY,
        windowEnd: (warmupDays + days) * DAY,
        days,
        trace: outcome.trace ?? [],
        controlTrace: controlOutcome.trace ?? [],
        /** Which levers actually differ from baseline, for the legend. */
        changed: Object.keys(overrides).filter((key) => {
          const k = key.startsWith("levers.") ? key.slice("levers.".length) : key
          const b = (BASELINE.levers as unknown as Record<string, { value: number }>)[k]
          return b !== undefined && b.value !== overrides[key]
        }),
        nodes: Object.entries(outcome.perNode).map(([id, state]) => ({
          id,
          utilisation: state?.utilisation ?? 0,
          stable: state?.stable ?? true,
        })),
      })
    }

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

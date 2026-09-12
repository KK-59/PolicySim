import "dotenv/config"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { parseDocument } from "../extraction/parse.ts"
import { extractCommitments } from "../extraction/commitments.ts"
import { toParams } from "../extraction/to-params.ts"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { runWorlds } from "../worlds/index.ts"
import { BASELINE } from "../contracts/baseline.ts"
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

    // --- the run -------------------------------------------------------------------------------
    // The hop that was missing. /api/extract already computes the Params and threw them away, so
    // whatever document you uploaded, the worlds screen showed the same precomputed baseline.
    // This runs the engine on the parameters that came out of YOUR document.
    if (url.pathname === "/api/run" && request.method === "POST") {
      const body = await requestJson(request, PARAMS_BODY) as { params?: unknown; samples?: unknown; horizonDays?: unknown }
      if (!body.params || typeof body.params !== "object") throw new Error("params are required")

      // The fidelity the shipped fixtures are built at (scripts/build-ui-data.ts). Matching it is
      // what makes this the real thing rather than a cheaper approximation of it.
      const samples = typeof body.samples === "number" ? body.samples : 60
      const horizonDays = typeof body.horizonDays === "number" ? body.horizonDays : 550

      const startedAt = Date.now()
      const metrics = runWorlds(body.params as Parameters<typeof runWorlds>[0], {
        samples,
        horizonDays,
        baseline: BASELINE,
      })
      return sendJson(response, { metrics, samples, horizonDays, elapsedMs: Date.now() - startedAt })
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

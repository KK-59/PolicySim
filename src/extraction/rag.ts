/**
 * Stage 2: deterministic retrieval over the curated evidence corpus.
 *
 * Retrieval deliberately returns evidence, not a ready-made parameter. The caller must still
 * check `applicability` before mapping a reported estimate to a model field. For example, an
 * admission risk ratio is evidence about an intervention effect; it is not a routing share.
 */

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export type EvidenceKind = "measured" | "documented" | "literature"
export type Applicability = "direct" | "supporting" | "boundary"

export interface CorpusChunk {
  id: string
  sourceId: string
  title: string
  year: number
  url?: string
  parameterPaths: string[]
  rangeOrCi: boolean
  evidenceKind: EvidenceKind
  applicability: Applicability
  text: string
}

export interface RetrievalOptions {
  limit?: number
  /** Keep only evidence reporting an interval, range, or explicit observed variation. */
  requireRange?: boolean
  /** Prefer exact contract paths. Supporting evidence can still be returned below direct hits. */
  parameterPath?: string
  corpusPath?: string
}

export interface LiteratureHit extends CorpusChunk {
  score: number
  matchedTerms: string[]
}

const DEFAULT_CORPUS_PATH = fileURLToPath(
  new URL("../../corpus/chunks.jsonl", import.meta.url),
)

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it",
  "of", "on", "or", "that", "the", "this", "to", "with",
])

const ALIASES: Record<string, string[]> = {
  admin: ["administrative", "paperwork", "nonclinical"],
  community: ["district", "home", "neighbourhood", "ucr"],
  consultation: ["appointment", "encounter", "visit"],
  discharge: ["transition", "transitional", "readmission", "homefirst"],
  gp: ["general", "practice", "primarycare"],
  monitoring: ["remote", "wearable", "rpm", "telemonitoring"],
  routing: ["referral", "transfer", "pathway"],
}

function normalise(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function queryTerms(query: string, parameterPath?: string): Set<string> {
  const terms = new Set(normalise(`${parameterPath ?? ""} ${query}`))
  for (const term of [...terms]) {
    for (const alias of ALIASES[term] ?? []) terms.add(alias)
  }
  return terms
}

export async function loadCorpus(corpusPath = DEFAULT_CORPUS_PATH): Promise<CorpusChunk[]> {
  const raw = await readFile(corpusPath, "utf8")
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as CorpusChunk
      } catch (error) {
        throw new Error(`Invalid corpus JSONL at line ${index + 1}`, { cause: error })
      }
    })
}

export function rankCorpus(
  chunks: readonly CorpusChunk[],
  query: string,
  options: RetrievalOptions = {},
): LiteratureHit[] {
  const terms = queryTerms(query, options.parameterPath)
  const requestedPath = options.parameterPath?.toLowerCase()

  return chunks
    .filter((chunk) => !options.requireRange || chunk.rangeOrCi)
    .map((chunk) => {
      const haystack = new Set(normalise(`${chunk.title} ${chunk.text} ${chunk.parameterPaths.join(" ")}`))
      const matchedTerms = [...terms].filter((term) => haystack.has(term))
      const exactPath = requestedPath
        ? chunk.parameterPaths.some((path) => path.toLowerCase() === requestedPath)
        : false
      const pathFamily = requestedPath
        ? chunk.parameterPaths.some((path) => requestedPath.startsWith(path.split(".")[0] ?? "!"))
        : false
      const applicabilityWeight = chunk.applicability === "direct" ? 5 : chunk.applicability === "supporting" ? 2 : 0
      const score = matchedTerms.length * 3 + (exactPath ? 18 : 0) + (pathFamily ? 3 : 0)
        + (chunk.rangeOrCi ? 2 : 0) + applicabilityWeight
      return { ...chunk, score, matchedTerms }
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.year - a.year || a.id.localeCompare(b.id))
    .slice(0, options.limit ?? 5)
}

export async function retrieveLiterature(
  query: string,
  options: RetrievalOptions = {},
): Promise<LiteratureHit[]> {
  return rankCorpus(await loadCorpus(options.corpusPath), query, options)
}

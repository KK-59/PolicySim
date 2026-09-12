import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const chunksPath = resolve(import.meta.dirname, "../corpus/chunks.jsonl")
const raw = (await readFile(chunksPath, "utf8")).trim()
if (!raw) throw new Error("Corpus has no chunks; run npm run corpus:build and inspect source-card sections")
const chunks = raw.split("\n").map(JSON.parse)
const sourceIds = new Set(chunks.map((chunk) => chunk.sourceId))
const invalid = chunks.filter((chunk) =>
  !chunk.id || !chunk.sourceId || !chunk.title || !chunk.text || !Array.isArray(chunk.parameterPaths)
)
const numeric = chunks.filter((chunk) => /\d/.test(chunk.text))
const interval = chunks.filter((chunk) => chunk.rangeOrCi)

if (invalid.length) throw new Error(`${invalid.length} malformed chunks`)
if (sourceIds.size < 30) throw new Error(`Expected at least 30 sources, found ${sourceIds.size}`)
if (numeric.length / chunks.length < 0.5) throw new Error("Fewer than half of chunks preserve numeric evidence")
if (interval.length / chunks.length < 0.3) throw new Error("Too little range/CI evidence")

console.log(`${sourceIds.size} sources; ${chunks.length} chunks; ${numeric.length} numeric; ${interval.length} range/CI.`)

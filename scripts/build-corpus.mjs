import { readdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const documentsDir = resolve(root, "corpus/documents")
const outputPath = resolve(root, "corpus/chunks.jsonl")
const indexPath = resolve(root, "corpus/sources.md")

function metadata(markdown, key) {
  const match = markdown.match(new RegExp(`^- ${key}:\\s*(.+)$`, "mi"))
  if (!match?.[1]) throw new Error(`Missing '${key}' metadata`)
  return match[1].trim()
}

function section(markdown, heading) {
  const match = markdown.match(new RegExp(`## ${heading}\\n+([\\s\\S]*?)(?:\\n## |$)`))
  return match?.[1]?.trim() ?? ""
}

function paragraphs(value) {
  return value.split(/\n\s*\n/).map((part) => part.replace(/\n/g, " ").trim()).filter(Boolean)
}

const files = (await readdir(documentsDir)).filter((file) => file.endsWith(".md")).sort()
const chunks = []
const sources = []

for (const file of files) {
  const markdown = await readFile(resolve(documentsDir, file), "utf8")
  const sourceId = metadata(markdown, "ID")
  const title = markdown.match(/^# (.+)$/m)?.[1]
  if (!title) throw new Error(`${file}: missing title`)
  const year = Number(metadata(markdown, "Year"))
  const source = metadata(markdown, "Source")
  const parameterPaths = metadata(markdown, "Parameters")
    .split(",").map((value) => value.trim()).filter((value) => value !== "context-only")
  const rangeOrCi = metadata(markdown, "Range or CI").toLowerCase() === "yes"
  const evidenceKind = metadata(markdown, "Evidence kind")
  const applicability = metadata(markdown, "Applicability")
  const url = source.startsWith("http") ? source : undefined

  const evidence = paragraphs(section(markdown, "Evidence"))
  const caveats = section(markdown, "Modelling use and caveats")
  sources.push({ sourceId, title, year, parameterPaths, rangeOrCi, file })
  for (const [index, paragraph] of evidence.entries()) {
    chunks.push({
      id: `${sourceId}:${index + 1}`,
      sourceId,
      title,
      year,
      ...(url ? { url } : {}),
      parameterPaths,
      rangeOrCi,
      evidenceKind,
      applicability,
      text: `${paragraph} ${caveats}`.trim(),
    })
  }
}

await writeFile(outputPath, `${chunks.map((chunk) => JSON.stringify(chunk)).join("\n")}\n`)
const index = [
  "# Source index",
  "",
  "One row per curated source card. `id` is the stable citation shown in the parameter table and UI.",
  "Cards paraphrase the source and preserve numeric context; follow the source URL for the full document.",
  "",
  "| id | Document | Year | Gives | Range or CI? | File |",
  "|---|---|---:|---|:---:|---|",
  ...sources.map((source) => {
    const gives = source.parameterPaths.length ? source.parameterPaths.join(", ") : "Policy or outcome context"
    return `| ${source.sourceId} | ${source.title} | ${source.year} | ${gives} | ${source.rangeOrCi ? "yes" : "no"} | [card](documents/${source.file}) |`
  }),
  "",
].join("\n")
await writeFile(indexPath, index)
console.log(`Wrote ${chunks.length} context-preserving chunks and indexed ${files.length} documents.`)

import { describe, expect, it } from "vitest"
import { loadCorpus, rankCorpus, retrieveLiterature, type CorpusChunk } from "./rag.ts"

const chunks: CorpusChunk[] = [
  {
    id: "admin:1",
    sourceId: "gp-workload-trends-2024",
    title: "GP administrative workload",
    year: 2024,
    parameterPaths: ["capacities.gpAdminShare"],
    rangeOrCi: true,
    evidenceKind: "literature",
    applicability: "direct",
    text: "Administrative work rose from 16.3% to 29.6% of GP workload.",
  },
  {
    id: "rpm:1",
    sourceId: "rpm-utilisation-2025",
    title: "Remote patient monitoring",
    year: 2025,
    parameterPaths: ["levers.monitoringIntensity"],
    rangeOrCi: true,
    evidenceKind: "literature",
    applicability: "supporting",
    text: "Hospitalisation risk ratio 0.86 with 95% CI 0.77 to 0.95.",
  },
]

describe("evidence retrieval", () => {
  it("prefers exact, directly applicable parameter evidence", () => {
    const hits = rankCorpus(chunks, "share of GP time spent on admin", {
      parameterPath: "capacities.gpAdminShare",
      requireRange: true,
    })
    expect(hits[0]?.sourceId).toBe("gp-workload-trends-2024")
    expect(hits[0]?.applicability).toBe("direct")
  })

  it("loads the generated corpus and retrieves interval evidence", async () => {
    const corpus = await loadCorpus()
    expect(corpus.length).toBeGreaterThanOrEqual(30)
    const hits = await retrieveLiterature("remote monitoring hospital admission", {
      parameterPath: "levers.monitoringIntensity",
      requireRange: true,
    })
    expect(hits.some((hit) => hit.sourceId === "rpm-utilisation-2025")).toBe(true)
    expect(hits.every((hit) => hit.rangeOrCi)).toBe(true)
  })
})

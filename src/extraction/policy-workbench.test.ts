import { describe, expect, it } from "vitest"
import {
  communityInteractions,
  interpretPolicy,
  outcomeDefinitions,
  policyExamples,
  previewActions,
  resourceFingerprint,
  selectEligiblePatients,
} from "./policy-workbench.ts"
import type { Resource } from "../clinical/prevention/simulation-types.ts"

describe("policy workbench", () => {
  it("interprets community policies and resolves cross-service interactions", () => {
    const policy = interpretPolicy(policyExamples[0].text)
    expect(policy.kind).toBe("community")
    expect(policy.population.rule).toBe("due_within_horizon")
    expect(policy.constraints.maxPerDay).toBe(8)
    expect(policy.horizonHours).toBe(720)
    expect(policy.intervention.createGpTask).toBe(true)
    expect(policy.intervention.sendMessage).toBe(true)
    expect(communityInteractions(policy, "SIM-1").map((item) => item.action.type)).toEqual([
      "schedule_visit", "create_task", "messaging_action",
    ])
    expect(previewActions(policy).map((item) => item.site)).toEqual(["community", "gp", "gp"])
    expect(outcomeDefinitions(policy)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "careGapHours", unit: "hours" }),
      expect.objectContaining({ key: "coverageRate", unit: "percent" }),
    ]))
  })

  it("adds diagnostics to an integrated community bundle", () => {
    const policy = interpretPolicy(policyExamples[0].text)
    policy.intervention.orderTest = true
    policy.intervention.panelId = "hba1c"
    policy.intervention.priority = "urgent"
    policy.intervention.collection = "now"
    expect(communityInteractions(policy, "SIM-1").map((item) => item.action.type)).toEqual([
      "schedule_visit", "create_task", "messaging_action", "order_test",
    ])
  })

  it("parses pharmacy and diagnostics constraints", () => {
    const pharmacy = interpretPolicy("Replenish products below reorder level to twice that level. Spend no more than £500 over the next 7 days.")
    expect(pharmacy.kind).toBe("pharmacy")
    expect(pharmacy.intervention.targetRatio).toBe(2)
    expect(pharmacy.constraints.maxSpendPence).toBe(50_000)

    const diagnostics = interpretPolicy("Order urgent HbA1c tests with immediate collection for open urgent tasks, up to 12 tests per day, and observe outcomes for 6 hours.")
    expect(diagnostics.intervention.panelId).toBe("hba1c")
    expect(diagnostics.intervention.collection).toBe("now")
    expect(diagnostics.horizonHours).toBe(6)
  })

  it("selects eligible patients deterministically", () => {
    const policy = interpretPolicy("Over the next 7 days, schedule community visits for patients with open community-care tasks due now or during that period, up to 8 visits per day.")
    const resources: Resource[] = [
      { id: "now", patientId: "SIM-1", kind: "task", title: "Due now", status: "open", owner: "gp", priority: "urgent", createdAt: 10, dueAt: 100, data: {}, version: 1 },
      { id: "later", patientId: "SIM-2", kind: "task", title: "Later", status: "open", owner: "gp", priority: "urgent", createdAt: 20, dueAt: 200, data: {}, version: 1 },
      { id: "outside", patientId: "SIM-4", kind: "task", title: "Outside", status: "open", owner: "gp", priority: "routine", createdAt: 20, dueAt: 604_800_101, data: {}, version: 1 },
      { id: "done", patientId: "SIM-3", kind: "task", title: "Done", status: "completed", owner: "gp", priority: "urgent", createdAt: 5, dueAt: 40, data: {}, version: 1 },
    ]
    expect(selectEligiblePatients(policy, resources, 100)).toEqual(["SIM-1", "SIM-2"])
    expect(resourceFingerprint(resources)).toEqual({ "task:open": 3, "task:completed": 1 })
  })
})

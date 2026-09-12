import { randomUUID } from "node:crypto"
import { NhsSimClient, configFromEnv, type ClientConfig } from "../../integration/nhssim-client.ts"
import { PolicyDraftSchema, assertLiveExperimentLimits, communityInteractions, resourceFingerprint, selectEligiblePatients, type PolicyDraft } from "../../extraction/policy-workbench.ts"
import type { Resource, SiteName, SiteView, WorldCredentials } from "./simulation-types.ts"

class ExperimentClient extends NhsSimClient {
  view(site: SiteName): Promise<SiteView> {
    return this.get<SiteView>(`/api/sites/${site}/view`, { offset: 0, limit: 500 })
  }

  clock(): Promise<{ now: number; paused: boolean; speed: number; events: unknown[] }> {
    return this.get("/api/clock")
  }

  advance(minutes: number): Promise<{ now: number; paused: boolean; speed: number; events: unknown[] }> {
    return this.post("/api/clock", { paused: true, advanceMinutes: minutes })
  }

  actionAt(site: SiteName, action: Record<string, unknown>, idempotencyKey: string): Promise<Resource> {
    return this.post(`/api/sites/${site}/actions`, action, idempotencyKey)
  }
}

function experimentConfig(teamKey: string): ClientConfig {
  return { ...configFromEnv(), teamKey, timeoutMs: 45_000, maxRetries: 2 }
}

async function createWorld(teamName: string): Promise<WorldCredentials> {
  const bootstrap = new NhsSimClient({ ...configFromEnv(), timeoutMs: 45_000, maxRetries: 5 })
  return bootstrap.request<WorldCredentials>("/api/keys", {
    method: "POST",
    body: { teamName },
    retries: 5,
  })
}

export interface ObservedOutcomeRow {
  label: string;
  control: number | null;
  baseline: number | null;
  intervention: number | null;
  deltaA: number | null;
  deltaB: number | null;
  difference: number | null;
  unit: "count" | "hours" | "percent";
  source: string;
}

export interface CommunityExperimentResult {
  experimentId: string;
  policy: PolicyDraft;
  worlds: { control: string; policyA: string; policyB: string };
  comparableStart: boolean;
  eligiblePatients: number;
  attemptedActions: number;
  acceptedActions: number;
  rejectedActions: number;
  startedAt: number;
  endedAt: number;
  outcomes: ObservedOutcomeRow[];
  observedSites: Array<{
    site: SiteName;
    controlReturned: number;
    controlTotal: number;
    baselineReturned: number;
    baselineTotal: number;
    interventionReturned: number;
    interventionTotal: number;
  }>;
  policyArms: {
    control: { label: string; description: string; attempted: number; accepted: number; rejected: number };
    a: { label: string; description: string; attempted: number; accepted: number; rejected: number };
    b: { label: string; description: string; attempted: number; accepted: number; rejected: number };
  };
  actionReceipts: Array<{ arm: "a" | "b"; patientId: string; site: SiteName; actionType: string; accepted: boolean; resourceId?: string; error?: string }>;
  note: string;
}

export interface ExperimentProgress {
  percent: number;
  stage: string;
  detail: string;
}

type ProgressReporter = (progress: ExperimentProgress) => void;
const observedSiteNames = ["gp", "hospital", "community", "diagnostics", "pharmacy", "wearables"] as const satisfies readonly SiteName[];
type ObservedSite = typeof observedSiteNames[number];
type SiteSnapshot = Record<ObservedSite, SiteView>;

async function readObservedSites(client: ExperimentClient): Promise<SiteSnapshot> {
  const views = await Promise.all(observedSiteNames.map((site) => client.view(site)));
  return Object.fromEntries(observedSiteNames.map((site, index) => [site, views[index]!])) as SiteSnapshot;
}

function isVisit(resource: Resource): boolean { return /visit/i.test(resource.kind); }
function isMessage(resource: Resource): boolean { return /message|conversation/i.test(resource.kind); }
function isDiagnostic(resource: Resource): boolean { return /test|diagnostic|pathology|report/i.test(resource.kind); }
function isCompleted(resource: Resource): boolean { return ["completed", "complete"].includes(resource.status.toLowerCase()); }
function isAvailable(resource: Resource): boolean { return ["completed", "complete", "available", "reviewed", "filed"].includes(resource.status.toLowerCase()); }
function isOpen(resource: Resource): boolean {
  return !["completed", "complete", "available", "reviewed", "closed", "rejected", "cancelled", "filed", "collected", "failed"].includes(resource.status.toLowerCase());
}
function count(resources: Resource[], predicate: (resource: Resource) => boolean): number { return resources.filter(predicate).length; }
function deltaCount(before: SiteView, after: SiteView, predicate: (resource: Resource) => boolean): number {
  return count(after.resources, predicate) - count(before.resources, predicate);
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function completionHours(resources: Resource[], ids: Set<string>): number | null {
  const durations = resources.flatMap((resource) => {
    if (!ids.has(resource.id) || !isCompleted(resource)) return [];
    const completion = resource.provenance?.changes?.filter((change) => /complete/i.test(change.action ?? "") && typeof change.time === "number").at(-1)?.time;
    return typeof completion === "number" ? [(completion - resource.createdAt) / 3_600_000] : [];
  });
  const value = median(durations);
  return value === null ? null : Math.round(value * 10) / 10;
}
function completionTime(resource: Resource): number | null {
  const time = resource.provenance?.changes
    ?.filter((change) => /complete|available|deliver/i.test(change.action ?? "") && typeof change.time === "number")
    .at(-1)?.time;
  return typeof time === "number" ? time : null;
}
function percentage(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round(numerator / denominator * 1_000) / 10;
}
function uniquePatients(resources: Resource[], predicate: (resource: Resource) => boolean = () => true): Set<string> {
  return new Set(resources.flatMap((resource) => resource.patientId && predicate(resource) ? [resource.patientId] : []));
}
function followupState(resources: Resource[], ids: Set<string>): Map<string, { completed: boolean; createdAt: number; completionAt: number | null }> {
  return new Map(resources.flatMap((resource) => {
    if (!ids.has(resource.id) || !resource.patientId) return [];
    return [[resource.patientId, { completed: isCompleted(resource), createdAt: resource.createdAt, completionAt: completionTime(resource) }] as const];
  }));
}
function unresolvedHours(patientIds: string[], anchorByPatient: Map<string, number>, followups: Map<string, { completed: boolean; completionAt: number | null }>, endAt: number): number | null {
  let total = 0;
  for (const patientId of patientIds) {
    const anchor = anchorByPatient.get(patientId);
    if (anchor === undefined) return null;
    const followup = followups.get(patientId);
    if (followup?.completed && followup.completionAt === null) return null;
    total += Math.max(0, (Math.min(followup?.completionAt ?? endAt, endAt) - anchor) / 3_600_000);
  }
  return Math.round(total * 10) / 10;
}
function sameFingerprint(left: Resource[], right: Resource[]): boolean {
  const stable = (resources: Resource[]) => Object.entries(resourceFingerprint(resources)).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}
function sameSnapshot(left: SiteSnapshot, right: SiteSnapshot): boolean {
  return observedSiteNames.every((site) => left[site].resourceTotal === right[site].resourceTotal)
    && sameFingerprint(observedSiteNames.flatMap((site) => left[site].resources), observedSiteNames.flatMap((site) => right[site].resources));
}
function subtract(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : Math.round((left - right) * 10) / 10;
}
function outcome(label: string, control: number | null, policyA: number | null, policyB: number | null, unit: "count" | "hours" | "percent", source: string): ObservedOutcomeRow {
  return { label, control, baseline: policyA, intervention: policyB, deltaA: subtract(policyA, control), deltaB: subtract(policyB, control), difference: subtract(policyB, policyA), unit, source };
}

export async function runCommunityExperiment(input: PolicyDraft, report: ProgressReporter = () => {}): Promise<CommunityExperimentResult> {
  const policy = PolicyDraftSchema.parse(input);
  assertLiveExperimentLimits(policy);
  if (policy.kind !== "community" || policy.intervention.action !== "schedule_visit") {
    throw new Error("Live execution currently supports the community visit policy only. The other policies remain previewable.");
  }
  if (!policy.intervention.createGpTask && !policy.intervention.sendMessage && !policy.intervention.orderTest) {
    throw new Error("Policy B is identical to the visit-only Policy A. Enable at least one additional interaction before running the comparison.");
  }
  const policyA = PolicyDraftSchema.parse({
    ...policy,
    sourceText: "Visit-only comparison policy",
    intervention: { ...policy.intervention, createGpTask: false, sendMessage: false, orderTest: false },
  });

  const experimentId = randomUUID();
  const suffix = `${Date.now().toString(36)}${experimentId.slice(0, 6)}`;
  async function prepareWorld(label: string, teamName: string, percent: number) {
    report({ percent, stage: "Preparing worlds", detail: `Creating ${label} world; temporary gateway errors are retried automatically` });
    try {
      return await createWorld(teamName);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} world could not be created after retrying the simulator: ${detail || "gateway unavailable"}`);
    }
  }
  // The simulator is sensitive to bursts of world-creation requests, so initialise
  // each arm in sequence before making the parallel read-only calls below.
  const controlCredentials = await prepareWorld("Control", `control${suffix}`, 5);
  const policyACredentials = await prepareWorld("Policy A", `policya${suffix}`, 8);
  const policyBCredentials = await prepareWorld("Policy B", `policyb${suffix}`, 11);
  const control = new ExperimentClient(experimentConfig(controlCredentials.apiKey));
  const policyAClient = new ExperimentClient(experimentConfig(policyACredentials.apiKey));
  const policyBClient = new ExperimentClient(experimentConfig(policyBCredentials.apiKey));

  report({ percent: 15, stage: "Locking comparison", detail: "Loading six service views in all three worlds" });
  const [controlBefore, policyABefore, policyBBefore] = await Promise.all([
    readObservedSites(control), readObservedSites(policyAClient), readObservedSites(policyBClient),
  ]);
  const comparableStart = sameSnapshot(controlBefore, policyABefore) && sameSnapshot(controlBefore, policyBBefore);
  if (!comparableStart) throw new Error("The three new simulator worlds did not have matching starts. No policy actions were executed.");

  report({ percent: 30, stage: "Resolving eligibility", detail: "Applying the visible resource rule in oldest-due order" });
  const eligible = selectEligiblePatients(policy, [...policyBBefore.gp.resources, ...policyBBefore.community.resources], policyBBefore.community.now);
  const selected = eligible.slice(0, policy.constraints.maxPerDay * Math.ceil(policy.horizonHours / 24));
  if (selected.length === 0) throw new Error(`No patients matched “${policy.population.label}” at the start of the fresh simulator worlds. No actions were sent and no clocks were advanced.`);

  const receipts: CommunityExperimentResult["actionReceipts"] = [];
  let remainingMinutes = policy.horizonHours * 60;
  let [controlClock, policyAClock, policyBClock] = await Promise.all([control.clock(), policyAClient.clock(), policyBClient.clock()]);
  const totalDays = Math.ceil(policy.horizonHours / 24);
  async function advanceAll(minutes: number) {
    let outstanding = minutes;
    while (outstanding > 0) {
      const step = Math.min(10_080, outstanding);
      [controlClock, policyAClock, policyBClock] = await Promise.all([control.advance(step), policyAClient.advance(step), policyBClient.advance(step)]);
      outstanding -= step;
    }
  }

  for (let day = 0; remainingMinutes > 0; day += 1) {
    const batch = selected.slice(day * policy.constraints.maxPerDay, (day + 1) * policy.constraints.maxPerDay);
    report({
      percent: 35 + Math.round(day / Math.max(1, totalDays) * 45),
      stage: batch.length ? "Executing policies" : "Advancing worlds",
      detail: batch.length ? `Day ${day + 1}: applying Policy A and Policy B to ${batch.length} patients; Control receives no action` : `Day ${day + 1}: no remaining eligible patients`,
    });
    const interactions = batch.flatMap((patientId) => [
      ...communityInteractions(policyA, patientId).map((interaction, index) => ({ arm: "a" as const, client: policyAClient, patientId, interaction, index })),
      ...communityInteractions(policy, patientId).map((interaction, index) => ({ arm: "b" as const, client: policyBClient, patientId, interaction, index })),
    ]);
    receipts.push(...await Promise.all(interactions.map(async ({ arm, client, patientId, interaction, index }) => {
      const actionType = String(interaction.action.type);
      try {
        const resource = await client.actionAt(interaction.site, interaction.action, `${experimentId}-${arm}-${patientId}-${index}-${actionType}`);
        return { arm, patientId, site: interaction.site, actionType, accepted: true, resourceId: resource.id };
      } catch (error) {
        return { arm, patientId, site: interaction.site, actionType, accepted: false, error: error instanceof Error ? error.message : String(error) };
      }
    })));
    const stepMinutes = batch.length === 0 ? remainingMinutes : Math.min(1_440, remainingMinutes);
    await advanceAll(stepMinutes);
    remainingMinutes -= stepMinutes;
  }

  report({ percent: 85, stage: "Measuring outcomes", detail: "Reading final resources across six services in Control, Policy A and Policy B" });
  const [controlAfter, policyAAfter, policyBAfter] = await Promise.all([
    readObservedSites(control), readObservedSites(policyAClient), readObservedSites(policyBClient),
  ]);
  const acceptedIdsA = new Set(receipts.flatMap((receipt) => receipt.arm === "a" && receipt.resourceId ? [receipt.resourceId] : []));
  const acceptedIdsB = new Set(receipts.flatMap((receipt) => receipt.arm === "b" && receipt.resourceId ? [receipt.resourceId] : []));
  const visitsA = policyAAfter.community.resources.filter((resource) => acceptedIdsA.has(resource.id));
  const visitsB = policyBAfter.community.resources.filter((resource) => acceptedIdsB.has(resource.id));
  const armReceipts = (arm: "a" | "b") => receipts.filter((receipt) => receipt.arm === arm);
  const acceptedByType = (arm: "a" | "b", type: string) => receipts.filter((receipt) => receipt.arm === arm && receipt.accepted && receipt.actionType === type).length;
  const rejectedByType = (arm: "a" | "b", type: string) => receipts.filter((receipt) => receipt.arm === arm && !receipt.accepted && receipt.actionType === type).length;
  const values = (site: ObservedSite, predicate: (resource: Resource) => boolean, mode: "end" | "delta" = "end") => {
    const measure = (before: SiteView, after: SiteView) => mode === "delta" ? deltaCount(before, after, predicate) : count(after.resources, predicate);
    return [measure(controlBefore[site], controlAfter[site]), measure(policyABefore[site], policyAAfter[site]), measure(policyBBefore[site], policyBAfter[site])] as const;
  };
  const visitCreated = values("community", isVisit, "delta");
  const visitCompleted = values("community", (resource) => isVisit(resource) && isCompleted(resource), "delta");
  const visitPending = values("community", (resource) => isVisit(resource) && !isCompleted(resource));
  const openTasks = values("gp", (resource) => /task/i.test(resource.kind) && isOpen(resource));
  const completedTasks = values("gp", (resource) => /task/i.test(resource.kind) && isCompleted(resource), "delta");
  const messages = values("gp", isMessage);
  const openMessages = values("gp", (resource) => isMessage(resource) && isOpen(resource));
  const failedMessages = values("gp", (resource) => isMessage(resource) && resource.status.toLowerCase() === "failed");
  const diagnosticResults = values("diagnostics", (resource) => isDiagnostic(resource) && isAvailable(resource));
  const diagnosticPending = values("diagnostics", (resource) => isDiagnostic(resource) && isOpen(resource));
  const hospitalWaiting = values("hospital", (resource) => resource.kind === "hospital-attendance" && resource.status === "waiting");
  const openPrescriptions = values("pharmacy", (resource) => resource.kind === "prescription" && isOpen(resource));
  const rejectedA = armReceipts("a").filter((receipt) => !receipt.accepted).length;
  const rejectedB = armReceipts("b").filter((receipt) => !receipt.accepted).length;
  const rejected = rejectedA + rejectedB;
  const acceptedPatients = (arm: "a" | "b") => new Set(receipts.flatMap((receipt) => receipt.arm === arm && receipt.accepted ? [receipt.patientId] : []));
  const selectedSet = new Set(selected);
  const followupsA = followupState(visitsA, acceptedIdsA);
  const followupsB = followupState(visitsB, acceptedIdsB);
  const completedPatientsA = new Set([...followupsA].flatMap(([patientId, state]) => state.completed ? [patientId] : []));
  const completedPatientsB = new Set([...followupsB].flatMap(([patientId, state]) => state.completed ? [patientId] : []));
  const eligibilityResources = [...policyBBefore.gp.resources, ...policyBBefore.community.resources].filter((resource) => {
    if (!resource.patientId || !selectedSet.has(resource.patientId)) return false;
    if (policy.population.rule === "recent_discharge") return /discharge/i.test(resource.kind) && !["draft", "cancelled"].includes(resource.status.toLowerCase());
    if (!/task/i.test(resource.kind) || !isOpen(resource)) return false;
    if (policy.population.rule === "open_urgent_gp_task") return resource.priority === "urgent";
    if (policy.population.rule === "overdue_task") return typeof resource.dueAt === "number" && resource.dueAt < policyBBefore.gp.now;
    return typeof resource.dueAt === "number" && resource.dueAt >= policyBBefore.gp.now && resource.dueAt <= policyBBefore.gp.now + policy.horizonHours * 3_600_000;
  });
  const anchorByPatient = new Map<string, number>();
  for (const resource of eligibilityResources) {
    if (!resource.patientId) continue;
    const anchor = resource.dueAt ?? resource.createdAt;
    anchorByPatient.set(resource.patientId, Math.min(anchorByPatient.get(resource.patientId) ?? anchor, anchor));
  }
  const within48Hours = (followups: Map<string, { completed: boolean; createdAt: number; completionAt: number | null }>) => {
    if ([...followups.values()].some((state) => state.completed && state.completionAt === null)) return null;
    return percentage([...followups.values()].filter((state) => state.completed && state.completionAt! - state.createdAt <= 48 * 3_600_000).length, selected.length);
  };
  const selectedHospitalPatients = (snapshot: SiteSnapshot) => uniquePatients(snapshot.hospital.resources, (resource) =>
    selectedSet.has(resource.patientId ?? "") && resource.kind === "hospital-attendance" && !["discharged", "complete", "completed", "cancelled"].includes(resource.status.toLowerCase())).size;
  const overduePrescriptionPatients = (snapshot: SiteSnapshot) => uniquePatients(snapshot.pharmacy.resources, (resource) =>
    selectedSet.has(resource.patientId ?? "") && resource.kind === "prescription" && isOpen(resource) && typeof resource.dueAt === "number" && resource.dueAt < snapshot.pharmacy.now).size;
  const acceptedResources = (arm: "a" | "b", type: string, snapshot: SiteSnapshot, site: ObservedSite) => {
    const ids = new Set(receipts.flatMap((receipt) => receipt.arm === arm && receipt.accepted && receipt.actionType === type && receipt.resourceId ? [receipt.resourceId] : []));
    return snapshot[site].resources.filter((resource) => ids.has(resource.id));
  };
  const deliveredMessageRateB = (() => {
    const resources = acceptedResources("b", "messaging_action", policyBAfter, "gp");
    const acceptedCount = acceptedByType("b", "messaging_action");
    if (resources.length < acceptedCount) return null;
    return percentage(resources.filter((resource) => ["delivered", "replied", "completed", "complete", "closed"].includes(resource.status.toLowerCase())).length, acceptedCount);
  })();
  const diagnosticResultRateB = (() => {
    const resources = acceptedResources("b", "order_test", policyBAfter, "diagnostics");
    const acceptedCount = acceptedByType("b", "order_test");
    if (resources.length < acceptedCount) return null;
    return percentage(resources.filter(isAvailable).length, acceptedCount);
  })();

  const outcomes: ObservedOutcomeRow[] = [
    outcome("Eligible patients reached", 0, acceptedPatients("a").size, acceptedPatients("b").size, "count", "Unique selected patient IDs with at least one successful policy API response"),
    outcome("Eligible patient coverage", 0, percentage(acceptedPatients("a").size, selected.length), percentage(acceptedPatients("b").size, selected.length), "percent", "Reached patients divided by the selected eligible cohort; Control sends no actions"),
    outcome("Unresolved follow-up care gaps", selected.length, selected.length - completedPatientsA.size, selected.length - completedPatientsB.size, "count", "Selected patients without an accepted policy visit observed in completed status"),
    outcome("Unresolved follow-up burden", unresolvedHours(selected, anchorByPatient, new Map(), controlClock.now), unresolvedHours(selected, anchorByPatient, followupsA, policyAClock.now), unresolvedHours(selected, anchorByPatient, followupsB, policyBClock.now), "hours", "Patient-hours from the eligibility resource dueAt (or createdAt when no dueAt exists) until policy-visit completion or experiment end"),
    outcome("Follow-ups completed within 48 hours", 0, within48Hours(followupsA), within48Hours(followupsB), "percent", "Selected patients whose accepted policy visit completed within 48 hours of that visit being created"),
    outcome("Visits created during observation", ...visitCreated, "count", "Change in community visit resources"),
    outcome("Visits completed during observation", ...visitCompleted, "count", "Change in completed community visit resources"),
    outcome("Visits pending at end", ...visitPending, "count", "Community visit resources not in completed status"),
    outcome("Policy visits accepted", 0, acceptedByType("a", "schedule_visit"), acceptedByType("b", "schedule_visit"), "count", "Successful schedule_visit API responses; Control sends no actions"),
    ...(policy.intervention.createGpTask ? [
      outcome("GP tasks accepted", 0, acceptedByType("a", "create_task"), acceptedByType("b", "create_task"), "count", "Successful create_task API responses; Control sends no actions"),
      outcome("GP tasks completed during observation", ...completedTasks, "count", "Change in completed task resources in the returned GP view"),
    ] : []),
    ...(policy.intervention.sendMessage ? [
      outcome("Messages queued", 0, acceptedByType("a", "messaging_action"), acceptedByType("b", "messaging_action"), "count", "Successful messaging_action API responses; Control sends no actions"),
      outcome("Visible messages at end", ...messages, "count", "Message and conversation resources in the returned GP view"),
      outcome("Messages open at end", ...openMessages, "count", "Open message and conversation resources in the returned GP view"),
      outcome("Messages failed at end", ...failedMessages, "count", "Message and conversation resources with failed status"),
      outcome("Policy message delivery rate", null, null, deliveredMessageRateB, "percent", "Policy B message resources in delivered, replied or completed state divided by accepted messaging actions"),
    ] : []),
    ...(policy.intervention.orderTest ? [
      outcome("Diagnostic tests ordered", 0, acceptedByType("a", "order_test"), acceptedByType("b", "order_test"), "count", "Successful order_test API responses; Control sends no actions"),
      outcome("Diagnostic results available at end", ...diagnosticResults, "count", "Completed, available, reviewed or filed diagnostic resources in the returned diagnostics view"),
      outcome("Diagnostic work pending at end", ...diagnosticPending, "count", "Open diagnostic test or report resources in the returned diagnostics view"),
      outcome("Policy diagnostic result rate", null, null, diagnosticResultRateB, "percent", "Policy B diagnostic resources in completed, available, reviewed or filed state divided by accepted test orders"),
    ] : []),
    outcome("Policy visits completed", 0, visitsA.filter(isCompleted).length, visitsB.filter(isCompleted).length, "count", "Accepted policy visit IDs observed in completed status; Control has no policy visit IDs"),
    outcome("Rejected policy interactions", 0, rejectedA, rejectedB, "count", `Rejected API responses in Policy B: visits ${rejectedByType("b", "schedule_visit")}, tasks ${rejectedByType("b", "create_task")}, messages ${rejectedByType("b", "messaging_action")}, tests ${rejectedByType("b", "order_test")}`),
    outcome("Median policy visit completion time", null, completionHours(visitsA, acceptedIdsA), completionHours(visitsB, acceptedIdsB), "hours", "Visit provenance timestamps; Control is unavailable because it schedules no policy visits"),
    outcome("Open GP tasks at end", ...openTasks, "count", "Open task resources in the returned GP view"),
    outcome("Selected patients in an active hospital pathway", selectedHospitalPatients(controlAfter), selectedHospitalPatients(policyAAfter), selectedHospitalPatients(policyBAfter), "count", "Selected patient IDs with a non-final hospital-attendance resource at experiment end; association only, not attributed causation"),
    outcome("Selected patients with an overdue prescription", overduePrescriptionPatients(controlAfter), overduePrescriptionPatients(policyAAfter), overduePrescriptionPatients(policyBAfter), "count", "Selected patient IDs with an open prescription whose dueAt is before experiment end"),
    outcome("Hospital attendances waiting at end", ...hospitalWaiting, "count", "Waiting hospital-attendance resources in the returned hospital view"),
    outcome("Open prescriptions at end", ...openPrescriptions, "count", "Open prescription resources in the returned pharmacy view"),
  ];

  report({ percent: 100, stage: "Complete", detail: "Control-adjusted observed outcomes are ready" });
  return {
    experimentId,
    policy,
    worlds: { control: controlCredentials.world, policyA: policyACredentials.world, policyB: policyBCredentials.world },
    comparableStart,
    eligiblePatients: eligible.length,
    attemptedActions: receipts.length,
    acceptedActions: receipts.length - rejected,
    rejectedActions: rejected,
    startedAt: controlBefore.community.now,
    endedAt: controlClock.now,
    outcomes,
    observedSites: observedSiteNames.map((site) => ({
      site,
      controlReturned: controlAfter[site].resources.length,
      controlTotal: controlAfter[site].resourceTotal,
      baselineReturned: policyAAfter[site].resources.length,
      baselineTotal: policyAAfter[site].resourceTotal,
      interventionReturned: policyBAfter[site].resources.length,
      interventionTotal: policyBAfter[site].resourceTotal,
    })),
    policyArms: {
      control: { label: "Control · Do nothing", description: "No patient-level interactions; clock advances equally", attempted: 0, accepted: 0, rejected: 0 },
      a: { label: "Policy A · Visit only", description: "Community visit for each eligible patient", attempted: armReceipts("a").length, accepted: armReceipts("a").filter((r) => r.accepted).length, rejected: rejectedA },
      b: { label: "Policy B · Integrated follow-up", description: communityInteractions(policy, "PATIENT").map((interaction) => String(interaction.action.type)).join(" + "), attempted: armReceipts("b").length, accepted: armReceipts("b").filter((r) => r.accepted).length, rejected: rejectedB },
    },
    actionReceipts: receipts,
    note: `Control, Policy A and Policy B advanced ${policy.horizonHours * 60} simulation minutes from matching starts. Control received no patient-level interactions. Counts are direct API observations with coverage disclosed below; they are operational outcomes, not inferred clinical effects.`,
  };
}

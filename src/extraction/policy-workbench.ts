import { z } from "zod"
import type { Resource } from "../clinical/prevention/simulation-types.ts"

export const PolicyKindSchema = z.enum(["community", "appointments", "diagnostics", "pharmacy"]);
export type PolicyKind = z.infer<typeof PolicyKindSchema>;

export const PolicyDraftSchema = z.object({
  sourceText: z.string().min(10).max(4000),
  kind: PolicyKindSchema,
  population: z.object({
    rule: z.enum(["recent_discharge", "overdue_task", "due_within_horizon", "open_urgent_gp_task", "below_reorder_level"]),
    label: z.string(),
  }),
  intervention: z.object({
    action: z.enum(["schedule_visit", "book_appointment", "order_test", "place_pharmacy_order"]),
    fallbackAction: z.enum(["schedule_visit", "book_appointment"]).optional(),
    mode: z.enum(["in-person", "telephone", "video", "online"]).optional(),
    panelId: z.enum(["fbc", "ue", "hba1c", "lft", "crp", "lipids"]).optional(),
    priority: z.enum(["routine", "urgent"]).optional(),
    collection: z.enum(["now", "next-round"]).optional(),
    targetRatio: z.number().min(1).max(10).optional(),
    createGpTask: z.boolean().optional(),
    taskTitle: z.string().min(1).max(500).optional(),
    sendMessage: z.boolean().optional(),
    messageChannel: z.enum(["sms", "email"]).optional(),
    allowReply: z.boolean().optional(),
    messageSubject: z.string().min(1).max(160).optional(),
    messageBody: z.string().min(1).max(5000).optional(),
    orderTest: z.boolean().optional(),
  }),
  constraints: z.object({
    maxPerDay: z.number().int().min(1).max(100),
    maxSpendPence: z.number().int().min(0).max(10_000_000).optional(),
  }),
  horizonHours: z.number().int().min(1).max(1_440),
  allocation: z.literal("oldest-due-first"),
});

export type PolicyDraft = z.infer<typeof PolicyDraftSchema>;

export interface ActionPreview {
  ordinal: number;
  site: "community" | "gp" | "diagnostics" | "pharmacy";
  action: Record<string, unknown>;
  requiresResolution: string[];
}

export interface OutcomeDefinition {
  key: string;
  label: string;
  unit: "count" | "hours" | "percent" | "pence";
  source: string;
}

/** Keep live simulator rehearsals small enough to finish reliably during an interactive demo. */
export const LIVE_EXPERIMENT_LIMITS = {
  maxPerDay: 3,
  maxHorizonHours: 72,
} as const;

export function assertLiveExperimentLimits(policy: PolicyDraft): void {
  if (
    policy.constraints.maxPerDay > LIVE_EXPERIMENT_LIMITS.maxPerDay
    || policy.horizonHours > LIVE_EXPERIMENT_LIMITS.maxHorizonHours
  ) {
    throw new Error(
      `Live comparisons are limited to ${LIVE_EXPERIMENT_LIMITS.maxPerDay} patients per day `
      + `and ${LIVE_EXPERIMENT_LIMITS.maxHorizonHours / 24} days so they finish reliably.`,
    );
  }
}

export const policyExamples = [
  {
    id: "community",
    label: "Community capacity",
    text: "Over the next 2 days, schedule community visits, create GP follow-up tasks and send simulated SMS reminders for patients with open community-care tasks due now or during that period, up to 2 patients per day.",
  },
  {
    id: "appointments",
    label: "Urgent GP access",
    text: "For the next 5 days, give patients with unresolved urgent GP tasks a same-day telephone appointment. If no slot is available, schedule a community visit. Limit this to 20 patients per day.",
  },
  {
    id: "diagnostics",
    label: "Diagnostics turnaround",
    text: "Order urgent full blood count tests with immediate collection for patients with an open urgent GP task requesting one, up to 12 tests per day, and observe outcomes for 6 hours.",
  },
  {
    id: "pharmacy",
    label: "Medicine availability",
    text: "Over the next 7 days, replenish pharmacy products below their reorder level to twice that level using the cheapest available quote. Spend no more than £500.",
  },
] as const;

function firstNumber(text: string, patterns: RegExp[], fallback: number): number {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return fallback;
}

function detectKind(text: string): PolicyKind {
  if (/pharmac|medicine|stock|reorder|prescription/i.test(text)) return "pharmacy";
  if (/blood|test|diagnostic|hba1c|lipid|pathology/i.test(text)) return "diagnostics";
  if (/appointment|same-day|same day|slot/i.test(text)) return "appointments";
  return "community";
}

function detectPanel(text: string): PolicyDraft["intervention"]["panelId"] {
  if (/hba1c/i.test(text)) return "hba1c";
  if (/lipid/i.test(text)) return "lipids";
  if (/liver|\blft\b/i.test(text)) return "lft";
  if (/c-reactive|\bcrp\b/i.test(text)) return "crp";
  if (/urea|electrolyte|\bue\b/i.test(text)) return "ue";
  return "fbc";
}

export function interpretPolicy(sourceText: string): PolicyDraft {
  const text = sourceText.trim();
  const kind = detectKind(text);
  const days = firstNumber(text, [/(?:next|over)\s+(\d+)\s+days?/i, /for\s+(\d+)\s+days?/i], 7);
  const explicitHours = text.match(/(?:for|over|observe(?: outcomes)? for)\s+(\d+)\s+hours?/i)?.[1];
  const maxPerDay = firstNumber(text, [/(?:up to|limit(?: this)? to|maximum|max)\s+(\d+)[^.]*?per day/i], kind === "community" ? 8 : 20);
  const pounds = text.match(/£\s*([\d,.]+)/)?.[1];
  const population = kind === "pharmacy"
    ? { rule: "below_reorder_level" as const, label: "Products with stock below their recorded reorder level" }
    : /discharg/i.test(text)
      ? { rule: "recent_discharge" as const, label: "Patients with a visible recent discharge record" }
      : /urgent/i.test(text)
        ? { rule: "open_urgent_gp_task" as const, label: "Patients with an unresolved urgent GP task" }
        : /overdue/i.test(text)
          ? { rule: "overdue_task" as const, label: "Patients with an unresolved task whose due time has passed" }
          : { rule: "due_within_horizon" as const, label: "Patients with an unresolved task due within the observation window" };

  const intervention: PolicyDraft["intervention"] = kind === "pharmacy"
    ? { action: "place_pharmacy_order", targetRatio: /twice|double|2\s*x/i.test(text) ? 2 : 1.5 }
    : kind === "diagnostics"
      ? {
          action: "order_test",
          panelId: detectPanel(text),
          priority: /urgent/i.test(text) ? "urgent" : "routine",
          collection: /immediate|\bnow\b/i.test(text) ? "now" : "next-round",
        }
      : kind === "appointments"
        ? {
            action: "book_appointment",
            fallbackAction: /community|home visit/i.test(text) ? "schedule_visit" : undefined,
            mode: /telephone|phone/i.test(text) ? "telephone" : /video/i.test(text) ? "video" : /online/i.test(text) ? "online" : "in-person",
          }
        : {
            action: "schedule_visit",
            createGpTask: /(?:create|add|raise).{0,20}(?:gp |follow-up )?tasks?|gp follow-up tasks?/i.test(text),
            taskTitle: "Review community follow-up outcome",
            sendMessage: /\b(?:sms|message|reminder|text)\b/i.test(text),
            messageChannel: /email/i.test(text) ? "email" : "sms",
            allowReply: !/no repl(?:y|ies)/i.test(text),
            messageSubject: "Community follow-up",
            messageBody: "A synthetic community follow-up has been scheduled in this simulation.",
            orderTest: false,
            panelId: "fbc",
            priority: "routine",
            collection: "next-round",
          };

  return PolicyDraftSchema.parse({
    sourceText: text,
    kind,
    population,
    intervention,
    constraints: {
      maxPerDay,
      maxSpendPence: pounds ? Math.round(Number(pounds.replaceAll(",", "")) * 100) : undefined,
    },
    horizonHours: explicitHours ? Number(explicitHours) : days * 24,
    allocation: "oldest-due-first",
  });
}

function actionSite(policy: PolicyDraft): ActionPreview["site"] {
  if (policy.kind === "appointments") return "gp";
  return policy.kind;
}

export interface PolicyInteraction {
  site: ActionPreview["site"];
  action: Record<string, unknown>;
}

export function communityInteractions(policyInput: PolicyDraft, patientId: string): PolicyInteraction[] {
  const policy = PolicyDraftSchema.parse(policyInput);
  if (policy.kind !== "community") return [];
  const interactions: PolicyInteraction[] = [{
    site: "community",
    action: { type: "schedule_visit", patientId, title: "Policy-funded community follow-up" },
  }];
  if (policy.intervention.createGpTask) {
    interactions.push({
      site: "gp",
      action: {
        type: "create_task",
        patientId,
        title: policy.intervention.taskTitle ?? "Review community follow-up outcome",
        text: "Review the synthetic community follow-up record and record any required simulated next step.",
      },
    });
  }
  if (policy.intervention.sendMessage) {
    interactions.push({
      site: "gp",
      action: {
        type: "messaging_action",
        patientId,
        messagingCommand: {
          kind: "create",
          subject: policy.intervention.messageSubject ?? "Community follow-up",
          body: policy.intervention.messageBody ?? "A synthetic community follow-up has been scheduled in this simulation.",
          channel: policy.intervention.messageChannel ?? "sms",
          allowReply: policy.intervention.allowReply ?? true,
        },
      },
    });
  }
  if (policy.intervention.orderTest) {
    const panelId = policy.intervention.panelId ?? "fbc";
    interactions.push({
      site: "gp",
      action: {
        type: "order_test",
        patientId,
        title: `${panelId.toUpperCase()} policy request`,
        bloodTestOrder: {
          panelId,
          panel: panelId.toUpperCase(),
          specimen: "Blood",
          priority: policy.intervention.priority ?? "routine",
          collection: policy.intervention.collection ?? "next-round",
          clinicalDetails: "Requested under explicitly reviewed synthetic policy parameters.",
        },
      },
    });
  }
  return interactions;
}

export function previewActions(policyInput: PolicyDraft, count = 3): ActionPreview[] {
  const policy = PolicyDraftSchema.parse(policyInput);
  if (policy.kind === "community") {
    return communityInteractions(policy, "RESOLVE_ELIGIBLE_PATIENT_1").map((interaction, index) => ({
      ordinal: index + 1,
      ...interaction,
      requiresResolution: ["patientId from the selected world's eligible resources"],
    }));
  }
  return Array.from({ length: Math.min(count, policy.constraints.maxPerDay) }, (_, index) => {
    const patientId = `RESOLVE_ELIGIBLE_PATIENT_${index + 1}`;
    let action: Record<string, unknown>;
    let requiresResolution = ["patientId from the selected world's eligible resources"];
    if (policy.kind === "appointments") {
      action = {
        type: "book_appointment",
        patientId,
        title: "Policy-funded urgent GP review",
        mode: policy.intervention.mode,
        durationMinutes: 15,
        sessionId: "RESOLVE_AVAILABLE_SESSION",
        sessionVersion: "RESOLVE_LATEST_VERSION",
      };
      requiresResolution.push("available appointment session and latest version");
    } else if (policy.kind === "diagnostics") {
      action = {
        type: "order_test",
        patientId,
        title: `${policy.intervention.panelId?.toUpperCase()} policy request`,
        bloodTestOrder: {
          panelId: policy.intervention.panelId,
          panel: policy.intervention.panelId?.toUpperCase(),
          specimen: "Blood",
          priority: policy.intervention.priority,
          collection: policy.intervention.collection,
          clinicalDetails: "Requested under reviewed synthetic policy criteria.",
        },
      };
    } else {
      action = {
        type: "place_pharmacy_order",
        resourceId: "RESOLVE_CURRENT_QUOTE",
        expectedVersion: "RESOLVE_LATEST_VERSION",
        quantity: "CALCULATE_PACKS_TO_TARGET",
      };
      requiresResolution = ["product below reorder level", "current supplier quote and version", "pack quantity within budget"];
    }
    return { ordinal: index + 1, site: actionSite(policy), action, requiresResolution };
  });
}

export function outcomeDefinitions(policy: PolicyDraft): OutcomeDefinition[] {
  switch (policy.kind) {
    case "community": return [
      { key: "patientsReached", label: "Eligible patients reached", unit: "count", source: "unique selected patients with a successful policy API response" },
      { key: "coverageRate", label: "Eligible patient coverage", unit: "percent", source: "reached patients divided by the selected eligible cohort" },
      { key: "careGaps", label: "Unresolved follow-up care gaps", unit: "count", source: "selected patients without a completed policy visit" },
      { key: "careGapHours", label: "Unresolved follow-up burden", unit: "hours", source: "patient-hours from eligibility due time until completed follow-up or experiment end" },
      { key: "followup48", label: "Follow-ups completed within 48 hours", unit: "percent", source: "selected patients whose policy visit completed within 48 hours of creation" },
      { key: "visitsCreated", label: "Visits created", unit: "count", source: "community visit resources created during the run" },
      ...(policy.intervention.createGpTask ? [{ key: "gpTasksCreated", label: "GP tasks accepted", unit: "count" as const, source: "successful create_task API responses" }] : []),
      ...(policy.intervention.sendMessage ? [{ key: "messagesCreated", label: "Messages queued", unit: "count" as const, source: "successful messaging_action API responses" }] : []),
      ...(policy.intervention.orderTest ? [{ key: "testsOrdered", label: "Diagnostic tests ordered", unit: "count" as const, source: "successful order_test API responses" }] : []),
      { key: "visitsCompleted", label: "Visits completed", unit: "count", source: "community visit resources in completed status" },
      { key: "visitsPending", label: "Visits still pending", unit: "count", source: "created policy visits not completed" },
      { key: "rejectedActions", label: "Rejected requests", unit: "count", source: "API action responses rejected by capacity or workflow rules" },
      { key: "completionHours", label: "Median completion time", unit: "hours", source: "resource creation and completion provenance timestamps" },
      { key: "gpTasksOpen", label: "Open GP tasks at end", unit: "count", source: "open task resources in the returned GP view" },
      ...(policy.intervention.createGpTask ? [{ key: "gpTasksCompleted", label: "GP tasks completed", unit: "count" as const, source: "change in completed task resources in the returned GP view" }] : []),
      ...(policy.intervention.sendMessage ? [
        { key: "messagesVisible", label: "Visible messages at end", unit: "count" as const, source: "message and conversation resources in the returned GP view" },
        { key: "messagesOpen", label: "Messages open at end", unit: "count" as const, source: "open message and conversation resources in the returned GP view" },
        { key: "messagesFailed", label: "Messages failed at end", unit: "count" as const, source: "message and conversation resources with failed status" },
        { key: "messageDelivery", label: "Policy message delivery rate", unit: "percent" as const, source: "delivered, replied or completed policy messages divided by accepted message actions" },
      ] : []),
      ...(policy.intervention.orderTest ? [
        { key: "diagnosticResults", label: "Diagnostic results available", unit: "count" as const, source: "available diagnostic resources in the returned diagnostics view" },
        { key: "diagnosticPending", label: "Diagnostic work pending", unit: "count" as const, source: "open diagnostic resources in the returned diagnostics view" },
        { key: "diagnosticResultRate", label: "Policy diagnostic result rate", unit: "percent" as const, source: "available policy diagnostic resources divided by accepted test orders" },
      ] : []),
      { key: "selectedHospital", label: "Selected patients in an active hospital pathway", unit: "count", source: "selected patients with a non-final hospital attendance at experiment end" },
      { key: "overduePrescriptionPatients", label: "Selected patients with an overdue prescription", unit: "count", source: "selected patients with an open prescription past its due time" },
      { key: "hospitalWaiting", label: "Hospital attendances waiting", unit: "count", source: "waiting hospital-attendance resources in the returned hospital view" },
      { key: "prescriptionsOpen", label: "Open prescriptions at end", unit: "count", source: "open prescription resources in the returned pharmacy view" },
    ];
    case "appointments": return [
      { key: "appointmentsBooked", label: "Appointments booked", unit: "count", source: "appointment resources created during the run" },
      { key: "appointmentsCompleted", label: "Appointments completed", unit: "count", source: "appointment resources in completed status" },
      { key: "appointmentsCancelled", label: "Appointments cancelled", unit: "count", source: "appointment resources in cancelled status" },
      { key: "urgentTasksOpen", label: "Urgent tasks still open", unit: "count", source: "urgent GP task resources not completed or rejected" },
    ];
    case "diagnostics": return [
      { key: "testsOrdered", label: "Tests ordered", unit: "count", source: "test resources created during the run" },
      { key: "resultsReturned", label: "Results returned", unit: "count", source: "diagnostic reports available after clock advance" },
      { key: "testsPending", label: "Tests still pending", unit: "count", source: "ordered tests without a returned report" },
      { key: "turnaroundHours", label: "Median turnaround", unit: "hours", source: "order and result timestamps" },
    ];
    case "pharmacy": return [
      { key: "stockouts", label: "Products out of stock", unit: "count", source: "pharmacy products with zero recorded stock" },
      { key: "unitsReceived", label: "Units received", unit: "count", source: "inventory change after received supplier orders" },
      { key: "prescriptionsCollected", label: "Prescriptions collected", unit: "count", source: "prescription resources in collected status" },
      { key: "spendPence", label: "Supplier spend", unit: "pence", source: "accepted purchase-order costs" },
    ];
  }
}

function isClosed(status: string): boolean {
  return ["completed", "complete", "closed", "rejected", "cancelled"].includes(status.toLowerCase());
}

export function selectEligiblePatients(policy: PolicyDraft, resources: Resource[], now: number): string[] {
  const horizonEnd = now + policy.horizonHours * 3_600_000;
  const selected = resources.filter((resource) => {
    if (!resource.patientId) return false;
    if (policy.population.rule === "recent_discharge") {
      return /discharge/i.test(resource.kind) && !["draft", "cancelled"].includes(resource.status.toLowerCase());
    }
    if (policy.population.rule === "open_urgent_gp_task") {
      return /task/i.test(resource.kind) && resource.priority === "urgent" && !isClosed(resource.status);
    }
    if (policy.population.rule === "overdue_task") {
      return /task/i.test(resource.kind) && typeof resource.dueAt === "number" && resource.dueAt < now && !isClosed(resource.status);
    }
    if (policy.population.rule === "due_within_horizon") {
      return /task/i.test(resource.kind) && typeof resource.dueAt === "number" && resource.dueAt >= now && resource.dueAt <= horizonEnd && !isClosed(resource.status);
    }
    return false;
  }).sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt) || a.id.localeCompare(b.id));
  return [...new Set(selected.map((resource) => resource.patientId!))];
}

export function resourceFingerprint(resources: Resource[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const resource of resources) {
    const key = `${resource.kind}:${resource.status}`;
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

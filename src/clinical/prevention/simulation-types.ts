export interface ProvenanceChange {
  action?: string
  source?: string
  time?: number
  actor?: { kind?: string; name?: string }
}

export interface Resource {
  id: string
  patientId?: string
  kind: string
  title: string
  status: string
  owner: string
  priority: "routine" | "urgent"
  createdAt: number
  dueAt?: number
  data: Record<string, unknown>
  version: number
  provenance?: {
    created?: ProvenanceChange | null
    changes?: ProvenanceChange[]
  }
}

export type SiteName = "gp" | "hospital" | "community" | "pharmacy" | "diagnostics" | "referrals" | "wearables"

export interface SiteView {
  id: string
  now: number
  speed: number
  paused: boolean
  population: number
  resources: Resource[]
  resourceTotal: number
  counters?: Record<string, number>
  staffing?: { doctors: number; nurses: number; staffedSpaces: number; waiting: number }
  faults?: Record<string, boolean>
}

export interface WorldCredentials {
  teamName: string
  world: string
  apiKey: string
  scopes: string[]
}

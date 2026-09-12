/**
 * Capture the real world's open work as a seed for the engine.
 *
 *   npm run seed
 *
 * OWNER: Kaavya.
 *
 * The PRD's claim is that the simulator is ground truth and the engine is a fast model of its
 * rules over a snapshot of it. This is the snapshot half: who is actually waiting, in which
 * service, and since when — with their real patient id, so the world view shows the people the
 * simulator has rather than anonymous demand.
 *
 * Captured once and committed. The demo then needs no server: the seed is a file, and everything
 * after t=0 is our engine.
 */

import { writeFileSync } from 'node:fs';
import 'dotenv/config';

const BASE = process.env['NHSSIM_BASE_URL'] ?? 'https://sim.animahacks.com';
const KEY = process.env['NHSSIM_TEAM_KEY'];

export interface SeedItem {
  /** The simulator's patient, e.g. SIM-000027. Absent where a resource carries none. */
  ref?: string;
  node: 'gp-clinic' | 'gp-admin' | 'community-visit';
  cls: 'routine' | 'complex' | 'urgent' | 'letter';
  /** Pathway position, so the router knows what the item is part way through. */
  stage?: string;
  /** How long it had already been waiting when the snapshot was taken, in minutes. */
  waitedMinutes: number;
  /** What it is, for the world view. */
  title: string;
}

interface Resource {
  kind: string;
  status: string;
  title?: string;
  patientId?: string;
  createdAt: number;
  priority?: string;
}

async function get(path: string): Promise<{ resources?: Resource[]; now?: number }> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json() as Promise<{ resources?: Resource[]; now?: number }>;
}

if (!KEY) {
  console.error('NHSSIM_TEAM_KEY is not set. The seed is committed, so this only needs running');
  console.error('when the world has moved on and you want a fresher one.');
  process.exit(1);
}

const [docs, community, gp, clock] = await Promise.all([
  get('/api/sites/gp/documents'),
  get('/api/sites/community/view'),
  get('/api/sites/gp/view'),
  get('/api/clock') as Promise<{ now: number }>,
]);

const now = clock.now;
const since = (r: Resource) => Math.max(0, Math.round((now - r.createdAt) / 60_000));

const items: SeedItem[] = [];

// Discharge letters. `sent` is sitting in the inbox unread; `reviewed` has been read and is
// waiting to be filed. Both are admin work, and the gap between them is the manual chasing the
// whole letter pathway is about.
for (const r of docs.resources ?? []) {
  if (r.kind !== 'discharge-summary') continue;
  if (r.status === 'sent') {
    items.push({
      ...(r.patientId ? { ref: r.patientId } : {}),
      node: 'gp-admin', cls: 'letter', stage: 'letter-review',
      waitedMinutes: since(r), title: r.title ?? 'Discharge summary, unread',
    });
  } else if (r.status === 'reviewed') {
    items.push({
      ...(r.patientId ? { ref: r.patientId } : {}),
      node: 'gp-admin', cls: 'letter', stage: 'letter-filing',
      waitedMinutes: since(r), title: r.title ?? 'Discharge summary, awaiting filing',
    });
  }
}

// Open GP work: tasks and requests nobody has actioned.
for (const r of gp.resources ?? []) {
  if (!['task', 'request', 'screening'].includes(r.kind) || r.status !== 'open') continue;
  items.push({
    ...(r.patientId ? { ref: r.patientId } : {}),
    node: 'gp-clinic',
    cls: r.priority === 'urgent' ? 'urgent' : 'routine',
    waitedMinutes: since(r),
    title: r.title ?? r.kind,
  });
}

// Community work waiting on the visiting team.
for (const r of community.resources ?? []) {
  if (!['care-package', 'visit'].includes(r.kind)) continue;
  if (!['waiting', 'open', 'scheduled'].includes(r.status)) continue;
  items.push({
    ...(r.patientId ? { ref: r.patientId } : {}),
    node: 'community-visit', cls: 'complex',
    waitedMinutes: since(r), title: r.title ?? 'Community visit',
  });
}

const byNode: Record<string, number> = {};
for (const i of items) byNode[i.node] = (byNode[i.node] ?? 0) + 1;

writeFileSync('fixtures/seed-state.json', JSON.stringify({
  source: `${BASE} · world team-4551d2471320`,
  capturedAt: new Date().toISOString(),
  simNow: now,
  note:
    'Open work in the real world at the moment of capture, with real patient ids. The engine '
    + 'starts from this rather than from an empty waiting room; everything after t=0 is the '
    + 'model, not a recording.',
  items,
}, null, 1));

console.log(`fixtures/seed-state.json — ${items.length} items`);
console.log('by node:', JSON.stringify(byNode));
console.log('with a patient id:', items.filter((i) => i.ref).length);

/**
 * The network simulator. One event loop for any number of connected nodes.
 *
 * OWNER: Kaavya. PRD §4.2.
 *
 * Replaces the single-node driver, which is now a one-node call into this. The M/M/1 check still
 * runs through here, so the validated code path and the product code path stay identical.
 */

import type { Rng } from './rng.ts';
import { makeRng } from './rng.ts';
import { EventQueue } from './clock.ts';
import { QueueNode, type NodeConfig, type NodeStats, type WorkItem } from './nodes.ts';

export const MINUTES_PER_DAY = 1440;

export interface EntryStream {
  nodeId: string;
  ratePerMin: number;
  /** Opaque label per arrival — the engine puts the patient class here. */
  tagFor?: (rng: Rng) => string;
  /** Priority and service multiplier for that label. */
  classOf?: (tag: string | undefined) => { priority: number; serviceMultiplier: number };
  /**
   * Share of this stream's arrivals that are deliberately timed to land on a weekday.
   *
   * A drawn arrival that falls at a weekend is pushed to the following Monday with this
   * probability; the rest arrive whenever they arrive. Used for discharge timing: a letter
   * discharged on a Saturday cannot be reviewed until the practice reopens.
   */
  weekdayOnlyShare?: number;
  /** Initial pathway stage, so the router can tell this stream's work apart downstream. */
  stageFor?: (tag: string | undefined) => string;
}

export interface NetworkSpec {
  nodes: readonly NodeConfig[];
  /**
   * Independent Poisson streams entering the network.
   *
   * More than one, because discharge letters do not arrive as a function of GP demand — they come
   * from hospital activity, at a rate we measured separately. Deriving them from GP throughput
   * made them scale with the wrong thing.
   */
  entries: readonly EntryStream[];
  /** Where an item goes after finishing at `from`. null means it leaves the system. */
  route?: (item: WorkItem, from: string, rng: Rng) => string | null;
  /**
   * Where a REFUSED item goes. null means it leaves.
   *
   * This is the rejection feedback loop: community turns a referral away at capacity and it lands
   * back on the GP as more work. Modelling refusal as "the patient vanishes" would hide the entire
   * cost of over-shifting care into a service that is already full.
   */
  onRefused?: (item: WorkItem, from: string, rng: Rng) => string | null;
  horizon: number;
  warmup: number;
  seed: number;
}

export interface NetworkResult {
  nodes: Map<string, NodeStats>;
  /** Items that entered the system from outside. */
  entered: number;
  /** Items that left having finished their pathway. */
  exited: number;
  /** Hops caused by a refusal — the extra work a full node pushes back upstream. */
  feedbackHops: number;
}

export function simulateNetwork(spec: NetworkSpec): NetworkResult {
  const rng = makeRng(spec.seed);
  const events = new EventQueue();

  const nodes = new Map<string, QueueNode>();
  for (const config of spec.nodes) {
    const node = new QueueNode(config);
    node.setWindow(spec.warmup, spec.horizon);
    nodes.set(config.id, node);
  }

  const live = new Map<number, WorkItem>();
  let nextId = 0;
  let entered = 0;
  let exited = 0;
  let feedbackHops = 0;

  const scheduleArrival = (streamIdx: number, from: number): void => {
    const stream = spec.entries[streamIdx];
    if (stream === undefined || stream.ratePerMin <= 0) return;
    let at = from + rng.exponential(stream.ratePerMin);

    // Weekday timing. Day 0 is a Monday, so days 5 and 6 of each week are the weekend.
    const weekdayShare = stream.weekdayOnlyShare;
    if (weekdayShare !== undefined && weekdayShare > 0) {
      const day = Math.floor(at / MINUTES_PER_DAY);
      const dow = day % 7;
      if (dow >= 5 && rng.next() < weekdayShare) {
        // Shift to Monday morning, keeping the arrival strictly after `from` so the event queue
        // never sees a scheduled-in-the-past error.
        const monday = (day + (7 - dow)) * MINUTES_PER_DAY;
        at = Math.max(at, monday);
      }
    }

    // `node` carries the stream index so each stream keeps its own arrival process.
    if (at <= spec.horizon) events.push({ time: at, kind: 'arrival', node: String(streamIdx) });
  };

  /** Put an item into a node, or bounce it if the node is full. Returns nothing; schedules events. */
  const send = (item: WorkItem, toId: string, now: number): void => {
    const node = nodes.get(toId);
    if (node === undefined) throw new Error(`route to unknown node '${toId}'`);

    if (node.wouldRefuse(now)) {
      node.refuse(now);
      const fallback = spec.onRefused?.(item, toId, rng) ?? null;
      if (fallback === null) {
        live.delete(item.id);
        exited++;
        return;
      }
      feedbackHops++;
      item.bounces = (item.bounces ?? 0) + 1;
      send(item, fallback, now);
      return;
    }

    for (const s of node.arrive(item, now, rng)) {
      events.push({ time: s.at, kind: 'service-complete', itemId: s.item.id, node: toId });
    }
  };

  for (let i = 0; i < spec.entries.length; i++) scheduleArrival(i, 0);
  for (const config of spec.nodes) {
    const sched = config.schedule;
    if (sched === null) continue;
    const days = Math.ceil(spec.horizon / MINUTES_PER_DAY);
    for (let d = 0; d < days; d++) {
      for (const start of sched.blockStarts) {
        const at = d * MINUTES_PER_DAY + start;
        if (at > 0 && at <= spec.horizon) {
          events.push({ time: at, kind: 'session-open', node: config.id });
        }
      }
    }
  }

  for (;;) {
    const ev = events.pop();
    if (ev === undefined || ev.time > spec.horizon) break;
    const now = ev.time;

    if (ev.kind === 'arrival') {
      const streamIdx = Number(ev.node ?? '0');
      const stream = spec.entries[streamIdx] as EntryStream;
      const tag = stream.tagFor?.(rng);
      const cls = stream.classOf?.(tag) ?? { priority: 0, serviceMultiplier: 1 };
      const item: WorkItem = {
        id: nextId++,
        arrivedAt: now,
        measured: now >= spec.warmup,
        tag,
        priority: cls.priority,
        serviceMultiplier: cls.serviceMultiplier,
        stage: stream.stageFor?.(tag),
      };
      live.set(item.id, item);
      entered++;
      send(item, stream.nodeId, now);
      scheduleArrival(streamIdx, now);
    } else if (ev.kind === 'service-complete') {
      const nodeId = ev.node as string;
      const node = nodes.get(nodeId) as QueueNode;
      const item = live.get(ev.itemId as number) as WorkItem;
      for (const s of node.complete(item, now, rng)) {
        events.push({ time: s.at, kind: 'service-complete', itemId: s.item.id, node: nodeId });
      }
      const next = spec.route?.(item, nodeId, rng) ?? null;
      if (next === null) {
        live.delete(item.id);
        exited++;
      } else {
        // A new leg of the pathway: the clock on this leg starts now.
        item.arrivedAt = now;
        item.startedAt = undefined;
        item.completedAt = undefined;
        send(item, next, now);
      }
    } else {
      const nodeId = ev.node as string;
      const node = nodes.get(nodeId) as QueueNode;
      for (const s of node.openSession(now, rng)) {
        events.push({ time: s.at, kind: 'service-complete', itemId: s.item.id, node: nodeId });
      }
    }
  }

  const stats = new Map<string, NodeStats>();
  for (const [id, node] of nodes) {
    node.finalise(spec.horizon);
    stats.set(id, node.stats);
  }
  return { nodes: stats, entered, exited, feedbackHops };
}

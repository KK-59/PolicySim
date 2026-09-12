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
  /** Record what happened, over a bounded window. Off by default. */
  trace?: TraceOptions;
  /**
   * Start with these already queued, rather than with empty services.
   *
   * The simulator is ground truth and this is how the engine starts from it: the people actually
   * waiting, in the service they are actually waiting in, with the time they have already waited
   * carried over. Everything after t=0 is the model.
   */
  seedItems?: readonly SeedItem[];
  /** Simulated minute at which the seeded work is placed. Usually the trace window's start. */
  seedAt?: number;
}

/**
 * One thing that happened, for the world view.
 *
 * Off by default. The engine runs ten simulated years in a third of a second precisely because it
 * throws these away; recording every event over that horizon would be tens of millions of objects
 * and the run would be about memory rather than queueing. Tracing is for a short window someone
 * is going to look at.
 */
export interface TraceEvent {
  /** Simulated minutes from t=0. */
  t: number
  kind: 'arrive' | 'start' | 'complete' | 'refuse'
  node: string
  /** Work item id, so a journey can be reassembled by filtering on it. */
  item: number
  /** Patient class, or 'letter' for the document stream. */
  cls: string
  /** The simulator's patient id, for work seeded from a snapshot. */
  ref?: string
  /** What the snapshot called it. */
  title?: string
  /**
   * When this item actually started waiting, if that is earlier than the event.
   *
   * Work carried in from the snapshot joins the trace at the window boundary, but it has been
   * waiting since long before — nine days, for some of these letters. Without this the view
   * computed every seeded wait from the boundary and showed the whole queue the same number,
   * which read as a bug and hid the only interesting thing about it.
   */
  since?: number
}

/** Work already in progress when the run starts, taken from a snapshot of the real world. */
export interface SeedItem {
  node: string
  cls: string
  stage?: string
  ref?: string
  title?: string
  /** How long it had already been waiting at the moment of capture. */
  waitedMinutes: number
}

export interface TraceOptions {
  /** Record events from this simulated minute. */
  from: number
  /** Stop recording at this one. */
  to: number
  /** Hard ceiling, so a pathological config cannot exhaust memory. */
  maxEvents?: number
}

export interface NetworkResult {
  nodes: Map<string, NodeStats>;
  /** Items that entered the system from outside. */
  entered: number;
  /** Items that left having finished their pathway. */
  exited: number;
  /** Hops caused by a refusal — the extra work a full node pushes back upstream. */
  feedbackHops: number;
  /** Present only when tracing was requested. */
  trace?: TraceEvent[];
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

  const traceOpts = spec.trace;
  const trace: TraceEvent[] = [];
  const maxEvents = traceOpts?.maxEvents ?? 60_000;
  const record = (t: number, kind: TraceEvent['kind'], node: string, item: WorkItem): void => {
    if (traceOpts === undefined) return;
    if (t < traceOpts.from || t > traceOpts.to) return;
    if (trace.length >= maxEvents) return;
    trace.push({
      t, kind, node, item: item.id, cls: item.tag ?? 'routine',
      ...(item.ref ? { ref: item.ref } : {}),
      ...(item.title ? { title: item.title } : {}),
      ...(kind === 'arrive' && item.arrivedAt < t ? { since: item.arrivedAt } : {}),
    });
  };

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
      record(now, 'refuse', toId, item);
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

    record(now, 'arrive', toId, item);
    for (const s of node.arrive(item, now, rng)) {
      record(now, 'start', toId, s.item);
      events.push({ time: s.at, kind: 'service-complete', itemId: s.item.id, node: toId });
    }
  };

  for (let i = 0; i < spec.entries.length; i++) scheduleArrival(i, 0);

  // Wake the loop exactly when the seed is due.
  //
  // Without this, the snapshot is placed on whatever event happens to come next — twelve minutes
  // late, in practice — so the world view opened on an empty neighbourhood that filled a moment
  // afterwards. The backlog should be there the instant the window does.
  const seedMoment = spec.seedAt ?? 0;
  const firstNode = spec.nodes[0];
  if (spec.seedItems !== undefined && spec.seedItems.length > 0 && firstNode !== undefined) {
    events.push({ time: seedMoment, kind: 'session-open', node: firstNode.id });
  }
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

  // Place the snapshot's open work before anything else happens.
  let seedPlaced = spec.seedItems === undefined || spec.seedItems.length === 0;
  const placeSeed = (at: number): void => {
    if (seedPlaced) return;
    seedPlaced = true;
    for (const s of spec.seedItems ?? []) {
      const item: WorkItem = {
        id: nextId++,
        // Waiting time already served is carried over, so a letter that has sat unread for three
        // days is three days old at t=0 rather than brand new.
        arrivedAt: at - s.waitedMinutes,
        measured: false,
        tag: s.cls,
        priority: s.cls === 'urgent' ? 0 : 1,
        serviceMultiplier: 1,
        ...(s.stage ? { stage: s.stage } : {}),
        ...(s.ref ? { ref: s.ref } : {}),
        ...(s.title ? { title: s.title } : {}),
      };
      live.set(item.id, item);
      entered++;
      send(item, s.node, at);
    }
  };

  // Seed the trace with everyone already queued when the window opens. Without it the view shows
  // an empty waiting room that fills from nothing, which is the opposite of what the model says.
  let seeded = traceOpts === undefined;

  for (;;) {
    const ev = events.pop();
    if (ev === undefined || ev.time > spec.horizon) break;
    const now = ev.time;

    if (!seedPlaced && now >= (spec.seedAt ?? 0)) placeSeed(now);

    if (!seeded && traceOpts !== undefined && now >= traceOpts.from) {
      seeded = true;
      for (const [id, node] of nodes) {
        for (const held of node.contents()) {
          trace.push({
            t: traceOpts.from,
            kind: 'arrive',
            node: id,
            item: held.item.id,
            cls: held.item.tag ?? 'routine',
            ...(held.item.ref ? { ref: held.item.ref } : {}),
            ...(held.item.title ? { title: held.item.title } : {}),
            ...(held.item.arrivedAt < traceOpts.from ? { since: held.item.arrivedAt } : {}),
          });
        }
      }
    }

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
      record(now, 'complete', nodeId, item);
      for (const s of node.complete(item, now, rng)) {
        record(now, 'start', nodeId, s.item);
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
        record(now, 'start', nodeId, s.item);
        events.push({ time: s.at, kind: 'service-complete', itemId: s.item.id, node: nodeId });
      }
    }
  }

  const stats = new Map<string, NodeStats>();
  for (const [id, node] of nodes) {
    node.finalise(spec.horizon);
    stats.set(id, node.stats);
  }
  return {
    nodes: stats,
    entered,
    exited,
    feedbackHops,
    ...(traceOpts === undefined ? {} : { trace }),
  };
}

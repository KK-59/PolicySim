/**
 * A capacity-constrained queueing node.
 *
 * OWNER: Kaavya.
 *
 * ONE implementation covers two jobs deliberately:
 *
 *   1. The real GP node — 3 clinicians in parallel, constant 15-minute service, and a daily budget
 *      of 90 slots that resets each morning. That is the structure NHS-SIM actually has
 *      (6 sessions x 15 usable slots), and constant service is what its provenance log shows.
 *
 *   2. A degenerate M/M/1 config — 1 server, exponential service, no daily budget. This one has an
 *      exact closed form, which is what makes the whole engine checkable. If the node cannot
 *      reproduce M/M/1, nothing built on it can be trusted.
 *
 * Same code path both times. A validation harness that runs different code from the product is
 * not a validation harness.
 */

import type { Rng } from './rng.ts';

export type ServiceDist = 'constant' | 'exponential';

/**
 * When the node is open, as minutes-of-day.
 *
 * This REPLACES a daily slot budget, deliberately. Slots and clinicians are the same physical
 * resource — 6 sessions x 4h = 1,440 clinician-minutes/day, which at 15 minutes each IS the 90
 * slots we measured. Modelling both meant the node had two independent knobs for one thing, the
 * budget always bound first, and `servers` did almost nothing.
 *
 * Now capacity EMERGES from time:
 *
 *   servers x floor(usableMinutes / serviceMinutes) x blocks
 *   = 3 x floor(225 / 15) x 2
 *   = 90 slots/day, matching the measurement exactly, from structure rather than assertion.
 *
 * It also buys correct overnight behaviour for free: work arriving at 17:30 waits for the morning
 * instead of being served instantly, which is most of why real waits are shaped the way they are.
 */
export interface SessionSchedule {
  /** Minute-of-day each block opens. Measured: [480, 780] — 08:00 and 13:00. */
  blockStarts: readonly number[];
  /**
   * Usable minutes per block, after protected breaks.
   * Measured: 225 = a 240-minute session minus one 15-minute protected break.
   */
  usableMinutes: number;
  /**
   * Clinicians per block, when they are not spread evenly. Overrides NodeConfig.servers.
   *
   * Seven sessions is four clinicians in the morning and three in the afternoon — not four in
   * both. Rounding sessions/blocks made one extra session behave like two, which doubled the
   * apparent strength of the extra-sessions lever.
   */
  serversPerBlock?: readonly number[];
  /**
   * Shut at weekends. Day 0 of the simulation is a Monday, so days 5 and 6 of each week are the
   * weekend.
   *
   * NHS-SIM has no weekday logic — its sessions are seeded for a fixed window from world
   * creation — so this is a deliberate divergence from the ground truth, and one that only the
   * admin node uses. Closing the clinic too would cut weekly capacity by two sevenths.
   */
  closedWeekends?: boolean;
}

export interface NodeConfig {
  id: string;
  /** Clinicians working in parallel (c). GP baseline: 3 — two doctors and a nurse. */
  servers: number;
  /** Mean service time in minutes. */
  serviceMinutes: number;
  /**
   * NHS-SIM's service times have exactly zero measured variance, so 'constant' is the faithful
   * choice. 'exponential' exists for the M/M/1 check and for sensitivity work.
   */
  serviceDist: ServiceDist;
  /** When the node is open. null = continuously available, as the degenerate M/M/1 config needs. */
  schedule: SessionSchedule | null;
  /**
   * Longest queue the node will accept before refusing new work — NHS-SIM's 409 at capacity.
   * null = unbounded, which is right for the GP (nobody is turned away, they just wait).
   *
   * Community is bounded: a visiting team with 4 slots a day cannot hold an indefinite backlog,
   * and a referral it refuses goes back to the GP as more work. That feedback is where the cost
   * of over-shifting to community actually shows up.
   */
  maxQueue: number | null;
}

const MINUTES_PER_DAY = 1440;

/** Clinician-minutes the node is open per day. 3 x 225 x 2 = 1,350 for the measured GP config. */
export function openMinutesPerDay(config: NodeConfig): number {
  if (config.schedule === null) return Number.POSITIVE_INFINITY;
  const per = config.schedule.serversPerBlock;
  const clinicianBlocks = per !== undefined
    ? per.reduce((a, b) => a + b, 0)
    : config.servers * config.schedule.blockStarts.length;
  // Averaged over the week, so utilisation is measured against time the node is really open.
  const weekdayFraction = config.schedule.closedWeekends === true ? 5 / 7 : 1;
  return clinicianBlocks * config.schedule.usableMinutes * weekdayFraction;
}

/** Slots a schedule yields per day. The measured 90 falls out of this, it is not asserted. */
export function slotsPerDay(config: NodeConfig): number {
  if (config.schedule === null) return Number.POSITIVE_INFINITY;
  const slotsPerClinicianBlock = Math.floor(config.schedule.usableMinutes / config.serviceMinutes);
  const per = config.schedule.serversPerBlock;
  const clinicianBlocks = per !== undefined
    ? per.reduce((a, b) => a + b, 0)
    : config.servers * config.schedule.blockStarts.length;
  return slotsPerClinicianBlock * clinicianBlocks;
}

/** One unit of work moving through the network. */
export interface WorkItem {
  id: number;
  arrivedAt: number;
  /** 0 is served first. Urgent = 0; routine and complex share level 1. */
  priority: number;
  /**
   * Multiplier on whatever the node's base service time is. A complex patient takes 2x a routine
   * one — 30 minutes at the GP, 180 at a community visit. Per-item rather than per-node, because
   * the same patient is complex wherever they go.
   */
  serviceMultiplier: number;
  startedAt?: number;
  completedAt?: number;
  /** Set once the item is counted into metrics — i.e. it arrived after warmup. */
  measured: boolean;
  /**
   * Opaque label the node records but never interprets. The engine puts the patient class here.
   * Keeping it opaque is what stops queueing code from acquiring clinical concepts.
   */
  tag?: string;
  /** What the snapshot called this piece of work, for the world view. */
  title?: string;
  /** How many times this item has been refused and sent back upstream. */
  bounces?: number;
  /**
   * The simulator's own identifier for this piece of work, where it came from a snapshot.
   *
   * Opaque to the engine, like `tag`. It exists so the world view can show the people NHS-SIM
   * actually has waiting instead of anonymous demand — the model does not know or care who
   * anyone is, and nothing downstream of here may start caring.
   */
  ref?: string;
  /**
   * Where the item is along its pathway. The router reads it to decide the next hop.
   *
   * Separate from `bounces`, which counts refusals. Overloading one counter for both meant the
   * letter pathway and the test pathway could not share the admin node without interfering.
   */
  stage?: string;
}

export class QueueNode {
  readonly config: NodeConfig;

  /**
   * One FIFO queue per priority level, served strictly in order: level 0 empties before level 1
   * gets a look in. Non-preemptive — an appointment in progress is never interrupted.
   *
   * Head pointers rather than Array.shift(): under pressure these queues grow into six figures,
   * and shift() is O(n), which would make the whole run O(n^2). The dead prefix is compacted once
   * it dominates.
   */
  private queues: WorkItem[][] = [];
  private heads: number[] = [];
  private busy = 0;

  // --- accounting, all over the measurement window only ---

  /** Integral of N(t) dt, where N = waiting + in service. This is what Little's Law needs. */
  private areaN = 0;
  /** Integral of busy-server-time, for utilisation. */
  private areaBusy = 0;
  private lastAccountedAt = 0;
  private windowStart = 0;
  private windowEnd = 0;

  /**
   * Service MINUTES consumed inside the measurement window.
   *
   * Counting appointments started would understate load as soon as classes have different
   * lengths: a 30-minute complex appointment consumes two slots' worth of clinician time but
   * would count as one. Minutes is the only denominator that stays honest.
   */
  private minutesUsed = 0;
  private nAtWindowStart: number | null = null;
  private nAtWindowEnd = 0;

  /** Every item that entered, so conservation can be checked at the end. */
  admitted = 0;
  completed = 0;
  /** Turned away at the door because the queue was full. Never admitted, so never in `admitted`. */
  refused = 0;

  // Kept in lockstep, so the caller can split results by tag without the node storing every item.
  private readonly waits: number[] = [];
  private readonly timesInSystem: number[] = [];
  private readonly tags: string[] = [];

  constructor(config: NodeConfig) {
    this.config = config;
  }

  /**
   * The block open at `now`, if any, as [openUntil]. A job may only start if it also FINISHES
   * before the block closes — a 15-minute appointment cannot begin five minutes before the
   * session ends.
   */
  private openUntil(now: number): number | null {
    const sched = this.config.schedule;
    if (sched === null) return Number.POSITIVE_INFINITY;
    const dayIndex = Math.floor(now / MINUTES_PER_DAY);
    if (sched.closedWeekends === true && dayIndex % 7 >= 5) return null;
    const dayStart = dayIndex * MINUTES_PER_DAY;
    const minuteOfDay = now - dayStart;
    for (const start of sched.blockStarts) {
      if (minuteOfDay >= start && minuteOfDay < start + sched.usableMinutes) {
        return dayStart + start + sched.usableMinutes;
      }
    }
    return null;
  }

  /** Clinicians on duty in the block covering `now`. */
  private serversAt(now: number): number {
    const sched = this.config.schedule;
    if (sched?.serversPerBlock === undefined) return this.config.servers;
    const minuteOfDay = now - Math.floor(now / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    for (let i = 0; i < sched.blockStarts.length; i++) {
      const start = sched.blockStarts[i] as number;
      if (minuteOfDay >= start && minuteOfDay < start + sched.usableMinutes) {
        return sched.serversPerBlock[i] ?? this.config.servers;
      }
    }
    return this.config.servers;
  }

  /**
   * Advance time-weighted accounting to `now`. Must be called before every state change, or the
   * integrals silently drift and Little's Law fails for a reason that has nothing to do with the
   * queue being wrong.
   */
  private accountTo(now: number): void {
    if (now <= this.lastAccountedAt) return;
    // Only accumulate inside the measurement window.
    const from = Math.max(this.lastAccountedAt, this.windowStart);
    const to = Math.min(now, this.windowEnd);
    if (to > from) {
      const dt = to - from;
      this.areaN += (this.queueLength + this.busy) * dt;
      this.areaBusy += this.busy * dt;
    }
    // Queue size at the window edges, so instability can be detected rather than guessed at.
    if (this.nAtWindowStart === null && now >= this.windowStart) {
      this.nAtWindowStart = this.queueLength + this.busy;
    }
    if (now <= this.windowEnd) this.nAtWindowEnd = this.queueLength + this.busy;
    this.lastAccountedAt = now;
  }

  /** Called once, before the run, to fix the window metrics are collected over. */
  setWindow(start: number, end: number): void {
    this.windowStart = start;
    this.windowEnd = end;
  }

  /** True if the node would turn this item away right now. */
  wouldRefuse(now: number): boolean {
    if (this.config.maxQueue === null) return false;
    this.accountTo(now);
    return this.queueLength >= this.config.maxQueue;
  }

  /** An item arrives. Returns the events the caller must schedule. */
  arrive(item: WorkItem, now: number, rng: Rng): ScheduledCompletion[] {
    this.accountTo(now);
    this.admitted++;
    this.enqueue(item);
    return this.tryStart(now, rng);
  }

  /** Record a refusal. The caller decides where the item goes next. */
  refuse(now: number): void {
    this.accountTo(now);
    this.refused++;
  }

  /** A server finishes. Returns any completions the freed server lets us start. */
  complete(item: WorkItem, now: number, rng: Rng): ScheduledCompletion[] {
    this.accountTo(now);
    this.busy--;
    item.completedAt = now;
    this.completed++;
    if (item.measured && item.startedAt !== undefined) {
      this.waits.push(item.startedAt - item.arrivedAt);
      this.timesInSystem.push(now - item.arrivedAt);
      this.tags.push(item.tag ?? '');
    }
    return this.tryStart(now, rng);
  }

  /** A session opens. Work that queued overnight can now start. */
  openSession(now: number, rng: Rng): ScheduledCompletion[] {
    this.accountTo(now);
    return this.tryStart(now, rng);
  }

  /** Start as many waiting items as the open session and free clinicians allow. */
  private tryStart(now: number, rng: Rng): ScheduledCompletion[] {
    const started: ScheduledCompletion[] = [];
    const closesAt = this.openUntil(now);
    if (closesAt === null) return started; // shut — everything waits for the next session

    const serversNow = this.serversAt(now);
    while (this.busy < serversNow) {
      const item = this.takeNext(now, closesAt);
      if (item === null) break;
      item.startedAt = now;
      this.busy++;
      const service = this.config.serviceMinutes * item.serviceMultiplier;
      if (now >= this.windowStart && now <= this.windowEnd) this.minutesUsed += service;
      const duration =
        this.config.serviceDist === 'constant' ? service : rng.exponential(1 / service);
      started.push({ item, at: now + duration });
    }
    return started;
  }

  /**
   * The next item to serve: highest priority first, FIFO within a level.
   *
   * An item is only taken if it also FINISHES before the session closes — a 30-minute appointment
   * cannot start 20 minutes before the end. When the head of a level does not fit, we look at the
   * next level down rather than leaving a clinician idle, because that is what a real practice
   * does with a short gap at the end of a session.
   *
   * That single rule is what produces the tail finding. As each session fills, there is a window
   * where routine patients still fit and complex ones no longer do, so long appointments are
   * repeatedly pushed past the end of the day.
   */
  private takeNext(now: number, closesAt: number): WorkItem | null {
    for (let p = 0; p < this.queues.length; p++) {
      const q = this.queues[p] as WorkItem[];
      const head = this.heads[p] as number;
      if (head >= q.length) continue;
      const item = q[head] as WorkItem;
      const need = this.config.serviceMinutes * item.serviceMultiplier;
      if (this.config.serviceDist === 'constant' && now + need > closesAt) {
        continue; // will not fit before close — try a shorter job at a lower priority
      }
      this.heads[p] = head + 1;
      if (head > 1024 && head * 2 > q.length) {
        this.queues[p] = q.slice(head + 1);
        this.heads[p] = 0;
      }
      return item;
    }
    return null;
  }

  /** Items waiting across every priority level, excluding compacted-away prefixes. */
  private get queueLength(): number {
    let n = 0;
    for (let p = 0; p < this.queues.length; p++) {
      n += (this.queues[p] as WorkItem[]).length - (this.heads[p] as number);
    }
    return n;
  }

  private enqueue(item: WorkItem): void {
    const p = item.priority;
    while (this.queues.length <= p) {
      this.queues.push([]);
      this.heads.push(0);
    }
    (this.queues[p] as WorkItem[]).push(item);
  }

  /**
   * Who is here right now: waiting and in service.
   *
   * For the world view. A trace that starts mid-run opens on a node that already has a queue, and
   * without this the queue is invisible until each item happens to be served — so the backlog
   * that matters most is the one the view cannot see.
   */
  contents(): { item: WorkItem; state: 'waiting' | 'service' }[] {
    const out: { item: WorkItem; state: 'waiting' | 'service' }[] = [];
    for (let p = 0; p < this.queues.length; p++) {
      const q = this.queues[p] as WorkItem[];
      for (let i = this.heads[p] as number; i < q.length; i++) {
        out.push({ item: q[i] as WorkItem, state: 'waiting' });
      }
    }
    // In-service items are not held in a list — the node tracks a count and their completion is
    // already scheduled — so they are reported by the completion events that follow.
    return out;
  }

  /** Close the books at the end of the run. */
  finalise(now: number): void {
    this.accountTo(now);
  }

  get stats(): NodeStats {
    const span = this.windowEnd - this.windowStart;

    // Utilisation is measured against time the node is actually OPEN, not against the 24-hour
    // day. A GP running flat out through every session is at 100%, not 31% — the overnight hours
    // are not idle capacity, they are closed.
    const days = span / MINUTES_PER_DAY;
    const utilisation =
      this.config.schedule !== null
        ? (days > 0 ? this.minutesUsed / (openMinutesPerDay(this.config) * days) : 0)
        : (span > 0 ? this.areaBusy / (span * this.config.servers) : 0);

    return {
      id: this.config.id,
      /** Time-average number in system. The L in L = lambda W. */
      meanNumberInSystem: span > 0 ? this.areaN / span : 0,
      utilisation,
      /** Queue size at the start and end of the window. Growth means no steady state. */
      nAtWindowStart: this.nAtWindowStart ?? 0,
      nAtWindowEnd: this.nAtWindowEnd,
      /** Items still waiting or in service when the run ended. */
      leftInSystem: this.queueLength + this.busy,
      admitted: this.admitted,
      completed: this.completed,
      refused: this.refused,
      waits: this.waits,
      timesInSystem: this.timesInSystem,
      tags: this.tags,
    };
  }
}

export interface ScheduledCompletion {
  item: WorkItem;
  at: number;
}

export interface NodeStats {
  id: string;
  meanNumberInSystem: number;
  /** Against the binding constraint — the daily slot budget where there is one. */
  utilisation: number;
  nAtWindowStart: number;
  nAtWindowEnd: number;
  leftInSystem: number;
  admitted: number;
  completed: number;
  refused: number;
  waits: number[];
  timesInSystem: number[];
  /** Parallel to `waits` and `timesInSystem`. */
  tags: string[];
}

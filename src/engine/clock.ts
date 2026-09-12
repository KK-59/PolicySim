/**
 * Event queue and simulation clock.
 *
 * OWNER: Kaavya.
 *
 * A binary min-heap over (time, seq). The `seq` tie-break is not cosmetic: when two events land on
 * the same timestamp — which happens constantly with constant service times — an unstable ordering
 * makes two runs with the same seed diverge. Insertion order breaks the tie, deterministically.
 *
 * Time is in SIMULATED MINUTES from t=0 throughout the engine. Convert at the edges only.
 */

export type EventKind =
  | 'arrival'          // new work item enters the neighbourhood
  | 'service-complete' // a server finishes an item
  | 'session-open';    // a clinic session opens; overnight work can start

export interface SimEvent {
  time: number;
  kind: EventKind;
  /** Insertion order. Breaks ties so the run is reproducible. */
  seq: number;
  /** The work item this event concerns, where there is one. */
  itemId?: number;
  /** Which node the event belongs to. Single-node phase: always 'gp-clinic'. */
  node?: string;
}

export class EventQueue {
  private heap: SimEvent[] = [];
  private seq = 0;
  private clock = 0;

  /** Current simulation time, in minutes. */
  get now(): number {
    return this.clock;
  }

  get size(): number {
    return this.heap.length;
  }

  /** Schedule an event at an absolute time. Scheduling into the past is a bug, not a clamp. */
  push(event: Omit<SimEvent, 'seq'>): void {
    if (event.time < this.clock) {
      throw new Error(
        `Event scheduled in the past: ${event.kind} at ${event.time}, clock at ${this.clock}`,
      );
    }
    const e: SimEvent = { ...event, seq: this.seq++ };
    this.heap.push(e);
    this.siftUp(this.heap.length - 1);
  }

  /** Pop the next event and advance the clock to it. Returns undefined when the queue drains. */
  pop(): SimEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0] as SimEvent;
    const last = this.heap.pop() as SimEvent;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    this.clock = top.time;
    return top;
  }

  private static before(a: SimEvent, b: SimEvent): boolean {
    return a.time !== b.time ? a.time < b.time : a.seq < b.seq;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const a = this.heap[i] as SimEvent;
      const b = this.heap[parent] as SimEvent;
      if (!EventQueue.before(a, b)) break;
      this.heap[i] = b;
      this.heap[parent] = a;
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < n && EventQueue.before(this.heap[l] as SimEvent, this.heap[smallest] as SimEvent)) {
        smallest = l;
      }
      if (r < n && EventQueue.before(this.heap[r] as SimEvent, this.heap[smallest] as SimEvent)) {
        smallest = r;
      }
      if (smallest === i) break;
      const tmp = this.heap[i] as SimEvent;
      this.heap[i] = this.heap[smallest] as SimEvent;
      this.heap[smallest] = tmp;
      i = smallest;
    }
  }
}

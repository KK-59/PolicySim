/**
 * Single-node convenience wrapper over the network simulator.
 *
 * OWNER: Kaavya.
 *
 * Exists so the M/M/1 and M/D/1 checks stay short to write while still running the exact code the
 * product runs. There is no separate single-node loop any more.
 */

import type { Rng } from './rng.ts';
import type { NodeConfig, NodeStats } from './nodes.ts';
import { simulateNetwork, MINUTES_PER_DAY } from './simulate.ts';

export { MINUTES_PER_DAY };

export interface NodeRun {
  config: NodeConfig;
  arrivalRatePerMin: number;
  horizon: number;
  warmup: number;
  seed: number;
  tagFor?: (rng: Rng) => string;
  classOf?: (tag: string | undefined) => { priority: number; serviceMultiplier: number };
}

export function simulateNode(spec: NodeRun): NodeStats {
  const result = simulateNetwork({
    nodes: [spec.config],
    entries: [{
      nodeId: spec.config.id,
      ratePerMin: spec.arrivalRatePerMin,
      tagFor: spec.tagFor,
      classOf: spec.classOf,
    }],
    horizon: spec.horizon,
    warmup: spec.warmup,
    seed: spec.seed,
  });
  return result.nodes.get(spec.config.id) as NodeStats;
}

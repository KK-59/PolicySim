/**
 * Builds precomputed/grid.json — the demo safety net.
 *
 *   npm run grid
 *
 * OWNER: Kaavya. PRD §8.1 step 8.
 *
 * The interface reads this file and does a lookup. Nothing is computed live on stage, so nothing
 * can be slow or throw. Slider moves land on grid positions.
 *
 * Three levers swept independently, ten positions each, plus the locked baseline.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { BASELINE } from '../src/contracts/baseline.ts';
import { runWorlds } from '../src/worlds/index.ts';
import type { Params } from '../src/contracts/params.ts';
import type { Metrics } from '../src/contracts/metrics.ts';

const SAMPLES = Number(process.env['GRID_SAMPLES'] ?? 60);
const HORIZON = Number(process.env['GRID_HORIZON'] ?? 730);

interface LeverSweep {
  path: string;
  label: string;
  positions: number[];
}

const SWEEPS: LeverSweep[] = [
  {
    path: 'levers.communityCapacityMultiplier',
    label: 'Community capacity',
    positions: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8],
  },
  {
    path: 'levers.hospitalToCommunityShare',
    label: 'Care shifted to community',
    positions: [0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.16, 0.25, 0.35],
  },
  {
    path: 'levers.extraGpSessions',
    label: 'Extra GP sessions',
    positions: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12],
  },
];

function withLever(base: Params, path: string, value: number): Params {
  const p = structuredClone(base);
  const parts = path.split('.');
  let cursor = p as unknown as Record<string, unknown>;
  for (const part of parts) cursor = cursor[part] as Record<string, unknown>;
  cursor['value'] = value;
  return p;
}

/** Only what the UI renders — the full Metrics object would bloat the bundle. */
function slim(m: Metrics) {
  const gp = m.worlds.perNode['gp-clinic'];
  const cm = m.worlds.perNode['community-visit'];
  const band = (t: { p50: number; p90: number }) => ({ p50: t.p50, p90: t.p90 });
  return {
    waits: {
      routine: {
        optimistic: band(m.worlds.waits.routine.optimistic),
        realistic: band(m.worlds.waits.routine.realistic),
        pessimistic: band(m.worlds.waits.routine.pessimistic),
      },
      complex: {
        optimistic: band(m.worlds.waits.complex.optimistic),
        realistic: band(m.worlds.waits.complex.realistic),
        pessimistic: band(m.worlds.waits.complex.pessimistic),
      },
      urgent: {
        optimistic: band(m.worlds.waits.urgent.optimistic),
        realistic: band(m.worlds.waits.urgent.realistic),
        pessimistic: band(m.worlds.waits.urgent.pessimistic),
      },
    },
    stable: {
      optimistic: gp?.optimistic.stable ?? false,
      realistic: gp?.realistic.stable ?? false,
      pessimistic: gp?.pessimistic.stable ?? false,
    },
    utilisation: {
      gp: gp?.realistic.utilisation ?? 0,
      community: cm?.realistic.utilisation ?? 0,
    },
    rejections: m.worlds.rejections.realistic,
    findings: m.findings.map((f) => ({
      statement: f.statement,
      survivesAllThree: f.survivesAllThree,
      optimisticOnly: f.optimisticOnly,
      holdsIn: f.holdsIn,
    })),
    thresholds: m.thresholds.map((t) => t.statement),
  };
}

const started = Date.now();
console.log(`Building grid: ${SWEEPS.length} levers x 10 positions, `
  + `${SAMPLES} samples, ${HORIZON} sim-days each`);

const baseline = runWorlds(BASELINE, { samples: SAMPLES, horizonDays: HORIZON });

const sweeps: Record<string, unknown> = {};
for (const sweep of SWEEPS) {
  const points = [];
  for (const value of sweep.positions) {
    const params = withLever(BASELINE, sweep.path, value);
    const m = runWorlds(params, { samples: SAMPLES, horizonDays: HORIZON, baseline: BASELINE });
    points.push({ value, ...slim(m) });
    process.stdout.write('.');
  }
  sweeps[sweep.path] = { label: sweep.label, points };
  process.stdout.write(` ${sweep.label}\n`);
}

const bundle = {
  builtAt: new Date().toISOString(),
  world: BASELINE.meta.worldId,
  snapshot: BASELINE.meta.snapshotId,
  samples: SAMPLES,
  horizonDays: HORIZON,
  tornado: baseline.tornado.slice(0, 8).map((r) => ({
    path: r.path,
    label: r.label,
    swing: Number.isFinite(r.swing) ? r.swing : null,
    source: r.rangeSource,
    dominantButUnsourced: r.dominantButUnsourced,
  })),
  flags: baseline.flags,
  baseline: slim(baseline),
  sweeps,
};

mkdirSync('precomputed', { recursive: true });
writeFileSync('precomputed/grid.json', JSON.stringify(bundle, null, 1));
const kb = (JSON.stringify(bundle).length / 1024).toFixed(0);
console.log(`\nprecomputed/grid.json — ${kb}KB in ${((Date.now() - started) / 1000).toFixed(0)}s`);

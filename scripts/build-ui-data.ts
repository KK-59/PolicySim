/**
 * Generates the interface's data from the engine.
 *
 *   npm run ui-data
 *
 * OWNER: Kaavya.
 *
 * Writes fixtures/metrics.live.json and fixtures/sweep.live.json, which src/ui/data reads in
 * place of the hand-written mocks. Precomputed rather than run in the browser, per PRD §0: a
 * thousand sampled simulations is a build step, not a page load, and a lookup cannot be slow or
 * throw on stage.
 *
 * Nothing written here carries `_synthetic`, which is what turns the banner off — so if this
 * script has not run, the interface says so rather than presenting fixtures as measurements.
 */

import { writeFileSync } from 'node:fs';
import { BASELINE } from '../src/contracts/baseline.ts';
import { runWorlds } from '../src/worlds/index.ts';
import { sampleParams } from '../src/worlds/sampler.ts';
import { run } from '../src/engine/index.ts';
import { makeRng } from '../src/engine/rng.ts';
import type { Params } from '../src/contracts/params.ts';

const SAMPLES = Number(process.env['UI_SAMPLES'] ?? 60);
const HORIZON = Number(process.env['UI_HORIZON'] ?? 550);
const GHOSTS = Number(process.env['UI_GHOSTS'] ?? 24);

/**
 * The swept lever.
 *
 * Community capacity, because it is the measured constraint (4 visits/day) and the one the
 * 10-Year Plan's shift depends on. The threshold it produces — "holds while capacity stays above
 * X" — is the shape of claim the PRD asks for, and it moves per world, which is the whole
 * argument for showing three.
 */
const LEVER_PATH = 'levers.communityCapacityMultiplier';
const POSITIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8];

/** Held while the lever sweeps: enough care is being shifted for capacity to matter. */
const POLICY_SHIFT = 0.05;
const POLICY_INDEX = 4;

function withLever(base: Params, value: number): Params {
  const p = structuredClone(base);
  p.levers.communityCapacityMultiplier.value = value;
  p.levers.hospitalToCommunityShare.value = POLICY_SHIFT;
  p.sim.horizonDays = HORIZON;
  return p;
}

type World = 'optimistic' | 'realistic' | 'pessimistic';
const WORLDS: World[] = ['optimistic', 'realistic', 'pessimistic'];
const MIN_PER_DAY = 1440;

console.log(`Sweeping ${LEVER_PATH} over ${POSITIONS.length} positions, `
  + `${SAMPLES} samples x ${HORIZON} sim-days`);

// --- the sweep -------------------------------------------------------------------------------

type Cell = { p50: Record<World, number>; p90: Record<World, number>; stable: Record<World, boolean> };
const routine: Cell[] = [];
const complex: Cell[] = [];

for (const value of POSITIONS) {
  const m = runWorlds(withLever(BASELINE, value), {
    samples: SAMPLES, horizonDays: HORIZON, baseline: BASELINE,
  });
  const gp = m.worlds.perNode['gp-clinic'];
  const cell = (band: typeof m.worlds.waits.routine): Cell => ({
    p50: { optimistic: band.optimistic.p50, realistic: band.realistic.p50, pessimistic: band.pessimistic.p50 },
    p90: { optimistic: band.optimistic.p90, realistic: band.realistic.p90, pessimistic: band.pessimistic.p90 },
    stable: {
      optimistic: gp?.optimistic.stable ?? false,
      realistic: gp?.realistic.stable ?? false,
      pessimistic: gp?.pessimistic.stable ?? false,
    },
  });
  routine.push(cell(m.worlds.waits.routine));
  complex.push(cell(m.worlds.waits.complex));
  process.stdout.write('.');
}
process.stdout.write('\n');

// --- ghosts: individual sampled runs, drawn faintly behind the bands ---------------------------
//
// Real sampled parameter draws, not jitter around the median. They are what makes the band mean
// something: a reader can see that the spread is made of runs, each of which actually happened.

const rng = makeRng(99);
const ghosts: { id: number; points: { x: number; y: number }[] }[] = [];
for (let g = 0; g < GHOSTS; g++) {
  const drawn = sampleParams(BASELINE, rng);
  const points: { x: number; y: number }[] = [];
  for (const value of POSITIONS) {
    const p = structuredClone(drawn);
    p.levers.communityCapacityMultiplier.value = value;
    p.levers.hospitalToCommunityShare.value = POLICY_SHIFT;
    p.sim.horizonDays = HORIZON;
    const r = run(p, 1000 + g);
    if (r.perNode['gp-clinic']?.stable) points.push({ x: value, y: r.waits.routine.p50 / MIN_PER_DAY });
  }
  if (points.length > 1) ghosts.push({ id: g, points });
}
console.log(`${ghosts.length} ghost runs`);

// --- breakpoints: the lowest capacity at which the world stays stable --------------------------

const breakpointFor = (world: World): number | null => {
  for (let i = 0; i < POSITIONS.length; i++) {
    if (routine[i]?.stable[world]) return POSITIONS[i] as number;
  }
  return null;
};

const series = (
  cells: Cell[],
  patientClass: 'routine' | 'complex',
  metric: 'p50' | 'p90',
  label: string,
) => ({
  patientClass,
  metric,
  label,
  direction: 'lower-is-better' as const,
  worlds: WORLDS.map((world) => ({
    world,
    points: POSITIONS.map((x, i) => ({ x, y: (cells[i] as Cell)[metric][world] / MIN_PER_DAY })),
  })),
  ghosts: patientClass === 'routine' ? ghosts : [],
});

writeFileSync('fixtures/sweep.live.json', JSON.stringify({
  lever: {
    path: LEVER_PATH,
    label: 'Community capacity',
    unit: 'x current',
    baseValue: BASELINE.capacities.communitySlotsPerDay.value,
    baseUnit: 'visits per day',
    positions: POSITIONS,
  },
  baselineIndex: 0,
  policyIndex: POLICY_INDEX,
  breakpoint: breakpointFor('realistic'),
  breakpointByWorld: {
    optimistic: breakpointFor('optimistic'),
    realistic: breakpointFor('realistic'),
    pessimistic: breakpointFor('pessimistic'),
  },
  series: [
    series(routine, 'routine', 'p50', 'Median wait, routine'),
    series(complex, 'complex', 'p90', '90th percentile wait, complex'),
  ],
}, null, 1));

// --- metrics: the policy under test, against the locked baseline --------------------------------

const policy = withLever(BASELINE, POSITIONS[POLICY_INDEX] as number);
const metrics = runWorlds(policy, { samples: SAMPLES, horizonDays: HORIZON, baseline: BASELINE });
writeFileSync('fixtures/metrics.live.json', JSON.stringify(metrics, null, 1));

// The calibrated baseline, so the parameter panel shows what the engine actually ran on.
writeFileSync('fixtures/params.live.json', JSON.stringify(BASELINE, null, 1));

console.log('fixtures/sweep.live.json + metrics.live.json + params.live.json written');
console.log(`breakpoints  optimistic ${breakpointFor('optimistic')}x  `
  + `realistic ${breakpointFor('realistic')}x  pessimistic ${breakpointFor('pessimistic')}x`);

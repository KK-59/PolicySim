/**
 * Tornado data.
 *
 * OWNER: Kaavya. The implementation lives in `buildTornado` inside src/worlds/index.ts, because it
 * needs the sampler's parameter walk and runs as part of producing Metrics. Re-exported here so
 * the path in the task breakdown resolves to something.
 *
 * A tornado row carries `dominantButUnsourced`: true when a parameter is in the top three by swing
 * AND its range is an assumption. That is the case that quietly collapses the three worlds, so it
 * is computed rather than remembered.
 */

export { runWorlds } from '../worlds/index.ts';
export type { TornadoRow } from '../contracts/metrics.ts';

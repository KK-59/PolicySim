/**
 * Precomputed grid export.
 *
 * OWNER: Kaavya. The build lives in scripts/build-grid.ts and runs offline via `npm run grid`; it
 * writes precomputed/grid.json, which the interface reads as a lookup so nothing is computed live
 * on stage.
 *
 * Deliberately not importable engine code: a thousand sampled runs per grid point takes minutes,
 * which is fine as a build step and unusable in a browser. This file exists so the path in the
 * task breakdown resolves, and to say where the real thing is.
 */

export type GridBundle = {
  builtAt: string;
  world: string | undefined;
  snapshot: string | undefined;
  samples: number;
  horizonDays: number;
  tornado: {
    path: string;
    label: string;
    /** null when that end of the range has no steady state — an unbounded swing. */
    swing: number | null;
    source: string;
    dominantButUnsourced: boolean;
  }[];
  baseline: unknown;
  sweeps: Record<string, { label: string; points: unknown[] }>;
};

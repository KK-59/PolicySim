/**
 * Metrics — what a run returns, including the three-world bands.
 * OWNER: Kaavya. CONSUMED BY: Elsa (every view), Kaavya (sensitivity).
 * PRD §4.5, §4.6. FREEZE BEFORE ANYONE BUILDS.
 *
 * TODO(kaavya): define alongside Params.
 *
 * Shape to define:
 *   - A single run's outputs: per-class median and 90th-percentile waits, queue lengths,
 *     utilisation per node, throughput, conservation counters.
 *   - ThreeWorlds<T>: optimistic = P90, realistic = P50, pessimistic = P10
 *     — percentiles of the OUTCOME distribution over ~1,000 sampled runs, not input corners.
 *   - Delta vs locked baseline (the UI never shows absolutes).
 *   - Robustness flag per finding: survives all three worlds / optimistic-only.
 *   - Tornado rows: parameter → outcome swing.
 *   - Threshold callouts: "holds while <param> >= X".
 *   - Verification results attached to every run: conservation, Little's Law, M/M/1 agreement.
 */

export {};

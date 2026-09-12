/**
 * Single import point for the frozen contracts.
 * `import type { Params, Metrics } from '@/contracts'`
 */

export type {
  Params,
  ParamsMeta,
  Sourced,
  SourceTag,
  PatientClass,
  ByClass,
  Arrivals,
  Capacities,
  ServiceTimes,
  Routing,
  Levers,
  Boundaries,
  Environment,
  SimConfig,
  ParamPath,
  FlatParam,
  ParamFlag,
} from './params.ts';

export { BASELINE } from './baseline.ts';

export type {
  Metrics,
  WorldBands,
  ThreeWorlds,
  MetricDirection,
  Tail,
  NodeId,
  NodeState,
  RunOutcome,
  RunMeta,
  Verification,
  VerificationCheck,
  Finding,
  TornadoRow,
  Threshold,
  Breakeven,
  MetricFlag,
  AccuracyReport,
  EventDiff,
  RankedPlan,
  PlanOutcome,
} from './metrics.ts';

// TODO(oriol): export the Action contract here once it is defined.

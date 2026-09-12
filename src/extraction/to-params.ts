/**
 * Commitments + retrieved evidence -> Params, with a source tag on every field.
 *
 * OWNER: Oriol (contract). PRD §2 step 3, §4.9 stage 2.
 *
 * Three tiers, applied in order and never silently:
 *   documented — the uploaded document states the number
 *   literature — the corpus supplies a value and a RANGE for a lever the document left open
 *   assumed    — neither did. Held at baseline, flagged amber, never quietly defaulted.
 *
 * Every value is clamped to the parameter's physical bounds, so a misread decimal point cannot
 * produce a negative capacity or a share above one.
 */

import type { Params, Sourced } from '../contracts/params.ts';
import { BASELINE } from '../contracts/baseline.ts';
import type { Commitment, LeverPath } from './commitments.ts';
import { retrieveLiterature } from './rag.ts';

export interface ExtractedParams {
  params: Params;
  /** One row per lever, for the parameter screen. */
  rows: ParamRow[];
}

export interface ParamRow {
  paramPath: LeverPath;
  label: string;
  value: number;
  range?: [number, number];
  bounds: [number, number];
  source: 'documented' | 'literature' | 'assumed';
  /** The document span, the corpus citation, or null. */
  citation: string | null;
  /** The commitment text, or why nothing was found. */
  text: string;
  span: string | null;
  note: string;
}

const LABELS: Record<LeverPath, string> = {
  'levers.communityCapacityMultiplier': 'Community capacity',
  'levers.extraGpSessions': 'Extra GP sessions',
  'levers.telephoneFollowUpShare': 'Telephone follow-up share',
  'levers.monitoringIntensity': 'Monitoring intensity',
  'levers.hospitalToCommunityShare': 'Care shifted to community',
  'levers.weekdayDischargeShare': 'Weekday discharge share',
};

const leverKey = (path: LeverPath) => path.split('.')[1] as keyof Params['levers'];

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

export async function toParams(
  commitments: readonly Commitment[],
  opts: { fillGapsFromCorpus?: boolean } = {},
): Promise<ExtractedParams> {
  const params = structuredClone(BASELINE);
  const rows: ParamRow[] = [];
  const claimed = new Set<LeverPath>();

  // --- tier 1: what the document says ----------------------------------------------------------
  for (const c of commitments) {
    const key = leverKey(c.paramPath);
    const leaf = params.levers[key] as Sourced | undefined;
    if (!leaf) continue;

    const value = clamp(c.value, leaf.bounds);
    leaf.value = value;
    leaf.source = c.documented ? 'documented' : 'assumed';
    leaf.citation = c.span ?? undefined;
    leaf.note = c.rationale;
    claimed.add(c.paramPath);

    rows.push({
      paramPath: c.paramPath,
      label: LABELS[c.paramPath],
      value,
      ...(leaf.range ? { range: [leaf.range[0], leaf.range[1]] as [number, number] } : {}),
      bounds: [leaf.bounds[0], leaf.bounds[1]],
      // A number the model inferred from wording is not a number the document states.
      source: c.documented ? 'documented' : 'assumed',
      citation: c.span,
      text: c.text,
      span: c.span,
      note: c.documented
        ? c.rationale
        : `Inferred from wording, not stated. ${c.rationale}`,
    });
  }

  // --- tier 2 and 3: everything the document left open -----------------------------------------
  for (const path of Object.keys(LABELS) as LeverPath[]) {
    if (claimed.has(path)) continue;
    const key = leverKey(path);
    const leaf = params.levers[key] as Sourced;

    const hit = opts.fillGapsFromCorpus === false
      ? undefined
      : (await retrieveLiterature(LABELS[path], {
          parameterPath: path, requireRange: true, limit: 1,
        }))[0];

    if (hit) {
      leaf.source = 'literature';
      leaf.citation = `${hit.title} (${hit.year})`;
      rows.push({
        paramPath: path,
        label: LABELS[path],
        value: leaf.value,
        ...(leaf.range ? { range: [leaf.range[0], leaf.range[1]] as [number, number] } : {}),
        bounds: [leaf.bounds[0], leaf.bounds[1]],
        source: 'literature',
        citation: `${hit.title} (${hit.year})`,
        text: 'Not in the document. Held at the calibrated baseline, with a corpus source.',
        span: null,
        note: hit.text.slice(0, 220),
      });
      continue;
    }

    // Nothing anywhere. Baseline, amber, and said out loud.
    leaf.source = 'assumed';
    rows.push({
      paramPath: path,
      label: LABELS[path],
      value: leaf.value,
      ...(leaf.range ? { range: [leaf.range[0], leaf.range[1]] as [number, number] } : {}),
      bounds: [leaf.bounds[0], leaf.bounds[1]],
      source: 'assumed',
      citation: null,
      text: 'Not in the document, and no ranged evidence in the corpus.',
      span: null,
      note: 'Held at the calibrated baseline. Flagged rather than silently defaulted.',
    });
  }

  rows.sort((a, b) =>
    Object.keys(LABELS).indexOf(a.paramPath) - Object.keys(LABELS).indexOf(b.paramPath));

  return { params, rows };
}

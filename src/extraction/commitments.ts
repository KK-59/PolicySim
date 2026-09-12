/**
 * Stage 1: the uploaded document -> operational commitments.
 *
 * OWNER: Oriol (contract). PRD §4.9.
 *
 * ONE model call, at the boundary of the system. It never sees a metric, never proposes an
 * outcome, and never feeds another model call: it reads English and returns which levers the
 * document moves and by how much. Everything causal happens afterwards, in the engine.
 *
 * Two constraints make it checkable rather than merely plausible:
 *
 *   - Constrained JSON. The schema is the parameter vocabulary, so the model cannot invent a
 *     lever the engine does not have.
 *   - A SPAN QUOTE per commitment, verified against the source text before it is accepted. A
 *     commitment we cannot point back at the document is a commitment the user cannot check, and
 *     it is dropped rather than shown.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/** Roughly 30k tokens of document. Beyond this the call is slow and the tail is rarely policy. */
const MAX_CHARS = 120_000;

/** The only paths a document is allowed to move. Anything else is not a policy lever. */
export const LEVER_PATHS = [
  'levers.communityCapacityMultiplier',
  'levers.extraGpSessions',
  'levers.telephoneFollowUpShare',
  'levers.monitoringIntensity',
  'levers.hospitalToCommunityShare',
  'levers.weekdayDischargeShare',
] as const;

export type LeverPath = (typeof LEVER_PATHS)[number];

export interface Commitment {
  id: string;
  /** What the document commits to, in the model's words. */
  text: string;
  /** Verbatim from the document, so the reader can find it. Null if it could not be verified. */
  span: string | null;
  paramPath: LeverPath;
  /** The value the document implies for that parameter, already in the engine's units. */
  value: number;
  /** True when the document states a number; false when the model inferred one from wording. */
  documented: boolean;
  /** Why this reading, in one line. Shown on hover. */
  rationale: string;
}

export interface ExtractionResult {
  commitments: Commitment[];
  /** Spans the model produced that are not in the document. Kept for the report, never rendered
   *  as findings. */
  rejected: { text: string; span: string; reason: string }[];
  model: string;
  /** Characters actually sent to the model. */
  charsRead: number;
  /** True when the document was longer than that. The user is told; it is not hidden. */
  truncated: boolean;
}

const SYSTEM = `You read NHS policy documents and identify the operational commitments they make.

You are given a document and a fixed vocabulary of engine parameters. For each commitment the
document makes, return the parameter it moves and the value it implies.

Rules:
- Only use parameters from the vocabulary. If a commitment does not map to one, omit it.
- Quote the document VERBATIM in "span". Copy the exact characters, including any typos. Never
  paraphrase in the span; paraphrase in "text" instead.
- Set "documented" true only when the document states the number. If you inferred a value from
  wording like "significantly increase", set it false and say so in the rationale.
- Values are absolute settings for the parameter, not changes. A multiplier of 1 means no change.
- Prefer fewer, well-evidenced commitments over many speculative ones.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['commitments'],
  properties: {
    commitments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'span', 'paramPath', 'value', 'documented', 'rationale'],
        properties: {
          text: { type: 'string' },
          span: { type: 'string' },
          paramPath: { type: 'string', enum: [...LEVER_PATHS] },
          value: { type: 'number' },
          documented: { type: 'boolean' },
          rationale: { type: 'string' },
        },
      },
    },
  },
} as const;

const VOCABULARY = `
levers.communityCapacityMultiplier — multiplier on community home-visit capacity.
  Baseline 1 = the measured 4 visits/day. "Double community capacity" is 2.
levers.extraGpSessions — additional GP sessions per day on top of the measured 6. An integer.
levers.telephoneFollowUpShare — share of appointments by telephone, 0 to 1. Measured baseline 0.33.
levers.monitoringIntensity — multiplier on remote monitoring. Baseline 1.
levers.hospitalToCommunityShare — share of hospital discharges routed to community rather than
  outpatient, 0 to 1. Baseline 0.
levers.weekdayDischargeShare — share of discharges timed to weekdays, 0 to 1. Baseline 1.
`;

export interface ExtractOptions {
  apiKey?: string;
  model?: string;
  /** Free text the user added alongside the document. Context only, never a parameter override. */
  notes?: string;
  fetchImpl?: typeof fetch;
}

export async function extractCommitments(
  documentText: string,
  opts: ExtractOptions = {},
): Promise<ExtractionResult> {
  const apiKey = opts.apiKey ?? process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Extraction is the one part of this that needs a model; '
      + 'put the key in .env (it is gitignored) and restart the API.',
    );
  }
  const model = opts.model ?? process.env['OPENAI_MODEL'] ?? 'gpt-4.1';
  const doFetch = opts.fetchImpl ?? fetch;

  // Long documents are truncated rather than chunked. A board paper states its commitments early;
  // chunking would multiply the model calls and the PRD's rule is one call at the boundary.
  //
  // The truncation is REPORTED. Silently reading the first fifth of somebody's strategy and
  // presenting the result as a reading of their strategy is the same failure as an unverified
  // span: it looks complete and is not.
  const sent = documentText.slice(0, MAX_CHARS);
  const truncated = documentText.length > MAX_CHARS;

  const body = {
    model,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'commitments', strict: true, schema: SCHEMA },
    },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `PARAMETER VOCABULARY\n${VOCABULARY}\n\n`
          + (opts.notes ? `CONTEXT FROM THE USER (not a parameter override)\n${opts.notes}\n\n` : '')
          + `DOCUMENT\n${sent}`,
      },
    ],
  };

  const response = await doFetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const payload = await response.json() as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');

  const parsed = JSON.parse(content) as { commitments: Omit<Commitment, 'id'>[] };
  return verify(parsed.commitments, sent, model, truncated);
}

/**
 * Drop anything whose span is not actually in the document.
 *
 * This is the load-bearing half. A model asked for a verbatim quote will occasionally produce a
 * near-quote, and a near-quote in a citation is worse than no citation — it looks checkable and
 * is not. Whitespace is normalised on both sides before comparing, because PDF extraction breaks
 * lines where the document does not.
 */
function verify(
  raw: readonly Omit<Commitment, 'id'>[],
  documentText: string,
  model: string,
  truncated: boolean,
): ExtractionResult {
  const haystack = normalise(documentText);
  const commitments: Commitment[] = [];
  const rejected: ExtractionResult['rejected'] = [];

  raw.forEach((c, i) => {
    const span = (c.span ?? '').trim();
    const found = span.length > 0 && haystack.includes(normalise(span));
    if (!found) {
      rejected.push({
        text: c.text,
        span,
        reason: span.length === 0
          ? 'no span quoted'
          : 'the quoted span is not in the document, so the reading cannot be checked',
      });
      return;
    }
    commitments.push({ ...c, id: `c${i + 1}`, span });
  });

  return { commitments, rejected, model, charsRead: documentText.length, truncated };
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Span verification: strict about words, forgiving about markup.
 * OWNER: Oriol. Never calls the model; the fetch is stubbed.
 */

import { describe, expect, it } from 'vitest';
import { extractCommitments } from '@/extraction/commitments.ts';

/** Stub the one network call, returning whatever commitments the test wants to verify. */
function stubModel(commitments: unknown[]) {
  return async () =>
    ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ commitments }) } }],
      }),
    }) as unknown as Response;
}

const commitment = (span: string) => ({
  text: 'a commitment',
  span,
  paramPath: 'levers.communityCapacityMultiplier',
  value: 2,
  documented: true,
  rationale: 'because',
});

async function run(documentText: string, span: string) {
  return extractCommitments(documentText, {
    apiKey: 'test-key',
    fetchImpl: stubModel([commitment(span)]),
  });
}

describe('a quote is still a quote through markup', () => {
  it('accepts a span the document wraps in markdown emphasis', async () => {
    // This threw away three of six real commitments before it was fixed.
    const doc = 'We will **double community capacity to eight visits per day** by Q2.';
    const out = await run(doc, 'double community capacity to eight visits per day');

    expect(out.rejected).toHaveLength(0);
    expect(out.commitments).toHaveLength(1);
  });

  it('accepts ASCII quotes and hyphens where the document uses typographic ones', async () => {
    const doc = 'The trust’s “home‐first” model reduces travel.';
    const out = await run(doc, "the trust's \"home-first\" model");

    expect(out.rejected).toHaveLength(0);
  });

  it('accepts a span broken by the soft hyphens and non-breaking spaces PDFs leave behind', async () => {
    // A soft hyphen splits ONE word across a line break: "vis-its" is "visits".
    const SOFT_HYPHEN = String.fromCharCode(0x00AD);
    const NBSP = String.fromCharCode(0x00A0);
    const doc = `Capacity${NBSP}rises to eight vis${SOFT_HYPHEN}its per day.`;
    const out = await run(doc, 'capacity rises to eight visits per day');

    expect(out.rejected).toHaveLength(0);
  });

  it('STILL rejects a span that is not in the document', async () => {
    // The safety property. Folding markup must not make different sentences compare equal.
    const doc = 'We will double community capacity to eight visits per day.';
    const out = await run(doc, 'we will triple community capacity to twelve visits per day');

    expect(out.commitments).toHaveLength(0);
    expect(out.rejected[0]?.reason).toContain('not in the document');
  });

  it('STILL rejects a commitment with no span at all', async () => {
    const out = await run('anything', '');

    expect(out.commitments).toHaveLength(0);
    expect(out.rejected[0]?.reason).toBe('no span quoted');
  });
});

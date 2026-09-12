/**
 * What the document says, in numbers, with where each one came from.
 *
 * Shown before the run so the user can disagree with the reading of their own document while it
 * still matters. Anything tagged `assumed` is amber.
 */

import { useState } from 'react'
import { Glyph } from '../components/Glyph'
import { SourceTag } from '../components/SourceTag'
import { navigate } from '../lib/router'
import { setCommitment, setRun, useRun } from '../lib/store'
import { EXTRACTION_NOTE, IS_EXTRACTION_SYNTHETIC } from '../data'

export function ExtractedParams() {
  const run = useRun()
  const commitments = run.commitments
  const [error, setError] = useState<string | null>(null)

  /**
   * Send the parameters to the engine and go to the result.
   *
   * The values sent are whatever is on screen — extraction's reading plus any edit the user made
   * to it. That is the point of showing them before the run rather than after.
   *
   * On failure the user stays here with a reason. Navigating anyway would show the precomputed
   * baseline under a heading claiming it is their policy, which is the one thing this screen
   * exists to prevent.
   */
  async function runPolicy() {
    setError(null)
    setRun({ running: true })
    try {
      const levers: Record<string, number> = {}
      for (const c of commitments) levers[c.paramPath] = c.value

      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levers, samples: 16 }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error ?? `Run failed (${response.status})`)

      setRun({
        hasRun: true,
        result: { metrics: payload.metrics, sweep: payload.sweep },
        running: false,
      })
      navigate('/world')
    } catch (cause) {
      setRun({ running: false })
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <section className="page">
      {/*
        The outcomes are the engine's; this page's document read is not. Saying so here rather
        than in the site-wide banner, because the banner going quiet must not vouch for a screen
        it was never about.
      */}
      {IS_EXTRACTION_SYNTHETIC && !run.extracted && (
        <p className="note row gap-2" role="note">
          <Glyph name="warning" size={13} />
          <span>{EXTRACTION_NOTE}</span>
        </p>
      )}

      {/* A document longer than one model call. Said here rather than nowhere: reading the first
          fifth of somebody's strategy and presenting it as a reading of their strategy is the
          same failure as an unverified quote — it looks complete and is not. */}
      {run.truncated && (
        <p className="note" role="note">
          <Glyph name="warning" size={13} />
          <span>
            Only the first {run.truncated.charsRead.toLocaleString()} characters were read.
            Commitments made later in the document will have been missed.
          </span>
        </p>
      )}

      {/* Spans the model quoted that are not in the document. Shown, not swallowed: a reading we
          could not verify is the thing a reader most needs to know we discarded. */}
      {run.rejected.length > 0 && (
        <p className="note" role="note">
          <Glyph name="warning" size={13} />
          <span>
            {run.rejected.length} reading{run.rejected.length === 1 ? '' : 's'} discarded because
            the quoted passage could not be found in the document.
          </span>
        </p>
      )}
      <div className="row between">
        <h1 className="h1">Here is what it says.</h1>
        <button
          type="button"
          className="btn btn--primary btn--lg"
          disabled={run.running}
          onClick={() => {
            void runPolicy()
          }}
        >
          {run.running ? 'Simulating…' : 'Run the three worlds'}
          {!run.running && <Glyph name="arrow" size={16} />}
        </button>
      </div>

      {error && (
        <p className="note mt-4" role="alert">
          <Glyph name="warning" size={13} />
          <span>{error}</span>
        </p>
      )}

      <div className="tablewrap mt-5">
        <table>
          <thead>
            <tr>
              <th>Commitment</th>
              <th className="n">Value</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {commitments.map((c) => (
              <tr key={c.id}>
                <td>
                  <p>{c.label}</p>
                  <p className="tiny muted mt-2">{c.text}</p>
                </td>
                <td className="n">
                  <input
                    className="num numfield"
                    type="number"
                    step={c.bounds[1] <= 1 ? 0.05 : 0.1}
                    min={c.bounds[0]}
                    max={c.bounds[1]}
                    value={c.value}
                    aria-label={`${c.label} value`}
                    onChange={(e) => setCommitment(c.id, Number(e.target.value))}
                  />
                </td>
                <td>
                  <SourceTag source={c.source} citation={c.citation} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

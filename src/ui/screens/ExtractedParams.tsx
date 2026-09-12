/**
 * What the document says, in numbers, with where each one came from.
 *
 * Shown before the run so the user can disagree with the reading of their own document while it
 * still matters. Anything tagged `assumed` is amber.
 */

import { Glyph } from '../components/Glyph'
import { SourceTag } from '../components/SourceTag'
import { navigate } from '../lib/router'
import { setCommitment, setRun, useRun } from '../lib/store'
import { EXTRACTION_NOTE, IS_EXTRACTION_SYNTHETIC } from '../data'

export function ExtractedParams() {
  const run = useRun()
  const commitments = run.commitments

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
          onClick={() => {
            setRun({ hasRun: true })
            navigate('/worlds')
          }}
        >
          Run in three worlds
          <Glyph name="arrow" size={16} />
        </button>
      </div>

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

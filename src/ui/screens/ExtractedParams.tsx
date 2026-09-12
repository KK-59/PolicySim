/**
 * What your policy actually says, in numbers, with where each one came from.
 *
 * Shown BEFORE the run, not after: the user gets to disagree with the reading of their own
 * document while it still matters. Anything tagged `assumed` is amber, and anything with no
 * span quote says so rather than implying the document supported it.
 */

import { Glyph } from '../components/Glyph'
import { SourceTag, SourceKey } from '../components/SourceTag'
import { navigate } from '../lib/router'
import { setCommitment, setRun, useRun } from '../lib/store'
import { extraction } from '../data'

export function ExtractedParams() {
  const run = useRun()
  const commitments = run.commitments
  const assumed = commitments.filter((c) => c.source === 'assumed').length

  return (
    <section className="section wrap wrap--wide" style={{ borderTop: 0 }}>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div className="prose stack gap-3">
          <h1 className="h1">Here is what it says.</h1>
          <p className="lead">
            {commitments.length} operational commitments, read out of{' '}
            <span className="num">{run.document?.filename ?? extraction.document.filename}</span>.
            Change anything that is wrong. Nothing has run yet.
          </p>
        </div>
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

      {assumed > 0 && (
        <p className="small mt-5 row gap-2" style={{ color: 'var(--amber)' }}>
          <Glyph name="warning" size={16} />
          {assumed} of these are assumptions the document does not support. They are not defaults —
          they are gaps, and they are shown so you can close them.
        </p>
      )}

      <div className="mt-5 panel">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Commitment</th>
                <th>Becomes</th>
                <th className="n">Value</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {commitments.map((c) => (
                <tr key={c.id}>
                  <td style={{ maxWidth: '26rem' }}>
                    <p>{c.text}</p>
                    <p className="tiny muted mt-2">
                      {c.span ? (
                        <em>{c.span}</em>
                      ) : (
                        <span style={{ color: 'var(--amber)' }}>
                          Not stated anywhere in the document.
                        </span>
                      )}
                    </p>
                  </td>
                  <td style={{ maxWidth: '14rem' }}>
                    <p className="small">{c.label}</p>
                    <p className="tiny muted mt-2">{c.note}</p>
                  </td>
                  <td className="n" style={{ minWidth: '9rem' }}>
                    <input
                      className="num"
                      type="number"
                      step={c.bounds[1] <= 1 ? 0.05 : 0.1}
                      min={c.bounds[0]}
                      max={c.bounds[1]}
                      value={c.value}
                      aria-label={`${c.label} value`}
                      onChange={(e) => setCommitment(c.id, Number(e.target.value))}
                      style={{
                        width: '5.5rem',
                        textAlign: 'right',
                        padding: '0.25rem 0.5rem',
                        border: '1px solid var(--rule-2)',
                        borderRadius: 'var(--r-sm)',
                        background: 'var(--paper)',
                      }}
                    />
                    {c.range && (
                      <p className="tiny muted num mt-2">
                        {c.range[0]}&ndash;{c.range[1]}
                      </p>
                    )}
                    {!c.range && <p className="tiny muted mt-2">no range</p>}
                  </td>
                  <td>
                    <SourceTag source={c.source} citation={c.citation} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5">
        <SourceKey />
      </div>

      <p className="tiny muted mt-4 prose">
        A parameter with no sampling range contributes nothing to the spread between worlds. Where
        you see &ldquo;no range&rdquo;, the three worlds are closer together than the evidence
        really justifies, and that is a limitation of the corpus rather than a sign of confidence.
      </p>
    </section>
  )
}

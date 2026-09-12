/**
 * Landing. Persuade mode.
 *
 * The first viewport is a thesis, not a header: the chart is live and doing the product's job
 * before a single claim is made about it. Everything below it exists to answer the two questions
 * a planner will actually have — what is this, and can I trust the numbers.
 *
 * The mode list is a registry, so adding Clinician mode later is a data change rather than a
 * redesign. The second card is visible and honest about not existing yet: a card that silently
 * goes nowhere reads as broken.
 */

import { Glyph } from '../components/Glyph'
import { Mascot, moodFromFindings } from '../components/Mascot'
import { WorldChart } from '../components/WorldChart'
import { Findings, WorldChip } from '../components/WorldPanel'
import { metrics, sweep, NOT_MODELLED, WORLD_ORDER, seriesFor, leverAt } from '../data'

interface Mode {
  id: string
  name: string
  who: string
  what: string
  status: 'live' | 'next'
  to?: string
}

const MODES: Mode[] = [
  {
    id: 'neighbourhood',
    name: 'Neighbourhood',
    who: 'Planner, PCN lead, ICB commissioner',
    what:
      'Drop in the policy document you already wrote. See how the neighbourhood responds across three worlds, where the conclusion breaks, and who wins and who loses.',
    status: 'live',
    to: '#/upload',
  },
  {
    id: 'clinician',
    name: 'Clinician',
    who: 'GP, care coordinator',
    what:
      'Take the recommended policy down to one named patient, rehearse three plans through the same engine, approve each action, then measure what actually happened against what was predicted.',
    status: 'next',
  },
]

export function Landing() {
  const complexSeries = seriesFor('complex')
  const headline = metrics.findings.find((f) => f.id === 'complex-tail-worsens') ?? metrics.findings[0]

  return (
    <>
      <section className="hero wrap wrap--wide">
        <div className="hero__grid">
          <div className="row between hero__top" style={{ alignItems: 'flex-start' }}>
            <div className="hero__claim">
              <h1 className="display">Every policy runs in three worlds.</h1>
              <p className="lead">
                Upload the document you already wrote. It becomes engine parameters, each one
                carrying where it came from, and runs forward a thousand times. You do not get a
                number. You get which of your conclusions survive all three worlds, and the
                condition each one holds under.
              </p>
              <div className="hero__actions">
                <a className="btn btn--primary btn--lg" href="#/upload">
                  Run a policy
                  <Glyph name="arrow" size={16} />
                </a>
                <a className="btn btn--ghost btn--lg" href="#/worlds">
                  See a worked example
                </a>
              </div>
            </div>
            <Mascot mood={moodFromFindings(metrics.findings)} size={104} />
          </div>

          <figure className="panel" style={{ margin: 0 }}>
            <figcaption className="panel__head">
              <div className="grow">
                <h2 className="h3">{complexSeries.label}</h2>
                <p className="tiny muted">
                  Against community capacity, which today is {sweep.lever.baseValue}{' '}
                  {sweep.lever.baseUnit}. Above the dashed line, the policy makes things worse.
                </p>
              </div>
              <div className="row gap-2">
                {WORLD_ORDER.map((w) => (
                  <WorldChip key={w} world={w} />
                ))}
              </div>
            </figcaption>
            <div className="panel__body">
              <WorldChart
                series={complexSeries}
                value={leverAt(sweep.policyIndex)}
                policyValue={leverAt(sweep.policyIndex)}
                breakpoint={sweep.breakpointByWorld.realistic}
              />
            </div>
          </figure>

          {headline && (
            <p className="h3" style={{ maxWidth: '54rem', fontWeight: 500 }}>
              {headline.statement}
            </p>
          )}
        </div>
      </section>

      <section className="section wrap wrap--wide">
        <div className="section__head">
          <h2 className="h2">Two altitudes, one engine</h2>
          <p className="lead prose">
            The neighbourhood view is the argument. The clinician view is the product. Both run the
            same deterministic engine over the same snapshot, so a recommendation and the patient it
            lands on can never disagree.
          </p>
        </div>

        <div className="modes">
          {MODES.map((m) =>
            m.status === 'live' ? (
              <a key={m.id} className="mode mode--live" href={m.to}>
                <div className="mode__top">
                  <h3 className="h3">{m.name}</h3>
                  <span className="mode__status">Live</span>
                </div>
                <p className="label">{m.who}</p>
                <p className="small">{m.what}</p>
                <span className="row gap-2 small" style={{ color: 'var(--blue)', fontWeight: 600 }}>
                  Open <Glyph name="arrow" size={14} />
                </span>
              </a>
            ) : (
              <div key={m.id} className="mode mode--next">
                <div className="mode__top">
                  <h3 className="h3 muted">{m.name}</h3>
                  <span className="mode__status">Next</span>
                </div>
                <p className="label">{m.who}</p>
                <p className="small muted">{m.what}</p>
                <span className="tiny muted">
                  The apply-and-verify loop behind it already works against the live world. The
                  interface for it is not built yet.
                </span>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="section wrap wrap--wide">
        <div className="split">
          <div>
            <div className="section__head">
              <h2 className="h2">What survived, and what did not</h2>
              <p className="lead prose">
                A conclusion that only shows up in the optimistic world is labelled as such and
                never presented as a result. Everything here is a claim about direction, shape or
                threshold, because a point estimate would be the more comfortable answer and the
                less true one.
              </p>
            </div>
            <Findings findings={metrics.findings} />
          </div>

          <aside className="panel panel--sunk">
            <div className="panel__head">
              <h3 className="h3">Why three worlds</h3>
            </div>
            <div className="panel__body stack gap-3">
              <p className="small">
                Each parameter is sampled from its published range and the engine runs{' '}
                <span className="num">{metrics.run.samples.toLocaleString('en-GB')}</span> times.
                The three worlds are percentiles of the <em>result</em>.
              </p>
              <p className="small">
                They are not the worst case of every input at once. Stacking twelve worst values
                produces a corner of parameter space with a vanishing chance of occurring. That is
                not a pessimistic scenario, it is an impossible one, and a judge who models for a
                living will say so.
              </p>
              <p className="small muted">
                Winter pressure and staff shortage stay as separate toggles, so &ldquo;pessimistic&rdquo;
                never becomes an undifferentiated bag of everything bad.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <section className="section wrap wrap--wide">
        <div className="section__head">
          <h2 className="h2">What this does not model</h2>
          <p className="lead prose">
            Said here rather than in a footnote. These are the limits that would change the answer,
            and none of them are in the simulator we are modelling.
          </p>
        </div>
        <div className="boundaries">
          {NOT_MODELLED.map((b) => (
            <div className="boundary" key={b.term}>
              <span className="boundary__term">{b.term}</span>
              <span className="muted">{b.detail}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

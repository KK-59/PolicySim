/**
 * About. What this is, why it works the way it does, and what it refuses to claim.
 *
 * No findings and no tornado here. Those are run output and they live on /worlds; showing them
 * twice is what made the old Overview page pointless.
 */

import { NOT_MODELLED, metrics } from '../data'

/** The chapters of the 10-Year Health Plan this tool is actually built against. */
const CHAPTERS: { n: string; title: string; how: string }[] = [
  {
    n: '02',
    title: 'From hospital to community',
    how: 'The Neighbourhood Health Service is the thing being simulated: discharge, community capacity, and who the shift leaves behind.',
  },
  {
    n: '03',
    title: 'From analogue to digital',
    how: 'One view across GP, hospital, pharmacy and community, instead of chasing the same letter through five systems.',
  },
  {
    n: '06',
    title: 'A new transparency of quality',
    how: 'Uncertainty is shown rather than hidden. A result that only holds in one world is labelled, not rounded up.',
  },
  {
    n: '08',
    title: 'Powering transformation',
    how: 'Evidence before rollout. The point of the tool is to test a policy before anyone funds it.',
  },
]

export function About() {
  return (
    <section className="page page--reading">
      <h1 className="h1">What this is</h1>
      <p className="lead mt-4">
        NHS-SIM lets you watch one version of a neighbourhood. It cannot tell you what a different
        one would have done. That is the gap this fills.
      </p>
      <p className="mt-4">
        Upload the policy document you already wrote. It is turned into engine parameters, each one
        carrying where it came from, and run forward{' '}
        {metrics.run.samples.toLocaleString('en-GB')} times.
      </p>

      <h2 className="h2 mt-7">Why three worlds</h2>
      <p className="mt-4">
        Every parameter is sampled from its published range. The three worlds are percentiles of
        the <em>result</em>: optimistic is the 10th, realistic the 50th, pessimistic the 90th.
      </p>
      <p className="mt-3">
        They are not the worst case of every input at once. Setting twelve parameters to their
        worst value together describes a future with almost no chance of happening, which makes it
        useless to plan against.
      </p>
      <p className="mt-3 muted">
        Winter pressure and staff shortage are separate switches, so pessimistic never becomes a
        bag of everything bad at the same time.
      </p>

      <h2 className="h2 mt-7">What we claim</h2>
      <p className="mt-4">
        Never a single number. The output is a claim about direction, shape or threshold: better on
        average, worse for the complex tail, and only while community capacity holds.
      </p>
      <p className="mt-3">
        A conclusion that appears in only one world is labelled on screen and never presented as a
        result.
      </p>

      <h2 className="h2 mt-7">The 10-Year Health Plan</h2>
      <p className="mt-4 muted">
        Four chapters this is built against, and how each one shows up in the product.
      </p>
      <dl className="boundaries mt-4">
        {CHAPTERS.map((c) => (
          <div className="boundary" key={c.n}>
            <dt className="boundary__term">
              <span className="num muted">{c.n}</span> {c.title}
            </dt>
            <dd className="muted">{c.how}</dd>
          </div>
        ))}
      </dl>

      <h2 className="h2 mt-7">What this does not model</h2>
      <p className="mt-4 muted">
        Stated here rather than buried. None of these exist in the simulator we are modelling.
      </p>
      <dl className="boundaries mt-4">
        {NOT_MODELLED.map((b) => (
          <div className="boundary" key={b.term}>
            <dt className="boundary__term">{b.term}</dt>
            <dd className="muted">{b.detail}</dd>
          </div>
        ))}
      </dl>

      <h2 className="h2 mt-7">Clinician mode</h2>
      <p className="mt-4 muted">
        Take the recommended policy down to one named patient, rehearse plans through the same
        engine, approve each action, then measure what happened against what was predicted. The
        apply and verify loop behind it already works against the live world. The interface for it
        is not built yet.
      </p>
    </section>
  )
}

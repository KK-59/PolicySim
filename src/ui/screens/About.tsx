/**
 * About. Everything that explains the product, kept off the landing page.
 */

import { Findings } from '../components/WorldPanel'
import { Tornado } from '../components/Tornado'
import { metrics, NOT_MODELLED } from '../data'

export function About() {
  return (
    <section className="page">
      <h1 className="h1">What this is</h1>

      <div className="prose stack gap-4 mt-5">
        <p className="lead">
          NHS-SIM lets you observe one world and follow a patient through it. It cannot compare two
          ways of running a neighbourhood: a world is 50,000 patients, reads take ninety seconds,
          and its clock moves in minutes while the question spans years.
        </p>
        <p>
          PolicySim is the missing counterfactual layer. Upload the document you already
          wrote. It becomes engine parameters, each one carrying where it came from, and runs
          forward {metrics.run.samples.toLocaleString('en-GB')} times.
        </p>
      </div>

      <h2 className="h2 mt-7">Why three worlds</h2>
      <div className="prose stack gap-4 mt-4">
        <p>
          Each parameter is sampled from its published range and the engine runs many times over.
          The three worlds are percentiles of the <em>result</em>: optimistic is P10, realistic
          P50, pessimistic P90.
        </p>
        <p>
          They are not the worst case of every input at once. Stacking twelve worst values produces
          a corner of parameter space with a vanishing chance of occurring. That is not a
          pessimistic scenario, it is an impossible one.
        </p>
        <p className="muted">
          Winter pressure and staff shortage stay as separate toggles, so &ldquo;pessimistic&rdquo;
          never becomes an undifferentiated bag of everything bad.
        </p>
      </div>

      <h2 className="h2 mt-7">What we claim</h2>
      <p className="prose mt-4">
        Not &ldquo;waits fall to 9.4 days&rdquo;. A conclusion that only shows up in the optimistic
        world is labelled as such and never presented as a result. From the worked example:
      </p>
      <div className="mt-4">
        <Findings findings={metrics.findings} />
      </div>

      <h2 className="h2 mt-7">What moves the answer</h2>
      <p className="prose mt-4 muted">
        Swing in days across each parameter&rsquo;s range. Amber marks a parameter that dominates
        the result and has no sourced range, which is the case that quietly collapses the three
        worlds toward each other.
      </p>
      <div className="mt-4">
        <Tornado rows={metrics.tornado} />
      </div>

      <h2 className="h2 mt-7">What this does not model</h2>
      <p className="prose mt-4 muted">
        Said here rather than in a footnote. None of these are in the simulator we are modelling.
      </p>
      <div className="boundaries mt-4">
        {NOT_MODELLED.map((b) => (
          <div className="boundary" key={b.term}>
            <span className="boundary__term">{b.term}</span>
            <span className="muted">{b.detail}</span>
          </div>
        ))}
      </div>

      <h2 className="h2 mt-7">Clinician mode</h2>
      <p className="prose mt-4 muted">
        Take the recommended policy down to one named patient, rehearse plans through the same
        engine, approve each action, then measure what happened against what was predicted. The
        apply-and-verify loop behind it already works against the live world. The interface is not
        built yet.
      </p>
    </section>
  )
}

/**
 * Landing. One screen, no scroll, two buttons.
 *
 * Everything that explains the product lives on /about. A planner arriving here either wants to
 * run their document or wants to know what this is, and those are the only two things offered.
 */

import { Glyph } from '../components/Glyph'
import { Mascot, moodFromFindings } from '../components/Mascot'
import { metrics } from '../data'
import { href } from '../lib/router'

export function Landing() {
  return (
    <section className="landing">
      <div className="landing__ground" aria-hidden="true" />
      <div className="landing__tint" aria-hidden="true" />
      <div className="landing__veil" aria-hidden="true" />
      <Mascot mood={moodFromFindings(metrics.findings)} size={128} />
      <h1 className="landing__name">PolicySim</h1>
      <p className="landing__line">Every policy runs in three worlds.</p>
      <div className="landing__actions">
        <a className="btn btn--primary btn--lg" href={href('/upload')}>
          Run a policy
          <Glyph name="arrow" size={16} />
        </a>
        <a className="btn btn--secondary btn--lg" href={href('/about')}>
          About
        </a>
      </div>
    </section>
  )
}

/**
 * Landing. One screen, no scroll, two buttons.
 *
 * Everything that explains the product lives on /about. A planner arriving here either wants to
 * run their document or wants to know what this is, and those are the only two things offered.
 *
 * Atlas carries the neighbourhood, which is the product's argument in one object: someone is
 * already bearing the weight of this place, and the question is whether the thing they are about
 * to commit to makes it heavier. The globe is carved with a town, not with the classical bull and
 * ship.
 */

import { Glyph } from '../components/Glyph'
import { href } from '../lib/router'

export function Landing() {
  return (
    <section className="landing">
      <div className="landing__ground" aria-hidden="true" />
      <div className="landing__tint" aria-hidden="true" />
      <div className="landing__veil" aria-hidden="true" />

      {/*
        The paper is cut out in the asset itself, not blended away at render time: the engraving's
        own brightness is its alpha channel, so the linework sits on the neighbourhood with nothing
        behind it. A multiply blend still paints the paper, which showed as a tinted rectangle.
      */}
      <img className="atlas" src="/atlas.webp" alt="" width={827} height={1100} />

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

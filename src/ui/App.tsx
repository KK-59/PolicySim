/**
 * Root. Landing -> upload -> parameters -> worlds, with Mode B reachable from a patient once it
 * exists. The mode list on the landing page is a registry for exactly that reason.
 *
 * The synthetic banner is not a debug affordance. Until the engine lands, everything on screen is
 * a fixture, and a tool whose entire argument is "every number carries its provenance" cannot
 * quietly present fabricated numbers as measured ones.
 */

import { Glyph } from './components/Glyph'
import { Landing } from './screens/Landing'
import { Upload } from './screens/Upload'
import { ExtractedParams } from './screens/ExtractedParams'
import { ThreeWorlds } from './screens/ThreeWorlds'
import { href, useRoute, type Route } from './lib/router'
import { useRun } from './lib/store'
import { IS_SYNTHETIC } from './data'
import './styles/app.css'

const STEPS: { to: Route; label: string }[] = [
  { to: '/upload', label: 'Policy' },
  { to: '/parameters', label: 'Parameters' },
  { to: '/worlds', label: 'Three worlds' },
]

function Steps({ route }: { route: Route }) {
  const current = STEPS.findIndex((s) => s.to === route)
  if (current === -1) return null

  return (
    <nav className="steps" aria-label="Progress">
      {STEPS.map((s, i) => (
        <span key={s.to} className="steps__item" data-state={i === current ? 'current' : i < current ? 'done' : 'todo'}>
          {i > 0 && <span className="steps__sep" aria-hidden="true" />}
          {i < current ? (
            <a className="navlink" href={href(s.to)} style={{ padding: 0 }}>
              {s.label}
            </a>
          ) : (
            <span aria-current={i === current ? 'step' : undefined}>{s.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

function Masthead({ route }: { route: Route }) {
  return (
    <header className="masthead">
      <div className="wrap wrap--wide masthead__inner">
        <a className="wordmark" href={href('/')}>
          <span className="wordmark__rule" aria-hidden="true" />
          Policy Sandbox
        </a>
        <Steps route={route} />
        <nav>
          <a className="navlink" href={href('/')} aria-current={route === '/' ? 'page' : undefined}>
            Overview
          </a>
          <a
            className="navlink"
            href={href('/worlds')}
            aria-current={route === '/worlds' ? 'page' : undefined}
          >
            Neighbourhood
          </a>
          <span className="navlink navlink--muted" title="Not built yet">
            Clinician
          </span>
          <a className="btn btn--primary" href={href('/upload')} style={{ marginLeft: 'var(--s-2)' }}>
            Run a policy
          </a>
        </nav>
      </div>
    </header>
  )
}

function SyntheticBanner() {
  if (!IS_SYNTHETIC) return null
  return (
    <div
      className="wrap wrap--wide"
      style={{
        display: 'flex',
        gap: 'var(--s-2)',
        alignItems: 'center',
        padding: 'var(--s-2) var(--s-5)',
        color: 'var(--amber)',
        fontSize: 'var(--t-tiny)',
        borderBottom: '1px solid var(--rule)',
        background: 'var(--amber-wash)',
        maxWidth: 'none',
      }}
    >
      <Glyph name="warning" size={14} />
      <span>
        Outcomes on this build come from a fixture, not from the engine. The baseline they move
        against is measured; the response curves are not. Nothing here is a measurement.
      </span>
    </div>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap wrap--wide footer__inner">
        <span>
          Policy Sandbox &middot; operational outcomes only, synthetic patients, a human approves
          every write.
        </span>
        <span>
          The simulator is ground truth. This is a fast, inspectable model of its rules, checked
          against it.
        </span>
      </div>
    </footer>
  )
}

/** Routes that need a document. Deep-linking past the upload lands on the upload. */
const GUARDED: Route[] = ['/parameters']

export function App() {
  const route = useRoute()
  const run = useRun()
  const blocked = GUARDED.includes(route) && !run.document

  return (
    <div className="shell">
      <SyntheticBanner />
      <Masthead route={blocked ? '/upload' : route} />
      <main>
        {blocked || route === '/upload' ? (
          <Upload />
        ) : route === '/parameters' ? (
          <ExtractedParams />
        ) : route === '/worlds' ? (
          <ThreeWorlds />
        ) : (
          <Landing />
        )}
      </main>
      <Footer />
    </div>
  )
}

/**
 * Root.
 *
 * The landing page is the whole screen with no chrome: it is a name and two buttons, so a
 * masthead repeating those buttons would be the duplication that made the old Overview link
 * meaningless. Every other route gets the bar.
 */

import { useState } from 'react'
import { Glyph } from './components/Glyph'
import { DocumentDrawer } from './components/DocumentDrawer'
import { Landing } from './screens/Landing'
import { About } from './screens/About'
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

function Bar({ route }: { route: Route }) {
  const step = STEPS.findIndex((s) => s.to === route)

  return (
    <header className="bar">
      <div className="page bar__inner">
        <a className="wordmark" href={href('/')}>
          <span className="wordmark__rule" aria-hidden="true" />
          PolicySim
        </a>

        {step !== -1 && (
          <nav className="steps" aria-label="Progress">
            {STEPS.map((s, i) => (
              <span key={s.to} className="steps__item" data-state={i === step ? 'current' : i < step ? 'done' : 'todo'}>
                {i > 0 && <span className="steps__sep" aria-hidden="true" />}
                {i < step ? <a href={href(s.to)}>{s.label}</a> : <span>{s.label}</span>}
              </span>
            ))}
          </nav>
        )}

        <a className="navlink" href={href('/about')} aria-current={route === '/about' ? 'page' : undefined}>
          About
        </a>
      </div>
    </header>
  )
}

/** Routes that need a document. Deep-linking past the upload lands on the upload. */
const GUARDED: Route[] = ['/parameters']

/**
 * The shelf trigger. A corner button rather than a place in the nav: the documents are how you
 * try the thing, not a step in it, and the flow already has three steps that mean something.
 */
function DocumentsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="docs-trigger" onClick={onClick}>
      <Glyph name="document" size={14} />
      Documents
    </button>
  )
}

export function App() {
  const route = useRoute()
  const run = useRun()
  const [drawer, setDrawer] = useState(false)
  const blocked = GUARDED.includes(route) && !run.document
  const effective: Route = blocked ? '/upload' : route

  if (effective === '/') return <Landing />

  return (
    <div className="shell">
      <Bar route={effective} />
      <main>
        {effective === '/about' ? (
          <About />
        ) : effective === '/upload' ? (
          <Upload />
        ) : effective === '/parameters' ? (
          <ExtractedParams />
        ) : (
          <ThreeWorlds />
        )}
      </main>
      {IS_SYNTHETIC && (
        <footer className="synthetic">
          <div className="page row gap-2">
            <Glyph name="warning" size={13} />
            <span>Outcomes come from a fixture, not the engine. Nothing here is a measurement.</span>
          </div>
        </footer>
      )}
      {/* Only on the upload screen: the shelf exists to be dragged onto the drop zone, so it is
          noise anywhere there is nothing to drop onto. */}
      {effective === '/upload' && (
        <>
          <DocumentsButton onClick={() => setDrawer(true)} />
          <DocumentDrawer open={drawer} onClose={() => setDrawer(false)} />
        </>
      )}
    </div>
  )
}

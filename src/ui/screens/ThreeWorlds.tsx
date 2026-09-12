/**
 * Three worlds. The result, and nothing else.
 *
 * Chart, the lever that drives it, and the findings. Sensitivity and flags sit behind a disclosure
 * because they matter for trusting the answer but not for reading it. Everything is delta against
 * the locked baseline, never an absolute.
 */

import { useState } from 'react'
import { Glyph } from '../components/Glyph'
import { Tornado } from '../components/Tornado'
import { WorldChart } from '../components/WorldChart'
import { Findings } from '../components/WorldPanel'
import { metrics as baselineMetrics, sweep, seriesFor, leverAt } from '../data'
import { useRun } from '../lib/store'

export function ThreeWorlds() {
  const run = useRun()
  // Outcomes for the document the user actually ran, when there are any. Otherwise the calibrated
  // baseline. The screen must say which, because showing a precomputed figure while the user
  // believes they are looking at their own policy is the one failure this project cannot have.
  const metrics = run.liveMetrics ?? baselineMetrics
  const isLive = run.liveMetrics !== null

  const positions = sweep.lever.positions
  const [idx, setIdx] = useState(sweep.policyIndex)
  const [seriesId, setSeriesId] = useState<'complex' | 'routine'>('complex')

  const series = seriesFor(seriesId)
  const value = leverAt(idx)

  return (
    <section className="page">
      <div className="row between">
        <h1 className="h1">{series.label}</h1>
        <div className="row gap-2" role="group" aria-label="Which outcome to chart">
          <button
            type="button"
            className={`btn ${seriesId === 'complex' ? 'btn--secondary' : 'btn--ghost'}`}
            aria-pressed={seriesId === 'complex'}
            onClick={() => setSeriesId('complex')}
          >
            Complex tail
          </button>
          <button
            type="button"
            className={`btn ${seriesId === 'routine' ? 'btn--secondary' : 'btn--ghost'}`}
            aria-pressed={seriesId === 'routine'}
            onClick={() => setSeriesId('routine')}
          >
            Routine median
          </button>
        </div>
      </div>

      <p className="small muted mt-3">
        {isLive ? (
          <>
            <Glyph name="check" size={13} /> Findings below are the engine&rsquo;s output for{' '}
            <strong>{run.document?.filename ?? 'your document'}</strong>. The curve is the
            calibrated baseline sweep, which does not depend on the document.
          </>
        ) : (
          <>
            <Glyph name="warning" size={13} /> Showing the calibrated baseline. Run a document to
            see what it changes.
          </>
        )}
      </p>

      <div className="mt-5">
        <WorldChart
          series={series}
          value={value}
          policyValue={leverAt(sweep.policyIndex)}
          breakpoint={sweep.breakpointByWorld.realistic}
          animate={false}
        />
      </div>

      <div className="lever mt-5">
        <div className="lever__head">
          <label className="small" htmlFor="lever-community">
            Community capacity
          </label>
          <span className="lever__value">
            {value}&#215; &middot; {(value * sweep.lever.baseValue).toFixed(1)} visits/day
          </span>
        </div>
        <input
          id="lever-community"
          type="range"
          min={0}
          max={positions.length - 1}
          step={1}
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
        />
      </div>

      <h2 className="h2 mt-7">Findings</h2>
      <div className="mt-4">
        <Findings findings={metrics.findings} />
      </div>

      <details className="disclosure mt-7">
        <summary>
          <Glyph name="flag" size={14} />
          Sensitivity and flagged parameters
        </summary>
        <div className="disclosure__body">
          <Tornado rows={metrics.tornado} />
          <div className="mt-5">
            {metrics.flags.map((f) => (
              <div className="flag" key={`${f.path}-${f.reason}`}>
                <span style={{ color: 'var(--amber)' }}>
                  <Glyph name="warning" size={15} />
                </span>
                <div>
                  <p className="flag__path">{f.path}</p>
                  <p className="small mt-2">{f.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>
    </section>
  )
}

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
import { metrics as baselineMetrics, sweep as baselineSweep } from '../data'
import { useRun } from '../lib/store'
import type { Metrics } from '@/contracts/metrics'
import type { Sweep, SweepSeries } from '../data'

export function ThreeWorlds() {
  const run = useRun()

  /**
   * This policy's own run, if it has one; the precomputed baseline otherwise.
   *
   * The fallback is not only for the first visit. It is the offline path: the grid is committed,
   * so the worlds screen renders with no API, no key and no network — which is the state the
   * demo has to survive if the server goes down again.
   */
  const metrics = (run.result?.metrics as Metrics | undefined) ?? baselineMetrics
  const sweep = (run.result?.sweep as Sweep | undefined) ?? baselineSweep
  const isLive = Boolean(run.result)

  const positions = sweep.lever.positions
  const [idx, setIdx] = useState(sweep.policyIndex)
  const [seriesId, setSeriesId] = useState<'complex' | 'routine'>('complex')

  const series: SweepSeries =
    sweep.series.find((x) => x.patientClass === seriesId) ?? (sweep.series[0] as SweepSeries)
  const value = positions[Math.min(idx, positions.length - 1)] ?? positions[0] ?? 1

  return (
    <section className="page">
      {/* Which numbers these are. A reader must never have to guess whether the chart is their
          policy or the shipped baseline. */}
      {!isLive && (
        <p className="note" role="note">
          <Glyph name="warning" size={13} />
          <span>
            Showing the precomputed baseline sweep. Run a policy from the parameters screen to
            simulate it.
          </span>
        </p>
      )}

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

      <div className="mt-5">
        <WorldChart
          series={series}
          value={value}
          policyValue={positions[sweep.policyIndex] ?? value}
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

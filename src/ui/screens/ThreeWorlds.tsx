/**
 * Three worlds. The result.
 *
 * Everything is delta against the locked baseline, and median and 90th percentile are always
 * shown together — because this policy's whole story is that those two move in opposite
 * directions, and a view that showed only the median would be a lie of omission.
 *
 * One lever is live. The precomputed sweep covers community capacity and nothing else, so the
 * other extracted levers are shown read-only with the reason stated. A slider that moves without
 * changing the answer would be worse than no slider.
 */

import { useMemo, useState } from 'react'
import { Glyph } from '../components/Glyph'
import { Mascot, moodFromFindings } from '../components/Mascot'
import { SourceTag } from '../components/SourceTag'
import { Tornado } from '../components/Tornado'
import { WorldChart } from '../components/WorldChart'
import { DeltaStat } from '../components/DeltaStat'
import { Findings, WorldChip } from '../components/WorldPanel'
import { useRun } from '../lib/store'
import {
  metrics,
  sweep,
  toDays,
  WORLD_ORDER,
  WORLD_PERCENTILE,
  signed,
  seriesFor,
  leverAt,
  worldPoints,
  type WorldName,
} from '../data'

const LIVE_LEVER = 'levers.communityCapacityMultiplier'

export function ThreeWorlds() {
  const run = useRun()
  const positions = sweep.lever.positions
  const [idx, setIdx] = useState(sweep.policyIndex)
  const [seriesId, setSeriesId] = useState<'complex' | 'routine'>('complex')

  const series = seriesFor(seriesId)
  const value = leverAt(idx)
  const atPolicy = idx === sweep.policyIndex

  /** Delta in days at the current lever position, per world, read off the sweep. */
  const readout = useMemo(
    () =>
      WORLD_ORDER.map((w) => {
        const pts = worldPoints(series, w)
        return { world: w, value: pts[idx]?.y ?? 0 }
      }),
    [series, idx],
  )

  const otherLevers = run.commitments.filter((c) => c.paramPath !== LIVE_LEVER)

  return (
    <section className="section wrap wrap--wide" style={{ borderTop: 0 }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="prose stack gap-3">
          <h1 className="h1">What survives all three.</h1>
          <p className="lead">
            {metrics.run.samples.toLocaleString('en-GB')} runs, parameters sampled from their
            ranges, reported as percentiles of the result. Every number below is a change from the
            locked baseline.
          </p>
        </div>
        <Mascot mood={moodFromFindings(metrics.findings)} size={92} />
      </div>

      <div className="split mt-6">
        <div className="stack gap-5">
          <figure className="panel" style={{ margin: 0 }}>
            <figcaption className="panel__head">
              <div className="grow">
                <h2 className="h3">{series.label}</h2>
                <p className="tiny muted">
                  Against community capacity. Today it is {sweep.lever.baseValue}{' '}
                  {sweep.lever.baseUnit}, the binding constraint in this world.
                </p>
              </div>
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
            </figcaption>
            <div className="panel__body">
              <WorldChart
                series={series}
                value={value}
                policyValue={leverAt(sweep.policyIndex)}
                breakpoint={sweep.breakpointByWorld.realistic}
                animate={false}
              />
            </div>
          </figure>

          <div className="panel">
            <div className="panel__head">
              <h2 className="h3 grow">
                {series.label} at {value}&#215;
              </h2>
              {!atPolicy && (
                <span className="tiny muted">
                  Your policy sits at {leverAt(sweep.policyIndex)}&#215;
                </span>
              )}
            </div>
            <div className="panel__body">
              <div className="modes" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {WORLD_ORDER.map((w) => {
                  const r = readout.find((x) => x.world === w)!
                  const bp = sweep.breakpointByWorld[w as WorldName]
                  return (
                    <div key={w} className={`world world--${w} stack gap-3`}>
                      <WorldChip world={w} />
                      <DeltaStat
                        label="change vs baseline"
                        delta={r.value}
                        direction="lower-is-better"
                        unit="d"
                      />
                      <p className="tiny muted">
                        {bp == null
                          ? 'No capacity in this sweep clears the harm in this world.'
                          : `Clears at ${bp}×.`}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2 className="h3 grow">Findings</h2>
              <span className="tiny muted">
                {metrics.findings.filter((f) => f.survivesAllThree).length} of{' '}
                {metrics.findings.length} survive all three
              </span>
            </div>
            <div className="panel__body">
              <Findings findings={metrics.findings} />
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2 className="h3 grow">What moves the answer</h2>
              <span className="tiny muted">Swing in days across each parameter&rsquo;s range</span>
            </div>
            <div className="panel__body">
              <Tornado rows={metrics.tornado} />
            </div>
          </div>
        </div>

        <aside className="stack gap-5">
          <div className="panel">
            <div className="panel__head">
              <h2 className="h3">Adjust</h2>
            </div>
            <div className="panel__body">
              <div className="lever">
                <div className="lever__head">
                  <label className="small" htmlFor="lever-community">
                    Community capacity
                  </label>
                  <span className="lever__value">
                    {value}&#215; &middot; {(value * sweep.lever.baseValue).toFixed(1)} /day
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
                <p className="tiny muted mt-2">
                  The best lever available, because the base is only {sweep.lever.baseValue} visits
                  a day and it binds everything downstream.
                </p>
              </div>

              {!atPolicy && (
                <button
                  type="button"
                  className="btn btn--ghost mt-3"
                  onClick={() => setIdx(sweep.policyIndex)}
                >
                  Back to your policy
                </button>
              )}
            </div>
          </div>

          <div className="panel panel--sunk">
            <div className="panel__head">
              <h2 className="h3">Also extracted</h2>
            </div>
            <div className="panel__body stack gap-3">
              {otherLevers.map((c) => (
                <div key={c.id} className="row between" style={{ gap: 'var(--s-2)' }}>
                  <span className="small">{c.label}</span>
                  <span className="row gap-2">
                    <span className="num small">{c.value}</span>
                    <SourceTag source={c.source} citation={c.citation} />
                  </span>
                </div>
              ))}
              <p className="tiny muted">
                Read-only in this build. The precomputed grid sweeps community capacity only, so
                moving these needs the engine rather than a lookup. They are shown because they are
                part of your policy, not because they are adjustable here.
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h2 className="h3 grow">Flagged</h2>
              <span style={{ color: 'var(--amber)' }}>
                <Glyph name="flag" size={16} />
              </span>
            </div>
            <div className="panel__body">
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

          <div className="panel panel--sunk">
            <div className="panel__head">
              <h2 className="h3">This run</h2>
            </div>
            <div className="panel__body stack gap-2">
              {[
                ['Samples', metrics.run.samples.toLocaleString('en-GB')],
                ['Horizon', `${(metrics.run.horizonDays / 365).toFixed(0)} years`],
                ['Elapsed', `${metrics.run.elapsedMs} ms`],
                ['Seed', String(metrics.run.seed)],
              ].map(([k, v]) => (
                <div className="row between" key={k}>
                  <span className="tiny muted">{k}</span>
                  <span className="num tiny">{v}</span>
                </div>
              ))}
              <div className="row between mt-2">
                <span className="tiny muted">Assertions</span>
                <span
                  className="row tiny"
                  style={{
                    gap: '0.25rem',
                    color: metrics.run.anyVerificationFailed ? 'var(--fuchsia)' : 'var(--blue)',
                  }}
                >
                  <Glyph name={metrics.run.anyVerificationFailed ? 'cross' : 'check'} size={13} />
                  {metrics.run.anyVerificationFailed ? 'failed' : 'passed'}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-6 row gap-4">
        {WORLD_ORDER.map((w) => (
          <span key={w} className="tiny muted">
            <strong>{w}</strong> = {WORLD_PERCENTILE[w]} of the outcome distribution
          </span>
        ))}
        <span className="tiny muted">
          Zero is the locked baseline, not a target.
        </span>
      </div>
    </section>
  )
}

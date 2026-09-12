/**
 * The three worlds as three worlds.
 *
 * The chart shows how an outcome MOVES across a lever. This shows what each world actually is:
 * what a patient waits in it, whether the practice holds together in it, what it costs. A reader
 * should be able to answer "what happens if the pessimistic world is the real one" without
 * reading a line chart.
 *
 * Absolutes and deltas together. The house rule is that a delta is what you argue from — it is
 * the only honest comparison — but a planner also has to know whether a wait is eight hours or
 * eight days before they can care about the change.
 */

import type { Metrics } from '@/contracts/metrics'
import { WORLD_ORDER, WORLD_PERCENTILE, type WorldName } from '../data'
import { Glyph } from './Glyph'

const MIN_PER_DAY = 1440

/** Hours below a day, days above it. A wait of 62 hours means nothing to anyone. */
function duration(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—'
  const days = minutes / MIN_PER_DAY
  return days < 1 ? `${(minutes / 60).toFixed(1)}h` : `${days.toFixed(1)}d`
}

function delta(minutes: number): { text: string; better: boolean } {
  if (!Number.isFinite(minutes)) return { text: '—', better: false }
  const days = minutes / MIN_PER_DAY
  const magnitude = Math.abs(days) < 1
    ? `${Math.abs(minutes / 60).toFixed(1)}h`
    : `${Math.abs(days).toFixed(1)}d`
  const sign = minutes > 0 ? '+' : minutes < 0 ? '−' : ''
  // Every outcome here is a wait, so lower is better. Never inferred from the sign alone.
  return { text: `${sign}${magnitude}`, better: minutes < 0 }
}

function percentage(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(0)}%`
}

function count(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-GB')
}

export function WorldOutcomes({ metrics }: { metrics: Metrics }) {
  return (
    <div className="worlds">
      {WORLD_ORDER.map((world: WorldName) => {
        const gp = metrics.worlds.perNode['gp-clinic']?.[world]
        const community = metrics.worlds.perNode['community-visit']?.[world]
        const stable = gp?.stable ?? true

        const rows = [
          {
            label: 'Routine, median',
            absolute: metrics.worlds.waits.routine[world].p50,
            change: metrics.delta.waits.routine[world].p50,
          },
          {
            label: 'Routine, 90th',
            absolute: metrics.worlds.waits.routine[world].p90,
            change: metrics.delta.waits.routine[world].p90,
          },
          {
            label: 'Complex, 90th',
            absolute: metrics.worlds.waits.complex[world].p90,
            change: metrics.delta.waits.complex[world].p90,
          },
          {
            label: 'Urgent, median',
            absolute: metrics.worlds.waits.urgent[world].p50,
            change: metrics.delta.waits.urgent[world].p50,
          },
        ]

        return (
          <article key={world} className={`worldcard world--${world}`} data-stable={stable}>
            <header className="worldcard__head">
              <span className="worldcard__name">
                <Glyph name={world} size={14} />
                {world}
              </span>
              <span className="worldcard__pct">{WORLD_PERCENTILE[world]}</span>
            </header>

            {stable ? (
              <dl className="worldcard__rows">
                {rows.map((r) => {
                  const d = delta(r.change)
                  return (
                    <div className="worldcard__row" key={r.label}>
                      <dt>{r.label}</dt>
                      <dd>
                        <span className="worldcard__abs">{duration(r.absolute)}</span>
                        <span className={`worldcard__delta ${d.better ? 'is-better' : 'is-worse'}`}>
                          {d.text}
                        </span>
                      </dd>
                    </div>
                  )
                })}
              </dl>
            ) : (
              /*
               * A wait from a queue that never settles is a statement about how long the
               * simulation ran, not about the neighbourhood. Printing a number here would be
               * false precision about the most important thing on the page.
               */
              <p className="worldcard__broken">
                <Glyph name="warning" size={13} />
                <strong>No stable operating point.</strong> The queue grows for as long as the
                model runs, so there is no wait to report. This policy does not work in this
                world.
              </p>
            )}

            <footer className="worldcard__foot">
              <span>
                GP {percentage(gp?.utilisation)} · community {percentage(community?.utilisation)}
              </span>
              <span>{count(metrics.worlds.rejections[world])} referrals refused</span>
            </footer>
          </article>
        )
      })}
    </div>
  )
}

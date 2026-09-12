/**
 * World vocabulary: the chip, and the findings list.
 *
 * P10 / P50 / P90 sit under the friendly names so the method is visible without anyone having to
 * explain it. A finding that appears only in the optimistic world is rendered as a warning and
 * never as a result — the UI gates on `survivesAllThree` so that call is never left to the reader.
 */

import type { Finding } from '@/contracts/metrics'
import { WORLD_ORDER, WORLD_PERCENTILE, type WorldName } from '../data'
import { Glyph } from './Glyph'

export function WorldChip({ world, showPercentile = true }: { world: WorldName; showPercentile?: boolean }) {
  return (
    <span className={`worldchip world world--${world}`}>
      <Glyph name={world} size={13} />
      {world}
      {showPercentile && <span className="worldchip__pct">{WORLD_PERCENTILE[world]}</span>}
    </span>
  )
}

function findingGlyph(f: Finding) {
  if (f.optimisticOnly) return 'warning' as const
  return f.survivesAllThree ? ('robust' as const) : ('partial' as const)
}

function findingNote(f: Finding) {
  if (f.optimisticOnly) return 'Only appears in the optimistic world. Not a finding.'
  if (f.survivesAllThree) return 'Survives all three worlds.'
  return `Holds in ${f.holdsIn.length} of three.`
}

export function Findings({ findings }: { findings: readonly Finding[] }) {
  if (findings.length === 0) {
    return (
      <p className="small muted">
        No conclusion held firmly enough to state. That is a result, not an error: with this
        parameter set the worlds disagree about everything that matters.
      </p>
    )
  }

  return (
    <ul className="findings">
      {findings.map((f) => (
        <li key={f.id} className={`finding${f.optimisticOnly ? ' finding--warning' : ''}`}>
          <span
            className="finding__glyph"
            style={{ color: f.optimisticOnly ? 'var(--amber)' : f.survivesAllThree ? 'var(--ink)' : 'var(--ink-3)' }}
          >
            <Glyph name={findingGlyph(f)} size={18} />
          </span>
          <div>
            <p className="finding__statement">{f.statement}</p>
            <div className="finding__meta">
              <span className="label">{f.kind}</span>
              <span className="tiny muted">{findingNote(f)}</span>
            </div>
          </div>
          <div className="finding__worlds">
            {WORLD_ORDER.map((w) => (
              <span
                key={w}
                className={`world world--${w}`}
                title={`${f.holdsIn.includes(w) ? 'Holds' : 'Does not hold'} in the ${w} world`}
                style={{ color: f.holdsIn.includes(w) ? 'var(--world-c)' : 'var(--rule-2)' }}
              >
                <Glyph name={w} size={15} />
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  )
}

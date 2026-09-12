/**
 * Which parameters actually move the answer.
 *
 * The row that matters most is the flagged one: a parameter that dominates the outcome AND has
 * no sourced range. That is the case that quietly collapses the three worlds toward each other,
 * and it is drawn in amber so it cannot be scrolled past.
 */

import type { TornadoRow } from '@/contracts/metrics'
import { SourceTag } from './SourceTag'
import { Glyph } from './Glyph'

export function Tornado({ rows }: { rows: readonly TornadoRow[] }) {
  const finiteSwings = rows
    .map((row) => row.swing)
    .filter((swing) => swing != null && Number.isFinite(swing))
  const max = Math.max(...finiteSwings, 1)

  if (rows.length === 0) {
    return <p className="small muted">No sensitivity results were available for this run.</p>
  }

  return (
    <div className="tornado">
      {rows.map((r) => {
        const swing = r.swing != null && Number.isFinite(r.swing) ? r.swing : null
        return <div className="tornado__row" key={r.path}>
          <div className="tornado__label">
            {r.dominantButUnsourced && (
              <span style={{ color: 'var(--amber)' }} title="Dominant, and nothing sources its range">
                <Glyph name="warning" size={14} />
              </span>
            )}
            <span>{r.label}</span>
            <SourceTag source={r.rangeSource} />
          </div>
          <div className="tornado__bar">
            <div
              className={`tornado__fill${r.dominantButUnsourced ? ' tornado__fill--flagged' : ''}`}
              style={{ left: 0, width: `${swing == null ? 0 : (swing / max) * 100}%` }}
            />
          </div>
          <span className="tornado__swing">{swing == null ? '—' : `${swing.toFixed(1)}d`}</span>
        </div>
      })}
    </div>
  )
}

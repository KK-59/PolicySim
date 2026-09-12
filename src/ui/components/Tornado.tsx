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
  const max = Math.max(...rows.map((r) => r.swing), 1)

  return (
    <div className="tornado">
      {rows.map((r) => (
        <div className="tornado__row" key={r.path}>
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
              style={{ left: 0, width: `${(r.swing / max) * 100}%` }}
            />
          </div>
          <span className="tornado__swing">{r.swing.toFixed(1)}d</span>
        </div>
      ))}
    </div>
  )
}

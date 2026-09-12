/**
 * A single outcome, shown as a change from the locked baseline and never as an absolute.
 *
 * Whether a delta is an improvement depends on the metric's direction, not its sign: for a wait,
 * a negative number is good news. That decision lives in one place (`isBetter`) so the direction
 * trap documented in metrics.ts cannot resurface per component.
 */

import { isBetter, signed } from '../data'
import { Glyph } from './Glyph'

interface Props {
  label: string
  delta: number
  direction: 'lower-is-better' | 'higher-is-better'
  unit?: string
  dp?: number
  note?: string
}

export function DeltaStat({ label, delta, direction, unit = '', dp = 1, note }: Props) {
  const flat = Math.abs(delta) < 0.05
  const better = isBetter(delta, direction)

  return (
    <div className="stack" style={{ gap: '0.25rem' }}>
      <span className="label">{label}</span>
      <span
        className="row"
        style={{ gap: '0.375rem', color: flat ? 'var(--ink-3)' : better ? 'var(--blue)' : 'var(--fuchsia)' }}
      >
        {!flat && <Glyph name={better ? 'check' : 'warning'} size={14} />}
        <span className="num" style={{ fontSize: 'var(--t-h3)', letterSpacing: '-0.03em' }}>
          {signed(delta, dp, unit)}
        </span>
      </span>
      {note && <span className="tiny muted">{note}</span>}
    </div>
  )
}

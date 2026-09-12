/**
 * The money shot.
 *
 * One wide chart: every sampled run drawn as a ghost trace, the three worlds struck forward over
 * them, and a dashed line of no effect through zero. The y axis is DELTA against the locked
 * baseline, never an absolute — a house rule from src/ui/README.md and the reason the chart can
 * be read without knowing what a good absolute wait would be.
 *
 * The ghosts are real sampled runs, not a drawn band. Where the evidence has no published range
 * the cloud is genuinely narrow, and the chart shows that rather than inventing width. 18 of our
 * 28 parameters are in exactly that position, so this is not a hypothetical.
 */

import { useId, useMemo, useState } from 'react'
import type { SweepSeries, WorldName } from '../data'
import { WORLD_ORDER, WORLD_PERCENTILE, signed, worldPoints, metrics } from '../data'
import { Glyph } from './Glyph'

const SAMPLE_COUNT = metrics.run.samples

const W = 1000
const H = 380
const PAD = { top: 18, right: 20, bottom: 38, left: 58 }

interface Props {
  series: SweepSeries
  /** Current lever position, in the series' own x units. */
  value: number
  /** Marks where the uploaded document put the lever, so the policy is visible against the sweep. */
  policyValue?: number
  /** Where the harm clears, per world. Drawn only where one exists. */
  breakpoint?: number | null
  animate?: boolean
}

const pct = (arr: number[], p: number): number => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * s.length)))] ?? 0
}

export function WorldChart({ series, value, policyValue, breakpoint, animate = true }: Props) {
  const uid = useId().replace(/:/g, '')
  const [hoverX, setHoverX] = useState<number | null>(null)

  const { x, y, domain } = useMemo(() => {
    const xs = worldPoints(series, 'realistic').map((p) => p.x)
    const xMin = Math.min(...xs)
    const xMax = Math.max(...xs)

    const ghostY = series.ghosts.flatMap((g) => g.points.map((p) => p.y))
    const worldY = series.worlds.flatMap((w) => w.points.map((p) => p.y))
    // Trim the ghost cloud's extremes so two runaway runs cannot flatten everything else.
    const lo = Math.min(pct(ghostY, 0.02), ...worldY, 0)
    const hi = Math.max(pct(ghostY, 0.98), ...worldY, 0)
    const padY = (hi - lo) * 0.08 || 1

    const yMin = lo - padY
    const yMax = hi + padY

    return {
      domain: { xMin, xMax, yMin, yMax },
      x: (v: number) =>
        PAD.left + ((v - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right),
      y: (v: number) =>
        PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom),
    }
  }, [series])

  const line = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ')

  const xTicks = useMemo(() => {
    const out: number[] = []
    for (let v = Math.ceil(domain.xMin); v <= domain.xMax + 0.001; v += 1) out.push(v)
    return out
  }, [domain])

  const yTicks = useMemo(() => {
    const span = domain.yMax - domain.yMin
    const step = span > 40 ? 20 : span > 16 ? 8 : span > 6 ? 4 : span > 2 ? 1 : 0.5
    const out: number[] = []
    for (let v = Math.ceil(domain.yMin / step) * step; v <= domain.yMax; v += step) {
      out.push(Number(v.toFixed(2)))
    }
    return out
  }, [domain])

  /** Value at the cursor, per world, read off the nearest sampled position. */
  const readAt = (xv: number) =>
    WORLD_ORDER.map((w) => {
      const pts = worldPoints(series, w)
      const nearest = pts.reduce((best, p) =>
        Math.abs(p.x - xv) < Math.abs(best.x - xv) ? p : best,
      )
      return { world: w, value: nearest.y }
    })

  const cursor = hoverX ?? value
  const readout = readAt(cursor)

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const frac = (px - PAD.left) / (W - PAD.left - PAD.right)
    const v = domain.xMin + frac * (domain.xMax - domain.xMin)
    setHoverX(Math.max(domain.xMin, Math.min(domain.xMax, v)))
  }

  return (
    <div className="chart-frame">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${series.label}, change against the locked baseline, across the three worlds.`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverX(null)}
      >
        <defs>
          <clipPath id={`${uid}-plot`}>
            <rect
              x={PAD.left}
              y={PAD.top}
              width={W - PAD.left - PAD.right}
              height={H - PAD.top - PAD.bottom}
            />
          </clipPath>
        </defs>

        {/* y grid and labels */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line className="chart__limit" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="chart__tick" x={PAD.left - 10} y={y(t) + 3.5} textAnchor="end">
              {signed(t, t % 1 === 0 ? 0 : 1)}
            </text>
          </g>
        ))}

        {/* Every sampled run. This is the evidence the three lines are percentiles of. */}
        <g clipPath={`url(#${uid}-plot)`} opacity={0.9}>
          {series.ghosts.map((g) => (
            <path key={g.id} className="chart__ghost" d={line(g.points)} />
          ))}
        </g>

        {/* The line of no effect. Above it the policy makes things worse. */}
        <line className="chart__zero" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
        <text className="chart__tick" x={W - PAD.right} y={y(0) - 8} textAnchor="end">
          no change
        </text>

        {/* Where the harm clears, when it clears at all. */}
        {breakpoint != null && breakpoint >= domain.xMin && breakpoint <= domain.xMax && (
          <g>
            <line
              className="chart__marker"
              x1={x(breakpoint)}
              x2={x(breakpoint)}
              y1={PAD.top}
              y2={H - PAD.bottom}
            />
            <text className="chart__tick" x={x(breakpoint) + 7} y={PAD.top + 12}>
              clears at {breakpoint}&#215;
            </text>
          </g>
        )}

        {/* The three worlds, struck forward. */}
        <g clipPath={`url(#${uid}-plot)`}>
          {WORLD_ORDER.map((w, i) => {
            const pts = worldPoints(series, w)
            return (
              <path
                key={w}
                className={`chart__line${animate ? ' chart__line--animate' : ''}`}
                d={line(pts)}
                stroke={`var(--w-${w})`}
                style={
                  animate
                    ? ({ ['--len' as string]: 2600, animationDelay: `${i * 110}ms` } as React.CSSProperties)
                    : undefined
                }
              />
            )
          })}
        </g>

        {/* Cursor */}
        <line
          className="chart__cursor"
          x1={x(cursor)}
          x2={x(cursor)}
          y1={PAD.top}
          y2={H - PAD.bottom}
          opacity={0.35}
        />
        {readout.map((r) => (
          <circle
            key={r.world}
            cx={x(cursor)}
            cy={y(r.value)}
            r={4}
            fill="var(--paper)"
            stroke={`var(--w-${r.world})`}
            strokeWidth={2.25}
          />
        ))}

        {/* Where the uploaded document put the lever. */}
        {policyValue != null && (
          <g>
            <line
              className="chart__axis"
              x1={x(policyValue)}
              x2={x(policyValue)}
              y1={H - PAD.bottom}
              y2={H - PAD.bottom + 6}
            />
            <text
              className="chart__tick"
              x={x(policyValue)}
              y={H - PAD.bottom + 30}
              textAnchor="middle"
              fill="var(--ink)"
            >
              your policy
            </text>
          </g>
        )}

        {/* x axis */}
        <line
          className="chart__axis"
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
        />
        {xTicks.map((t) => (
          <text
            key={`x${t}`}
            className="chart__tick"
            x={x(t)}
            y={H - PAD.bottom + 16}
            textAnchor="middle"
          >
            {t}&#215;
          </text>
        ))}
      </svg>

      <div className="chart-legend">
        <div className="chart-readout">
          {readout.map((r) => (
            <div key={r.world} className={`readout world world--${r.world}`}>
              <span className="readout__value">{signed(r.value, 1)}</span>
              <span className="label">
                {r.world} &middot; {WORLD_PERCENTILE[r.world as WorldName]}
              </span>
            </div>
          ))}
        </div>
        <p className="tiny muted" style={{ marginLeft: 'auto', maxWidth: '22rem' }}>
          <Glyph name="sweep" size={13} /> Days against the locked baseline. Each grey trace is one
          of {series.ghosts.length} sampled runs shown from {SAMPLE_COUNT.toLocaleString('en-GB')}.
        </p>
      </div>
    </div>
  )
}

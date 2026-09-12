/**
 * Explanatory diagrams for /about.
 *
 * Both are drawn from the same fixture the results page renders, not mocked up separately. The
 * sampling diagram is a real histogram of real sampled runs, so the shape a reader learns here is
 * the shape they meet on the results page. A diagram that invented its own distribution would be
 * teaching the wrong thing.
 */

import { seriesFor, sweep, worldPoints, WORLD_ORDER, WORLD_PERCENTILE, signed } from '../data'
import { Glyph } from './Glyph'

// ---------------------------------------------------------------------------
// Sampling: how 1,000 runs become three worlds
// ---------------------------------------------------------------------------

const W = 680
const H = 220
const PAD = { top: 26, right: 16, bottom: 34, left: 16 }
// 70 thinned runs over 22 bins reads as noise. Fewer bins show the shape they actually have.
const BINS = 14

export function SamplingDiagram() {
  const series = seriesFor('complex')
  const i = sweep.policyIndex

  // Every sampled run at the policy position, as one number each.
  const samples = series.ghosts.map((g) => g.points[i]?.y ?? 0)
  const worlds = WORLD_ORDER.map((w) => ({ world: w, value: worldPoints(series, w)[i]?.y ?? 0 }))

  const lo = Math.min(...samples, ...worlds.map((w) => w.value))
  const hi = Math.max(...samples, ...worlds.map((w) => w.value))
  const span = hi - lo || 1

  const counts = new Array<number>(BINS).fill(0)
  for (const s of samples) {
    const b = Math.min(BINS - 1, Math.floor(((s - lo) / span) * BINS))
    counts[b] = (counts[b] ?? 0) + 1
  }
  const peak = Math.max(...counts, 1)

  const x = (v: number) => PAD.left + ((v - lo) / span) * (W - PAD.left - PAD.right)
  const barW = (W - PAD.left - PAD.right) / BINS

  return (
    <figure className="diagram diagram--wide">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="diagram__svg"
        role="img"
        aria-label="A histogram of sampled runs, with the tenth, fiftieth and ninetieth percentiles marked as the three worlds."
      >
        {/*
          Every run, binned. Bars are tinted by which tail they fall in, so the reader can see
          the runs the optimistic and pessimistic worlds are cut from rather than taking the
          percentile lines on trust.
        */}
        {counts.map((c, b) => {
          const h = (c / peak) * (H - PAD.top - PAD.bottom)
          const centre = lo + ((b + 0.5) / BINS) * span
          const p10 = worlds.find((w) => w.world === 'optimistic')?.value ?? lo
          const p90 = worlds.find((w) => w.world === 'pessimistic')?.value ?? hi
          const fill =
            centre < p10
              ? 'var(--wash-blue)'
              : centre > p90
                ? 'var(--wash-fuchsia)'
                : 'var(--rule)'
          return (
            <rect
              key={b}
              x={PAD.left + b * barW + 1}
              y={H - PAD.bottom - h}
              width={Math.max(1, barW - 2)}
              height={h}
              rx={2}
              fill={fill}
            />
          )
        })}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={H - PAD.bottom}
          y2={H - PAD.bottom}
          stroke="var(--rule-2)"
        />

        {/* The three worlds are cuts through that pile, not separate runs. */}
        {worlds.map((w) => (
          <g key={w.world}>
            <line
              x1={x(w.value)}
              x2={x(w.value)}
              y1={PAD.top - 10}
              y2={H - PAD.bottom}
              stroke={`var(--w-${w.world})`}
              strokeWidth={2}
            />
            <text
              x={x(w.value)}
              y={PAD.top - 15}
              textAnchor="middle"
              className="diagram__tick"
              fill={`var(--w-${w.world})`}
            >
              {WORLD_PERCENTILE[w.world]}
            </text>
            <text
              x={x(w.value)}
              y={H - PAD.bottom + 16}
              textAnchor="middle"
              className="diagram__tick"
              fill="var(--ink-3)"
            >
              {signed(w.value, 1, 'd')}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="diagram__cap">
        Each column counts runs that landed in that range, tinted where it falls outside the
        tenth or ninetieth. The three worlds are cuts through the same pile, not three separate
        runs.
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Pipeline: where the model sits, and where it does not
// ---------------------------------------------------------------------------

interface Stage {
  id: string
  label: string
  detail: string
  kind: 'model' | 'deterministic'
  glyph: 'document' | 'flag' | 'sweep' | 'robust' | 'check'
}

const STAGES: Stage[] = [
  {
    id: 'doc',
    label: 'Your document',
    detail: 'A board paper, a service spec, a strategy',
    kind: 'model',
    glyph: 'document',
  },
  {
    id: 'params',
    label: 'Parameters',
    detail: 'Each one tagged with where it came from',
    kind: 'deterministic',
    glyph: 'flag',
  },
  {
    id: 'engine',
    label: 'Engine',
    detail: 'Same inputs, same answer, every time',
    kind: 'deterministic',
    glyph: 'sweep',
  },
  {
    id: 'worlds',
    label: 'Three worlds',
    detail: 'Percentiles of the result',
    kind: 'deterministic',
    glyph: 'robust',
  },
  {
    id: 'brief',
    label: 'Plain English',
    detail: 'What held, and under what condition',
    kind: 'model',
    glyph: 'check',
  },
]

export function PipelineDiagram() {
  return (
    <figure className="diagram diagram--wide">
      <ol className="pipeline">
        {STAGES.map((s, i) => (
          <li key={s.id} className={`pipeline__stage pipeline__stage--${s.kind}`}>
            {i > 0 && (
              <span className="pipeline__arrow" aria-hidden="true">
                <Glyph name="arrow" size={14} />
              </span>
            )}
            <div className="pipeline__box">
              <span className="pipeline__glyph">
                <Glyph name={s.glyph} size={16} />
              </span>
              <strong className="pipeline__label">{s.label}</strong>
              <span className="pipeline__detail">{s.detail}</span>
              <span className="pipeline__kind">
                {s.kind === 'model' ? 'language model' : 'deterministic'}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="diagram__cap">
        A language model reads your document at one end and writes the summary at the other. It is
        never allowed between them, so no model output is ever fed straight into another.
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// The four kinds of claim
// ---------------------------------------------------------------------------

const CLAIMS: {
  kind: string
  glyph: 'robust' | 'partial' | 'sweep' | 'warning'
  colour: string
  example: string
}[] = [
  { kind: 'Ordinal', glyph: 'partial', colour: 'var(--ink-3)', example: 'A is better than B.' },
  { kind: 'Structural', glyph: 'sweep', colour: 'var(--blue)', example: 'The median improves while the tail gets worse.' },
  { kind: 'Threshold', glyph: 'warning', colour: 'var(--amber)', example: 'It holds while community capacity stays above 3.4x.' },
  { kind: 'Robust', glyph: 'robust', colour: 'var(--ink)', example: 'It holds in all three worlds.' },
]

export function ClaimKinds() {
  return (
    <ul className="claims">
      {CLAIMS.map((c) => (
        <li className="claim" key={c.kind}>
          <span className="claim__glyph" style={{ color: c.colour }}>
            <Glyph name={c.glyph} size={16} />
          </span>
          <strong className="claim__kind">{c.kind}</strong>
          <span className="claim__example">{c.example}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The mark. Authored SVG, not generated art.
 *
 * It is a plumbob: the diamond that floats above a Sim and tells you how they are doing. That is
 * the right object for this product and not a decorative borrowing — we are reading the state of
 * a simulated population, and the plumbob is the one piece of visual language that already means
 * exactly that. It also keeps the register serious: these are people's lives, and a cartoon
 * character with a face was the wrong tone for it.
 *
 * The three bars across its waist are the same three worlds used everywhere else. When the worlds
 * agree they close into one band; when they disagree they pull apart and the diamond separates
 * into three offset ghosts. The mark IS the finding — change the findings and it changes.
 */

export type Mood = 'steady' | 'uncertain' | 'alert'

interface Props {
  mood?: Mood
  size?: number
  className?: string
  /** Give it a label when it carries meaning; leave it off when it is company. */
  title?: string
}

/** gap: how far the worlds pull apart. split: how far the whole diamond ghosts outward. */
const SPREAD: Record<Mood, { gap: number; split: number }> = {
  steady: { gap: 4.5, split: 0 },
  uncertain: { gap: 8, split: 3.5 },
  alert: { gap: 12, split: 7 },
}

/** Bar widths. The outer worlds shorten as they pull away from the waist. */
const WIDTH: Record<Mood, [number, number, number]> = {
  steady: [40, 46, 40],
  uncertain: [30, 46, 27],
  alert: [20, 46, 17],
}

const DIAMOND = 'M48 6 L82 52 L48 110 L14 52 Z'
const WAIST_Y = 52

export function Mascot({ mood = 'steady', size = 96, className, title }: Props) {
  const { gap, split } = SPREAD[mood]
  const [w1, w2, w3] = WIDTH[mood]
  const uid = `plumbob-${mood}`

  const bar = (y: number, w: number, stroke: string, key: string) => (
    <path
      key={key}
      d={`M${48 - w / 2} ${y}h${w}`}
      stroke={stroke}
      strokeWidth={3.2}
      strokeLinecap="round"
    />
  )

  return (
    <svg
      className={className ? `mascot ${className}` : 'mascot'}
      width={size}
      height={size * (128 / 96)}
      viewBox="0 0 96 128"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={`${uid}-face`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--paper)" />
          <stop offset="1" stopColor="var(--wash-fuchsia)" />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <path d={DIAMOND} />
        </clipPath>
      </defs>

      {/* It floats. */}
      <ellipse cx="48" cy="121" rx="19" ry="3.6" fill="var(--ink)" opacity={0.11} />

      {/* Ghosted copies: the worlds coming apart. Absent entirely when they agree. */}
      {split > 0 && (
        <g opacity={0.26}>
          <path d={DIAMOND} transform={`translate(${-split} 0)`} stroke="var(--blue)" strokeWidth={2} />
          <path d={DIAMOND} transform={`translate(${split} 0)`} stroke="var(--fuchsia)" strokeWidth={2} />
        </g>
      )}

      {/* The diamond */}
      <path d={DIAMOND} fill={`url(#${uid}-face)`} />
      <g clipPath={`url(#${uid}-clip)`}>
        {/* The centre ridge, so it reads as a solid faceted object rather than a flat rhombus. */}
        <path d="M48 6V110" stroke="var(--ink)" strokeWidth={1.4} opacity={0.18} />
        {bar(WAIST_Y - gap, w1, 'var(--w-optimistic)', 'optimistic')}
        {bar(WAIST_Y, w2, 'var(--w-realistic)', 'realistic')}
        {bar(WAIST_Y + gap, w3, 'var(--w-pessimistic)', 'pessimistic')}
      </g>
      <path d={DIAMOND} stroke="var(--ink)" strokeWidth={2.6} strokeLinejoin="round" />
    </svg>
  )
}

/** Picks the mood from a finding set, so the mark is never set by hand. */
export function moodFromFindings(
  findings: readonly { survivesAllThree: boolean; optimisticOnly: boolean }[],
): Mood {
  if (findings.some((f) => f.optimisticOnly)) return 'alert'
  if (findings.some((f) => !f.survivesAllThree)) return 'uncertain'
  return 'steady'
}

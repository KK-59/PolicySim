/**
 * The mark. Authored SVG, not generated art.
 *
 * A person with a plumbob above their head, exactly as The Sims places it. That object already
 * means "here is the state of a simulated person", which is precisely what this product reports,
 * so it is borrowed as a working piece of language rather than as a decoration.
 *
 * The figure is deliberately plain and faceless. These are people's lives and the register has to
 * stay serious; a character with a face would have made it a toy.
 *
 * The diamond carries Anima's gradient, and the three bars across its waist are the three worlds.
 * When the worlds agree the bars close into one band. When they disagree they pull apart and the
 * diamond throws off two ghosts. The mark IS the finding.
 */

export type Mood = 'steady' | 'uncertain' | 'alert'

interface Props {
  mood?: Mood
  size?: number
  className?: string
  /** Give it a label when it carries meaning; leave it off when it is company. */
  title?: string
}

/** gap: how far the worlds pull apart. split: how far the diamond ghosts outward. */
const SPREAD: Record<Mood, { gap: number; split: number }> = {
  steady: { gap: 3.4, split: 0 },
  uncertain: { gap: 6, split: 3 },
  alert: { gap: 8.6, split: 6 },
}

/** Bar widths. The outer worlds shorten as they pull away from the waist. */
const WIDTH: Record<Mood, [number, number, number]> = {
  steady: [26, 30, 26],
  uncertain: [19, 30, 17],
  alert: [12, 30, 10],
}

const DIAMOND = 'M48 2 L72 27 L48 56 L24 27 Z'
const WAIST_Y = 27

export function Mascot({ mood = 'steady', size = 96, className, title }: Props) {
  const { gap, split } = SPREAD[mood]
  const [w1, w2, w3] = WIDTH[mood]
  const uid = `plumbob-${mood}`

  const bar = (y: number, w: number, opacity: number, key: string) => (
    <path
      key={key}
      d={`M${48 - w / 2} ${y}h${w}`}
      stroke="var(--paper)"
      strokeWidth={2.6}
      strokeLinecap="round"
      opacity={opacity}
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
        <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.163" stopColor="var(--blue)" />
          <stop offset="1" stopColor="var(--fuchsia)" />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <path d={DIAMOND} />
        </clipPath>
      </defs>

      {/* Ghosts: the worlds coming apart. Absent entirely when they agree. */}
      {split > 0 && (
        <g opacity={0.3}>
          <path d={DIAMOND} transform={`translate(${-split} 0)`} stroke="var(--blue)" strokeWidth={1.8} />
          <path d={DIAMOND} transform={`translate(${split} 0)`} stroke="var(--fuchsia)" strokeWidth={1.8} />
        </g>
      )}

      {/* The plumbob */}
      <path d={DIAMOND} fill={`url(#${uid}-g)`} />
      <g clipPath={`url(#${uid}-clip)`}>
        {bar(WAIST_Y - gap, w1, 0.55, 'optimistic')}
        {bar(WAIST_Y, w2, 1, 'realistic')}
        {bar(WAIST_Y + gap, w3, 0.55, 'pessimistic')}
      </g>
      <path d={DIAMOND} stroke="var(--ink)" strokeWidth={2.4} strokeLinejoin="round" />

      {/* The person it belongs to. Plain and faceless on purpose. */}
      <circle
        cx="48"
        cy="80"
        r="13.5"
        fill="var(--paper)"
        stroke="var(--ink)"
        strokeWidth={2.6}
      />
      <path
        d="M20 126 C20 105, 32.5 94.5, 48 94.5 C63.5 94.5, 76 105, 76 126"
        fill="var(--paper)"
        stroke="var(--ink)"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
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

/**
 * The mascot. Authored SVG, not generated art.
 *
 * It is a status indicator wearing a face: its expression IS the data. The three marks below the
 * eyes are the same three world ticks used everywhere else in the interface, so when the worlds
 * agree the marks line up and it looks settled, and when they disagree the marks spread and it
 * looks unsure. Nothing about it is decorative — change the finding and the face changes with it.
 *
 * Two earlier generated versions were discarded: a capsule with legs reads as a medication pill,
 * which is the wrong thing entirely for a neighbourhood planning tool.
 */

export type Mood = 'steady' | 'uncertain' | 'alert'

interface Props {
  mood?: Mood
  size?: number
  className?: string
  /** Give it a label when it carries meaning; leave it off when it is company. */
  title?: string
}

/**
 * How far the outer two worlds pull away from the median line, and how far the median itself
 * bends. A flat median with its neighbours tight against it is a settled result.
 */
const SPREAD: Record<Mood, { gap: number; bend: number }> = {
  steady: { gap: 0.9, bend: 0 },
  uncertain: { gap: 4.4, bend: 2.2 },
  alert: { gap: 8.2, bend: 5.4 },
}

/** The median line, drawn as a path so it can bend. This is the mouth. */
function medianPath(cy: number, bend: number) {
  return `M21 ${cy}q5.5 ${-bend * 1.6} 11 0t11 ${bend * 1.1}`
}

export function Mascot({ mood = 'steady', size = 96, className, title }: Props) {
  const { gap, bend } = SPREAD[mood]
  const uid = `mascot-${mood}`
  const MOUTH_Y = 54

  return (
    <svg
      className={className ? `mascot ${className}` : 'mascot'}
      width={size}
      height={size * (86 / 64)}
      viewBox="0 0 64 86"
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
          <rect x="6" y="16" width="52" height="64" rx="17" />
        </clipPath>
      </defs>

      {/* The probe: it is an instrument that takes a reading, not a character with a head. */}
      <path d="M32 16V8" stroke="var(--ink)" strokeWidth={2.2} strokeLinecap="round" />
      <circle cx="32" cy="5" r="3.1" fill="var(--paper)" stroke="var(--ink)" strokeWidth={2.2} />

      {/* Body */}
      <rect
        x="6"
        y="16"
        width="52"
        height="64"
        rx="17"
        fill="var(--paper)"
        stroke="var(--ink)"
        strokeWidth={2.4}
      />

      {/* Eyes */}
      <circle cx="23" cy="38" r="3.2" fill="var(--ink)" />
      <circle cx="41" cy="38" r="3.2" fill="var(--ink)" />

      {/*
        The mouth is the three-world band: the median line with the optimistic and pessimistic
        runs above and below it. When the worlds agree they close up and it reads as a calm smile.
        When they disagree it opens into a spread, and the face is literally the uncertainty.
      */}
      <path
        d={medianPath(MOUTH_Y - gap, bend * 0.6)}
        stroke="var(--ink)"
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.34}
      />
      <path
        d={medianPath(MOUTH_Y, bend)}
        stroke="var(--ink)"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <path
        d={medianPath(MOUTH_Y + gap, bend * 1.4)}
        stroke="var(--ink)"
        strokeWidth={1.6}
        strokeLinecap="round"
        opacity={0.34}
      />

      {/* Anima's gradient as a reading bar across the base, with the body closing beneath it. */}
      <g clipPath={`url(#${uid}-clip)`}>
        <rect className="mascot__band" x="6" y="68" width="52" height="4.5" fill={`url(#${uid}-g)`} />
      </g>
    </svg>
  )
}

/** Picks the mood from a finding set, so the face is never set by hand. */
export function moodFromFindings(findings: readonly { survivesAllThree: boolean; optimisticOnly: boolean }[]): Mood {
  if (findings.some((f) => f.optimisticOnly)) return 'alert'
  if (findings.some((f) => !f.survivesAllThree)) return 'uncertain'
  return 'steady'
}

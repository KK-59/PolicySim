/**
 * The glyph set. Authored, not generated, and not a general icon library.
 *
 * The three world glyphs are the load-bearing ones: they place a tick at the percentile's own
 * height on a shared axis, so P10 sits low, P50 centre, P90 high. That encodes the world as a
 * MARK rather than a hue, which is what lets a finding survive a projector, a colourblind reader
 * and a greyscale print, the accessibility constraint in PRODUCT.md, discharged in the geometry
 * instead of apologised for in a footnote.
 *
 * One stroke weight throughout (1.5 at 16px), butt-free round caps, currentColor.
 */

export type GlyphName =
  | 'optimistic'
  | 'realistic'
  | 'pessimistic'
  | 'robust'
  | 'partial'
  | 'warning'
  | 'flag'
  | 'document'
  | 'arrow'
  | 'check'
  | 'cross'
  | 'sweep'
  | 'upload'

interface Props {
  name: GlyphName
  size?: number
  className?: string
  title?: string
}

/** Tick height per world: the percentile's own position on the distribution. */
const WORLD_Y: Record<'optimistic' | 'realistic' | 'pessimistic', number> = {
  optimistic: 11.5,
  realistic: 8,
  pessimistic: 4.5,
}

function WorldMark({ world }: { world: 'optimistic' | 'realistic' | 'pessimistic' }) {
  const y = WORLD_Y[world]
  return (
    <>
      <path d="M8 2.5v11" opacity={0.32} />
      <path d={`M3.5 ${y}h9`} />
    </>
  )
}

const PATHS: Record<Exclude<GlyphName, 'optimistic' | 'realistic' | 'pessimistic'>, JSX.Element> = {
  // Three rules of equal length: the claim held everywhere it was tested.
  robust: (
    <>
      <path d="M3.5 4.5h9" />
      <path d="M3.5 8h9" />
      <path d="M3.5 11.5h9" />
    </>
  ),
  // One rule falls short: it held in some worlds and not others.
  partial: (
    <>
      <path d="M3.5 4.5h9" />
      <path d="M3.5 8h9" />
      <path d="M3.5 11.5h3.5" opacity={0.4} />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.6 14.2 13.4H1.8L8 2.6Z" />
      <path d="M8 6.6v3.1" />
      <path d="M8 11.6h.01" />
    </>
  ),
  flag: (
    <>
      <path d="M4 14V2.8" />
      <path d="M4 3.2h7.6l-1.7 2.6 1.7 2.6H4" />
    </>
  ),
  document: (
    <>
      <path d="M4 2.5h5l3.2 3.2V13.5H4V2.5Z" />
      <path d="M9 2.5v3.3h3.2" />
    </>
  ),
  arrow: (
    <>
      <path d="M3 8h10" />
      <path d="M9 4.3 12.7 8 9 11.7" />
    </>
  ),
  check: <path d="M3.4 8.4 6.6 11.6 12.6 4.8" />,
  cross: (
    <>
      <path d="M4.4 4.4 11.6 11.6" />
      <path d="M11.6 4.4 4.4 11.6" />
    </>
  ),
  // The sweep: a curve crossing the line of no effect.
  sweep: (
    <>
      <path d="M2.4 8h11.2" opacity={0.35} strokeDasharray="2 2" />
      <path d="M2.4 12.4C5 12.4 6 3.6 8.6 3.6c2 0 2.6 4.4 5 4.4" />
    </>
  ),
  upload: (
    <>
      <path d="M8 11V3.2" />
      <path d="M4.8 6.4 8 3.2l3.2 3.2" />
      <path d="M3 12.8h10" />
    </>
  ),
}

export function Glyph({ name, size = 16, className, title }: Props) {
  const isWorld = name === 'optimistic' || name === 'realistic' || name === 'pessimistic'
  return (
    <svg
      className={className ? `glyph ${className}` : 'glyph'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {isWorld ? <WorldMark world={name} /> : PATHS[name]}
    </svg>
  )
}

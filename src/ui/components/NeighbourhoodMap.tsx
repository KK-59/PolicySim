/**
 * The neighbourhood, with our simulation running on it.
 *
 * Dots are people, coloured by patient class, moving between services. Class is worth colouring
 * because it is what the engine actually treats differently: urgent jumps the queue, complex
 * takes a double appointment, a letter is admin rather than a person in a room.
 *
 * The illustration is NHS-SIM's, credited on screen — it is a picture of the world this project
 * models, the same Riverside Practice and Northbank General the engine has nodes for. What moves
 * on it is ours: every count and every flow comes from the engine's event log.
 *
 * Two sites are drawn dim. The pharmacy and the home are in the neighbourhood and not in the
 * model, and showing them greyed is more honest than cropping them out — the PRD asks for
 * declared limits on screen rather than in a footnote, and a map with a hole in it says it better
 * than a sentence.
 */

import { useMemo } from 'react'

const MAP_W = 1536
const MAP_H = 1024

/**
 * Marker positions as a fraction of the illustration.
 *
 * Eyeballed against the artwork rather than taken from NHS-SIM's bundle, which does not ship
 * them. If a pin sits off its building, nudge it here — nothing else depends on these.
 */
const SITES = {
  gp: { x: 0.229, y: 0.439, kind: 'Primary care', name: 'Riverside Practice' },
  hospital: { x: 0.747, y: 0.384, kind: 'Secondary care', name: 'Northbank General' },
  community: { x: 0.487, y: 0.660, kind: 'Community', name: 'Neighbourhood Care' },
  pharmacy: { x: 0.370, y: 0.827, kind: 'Pharmacy', name: 'High Street Pharmacy' },
  home: { x: 0.169, y: 0.758, kind: 'At home', name: 'At home' },
} as const

type SiteId = keyof typeof SITES

/** Which engine node lives at which site. Admin and clinic are the same building, as in life. */
const NODE_SITE: Record<string, SiteId> = {
  'gp-clinic': 'gp',
  'gp-admin': 'gp',
  test: 'hospital',
  'community-visit': 'community',
}

/** In the neighbourhood, not in the model. Drawn dim and labelled. */
const UNMODELLED: SiteId[] = ['pharmacy', 'home']

export interface MapFlow {
  from: SiteId
  to: SiteId
  /** 0–1 through its journey, so a dot sits somewhere along the line. */
  progress: number
  cls: string
  key: string
}

interface Props {
  /** Waiting count per engine node at the scrubbed minute. */
  counts: Record<string, { waiting: number; service: number }>
  /** Movements in flight right now. */
  flows: MapFlow[]
  /** Waiting here, minus waiting here with the policy switched off. */
  delta: Partial<Record<SiteId, number>>
  /** False when no lever differs from baseline, in which case a delta of zero means nothing. */
  hasControl: boolean
  /** Site whose queue is open, if any. */
  selected: SiteId | null
  onSelect: (site: SiteId | null) => void
}

export function NeighbourhoodMap({ counts, flows, delta, hasControl, selected, onSelect }: Props) {
  // One badge per site, summing the nodes that sit there.
  const perSite = useMemo(() => {
    const out: Partial<Record<SiteId, { waiting: number; service: number }>> = {}
    for (const [node, site] of Object.entries(NODE_SITE)) {
      const c = counts[node]
      if (!c) continue
      const cur = out[site] ?? { waiting: 0, service: 0 }
      out[site] = { waiting: cur.waiting + c.waiting, service: cur.service + c.service }
    }
    return out
  }, [counts])

  return (
    <figure className="nmap">
      <div className="nmap__frame" style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }}>
        <img className="nmap__img" src="/world/neighbourhood.webp" alt="" />

        {/* Flows sit under the pins so a dot never covers a number. */}
        <svg className="nmap__flows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {flows.map((f) => {
            const a = SITES[f.from]
            const b = SITES[f.to]
            const x = (a.x + (b.x - a.x) * f.progress) * 100
            const y = (a.y + (b.y - a.y) * f.progress) * 100
            return (
              <g key={f.key}>
                <line
                  className="nmap__path"
                  x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100}
                />
                <circle className={`nmap__dot nmap__dot--${f.cls}`} cx={x} cy={y} r={0.7} />
              </g>
            )
          })}
        </svg>

        {(Object.keys(SITES) as SiteId[]).map((id) => {
          const site = SITES[id]
          const c = perSite[id]
          const unmodelled = UNMODELLED.includes(id)
          const busy = (c?.waiting ?? 0) > 0
          return (
            <button
              type="button"
              key={id}
              className="nmap__pin"
              style={{ left: `${site.x * 100}%`, top: `${site.y * 100}%` }}
              data-unmodelled={unmodelled}
              data-selected={selected === id}
              disabled={unmodelled}
              onClick={() => onSelect(selected === id ? null : id)}
              title={unmodelled ? `${site.name} — outside the model` : site.name}
            >
              <span className="nmap__dotmark" data-busy={busy} />
              <span className="nmap__label">
                <span className="nmap__kind">{site.kind}</span>
                <span className="nmap__name">{site.name}</span>
                {unmodelled ? null : (
                  <span className="nmap__count">
                    <strong>{c?.waiting ?? 0}</strong> waiting
                    {(c?.service ?? 0) > 0 && <em> · {c?.service} in service</em>}
                    {/* The exact effect of the policy at this minute: the same seed, the same
                        arrivals, the same backlog, with the levers off. */}
                    {hasControl && (delta[id] ?? 0) !== 0 && (
                      <em
                        className={`nmap__delta ${(delta[id] ?? 0) < 0 ? 'is-better' : 'is-worse'}`}
                      >
                        {(delta[id] ?? 0) > 0 ? '+' : '−'}
                        {Math.abs(delta[id] ?? 0)} vs no policy
                      </em>
                    )}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="nmap__legend">
        {/* Without this the dots are just colours. Class is what decides priority and appointment
            length, so it is the thing worth colouring and the thing worth naming. */}
        <span className="nmap__key">
          <i className="nmap__swatch nmap__swatch--routine" /> Routine
        </span>
        <span className="nmap__key">
          <i className="nmap__swatch nmap__swatch--complex" /> Complex · double appointment
        </span>
        <span className="nmap__key">
          <i className="nmap__swatch nmap__swatch--urgent" /> Urgent · jumps the queue
        </span>
        <span className="nmap__key">
          <i className="nmap__swatch nmap__swatch--letter" /> Discharge letter
        </span>
        <span className="nmap__key nmap__key--note">Each dot is one person moving between services.</span>
      </div>

      <figcaption className="nmap__credit">
        Neighbourhood illustration by NHS-SIM; the movement on it is this engine's. The pharmacy
        and the home are dimmed: they are in the neighbourhood and not in the model.
      </figcaption>
    </figure>
  )
}

export { NODE_SITE, SITES }
export type { SiteId }

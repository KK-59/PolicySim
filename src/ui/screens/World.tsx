/**
 * The world, as it ran.
 *
 * Everything on this page is reconstructed from the engine's own event log — every arrival,
 * service start, completion and refusal it processed. Nothing is a summary or a second
 * representation: scrub to a minute and you are looking at where each work item actually was.
 *
 * What it is NOT: NHS-SIM's patients. Our model simulates anonymous demand, so an item here is a
 * person's contact with a service, not Amira Khan. Naming them would be a fiction the engine
 * cannot back, and the page says so rather than implying otherwise.
 */

import { useEffect, useMemo, useState } from 'react'
import { Glyph } from '../components/Glyph'
import { NeighbourhoodMap, NODE_SITE, type MapFlow, type SiteId } from '../components/NeighbourhoodMap'
import { navigate } from '../lib/router'
import { useRun } from '../lib/store'
import type { Metrics } from '@/contracts/metrics'

const DAY = 1440

interface TraceEvent {
  t: number
  kind: 'arrive' | 'start' | 'complete' | 'refuse'
  node: string
  item: number
  cls: string
  /** Present for work seeded from the snapshot: the simulator's own patient. */
  ref?: string
  title?: string
}

type WorldName = 'optimistic' | 'realistic' | 'pessimistic'
const WORLDS: WorldName[] = ['optimistic', 'realistic', 'pessimistic']
const PERCENTILE: Record<WorldName, string> = {
  optimistic: 'P10',
  realistic: 'P50',
  pessimistic: 'P90',
}

interface WorldData {
  world: WorldName
  seed?: { capturedAt: string; items: number; source: string }
  /** The same seed with the policy switched off, so the difference is the policy. */
  controlTrace?: TraceEvent[]
  changed?: string[]
  windowStart: number
  windowEnd: number
  days: number
  trace: TraceEvent[]
  nodes: { id: string; utilisation: number; stable: boolean }[]
}

const NODE_LABEL: Record<string, string> = {
  'gp-clinic': 'GP clinic',
  'gp-admin': 'GP admin',
  test: 'Diagnostics',
  'community-visit': 'Community visits',
}

const NODE_ORDER = ['gp-clinic', 'gp-admin', 'test', 'community-visit']

interface Placed {
  item: number
  cls: string
  state: 'waiting' | 'service'
  since: number
  ref?: string
  title?: string
}

/**
 * Where every item was at time `t`.
 *
 * A replay rather than an index: the log is a few thousand events, so scanning it on each scrub
 * costs less than a millisecond and cannot drift out of step with the events the way a
 * precomputed snapshot table would.
 */
function stateAt(trace: readonly TraceEvent[], t: number): Map<string, Placed[]> {
  type Held = {
    node: string; state: 'waiting' | 'service'; since: number; cls: string
    ref?: string; title?: string
  }
  const placed = new Map<number, Held>()

  for (const e of trace) {
    if (e.t > t) break
    const prev = placed.get(e.item)
    // Identity is carried forward: only the arrival event names the patient, and an item is still
    // the same person once it is in service.
    const identity = { ref: e.ref ?? prev?.ref, title: e.title ?? prev?.title }
    if (e.kind === 'arrive') {
      placed.set(e.item, { node: e.node, state: 'waiting', since: e.t, cls: e.cls, ...identity })
    } else if (e.kind === 'start') {
      // An item can start without a recorded arrival: it was mid-service when the window opened,
      // so its arrival is behind us. Adopt it rather than dropping it on the floor.
      placed.set(e.item, {
        node: e.node, state: 'service', since: e.t, cls: prev?.cls ?? e.cls, ...identity,
      })
    } else if (e.kind === 'complete' || e.kind === 'refuse') placed.delete(e.item)
  }

  const byNode = new Map<string, Placed[]>()
  for (const [item, p] of placed) {
    const list = byNode.get(p.node) ?? []
    list.push({
      item, cls: p.cls, state: p.state, since: p.since,
      ...(p.ref ? { ref: p.ref } : {}), ...(p.title ? { title: p.title } : {}),
    })
    byNode.set(p.node, list)
  }
  for (const list of byNode.values()) list.sort((a, b) => a.since - b.since)
  return byNode
}

/**
 * Every time an item moved from one service to another.
 *
 * Derived rather than recorded: the log says where each item arrived, and the previous place it
 * finished tells you where it came from. Precomputed once per trace so scrubbing stays cheap.
 */
function movements(trace: readonly TraceEvent[]): { t: number; from: SiteId; to: SiteId; cls: string; item: number }[] {
  const lastSite = new Map<number, SiteId>()
  const out: { t: number; from: SiteId; to: SiteId; cls: string; item: number }[] = []
  for (const e of trace) {
    const site = NODE_SITE[e.node]
    if (!site) continue
    if (e.kind === 'arrive') {
      const from = lastSite.get(e.item)
      if (from && from !== site) out.push({ t: e.t, from, to: site, cls: e.cls, item: e.item })
      lastSite.set(e.item, site)
    } else if (e.kind === 'complete' || e.kind === 'refuse') {
      lastSite.set(e.item, site)
    }
  }
  return out
}

/** How long a dot spends visibly travelling before it lands, in simulated minutes. */
const TRAVEL = 60

/** Minutes into the window, as a day and a clock time. Day 0 of the model is a Monday. */
function stamp(minutes: number): string {
  const day = Math.floor(minutes / DAY)
  const mins = Math.round(minutes - day * DAY)
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const hh = String(Math.floor(mins / 60)).padStart(2, '0')
  const mm = String(mins % 60).padStart(2, '0')
  return `${names[day % 7]} ${hh}:${mm}`
}

const wait = (mins: number) => (mins < 60 ? `${Math.round(mins)}m` : `${(mins / 60).toFixed(1)}h`)

export function World() {
  const run = useRun()
  const metrics = run.result?.metrics as Metrics | undefined
  const [data, setData] = useState<WorldData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [openNode, setOpenNode] = useState<string | null>(null)
  const [openSite, setOpenSite] = useState<SiteId | null>(null)
  const [openItem, setOpenItem] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [world, setWorld] = useState<WorldName>('realistic')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const levers: Record<string, number> = {}
    for (const c of run.commitments) levers[c.paramPath] = c.value

    let cancelled = false
    setLoading(true)
    setError(null)
    // Keep the scrub position across a world change. Comparing the same Tuesday morning in two
    // worlds is the point of being able to switch; being thrown back to Monday would defeat it.
    fetch('/api/world', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ levers, days: 14, world }),
    })
      .then(async (r) => {
        const payload = await r.json()
        if (!r.ok) throw new Error(payload?.error ?? `Failed (${r.status})`)
        if (cancelled) return
        setData(payload)
        setOpenItem(null)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [world])

  // Play advances by half an hour a frame. Fast enough to see a session fill and empty, slow
  // enough that the queue is legible while it does.
  useEffect(() => {
    if (!playing || !data) return
    const span = data.windowEnd - data.windowStart
    const id = window.setInterval(() => {
      setOffset((o) => (o + 30 >= span ? 0 : o + 30))
    }, 80)
    return () => window.clearInterval(id)
  }, [playing, data])

  const now = (data?.windowStart ?? 0) + offset
  const byNode = useMemo<Map<string, Placed[]>>(
    () => (data ? stateAt(data.trace, now) : new Map()),
    [data, now],
  )

  // The same minute with the policy off. Every difference below is the policy and nothing else.
  const controlByNode = useMemo<Map<string, Placed[]>>(
    () => (data?.controlTrace ? stateAt(data.controlTrace, now) : new Map()),
    [data, now],
  )

  const moves = useMemo(() => (data ? movements(data.trace) : []), [data])

  /** Dots in flight at this minute, gliding in so they land exactly when the item arrives. */
  const flows = useMemo<MapFlow[]>(
    () => moves
      .filter((m) => m.t >= now && m.t <= now + TRAVEL)
      .slice(0, 40)
      .map((m) => ({
        from: m.from,
        to: m.to,
        progress: 1 - (m.t - now) / TRAVEL,
        cls: m.cls,
        key: `${m.item}-${m.t}`,
      })),
    [moves, now],
  )

  const counts = useMemo(() => {
    const out: Record<string, { waiting: number; service: number }> = {}
    for (const [node, list] of byNode) {
      out[node] = {
        waiting: list.filter((p) => p.state === 'waiting').length,
        service: list.filter((p) => p.state === 'service').length,
      }
    }
    return out
  }, [byNode])

  /** Waiting under the policy minus waiting without it, per site. */
  const siteDelta = useMemo(() => {
    const sum = (m: Map<string, Placed[]>) => {
      const out: Partial<Record<SiteId, number>> = {}
      for (const [node, list] of m) {
        const site = NODE_SITE[node]
        if (!site) continue
        out[site] = (out[site] ?? 0) + list.filter((p) => p.state === 'waiting').length
      }
      return out
    }
    const a = sum(byNode)
    const b = sum(controlByNode)
    const out: Partial<Record<SiteId, number>> = {}
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<SiteId>) {
      out[k] = (a[k] ?? 0) - (b[k] ?? 0)
    }
    return out
  }, [byNode, controlByNode])

  const journey = useMemo(() => {
    if (!data || openItem === null) return []
    return data.trace.filter((e) => e.item === openItem)
  }, [data, openItem])

  if (error) {
    return (
      <section className="page">
        <p className="note" role="alert">
          <Glyph name="warning" size={13} />
          <span>{error} — the world view needs the API running (`npm run dev`).</span>
        </p>
      </section>
    )
  }

  if (!data) return <section className="page"><p className="muted">Running the world…</p></section>

  const span = data.windowEnd - data.windowStart
  const refusalsSoFar = data.trace.filter((e) => e.kind === 'refuse' && e.t <= now).length
  const queue = openNode ? byNode.get(openNode) ?? [] : []

  return (
    <section className="page">
      <div className="row between">
        <h1 className="h1">The world, as it ran.</h1>
        <button type="button" className="btn btn--secondary" onClick={() => setPlaying((p) => !p)}>
          <Glyph name={playing ? 'warning' : 'arrow'} size={14} />
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>

      {/*
        The choice of world is the primary control on this page, so it is the biggest thing on it.
        Each card carries that world's own headline outcome where a run exists, because "which
        world do I want to watch" is a question about what happens in them.

        Not a re-roll: each is the sampled parameter draw that produced that percentile, so this
        is the same pessimistic world the chart was drawn from.
      */}
      <div className="worldpick mt-4" role="group" aria-label="Which world to watch">
        {WORLDS.map((w) => {
          const band = metrics?.worlds.waits.routine[w]
          const stable = metrics?.worlds.perNode['gp-clinic']?.[w].stable ?? true
          return (
            <button
              type="button"
              key={w}
              className={`worldpick__card world--${w}`}
              aria-pressed={world === w}
              data-active={world === w}
              disabled={loading}
              onClick={() => setWorld(w)}
            >
              <span className="worldpick__top">
                <Glyph name={w} size={16} />
                <span className="worldpick__name">{w}</span>
                <span className="worldpick__pct">{PERCENTILE[w]}</span>
              </span>
              <span className="worldpick__stat">
                {band === undefined
                  ? '—'
                  : !stable
                    ? 'no steady state'
                    : band.p50 / DAY < 1
                      ? `${(band.p50 / 60).toFixed(1)}h median wait`
                      : `${(band.p50 / DAY).toFixed(1)}d median wait`}
              </span>
              {world === w && loading && <span className="worldpick__busy">running…</span>}
            </button>
          )
        })}
      </div>

      <div className="row between mt-4">
        <p className="lead" style={{ margin: 0 }}>
          {data.trace.length.toLocaleString()} events over {data.days} simulated days in the{' '}
          <strong>{data.world}</strong> world, replayed from the engine's own log. Scrub to a
          minute and click a service to see who is waiting in it.
        </p>
        <button type="button" className="btn btn--ghost" onClick={() => navigate('/worlds')}>
          <Glyph name="document" size={14} />
          Full report
        </button>
      </div>

      <div className="scrubber mt-5">
        <input
          type="range"
          min={0}
          max={span}
          step={15}
          value={offset}
          aria-label="Time"
          onChange={(e) => setOffset(Number(e.target.value))}
        />
        <div className="scrubber__readout">
          <strong>{stamp(now)}</strong>
          <span className="muted">day {Math.floor(offset / DAY) + 1} of {data.days}</span>
          <span className="muted">{refusalsSoFar} referrals refused so far</span>
        </div>
      </div>

      <NeighbourhoodMap
        counts={counts}
        flows={flows}
        delta={siteDelta}
        hasControl={Boolean(data.controlTrace && (data.changed?.length ?? 0) > 0)}
        selected={openSite}
        onSelect={(site) => {
          setOpenSite(site)
          // A pin opens the biggest queue at that site, so clicking the GP lands somewhere.
          const nodes = Object.entries(NODE_SITE).filter(([, s2]) => s2 === site).map(([n]) => n)
          const biggest = nodes.sort((a, b) => (counts[b]?.waiting ?? 0) - (counts[a]?.waiting ?? 0))[0]
          setOpenNode(site === null ? null : biggest ?? null)
          setOpenItem(null)
        }}
      />

      <div className="nodes mt-4">
        {NODE_ORDER.map((id) => {
          const here = byNode.get(id) ?? []
          const waiting = here.filter((p) => p.state === 'waiting').length
          const serving = here.filter((p) => p.state === 'service').length
          const open = openNode === id
          return (
            <button
              type="button"
              key={id}
              className="nodecard"
              data-open={open}
              data-busy={serving > 0}
              onClick={() => { setOpenNode(open ? null : id); setOpenItem(null) }}
            >
              <span className="nodecard__name">{NODE_LABEL[id] ?? id}</span>
              <span className="nodecard__counts">
                <strong>{waiting}</strong> waiting
                <span className="muted"> · {serving} in service</span>
              </span>
              <span className="nodecard__bar" aria-hidden="true">
                {Array.from({ length: Math.min(waiting, 40) }).map((_, i) => (
                  <i key={i} />
                ))}
              </span>
            </button>
          )
        })}
      </div>

      {openNode && (
        <div className="queue mt-4">
          <h2 className="h2">
            {NODE_LABEL[openNode]} · {queue.length} here at {stamp(now)}
          </h2>
          {queue.length === 0 ? (
            <p className="muted small mt-2">Empty. Nobody is waiting or being seen.</p>
          ) : (
            <ul className="queuelist mt-2">
              {queue.slice(0, 60).map((p) => (
                <li key={p.item}>
                  <button
                    type="button"
                    className="queueitem"
                    data-state={p.state}
                    data-selected={openItem === p.item}
                    onClick={() => setOpenItem(openItem === p.item ? null : p.item)}
                  >
                    <span className={`cls cls--${p.cls}`}>{p.cls}</span>
                    {/* A real patient from the snapshot is named; demand the model generated
                        is not, because it is not anybody. */}
                    <span className={p.ref ? 'queueitem__ref' : 'muted'}>
                      {p.ref ?? `#${p.item}`}
                    </span>
                    <span>
                      {p.state === 'service' ? 'in service' : 'waiting'} {wait(now - p.since)}
                    </span>
                  </button>
                </li>
              ))}
              {queue.length > 60 && (
                <li className="muted small">…and {queue.length - 60} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      {openItem !== null && journey.length > 0 && (
        <div className="journey mt-4">
          <h2 className="h2">
            {journey.find((e) => e.ref)?.ref ?? `Item #${openItem}`}
          </h2>
          {journey.find((e) => e.title) && (
            <p className="muted small">{journey.find((e) => e.title)?.title}</p>
          )}
          <ol className="journeylist mt-2">
            {journey.map((e, i) => (
              <li key={i} data-kind={e.kind}>
                <span className="journey__t">{stamp(e.t)}</span>
                <span className="journey__what">
                  {e.kind === 'arrive' && `joined the queue at ${NODE_LABEL[e.node] ?? e.node}`}
                  {e.kind === 'start' && `seen at ${NODE_LABEL[e.node] ?? e.node}`}
                  {e.kind === 'complete' && `finished at ${NODE_LABEL[e.node] ?? e.node}`}
                  {e.kind === 'refuse' && `refused by ${NODE_LABEL[e.node] ?? e.node} — sent back`}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="note mt-5" role="note">
        <Glyph name="warning" size={13} />
        <span>
          {data.seed
            ? `Starts from ${data.seed.items} pieces of open work captured from the real world, `
              + 'with their own patient ids and the time they had already waited. Everything after '
              + 'that moment is the model, not a recording — a named patient here is a real '
              + 'person in the simulator, but what happens to them is our prediction. '
              + 'Unnamed items are demand the model generated.'
            : 'These are simulated work items, not NHS-SIM patients.'}
        </span>
      </p>
    </section>
  )
}

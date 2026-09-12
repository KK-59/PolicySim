/**
 * A patient, as the simulator has them.
 *
 * Everything above the fold here is REAL: name, date of birth, conditions, needs, goals, and the
 * records each service holds — read from NHS-SIM at the moment the seed was captured. What the
 * world view then does with this person is the engine's prediction, and the panel keeps the two
 * apart rather than blending them into one story.
 */

import PATIENTS from '../../../fixtures/seed-patients.json'
import { Glyph } from './Glyph'

interface RecordRow {
  site: string
  kind: string
  status: string
  title: string
  createdAt: number
  dueAt?: number
  priority?: string
}

interface Person {
  id: string
  name?: string
  birthDate?: string
  conditions?: string[]
  needs?: string[]
  goals?: string[]
  localIds?: Record<string, string>
  records: RecordRow[]
  recordsTrimmed?: Record<string, number>
}

const PEOPLE = new Map<string, Person>(
  (PATIENTS as { people: Person[] }).people.map((p) => [p.id, p]),
)

export const hasRecord = (ref: string | undefined): boolean =>
  ref !== undefined && PEOPLE.has(ref)

/** Age at the simulator's clock, not today's — the world runs in 2026. */
function age(birthDate: string | undefined, now: number): string {
  if (!birthDate) return ''
  const born = new Date(birthDate)
  const at = new Date(now)
  let years = at.getFullYear() - born.getFullYear()
  const monthDiff = at.getMonth() - born.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < born.getDate())) years--
  return `${years}`
}

const when = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function PatientRecord({ ref, now }: { ref: string; now: number }) {
  const person = PEOPLE.get(ref)
  if (!person) {
    return (
      <p className="muted small">
        No record: this is demand the model generated, not a person the simulator has.
      </p>
    )
  }

  const bySite = new Map<string, RecordRow[]>()
  for (const r of person.records) {
    const list = bySite.get(r.site) ?? []
    list.push(r)
    bySite.set(r.site, list)
  }

  const trimmed = Object.entries(person.recordsTrimmed ?? {})

  return (
    <div className="record">
      <header className="record__head">
        <div>
          <h3 className="record__name">{person.name ?? person.id}</h3>
          <p className="record__meta">
            {person.id}
            {person.birthDate && ` · born ${person.birthDate} · ${age(person.birthDate, now)}`}
            {person.localIds?.['gp'] && ` · ${person.localIds['gp']}`}
          </p>
        </div>
        <span className="record__flag">Real record, from the simulator</span>
      </header>

      {person.conditions && person.conditions.length > 0 && (
        <p className="record__chips">
          {person.conditions.map((c) => (
            <span className="chip chip--condition" key={c}>{c}</span>
          ))}
        </p>
      )}

      {person.needs && person.needs.length > 0 && (
        <p className="record__line"><strong>Needs.</strong> {person.needs.join(' · ')}</p>
      )}
      {person.goals && person.goals.length > 0 && (
        <p className="record__line"><strong>Wants.</strong> {person.goals.join(' · ')}</p>
      )}

      {[...bySite.entries()].map(([site, rows]) => (
        <section className="record__site" key={site}>
          <h4 className="record__sitename">{site}</h4>
          <ul className="record__rows">
            {rows.slice(0, 14).map((r, i) => (
              <li key={i} data-status={r.status}>
                <span className="record__kind">{r.kind}</span>
                <span className="record__title">{r.title}</span>
                <span className="record__status">{r.status}</span>
                <span className="record__when">{when(r.createdAt)}</span>
              </li>
            ))}
            {rows.length > 14 && (
              <li className="muted small">…and {rows.length - 14} more at this service</li>
            )}
          </ul>
        </section>
      ))}

      {trimmed.length > 0 && (
        <p className="muted small">
          {trimmed.map(([k, n]) => `${n} further ${k} records`).join(', ')} not carried into the
          seed — they repeat.
        </p>
      )}

      <p className="note" role="note">
        <Glyph name="warning" size={13} />
        <span>
          The record above is real. Where this person goes next in the world view is the engine's
          prediction, not something the simulator has done.
        </span>
      </p>
    </div>
  )
}

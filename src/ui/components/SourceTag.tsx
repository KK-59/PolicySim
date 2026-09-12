/**
 * Every number on screen carries where it came from. A parameter with no source is flagged,
 * never silently defaulted — PRODUCT.md principle 2, and the thing that makes "where did that
 * number come from" answerable in the room.
 */

import type { SourceTag as Tag } from '@/contracts/params'
import { SOURCE_MEANING } from '../data'
import { Glyph } from './Glyph'

export function SourceTag({ source, citation }: { source: Tag; citation?: string | null }) {
  return (
    <span
      className={`srctag srctag--${source}`}
      title={citation ? `${SOURCE_MEANING[source]}\n\n${citation}` : SOURCE_MEANING[source]}
    >
      {source === 'assumed' && <Glyph name="warning" size={11} />}
      {source}
    </span>
  )
}

/** The key, shown once per screen that uses tags rather than beside every one of them. */
export function SourceKey() {
  const tags: Tag[] = ['measured', 'documented', 'literature', 'assumed']
  return (
    <div className="row gap-3">
      {tags.map((t) => (
        <span key={t} className="row gap-2" style={{ gap: '0.375rem' }}>
          <SourceTag source={t} />
          <span className="tiny muted">{SOURCE_MEANING[t]}</span>
        </span>
      ))}
    </div>
  )
}

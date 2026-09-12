/**
 * Names for demand the model generated.
 *
 * These people do not exist. They are not the simulator's patients — those come from the seed and
 * carry a SIM- id — they are arrivals the engine invented to keep the queues fed.
 *
 * Every name begins with S, for simulated. That is the tell: a reader who learns it once can sort
 * the two kinds apart at a glance, and it survives being screenshotted out of context in a way a
 * colour or a footnote does not. Repeats are fine and expected — a neighbourhood of fifty
 * thousand has more than one Sam Shah.
 */

const FIRST = [
  'Sam', 'Sara', 'Simon', 'Sofia', 'Sunil', 'Stella', 'Seb', 'Shreya', 'Sean', 'Sadie',
  'Solomon', 'Suki', 'Stefan', 'Sana', 'Silas', 'Saoirse', 'Sami', 'Serena', 'Sol', 'Sinead',
  'Sven', 'Selina', 'Saul', 'Shona', 'Sadia', 'Struan', 'Sylvie', 'Santiago', 'Saskia', 'Seren',
] as const

const LAST = [
  'Shah', 'Singh', 'Stone', 'Sutton', 'Sharma', 'Silva', 'Sinclair', 'Stewart', 'Summers', 'Sen',
  'Sandhu', 'Sparks', 'Stanley', 'Swift', 'Sykes', 'Sorensen', 'Salim', 'Santos', 'Sadler',
  'Sowande', 'Sullivan', 'Sartori', 'Sekhon', 'Sheppard', 'Sloane',
] as const

/**
 * The same item always gets the same name.
 *
 * Hashed rather than indexed by two multipliers: that version cycled every 150 items, so a queue
 * of three hundred showed every name twice and looked like a bug. Mixing the id first uses the
 * full 750 combinations and scatters them, so neighbours in a queue are not neighbours in the
 * list.
 */
function mix(n: number): number {
  let h = n + 0x9e3779b9
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad)
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97)
  return (h ^ (h >>> 15)) >>> 0
}

export function syntheticName(itemId: number): string {
  const h = mix(itemId)
  const first = FIRST[h % FIRST.length] as string
  const last = LAST[(h >>> 8) % LAST.length] as string
  return `${first} ${last}`
}

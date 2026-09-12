#!/usr/bin/env node
/**
 * Generates the mascot artwork with fal.ai (Recraft V3, vector illustration style).
 *
 * Icons are NOT generated here: they are hand-drawn inline SVG in src/ui/components/Glyph.tsx,
 * because the variation glyphs are semantic (they encode whether a finding holds) and have to be
 * exact. A generated icon set would be decoration; these are data.
 *
 * Usage: FAL_KEY=... node scripts/gen-assets.mjs
 * Output: src/ui/assets/mascot-<pose>.png
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/ui/assets')

const KEY = process.env.FAL_KEY
if (!KEY) {
  console.error('FAL_KEY missing. It lives in .env (gitignored).')
  process.exit(1)
}

/**
 * One shared body description so the three poses are the same character, not three characters.
 * The palette is Anima's: white ground, #0A0A0A ink, #1D4ED8 -> #C026D3 gradient.
 */
const BODY = [
  'Minimal geometric logo mark, flat line art, centred on plain white.',
  'A tall rounded-rectangle outline, pure white inside, uniform thin black stroke.',
  'Two tiny solid black square eyes near the top.',
  'Strictly NO arms, NO legs, NO feet, NO shoes, NO hands, NO facial shading.',
  'Pure geometry, single stroke weight, no shading, no shadow, no colour except one blue-to-magenta bar.',
].join(' ')

const POSES = [
  {
    name: 'steady',
    mouth:
      'Below the eyes, one straight horizontal black bar, perfectly level.',
    mood: 'The character looks settled and quietly confident, standing upright and symmetrical.',
  },
  {
    name: 'uncertain',
    mouth:
      'Below the eyes, three short horizontal black bars of different lengths, stacked.',
    mood: 'The character tilts very slightly to one side and its eyes are a touch smaller, looking unsure.',
  },
  {
    name: 'alert',
    mouth:
      'Below the eyes, one horizontal black bar whose right end steps sharply upward.',
    mood: 'The character leans forward with its arms lifted slightly, eyes a little wider, looking like it has spotted something.',
  },
]

async function submit(prompt) {
  const res = await fetch('https://queue.fal.run/fal-ai/recraft-v3', {
    method: 'POST',
    headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      style: 'vector_illustration',
      image_size: { width: 1024, height: 1024 },
    }),
  })
  if (!res.ok) throw new Error(`submit ${res.status}: ${await res.text()}`)
  return res.json()
}

async function poll(statusUrl, responseUrl) {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const s = await fetch(statusUrl, { headers: { Authorization: `Key ${KEY}` } })
    const body = await s.json()
    if (body.status === 'COMPLETED') {
      const r = await fetch(responseUrl, { headers: { Authorization: `Key ${KEY}` } })
      return r.json()
    }
    if (body.status === 'FAILED') throw new Error(`generation failed: ${JSON.stringify(body)}`)
  }
  throw new Error('timed out waiting for generation')
}

async function one(pose) {
  const prompt = `${BODY} ${pose.mouth} ${pose.mood}`
  console.log(`[${pose.name}] submitting`)
  const queued = await submit(prompt)
  const result = await poll(queued.status_url, queued.response_url)
  const url = result?.images?.[0]?.url
  if (!url) throw new Error(`no image returned for ${pose.name}: ${JSON.stringify(result)}`)
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
  const file = join(OUT, `mascot-alt-${pose.name}.svg`)
  await writeFile(file, bytes)
  console.log(`[${pose.name}] wrote ${file} (${bytes.length} bytes)`)
}

await mkdir(OUT, { recursive: true })
const results = await Promise.allSettled(POSES.map(one))
for (const [i, r] of results.entries()) {
  if (r.status === 'rejected') console.error(`[${POSES[i].name}] ${r.reason?.message ?? r.reason}`)
}
console.log('done')

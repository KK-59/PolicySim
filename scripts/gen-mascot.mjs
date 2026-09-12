#!/usr/bin/env node
/**
 * Generates Atlas mascot candidates with fal.ai (FLUX Pro 1.1 Ultra).
 *
 * The concept: Atlas carries the world on his shoulders, and the globe is carved with OUR
 * neighbourhood instead of the classical bull and ship. A policymaker bearing the weight of the
 * place they are responsible for is the product's argument in one object.
 *
 * Five candidates across five registers, so the choice is about register and not about luck.
 *
 * Usage: FAL_KEY=... node scripts/gen-mascot.mjs [--only 3]
 * Output: design/mascot/atlas-<n>.png plus a contact sheet at design/mascot/index.html
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'design/mascot')

const KEY = process.env.FAL_KEY
if (!KEY) {
  console.error('FAL_KEY missing. It lives in .env (gitignored).')
  process.exit(1)
}

/** What is carved on the globe, in every variant. This is the whole point of the mascot. */
const GLOBE =
  'the sphere is carved in low relief with a small English town seen from above: terraced houses, ' +
  'a hospital block, a church spire, a river with a stone bridge, roads and trees'

const SET_A = [
  {
    n: 1,
    label: 'Marble statue, close 3/4',
    prompt:
      `A classical white marble sculpture, close three-quarter view from the chest up. A powerful ` +
      `bearded Titan bends under the weight of a large stone sphere resting on his shoulder and ` +
      `upper back, both arms raised to brace it. ${GLOBE}, instead of any zodiac or ship. Aged ` +
      `Carrara marble with fine carving detail and soft shadow. Plain pale stone wall behind. ` +
      `Museum photograph, natural daylight, shallow depth of field. No text.`,
  },
  {
    n: 2,
    label: 'Marble statue, full figure',
    prompt:
      `A full-length classical white marble statue of Atlas kneeling on one knee, straining, ` +
      `holding an enormous stone globe above and behind his head with both arms. ${GLOBE}. ` +
      `Carved Carrara marble, crisp chisel detail, centred, isolated on a plain soft white ` +
      `background with a gentle floor shadow. Studio lighting. No text.`,
  },
  {
    n: 3,
    label: 'Engraving / woodcut',
    prompt:
      `A black and white 19th century engraving on cream paper. Atlas, a muscular bearded titan, ` +
      `strides forward carrying a vast globe on his shoulders. ${GLOBE}, engraved in fine ` +
      `cross-hatched line work. Pure line art, dense hatching, no grey wash, no colour. Centred ` +
      `on plain cream paper. No text, no border, no lettering.`,
  },
  {
    n: 4,
    label: 'Flat vector, product palette',
    prompt:
      `A minimal flat vector logo mark on pure white. A simplified geometric figure of a kneeling ` +
      `man seen from the side, drawn as clean thin charcoal-black outlines with no shading, ` +
      `holding a large circle above his shoulders with both arms. Inside the circle, a simple ` +
      `line-drawn town skyline: houses, a hospital, a church spire, a bridge. The circle is filled ` +
      `with a smooth royal-blue to magenta gradient. Absolutely flat, no texture, no shadow. ` +
      `Centred, generous white margin. No text.`,
  },
  {
    n: 5,
    label: 'Marble figure, gradient globe',
    prompt:
      `A white marble statue of a straining bearded Titan, shoulders and raised arms only, ` +
      `holding aloft a large smooth glowing sphere. The sphere is a polished translucent orb lit ` +
      `from within with a royal blue to magenta gradient, and ${GLOBE} etched across it in fine ` +
      `pale lines. The marble figure is cool white and matte. Plain white background, soft studio ` +
      `light. Product photograph. No text.`,
  },
]

/** Shared style floor for set B: the engraved register that sits with our ink-on-white pages. */
const ENGRAVED =
  // The figure is clothed deliberately. A bare classical nude trips FLUX's safety filter, which
  // returns an identical 1024x768 placeholder rather than an error — seven of ten came back that
  // way on the first run. Drapery is also the right call for a health product.
  'The figure wears classical draped cloth wrapped around his waist and over one shoulder, fully ' +
  'covered. Pure black line art, no grey wash, no colour, no gradient. Fine engraved ' +
  'cross-hatching for all shading. Centred, full figure visible, generous margin. No text, no ' +
  'lettering, no border, no signature.'

/**
 * Set B: the pose from candidate 2 (kneeling, isolated, globe carried on the shoulders) in the
 * engraved register of candidate 3, which is the one that sits with the neighbourhood background
 * without dragging a photograph onto the page. Ten variations on technique, angle and strain.
 */
const SET_B = [
  { n: 1, label: 'Fine engraving, kneeling, isolated', extra:
    `A 19th century copperplate engraving of Atlas kneeling on one knee on a plain plinth, straining, both arms raised to hold a great globe on his shoulders. ${GLOBE}. Isolated on plain cream paper with nothing behind him.` },
  { n: 2, label: 'Engraving, armillary meridians', extra:
    `A 19th century engraving of Atlas kneeling on one knee, holding aloft a great globe banded with engraved meridian and equator rings like an armillary sphere. ${GLOBE}, between the rings. Isolated on plain cream paper.` },
  { n: 3, label: 'Bold woodcut', extra:
    `A bold woodcut print of Atlas kneeling on one knee, shouldering an enormous globe. ${GLOBE}. Thick confident carved lines and strong black shapes. Isolated on warm off-white paper.` },
  { n: 4, label: 'Stipple etching', extra:
    `A stipple etching of Atlas kneeling on one knee beneath a vast globe held on his shoulders. ${GLOBE}. Shading built entirely from fine dots and flicks rather than long lines. Isolated on cream paper.` },
  { n: 5, label: 'Architectural pen', extra:
    `A precise architectural pen-and-ink drawing of Atlas kneeling on one knee, holding a large globe above his shoulders. ${GLOBE}, drawn with the crisp measured line of a technical illustrator. Isolated on plain white paper.` },
  { n: 6, label: 'Engraving, low horizon', extra:
    `A 19th century engraving of Atlas kneeling on one knee on a low rise, shouldering a great globe. ${GLOBE}. A faint engraved horizon and a few small rooftops far behind him, kept very light so the figure dominates. Cream paper.` },
  { n: 7, label: 'Engraving, three-quarter back', extra:
    `A 19th century engraving of Atlas kneeling on one knee, turned three-quarters away, a heavy draped cloak covering his back and shoulders, the great globe resting above him. ${GLOBE}. Isolated on cream paper.` },
  { n: 8, label: 'Engraving, deep strain', extra:
    `A dramatic 19th century engraving of Atlas crouched low on both knees, head bowed, buckling under an enormous globe pressing down on his shoulders. ${GLOBE}. Deep shadow in the hatching. Isolated on cream paper.` },
  { n: 9, label: 'Light line, airy', extra:
    `A delicate fine-line engraving of Atlas kneeling on one knee holding a globe aloft, drawn with sparse open hatching and a great deal of white space, light and airy rather than dense. ${GLOBE}, drawn in the lightest possible line. Isolated on warm white paper.` },
  { n: 10, label: 'Engraving, standing braced', extra:
    `A 19th century engraving of Atlas standing with legs braced wide, knees bent, shouldering an enormous globe with both arms raised. ${GLOBE}. Isolated on cream paper.` },
]

async function submit(prompt) {
  const res = await fetch('https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra', {
    method: 'POST',
    headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, aspect_ratio: '3:4', num_images: 1, output_format: 'png' }),
  })
  if (!res.ok) throw new Error(`submit ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function poll(statusUrl, responseUrl) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const s = await fetch(statusUrl, { headers: { Authorization: `Key ${KEY}` } })
    const body = await s.json()
    if (body.status === 'COMPLETED') {
      const r = await fetch(responseUrl, { headers: { Authorization: `Key ${KEY}` } })
      return r.json()
    }
    if (body.status === 'FAILED') throw new Error(`failed: ${JSON.stringify(body).slice(0, 300)}`)
  }
  throw new Error('timed out')
}

async function one(v) {
  console.log(`[${v.n}] ${v.label} — submitting`)
  const queued = await submit(v.prompt)
  const result = await poll(queued.status_url, queued.response_url)
  const url = result?.images?.[0]?.url
  if (!url) throw new Error(`no image: ${JSON.stringify(result).slice(0, 300)}`)
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
  await writeFile(join(OUT, `${PREFIX}-${v.n}.png`), bytes)
  console.log(`[${v.n}] ${v.label} — done (${Math.round(bytes.length / 1024)} KB)`)
}

const setName = process.argv.includes('--set')
  ? process.argv[process.argv.indexOf('--set') + 1]
  : 'a'
const PREFIX = setName === 'b' ? 'atlas-b' : 'atlas'
const VARIANTS =
  setName === 'b'
    ? SET_B.map((v) => ({ n: v.n, label: v.label, prompt: `${v.extra} ${ENGRAVED}` }))
    : SET_A

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1].split(',').map(Number)
  : null
const todo = only ? VARIANTS.filter((v) => only.includes(v.n)) : VARIANTS

await mkdir(OUT, { recursive: true })
const results = await Promise.allSettled(todo.map(one))
results.forEach((r, i) => {
  if (r.status === 'rejected') console.error(`[${todo[i].n}] FAILED: ${r.reason?.message ?? r.reason}`)
})

// Contact sheet, so all five can be judged side by side rather than one at a time.
const cards = VARIANTS.map(
  (v) =>
    `<figure><img src="${PREFIX}-${v.n}.png" alt=""><figcaption>${v.n} &middot; ${v.label}</figcaption></figure>`,
).join('')
await writeFile(
  join(OUT, setName === 'b' ? 'index-b.html' : 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Atlas mascot candidates</title>
<style>
body{margin:0;padding:32px;background:#fafafa;font:14px/1.5 -apple-system,system-ui,sans-serif;color:#0a0a0a}
h1{font-size:16px;margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
figure{margin:0;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden}
img{display:block;width:100%;height:auto}
figcaption{padding:10px 12px;font-size:12px;color:#737373;border-top:1px solid #e5e5e5}
</style>
<h1>Atlas mascot candidates &mdash; the globe carries our neighbourhood</h1>
<div class="grid">${cards}</div>`,
)
console.log(`\ncontact sheet: ${join(OUT, setName === 'b' ? 'index-b.html' : 'index.html')}`)

/**
 * Loading a policy, from wherever it came from.
 *
 * A document the user dropped in and one off the shelf differ only in where the bytes are; from
 * the read onwards they must be indistinguishable, so both go through here rather than through
 * two copies of the same flow.
 */

import { navigate } from './router'
import { setRun } from './store'

interface ExtractPayload {
  document?: { filename?: string }
  rows?: Record<string, unknown>[]
  rejected?: { text: string; span: string; reason: string }[]
  truncated?: boolean
  charsRead?: number
  error?: string
}

function applyExtraction(payload: ExtractPayload, filename: string, sizeBytes: number) {
  setRun({
    document: { filename: payload.document?.filename ?? filename, sizeBytes },
    commitments: (payload.rows ?? []).map((r, i) => ({ id: `c${i + 1}`, ...r })) as never,
    rejected: payload.rejected ?? [],
    truncated: payload.truncated ? { charsRead: payload.charsRead ?? 0 } : null,
    extracted: true,
  })
  navigate('/parameters')
}

async function readJson(response: Response): Promise<ExtractPayload> {
  const payload = (await response.json()) as ExtractPayload
  if (!response.ok) throw new Error(payload?.error ?? `Extraction failed (${response.status})`)
  return payload
}

/** A document already on the server. It never travels to the browser and back. */
export async function loadCatalogued(id: string, title: string): Promise<void> {
  setRun({ document: { filename: title, sizeBytes: 0 } })
  const response = await fetch(`/api/documents/${id}/extract`, { method: 'POST' })
  applyExtraction(await readJson(response), title, 0)
}

/** A file the user chose or dropped. */
export async function loadFile(file: File, notes: string): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Chunked: String.fromCharCode(...bytes) blows the call stack on anything board-paper sized.
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, contentBase64: btoa(binary), notes }),
  })
  applyExtraction(await readJson(response), file.name, file.size)
}

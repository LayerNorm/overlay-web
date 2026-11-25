import type { MonidPrice } from '@/server/integrations/monid/client'

/** How run_api shapes Monid output for the model: saved files, previews of large output, and price text. */

export type SavedApiFile = { fileId: string; url: string; name: string; mimeType: string; sizeBytes: number }

/** Output larger than this (as JSON) is saved to Files whole, and a preview is returned. */
export const MAX_INLINE_OUTPUT_CHARS = 40_000

// ── Output handling ──────────────────────────────────────────────────────────

export type Artifact = { download_link: string; content_type?: string; link_expires_at?: string }

function isArtifact(value: unknown): value is Artifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.download_link === 'string'
    && (typeof record.content_type === 'string' || typeof record.link_expires_at === 'string')
}

/** Replaces each file Monid returned with the Overlay file it was saved as, walking the output depth-first. */
export async function replaceArtifacts(
  value: unknown,
  save: (artifact: Artifact, index: number) => Promise<SavedApiFile | null>,
): Promise<unknown> {
  let index = 0
  const visit = async (node: unknown, depth: number): Promise<unknown> => {
    if (depth > 12) return node
    if (isArtifact(node)) {
      const saved = await save(node, index++)
      if (!saved) return { ...node, savedToFiles: false }
      return { file: saved }
    }
    if (Array.isArray(node)) {
      const out: unknown[] = []
      for (const item of node) out.push(await visit(item, depth + 1))
      return out
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node)) out[k] = await visit(v, depth + 1)
      return out
    }
    return node
  }
  return await visit(value, 0)
}

export function previewOutput(output: unknown): unknown {
  if (Array.isArray(output)) {
    const items: unknown[] = []
    let size = 2
    for (const item of output) {
      const text = JSON.stringify(item)
      if (size + text.length > MAX_INLINE_OUTPUT_CHARS) break
      items.push(item)
      size += text.length + 1
    }
    return { firstItems: items, totalItems: output.length }
  }
  if (output && typeof output === 'object') {
    // A single big array inside an object (results, items, data…) is the usual shape.
    const entries = Object.entries(output)
    const arrayEntry = entries.find(([, v]) => Array.isArray(v) && JSON.stringify(v).length > MAX_INLINE_OUTPUT_CHARS / 2)
    if (arrayEntry) {
      const rest = Object.fromEntries(entries.filter(([k]) => k !== arrayEntry[0]))
      const restText = JSON.stringify(rest)
      if (restText.length < MAX_INLINE_OUTPUT_CHARS / 4) {
        return { ...rest, [arrayEntry[0]]: previewOutput(arrayEntry[1]) }
      }
    }
  }
  return { truncatedJson: JSON.stringify(output).slice(0, MAX_INLINE_OUTPUT_CHARS) }
}

const EXTENSIONS: Record<string, string> = {
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  'model/obj': 'obj',
  'model/stl': 'stl',
  'model/vnd.usdz+zip': 'usdz',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/zip': 'zip',
}

export function artifactFileName(link: string, mimeType: string, fallback: string): string {
  let base = ''
  try {
    base = decodeURIComponent(new URL(link).pathname.split('/').pop() ?? '')
  } catch (_error) {
    base = ''
  }
  base = base.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120)
  if (base && /\.[A-Za-z0-9]{2,5}$/.test(base)) return base
  const extension = EXTENSIONS[mimeType]
  return extension ? `${fallback}.${extension}` : fallback
}

export function fileUrl(fileId: string): string {
  return `/api/v1/files/${encodeURIComponent(fileId)}/content`
}

// ── Pricing text ─────────────────────────────────────────────────────────────

const UNIT_WORDS: Record<string, string> = {
  PER_CALL: 'per call',
  PER_RESULT: 'per result',
}

/** A one-line price for the model, e.g. "$0.03 per call" or "from $0.30 (varies by texture_resolution)". */
export function describePrice(price: MonidPrice | undefined): string | undefined {
  if (!price) return undefined
  const amount = price.amount?.value
  if (typeof amount !== 'number') return price.type
  const dollars = formatDollars(amount)
  if (amount === 0) return 'free'
  const varies = price.selectors?.length
    ? ` (varies by ${price.selectors.map((selector) => selector.key ?? selector.label).filter(Boolean).join(', ')})`
    : ''
  if (UNIT_WORDS[price.type]) return `${dollars} ${UNIT_WORDS[price.type]}${varies}`
  if (price.unit) return `${dollars} per ${price.unit}${varies}`
  return `from ${dollars}${varies}`
}

/** Two decimals, more only when the price needs them: $1.50, $0.30, $0.015, $0.0004. */
function formatDollars(value: number): string {
  if (value < 0.01) return `$${Number(value.toPrecision(2))}`
  const [whole, fraction = ''] = value.toFixed(4).replace(/0+$/, '').split('.')
  return `$${whole}.${fraction.padEnd(2, '0')}`
}

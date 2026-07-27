import 'server-only'

import type { ExternalKnowledgeSourceKind } from '@overlay/app-core'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'
import { extractReadableText } from '@/shared/knowledge/html-text'
import { KnowledgeBaseServiceError } from './KnowledgeBaseService'

export type FetchedKnowledgeSource = {
  content: string
  mimeType: string
  title?: string
  /** Canonical reference to store as provenance. */
  ref: string
  label?: string
  originUpdatedAt?: number
}

export interface KnowledgeSourceFetcher {
  readonly kind: ExternalKnowledgeSourceKind
  fetch(args: { ref: string; userId: string }): Promise<FetchedKnowledgeSource>
}

const MAX_FETCH_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'text/markdown',
  'application/xhtml+xml',
  'application/json',
]

/**
 * Fetches a public web page and reduces it to readable text.
 *
 * Reuses the same SSRF validation as outbound webhooks, so a knowledge source
 * cannot be used to reach internal services or cloud metadata endpoints.
 */
export class UrlKnowledgeSourceFetcher implements KnowledgeSourceFetcher {
  readonly kind = 'url' as const

  constructor(private readonly options: { allowLocalDev?: boolean } = {}) {}

  async fetch({ ref }: { ref: string; userId: string }): Promise<FetchedKnowledgeSource> {
    const validated = await validatePublicNetworkUrl(ref, {
      allowLocalDev: this.options.allowLocalDev === true,
    })
    if (!validated.ok) throw new KnowledgeBaseServiceError(validated.error, 400)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(validated.url, {
        headers: { accept: ALLOWED_CONTENT_TYPES.join(', ') },
        redirect: 'error',
        signal: controller.signal,
      })
    } catch (error) {
      throw new KnowledgeBaseServiceError(
        `Could not fetch the source URL: ${error instanceof Error ? error.message : 'request failed'}`,
        502,
      )
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw new KnowledgeBaseServiceError(
        `Source URL responded with ${response.status}`,
        response.status >= 500 ? 502 : 400,
      )
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    const baseType = contentType.split(';')[0]?.trim() ?? ''
    if (baseType && !ALLOWED_CONTENT_TYPES.includes(baseType)) {
      throw new KnowledgeBaseServiceError(
        `Unsupported source content type: ${baseType}. Upload the file instead.`,
        415,
      )
    }
    const declaredLength = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FETCH_BYTES) {
      throw new KnowledgeBaseServiceError('Source URL exceeds the 8 MB fetch limit', 413)
    }
    const raw = await readBounded(response)
    const isHtml = baseType === 'text/html' || baseType === 'application/xhtml+xml'
    const extracted = isHtml ? extractReadableText(raw) : { text: raw.trim(), title: undefined }
    if (!extracted.text) {
      throw new KnowledgeBaseServiceError('No readable text was found at the source URL', 422)
    }
    const lastModified = response.headers.get('last-modified')
    const originUpdatedAt = lastModified ? Date.parse(lastModified) : Number.NaN
    return {
      content: extracted.text,
      mimeType: baseType || 'text/plain',
      title: extracted.title,
      ref: validated.url.toString(),
      label: validated.url.hostname,
      originUpdatedAt: Number.isFinite(originUpdatedAt) ? originUpdatedAt : undefined,
    }
  }
}

/** Reads a response body while enforcing the byte ceiling on unknown lengths. */
async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return (await response.text()).slice(0, MAX_FETCH_BYTES)
  const decoder = new TextDecoder()
  const parts: string[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel().catch((_error) => {})
      throw new KnowledgeBaseServiceError('Source URL exceeds the 8 MB fetch limit', 413)
    }
    parts.push(decoder.decode(value, { stream: true }))
  }
  parts.push(decoder.decode())
  return parts.join('')
}

export class KnowledgeSourceFetcherRegistry {
  private readonly byKind = new Map<ExternalKnowledgeSourceKind, KnowledgeSourceFetcher>()

  constructor(fetchers: KnowledgeSourceFetcher[]) {
    for (const fetcher of fetchers) this.byKind.set(fetcher.kind, fetcher)
  }

  /** Throws a clear 501 rather than silently ingesting nothing. */
  require(kind: ExternalKnowledgeSourceKind): KnowledgeSourceFetcher {
    const fetcher = this.byKind.get(kind)
    if (!fetcher) {
      throw new KnowledgeBaseServiceError(
        `Knowledge sources of kind "${kind}" are not enabled in this deployment`,
        501,
      )
    }
    return fetcher
  }

  supports(kind: ExternalKnowledgeSourceKind): boolean {
    return this.byKind.has(kind)
  }
}

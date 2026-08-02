import 'server-only'

import type { ExternalKnowledgeSourceKind } from '@overlay/app-core'
import type {
  IntegrationExecutionRequest,
  IntegrationExecutionResult,
} from '@/server/integrations/contracts'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'
import {
  parseConnectedKnowledgeSourceRef,
  type ConnectedKnowledgeSourceRecipe,
} from '@/shared/knowledge/external-source-ref'
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

type ConnectedSourceRecipe = {
  kind: 'connector' | 'drive'
  label: string
  mimeType: string
  toolId: string
  args(resourceId: string): Record<string, unknown>
}

const CONNECTED_SOURCE_RECIPES: Record<ConnectedKnowledgeSourceRecipe, ConnectedSourceRecipe> = {
  'google-drive-file': {
    kind: 'drive',
    label: 'Google Drive',
    mimeType: 'text/plain',
    toolId: 'GOOGLEDRIVE_PARSE_FILE',
    args: (fileId) => ({ file_id: fileId }),
  },
  'dropbox-file': {
    kind: 'drive',
    label: 'Dropbox',
    mimeType: 'text/plain',
    toolId: 'DROPBOX_READ_FILE',
    args: (path) => ({ path }),
  },
  'notion-page': {
    kind: 'connector',
    label: 'Notion',
    mimeType: 'text/markdown',
    toolId: 'NOTION_GET_PAGE_MARKDOWN',
    args: (pageId) => ({ page_id: pageId }),
  },
  'confluence-page': {
    kind: 'connector',
    label: 'Confluence',
    mimeType: 'text/plain',
    toolId: 'CONFLUENCE_GET_PAGE_BY_ID',
    args: (id) => ({ id }),
  },
}

/**
 * Fetches an explicitly supported read-only source through the configured
 * integration provider. The reference selects a recipe, never an arbitrary
 * tool ID, so this path cannot be turned into a general connector executor.
 */
export class IntegrationKnowledgeSourceFetcher implements KnowledgeSourceFetcher {
  constructor(
    readonly kind: 'connector' | 'drive',
    private readonly execute: (
      request: IntegrationExecutionRequest,
    ) => Promise<IntegrationExecutionResult>,
  ) {}

  async fetch({ ref, userId }: { ref: string; userId: string }): Promise<FetchedKnowledgeSource> {
    const parsed = parseConnectedKnowledgeSourceRef(ref)
    if (!parsed) throw new KnowledgeBaseServiceError('Invalid connected source reference', 400)
    const recipe = CONNECTED_SOURCE_RECIPES[parsed.recipe]
    if (recipe.kind !== this.kind) {
      throw new KnowledgeBaseServiceError(
        `Connected source recipe "${parsed.recipe}" does not match kind "${this.kind}"`,
        400,
      )
    }
    const result = await this.execute({
      args: recipe.args(parsed.resourceId),
      toolId: recipe.toolId,
      userId,
    })
    if (result.status !== 'completed') {
      throw new KnowledgeBaseServiceError(
        result.error || `Could not read the ${recipe.label} source`,
        502,
      )
    }
    const content = extractIntegrationText(result.output)
    if (!content) {
      throw new KnowledgeBaseServiceError(
        `No readable text was returned by ${recipe.label}`,
        422,
      )
    }
    if (new TextEncoder().encode(content).byteLength > MAX_FETCH_BYTES) {
      throw new KnowledgeBaseServiceError('Connected source exceeds the 8 MB fetch limit', 413)
    }
    return {
      content,
      label: recipe.label,
      mimeType: recipe.mimeType,
      ref,
    }
  }
}

function extractIntegrationText(output: unknown): string {
  if (typeof output === 'string') return output.trim()
  if (!output || typeof output !== 'object' || Array.isArray(output)) return ''
  const record = output as Record<string, unknown>
  for (const key of ['markdown', 'text', 'content', 'body', 'plain_text', 'plainText']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const data = record.data
  if (data !== undefined && data !== output) return extractIntegrationText(data)
  return ''
}

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

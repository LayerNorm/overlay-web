import 'server-only'

import { callInternalApi, callInternalApiGet, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'

/**
 * Knowledge-base tools.
 *
 * These exist because `search_knowledge` and `search_in_files` are account-wide:
 * they search every file and memory a user owns. When a user references a
 * specific knowledge base, answering from those tools silently crosses the
 * knowledge base's boundary and mixes untrusted material into a grounded answer.
 *
 * Every call goes through the existing `/api/v1/knowledge-bases/*` routes, so the
 * authorization boundary, source enable/disable state, and `ready`-only filtering
 * are enforced server-side rather than restated here.
 */

type SourceSummary = {
  membership?: { enabled?: boolean }
  source?: {
    id?: string
    title?: string
    kind?: string
    status?: string
    mimeType?: string
  }
}

function failed(message: string) {
  return { success: false as const, error: message }
}

/** Resolves the base to act on: the explicit argument, else a single active base. */
function resolveKnowledgeBaseId(
  options: OverlayToolsOptions,
  explicit: string | undefined,
): { ok: true; knowledgeBaseId: string } | { ok: false; error: string } {
  const trimmed = explicit?.trim()
  if (trimmed) return { ok: true, knowledgeBaseId: trimmed }
  const active = options.activeKnowledgeBaseIds ?? []
  if (active.length === 1) return { ok: true, knowledgeBaseId: active[0]! }
  if (active.length === 0) {
    return {
      ok: false,
      error: 'knowledgeBaseId is required. Call list_knowledge_bases first to find it.',
    }
  }
  return {
    ok: false,
    error: `Several knowledge bases are active (${active.join(', ')}). `
      + 'Pass the specific knowledgeBaseId you mean.',
  }
}

/** Knowledge bases the user can read, so the model can resolve a name to an id. */
export async function executeListKnowledgeBases(options: OverlayToolsOptions) {
  try {
    const res = await callInternalApiGet(
      '/api/v1/knowledge-bases',
      options.accessToken,
      options.baseUrl,
      options.forwardCookie,
      options.serverSecret,
      options.userId,
    )
    if (!res.ok) return failed(`Could not list knowledge bases (${res.status}).`)
    const body = await res.json() as { knowledgeBases?: Array<Record<string, unknown>> }
    const knowledgeBases = (body.knowledgeBases ?? []).map((base) => ({
      knowledgeBaseId: base.id,
      title: base.title,
      description: base.description,
      kind: base.kind,
    }))
    return { success: true as const, knowledgeBases, count: knowledgeBases.length }
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'Failed to list knowledge bases')
  }
}

/**
 * Full source manifest for one knowledge base.
 *
 * This is the tool to use for "what is in X" questions. Semantic search cannot
 * answer them: the question is about the corpus itself, not its content, so
 * embedding it returns arbitrary passages.
 */
export async function executeListKnowledgeBaseSources(
  options: OverlayToolsOptions,
  input: { knowledgeBaseId?: string },
) {
  const resolved = resolveKnowledgeBaseId(options, input.knowledgeBaseId)
  if (!resolved.ok) return failed(resolved.error)
  try {
    const res = await callInternalApiGet(
      `/api/v1/knowledge-bases/${encodeURIComponent(resolved.knowledgeBaseId)}/sources`,
      options.accessToken,
      options.baseUrl,
      options.forwardCookie,
      options.serverSecret,
      options.userId,
    )
    if (res.status === 404) return failed('Knowledge base not found or not accessible.')
    if (!res.ok) return failed(`Could not list knowledge-base sources (${res.status}).`)
    const body = await res.json() as { sources?: SourceSummary[] }
    const sources = (body.sources ?? []).map((entry) => ({
      sourceId: entry.source?.id,
      title: entry.source?.title,
      kind: entry.source?.kind,
      status: entry.source?.status,
      mimeType: entry.source?.mimeType,
      enabled: entry.membership?.enabled !== false,
    }))
    const retrievable = sources.filter((s) => s.enabled && s.status === 'ready')
    return {
      success: true as const,
      knowledgeBaseId: resolved.knowledgeBaseId,
      sources,
      count: sources.length,
      retrievableCount: retrievable.length,
      note: 'This is the complete and authoritative list of sources in this knowledge base. '
        + 'Do not add files or notes from elsewhere in the account when describing it.',
    }
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'Failed to list sources')
  }
}

/** Hybrid retrieval restricted to one knowledge base, returning citable passages. */
export async function executeSearchKnowledgeBase(
  options: OverlayToolsOptions,
  input: { knowledgeBaseId?: string; query: string; limit?: number },
) {
  const resolved = resolveKnowledgeBaseId(options, input.knowledgeBaseId)
  if (!resolved.ok) return failed(resolved.error)
  const query = input.query?.trim()
  if (!query) return failed('query is required.')
  try {
    const res = await callInternalApi(
      `/api/v1/knowledge-bases/${encodeURIComponent(resolved.knowledgeBaseId)}/search`,
      {
        ...toolAuthBody(options),
        query,
        limit: input.limit,
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (res.status === 404) return failed('Knowledge base not found or not accessible.')
    if (!res.ok) return failed(`Knowledge-base search failed (${res.status}).`)
    const body = await res.json() as {
      chunks?: Array<{ text?: string; title?: string; knowledgeSourceId?: string; chunkIndex?: number }>
      citations?: Array<Record<string, unknown>>
    }
    const passages = (body.chunks ?? []).map((chunk) => ({
      sourceId: chunk.knowledgeSourceId,
      title: chunk.title,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
    }))
    return {
      success: true as const,
      knowledgeBaseId: resolved.knowledgeBaseId,
      passages,
      citations: body.citations ?? [],
      count: passages.length,
      note: passages.length === 0
        ? 'No passage in this knowledge base matched. Say so rather than answering from other files.'
        : 'These passages are the only trusted material for this knowledge base. Cite them.',
    }
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'Knowledge-base search failed')
  }
}

/**
 * Reads a source's extracted text directly, for walkthrough and summarization
 * questions where ranked snippets are the wrong shape of answer.
 */
export async function executeReadKnowledgeSource(
  options: OverlayToolsOptions,
  input: { knowledgeBaseId?: string; sourceId: string; limit?: number },
) {
  const resolved = resolveKnowledgeBaseId(options, input.knowledgeBaseId)
  if (!resolved.ok) return failed(resolved.error)
  const sourceId = input.sourceId?.trim()
  if (!sourceId) return failed('sourceId is required.')
  try {
    const params = new URLSearchParams({ sourceId })
    if (input.limit) params.set('previewLimit', String(Math.min(20_000, Math.max(200, input.limit))))
    const res = await callInternalApiGet(
      `/api/v1/knowledge-bases/${encodeURIComponent(resolved.knowledgeBaseId)}/diagnostics?${params}`,
      options.accessToken,
      options.baseUrl,
      options.forwardCookie,
      options.serverSecret,
      options.userId,
    )
    if (res.status === 404) return failed('Knowledge source not found in this knowledge base.')
    if (res.status === 409) {
      return failed('This source has no extracted text yet. It may still be processing.')
    }
    if (!res.ok) return failed(`Could not read knowledge source (${res.status}).`)
    const body = await res.json() as {
      preview?: { text?: string; totalChars?: number; truncated?: boolean }
    }
    if (!body.preview) return failed('This source has no extracted text yet.')
    return {
      success: true as const,
      knowledgeBaseId: resolved.knowledgeBaseId,
      sourceId,
      text: body.preview.text ?? '',
      totalChars: body.preview.totalChars ?? 0,
      truncated: body.preview.truncated === true,
    }
  } catch (error) {
    return failed(error instanceof Error ? error.message : 'Failed to read knowledge source')
  }
}

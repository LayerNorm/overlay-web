import 'server-only'

import { logger } from '@/server/observability/logger'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ToolSet } from 'ai'
import { getServerProviderKey } from '@/server/ai/provider-keys'

type JsonRecord = Record<string, unknown>

const REMOVED_COMPOSIO_TOOLS = new Set([
  'COMPOSIO_REMOTE_BASH_TOOL',
  'COMPOSIO_REMOTE_WORKBENCH',
])

async function getComposioApiKey(accessToken?: string): Promise<string | null> {
  void accessToken
  return await getServerProviderKey('composio')
}

function resolveComposioSessionIdFactory() {
  let composioSessionId: string | null = null

  function getProvidedSessionId(toolName: string, args: JsonRecord): string | undefined {
    if (toolName === 'COMPOSIO_SEARCH_TOOLS') {
      const session = args.session
      if (session && typeof session === 'object' && !Array.isArray(session)) {
        const id = (session as JsonRecord).id
        if (typeof id === 'string' && id.trim()) {
          return id.trim()
        }
      }
      return undefined
    }

    const sessionId = args.session_id
    return typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined
  }

  function resolve(toolName: string, args: JsonRecord): string {
    const provided = getProvidedSessionId(toolName, args)
    const fallbackSessionId = `overlay-web-${Date.now()}`

    if (!composioSessionId) {
      composioSessionId = provided || fallbackSessionId
    } else if (provided && provided !== composioSessionId) {
      logger.warn(
        `[Composio] Overriding mismatched session_id for ${toolName}: ${provided} -> ${composioSessionId}`
      )
    }

    return composioSessionId
  }

  return { resolve }
}

function withConsistentComposioSession(
  toolName: string,
  args: JsonRecord,
  resolver: (toolName: string, args: JsonRecord) => string,
): JsonRecord {
  const sessionId = resolver(toolName, args)
  const normalized: JsonRecord = { ...args }

  if (toolName === 'COMPOSIO_SEARCH_TOOLS') {
    const existingSession =
      normalized.session &&
      typeof normalized.session === 'object' &&
      !Array.isArray(normalized.session)
        ? (normalized.session as JsonRecord)
        : {}

    normalized.session = {
      ...existingSession,
      id: sessionId,
    }

    if (normalized.session && typeof normalized.session === 'object') {
      delete (normalized.session as JsonRecord).generate_id
    }

    return normalized
  }

  normalized.session_id = sessionId
  return normalized
}

async function loadComposioModules(): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Composio: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  VercelProvider: any
}> {
  try {
    const [coreModule, vercelModule] = await Promise.all([
      import('@composio/core'),
      import('@composio/vercel'),
    ])

    return {
      Composio: coreModule.Composio,
      VercelProvider: vercelModule.VercelProvider,
    }
  } catch (_error) {
    const coreUrl = pathToFileURL(
      path.resolve(process.cwd(), '../overlay-desktop/node_modules/@composio/core/dist/index.mjs')
    ).href
    const vercelUrl = pathToFileURL(
      path.resolve(process.cwd(), '../overlay-desktop/node_modules/@composio/vercel/dist/index.mjs')
    ).href

    try {
      const coreModule = await import(/* webpackIgnore: true */ coreUrl)
      const vercelModule = await import(/* webpackIgnore: true */ vercelUrl)

      return {
        Composio: coreModule.Composio,
        VercelProvider: vercelModule.VercelProvider,
      }
    } catch (error) {
      throw new Error(
        `Composio packages are unavailable for overlay-landing: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

/**
 * Cache of resolved Composio tool sets, keyed by userId. The first request per user
 * per process pays the ~700–1000ms init cost; subsequent requests inside TTL are
 * basically free. In-flight promises are stored so concurrent requests coalesce.
 */
type ComposioCacheEntry = {
  tools: ToolSet
  createdAt: number
}
const composioCache = new Map<string, ComposioCacheEntry>()
const composioInFlight = new Map<string, Promise<ToolSet>>()
const COMPOSIO_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

async function buildBrowserUnifiedTools(args: {
  userId: string
  accessToken?: string
}): Promise<ToolSet> {
  const apiKey = await getComposioApiKey(args.accessToken)
  if (!apiKey) {
    throw new Error('COMPOSIO_API_KEY is not configured. Set it in Convex or the server environment.')
  }

  const { Composio, VercelProvider } = await loadComposioModules()
  const composio = new Composio({ apiKey, provider: new VercelProvider() })
  const session = await composio.create(args.userId)
  const rawTools = (await session.tools()) as ToolSet
  const wrappedTools = {} as ToolSet
  const { resolve } = resolveComposioSessionIdFactory()

  for (const [toolName, toolDef] of Object.entries(rawTools)) {
    if (REMOVED_COMPOSIO_TOOLS.has(toolName)) {
      continue
    }

    if (!toolDef || typeof toolDef !== 'object') {
      continue
    }

    const originalExecute = (toolDef as { execute?: unknown }).execute
    if (typeof originalExecute !== 'function') {
      wrappedTools[toolName] = toolDef
      continue
    }

    wrappedTools[toolName] = {
      ...toolDef,
      execute: async (input: JsonRecord, extra: unknown) => {
        const normalizedInput = withConsistentComposioSession(toolName, input ?? {}, resolve)
        return (originalExecute as (input: JsonRecord, extra: unknown) => Promise<unknown>)(
          normalizedInput,
          extra
        )
      },
    }
  }

  return wrappedTools
}

export async function createBrowserUnifiedTools(args: {
  userId: string
  accessToken?: string
}): Promise<ToolSet> {
  const now = Date.now()
  const cached = composioCache.get(args.userId)
  if (cached && now - cached.createdAt < COMPOSIO_CACHE_TTL_MS) {
    return cached.tools
  }

  const existing = composioInFlight.get(args.userId)
  if (existing) return existing

  const promise = (async () => {
    try {
      const tools = await buildBrowserUnifiedTools(args)
      composioCache.set(args.userId, { tools, createdAt: Date.now() })
      return tools
    } finally {
      composioInFlight.delete(args.userId)
    }
  })()
  composioInFlight.set(args.userId, promise)
  return promise
}

/** Fire-and-forget pre-warm. Errors are swallowed — the real call will surface them. */
export function prewarmBrowserUnifiedTools(args: {
  userId: string
  accessToken?: string
}): void {
  const cached = composioCache.get(args.userId)
  if (cached && Date.now() - cached.createdAt < COMPOSIO_CACHE_TTL_MS) return
  if (composioInFlight.has(args.userId)) return
  void createBrowserUnifiedTools(args).catch((_error) => {
    // swallow — next real call will throw and surface properly
  })
}

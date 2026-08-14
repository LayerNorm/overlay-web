import { NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

/**
 * Indexed mention search via Convex search indexes.
 * Returns bounded top-K results per category, replacing the previous
 * scan-and-filter approach that fetched all items client-side.
 */
export async function GET(request: Request, context: AppApiRouteContext) {
  const serverContext = getOverlayServerContext()
  const url = new URL(request.url)
  const query = url.searchParams.get('q') ?? ''

  if (!query.trim()) {
    return NextResponse.json({
      conversations: [],
      files: [],
      notes: [],
      automations: [],
      skills: [],
      mcpServers: [],
    })
  }

  // Only use Convex search when the provider supports it.
  if (serverContext.appDataCapabilities.provider !== 'convex') {
    return NextResponse.json({
      conversations: [],
      files: [],
      notes: [],
      automations: [],
      skills: [],
      mcpServers: [],
    })
  }

  const result = await convex.query<{
    conversations: Array<{ _id: string; title: string; _creationTime: number }>
    files: Array<{ _id: string; name: string; kind?: string; mimeType?: string }>
    notes: Array<{ _id: string; title: string }>
    automations: Array<{ _id: string; name?: string; description?: string }>
    skills: Array<{ _id: string; name: string; description: string }>
    mcpServers: Array<{ _id: string; name: string; description?: string }>
  }>('search/mentions:searchMentions', {
    userId: context.auth.userId,
    query,
    serverSecret: getInternalApiSecret(),
    workspaceId: context.workspace.workspace.id,
  }, { throwOnError: false, timeoutMs: 5_000, suppressNetworkConsoleError: true })

  return NextResponse.json(result ?? {
    conversations: [],
    files: [],
    notes: [],
    automations: [],
    skills: [],
    mcpServers: [],
  })
}

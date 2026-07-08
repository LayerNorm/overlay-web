import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { refreshMcpServerToolCatalog } from '@/server/tools/mcp-tools'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'

async function validateMcpUrl(url: unknown): Promise<string | null> {
  const result = await validatePublicNetworkUrl(url, { allowLocalDev: true, requireHttps: true })
  return result.ok ? null : result.error
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const mcps = await convex.query('integrations/mcpServers:list', {
      userId: auth.userId,
      serverSecret,
    })
    return NextResponse.json(mcps || [])
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to fetch MCP servers' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json()
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const {
      name,
      description,
      transport,
      url,
      enabled,
      authType,
      authConfig,
      timeoutMs,
    } = body as Record<string, unknown>
    if (!name || !transport || !url) {
      return NextResponse.json(
        { error: 'name, transport, and url are required' },
        { status: 400 }
      )
    }

    const urlError = await validateMcpUrl(url)
    if (urlError) {
      return NextResponse.json({ error: urlError }, { status: 400 })
    }

    const mcpServerId = await convex.mutation<string>('integrations/mcpServers:create', {
      userId: auth.userId,
      serverSecret,
      name,
      description: description || '',
      transport,
      url,
      enabled: enabled !== false,
      authType: authType || 'none',
      authConfig: authConfig || undefined,
      timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
    })
    if (!mcpServerId) {
      return NextResponse.json({ error: 'Failed to create MCP server' }, { status: 500 })
    }
    if (enabled !== false) {
      void refreshMcpServerToolCatalog({
        mcpServerId,
        userId: auth.userId,
        serverSecret,
      }).catch((_error) => undefined)
    }
    return NextResponse.json({ id: mcpServerId })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to create MCP server' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = await request.json()
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const {
      mcpServerId,
      name,
      description,
      transport,
      url,
      enabled,
      authType,
      authConfig,
      timeoutMs,
    } = body as Record<string, unknown>
    if (!mcpServerId) {
      return NextResponse.json({ error: 'mcpServerId required' }, { status: 400 })
    }

    if (url !== undefined) {
      const urlError = await validateMcpUrl(url)
      if (urlError) {
        return NextResponse.json({ error: urlError }, { status: 400 })
      }
    }

    await convex.mutation('integrations/mcpServers:update', {
      mcpServerId,
      userId: auth.userId,
      serverSecret,
      name,
      description,
      transport,
      url,
      enabled,
      authType,
      authConfig,
      timeoutMs,
    })
    if (enabled !== false) {
      void refreshMcpServerToolCatalog({
        mcpServerId: String(mcpServerId),
        userId: auth.userId,
        serverSecret,
      }).catch((_error) => undefined)
    }
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to update MCP server' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const { auth } = context
    const serverSecret = getInternalApiSecret()

    const mcpServerId = request.nextUrl.searchParams.get('mcpServerId')
    if (!mcpServerId) {
      return NextResponse.json({ error: 'mcpServerId required' }, { status: 400 })
    }

    await convex.mutation('integrations/mcpServers:remove', {
      mcpServerId,
      userId: auth.userId,
      serverSecret,
    })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to delete MCP server' }, { status: 500 })
  }
}

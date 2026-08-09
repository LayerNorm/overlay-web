import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { McpCredentialConfigurationError, type McpOAuthSurface } from '@/server/extensions'
import { logger } from '@/server/observability/logger'
import { getBaseUrl } from '@/server/web/app-url'
import {
  disconnectMcpOAuth,
  McpOAuthAlreadyAuthorizedError,
  startMcpOAuth,
} from '@/server/tools/mcp-oauth'

function repository() {
  return getOverlayServerContext().appData.repositories.mcpServers
}

/**
 * `returnTo` decides where the browser lands after the provider redirects back. Only same-origin
 * relative paths are allowed, so a caller cannot turn Connect into an open redirect.
 */
function safeReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return undefined
  return trimmed
}

function parseSurface(value: unknown): McpOAuthSurface {
  return value === 'desktop' ? 'desktop' : 'web'
}

/** Begin an authorization-code flow and hand the browser the provider's authorization URL. */
export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = Object.keys(context.parsedJson).length > 0
      ? context.parsedJson
      : await request.json()
    const mcpServerId = typeof body.mcpServerId === 'string' ? body.mcpServerId.trim() : ''
    if (!mcpServerId) {
      return NextResponse.json({ error: 'mcpServerId is required' }, { status: 400 })
    }

    const server = await repository().get({ mcpServerId, userId: context.auth.userId })
    if (!server) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
    if (server.authType !== 'oauth') {
      return NextResponse.json(
        { error: 'This MCP server is not configured to use OAuth' },
        { status: 400 },
      )
    }

    const { authorizationUrl } = await startMcpOAuth({
      baseUrl: getBaseUrl(),
      returnTo: safeReturnTo(body.returnTo),
      // Binding the flow to the caller's session closes cross-account token injection on web.
      sessionBinding: context.auth.userId,
      server,
      surface: parseSurface(body.surface),
      ...(typeof body.scope === 'string' && body.scope.trim() ? { scope: body.scope.trim() } : {}),
    })

    return NextResponse.json({ redirectUrl: authorizationUrl })
  } catch (error) {
    if (error instanceof McpOAuthAlreadyAuthorizedError) {
      return NextResponse.json({ alreadyConnected: true })
    }
    if (error instanceof McpCredentialConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    logger.warn('[MCP] OAuth start failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return NextResponse.json(
      {
        error: error instanceof Error
          ? `Could not start OAuth for this server: ${error.message}`
          : 'Could not start OAuth for this server',
      },
      { status: 502 },
    )
  }
}

/** Forget stored tokens and any registered client for this server. */
export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const mcpServerId = request.nextUrl.searchParams.get('mcpServerId')?.trim()
    if (!mcpServerId) {
      return NextResponse.json({ error: 'mcpServerId is required' }, { status: 400 })
    }
    const server = await repository().get({ mcpServerId, userId: context.auth.userId })
    if (!server) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })

    await disconnectMcpOAuth({ server })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to disconnect this MCP server' }, { status: 500 })
  }
}

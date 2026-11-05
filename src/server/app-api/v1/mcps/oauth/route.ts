import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { McpCredentialConfigurationError, type McpOAuthSurface } from '@/server/extensions'
import { getBaseUrl } from '@/server/web/app-url'
import {
  disconnectMcpOAuth,
  McpOAuthAlreadyAuthorizedError,
  startMcpOAuth,
} from '@/server/tools/mcp-oauth'
import { beginMcpCommand, finishMcpCommand } from '@/server/extensions/McpCommandState'

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
  let commandId: string | undefined
  let mcpServerId: string | undefined
  try {
    const body = Object.keys(context.parsedJson).length > 0
      ? context.parsedJson
      : await request.json()
    mcpServerId = typeof body.mcpServerId === 'string' ? body.mcpServerId.trim() : ''
    if (!mcpServerId) {
      return NextResponse.json({ error: 'mcpServerId is required' }, { status: 400 })
    }

    const server = await repository().get({
      mcpServerId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    if (!server) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
    if (server.authType !== 'oauth') {
      return NextResponse.json(
        { error: 'This MCP server is not configured to use OAuth' },
        { status: 400 },
      )
    }
    commandId = await beginMcpCommand({
      mcpServerId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      kind: 'connect',
    })

    const { authorizationUrl } = await startMcpOAuth({
      baseUrl: getBaseUrl(),
      returnTo: safeReturnTo(body.returnTo),
      // Binding the flow to the caller's session closes cross-account token injection on web.
      sessionBinding: context.auth.userId,
      server,
      surface: parseSurface(body.surface),
      ...(typeof body.scope === 'string' && body.scope.trim() ? { scope: body.scope.trim() } : {}),
    })
    await finishMcpCommand({
      mcpServerId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      commandId,
      status: 'succeeded',
    })

    return NextResponse.json({ redirectUrl: authorizationUrl })
  } catch (error) {
    if (error instanceof McpOAuthAlreadyAuthorizedError) {
      if (commandId && mcpServerId) {
        await finishMcpCommand({
          mcpServerId,
          userId: context.auth.userId,
          workspaceId: context.workspace.workspace.id,
          commandId,
          status: 'succeeded',
        }).catch((_error) => undefined)
      }
      return NextResponse.json({ alreadyConnected: true })
    }
    if (commandId && mcpServerId) {
      await finishMcpCommand({
        mcpServerId,
        userId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        commandId,
        status: 'failed',
      }).catch((_error) => undefined)
    }
    return NextResponse.json(
      { error: error instanceof McpCredentialConfigurationError ? 'MCP credential storage is not configured.' : 'Could not start OAuth for this server.' },
      { status: error instanceof McpCredentialConfigurationError ? 503 : 502 },
    )
  }
}

/** Forget stored tokens and any registered client for this server. */
export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  let commandId: string | undefined
  let mcpServerId: string | null = null
  try {
    mcpServerId = request.nextUrl.searchParams.get('mcpServerId')?.trim() ?? null
    if (!mcpServerId) {
      return NextResponse.json({ error: 'mcpServerId is required' }, { status: 400 })
    }
    const server = await repository().get({
      mcpServerId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    if (!server) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })

    commandId = await beginMcpCommand({
      mcpServerId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      kind: 'disconnect',
    })
    await disconnectMcpOAuth({ server })
    await finishMcpCommand({
      mcpServerId,
      userId: context.auth.userId,
      workspaceId: context.workspace.workspace.id,
      commandId,
      status: 'succeeded',
    })
    return NextResponse.json({ success: true })
  } catch (_error) {
    if (commandId && mcpServerId) {
      await finishMcpCommand({
        mcpServerId,
        userId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        commandId,
        status: 'failed',
      }).catch((_error) => undefined)
    }
    return NextResponse.json({ error: 'Failed to disconnect this MCP server' }, { status: 500 })
  }
}

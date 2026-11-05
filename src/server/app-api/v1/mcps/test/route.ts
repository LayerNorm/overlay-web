import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  discoverToolsCatalogForServer,
  persistMcpServerToolCatalog,
  type McpServerConfig,
} from '@/server/tools/mcp-tools'
import { beginMcpCommand, finishMcpCommand } from '@/server/extensions/McpCommandState'

function parseAuthType(value: unknown): McpServerConfig['authType'] {
  if (value === 'bearer' || value === 'header' || value === 'oauth') return value
  return 'none'
}

function parseTransport(value: unknown): McpServerConfig['transport'] {
  return value === 'sse' ? 'sse' : 'streamable-http'
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  let mcpServerId: string | undefined
  let attemptedAuthType: McpServerConfig['authType'] = 'none'
  let commandId: string | undefined
  let attemptedConnection = false
  try {
    const body = await request.json()
    const record = body as Record<string, unknown>

    const requestedUrl = record.url
    if (!requestedUrl || typeof requestedUrl !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    mcpServerId = typeof record.mcpServerId === 'string' && record.mcpServerId.length > 0
      ? record.mcpServerId
      : undefined

    const saved = mcpServerId
      ? await getOverlayServerContext().appData.repositories.mcpServers.get({
          mcpServerId,
          userId: context.auth.userId,
          workspaceId: context.workspace.workspace.id,
        })
      : null
    if (mcpServerId && !saved) {
      return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
    }
    const useStoredConfig = record.useStoredConfig === true
    const transport = useStoredConfig
      ? saved!.transport
      : record.transport === undefined && saved
        ? saved.transport
        : parseTransport(record.transport)
    const authType = useStoredConfig
      ? saved!.authType
      : record.authType === undefined && saved
        ? saved.authType
        : parseAuthType(record.authType)
    const url = useStoredConfig ? saved!.url : requestedUrl
    const sameStoredConnection = Boolean(saved
      && url === saved.url
      && transport === saved.transport
      && authType === saved.authType)
    const freshAuthConfig = record.authConfig && typeof record.authConfig === 'object' && !Array.isArray(record.authConfig)
      ? record.authConfig as McpServerConfig['authConfig']
      : undefined
    const config: McpServerConfig = {
      _id: mcpServerId ?? 'test',
      userId: context.auth.userId,
      name: saved?.name ?? 'test',
      transport,
      url,
      enabled: true,
      authType,
      authConfig: freshAuthConfig ?? ((useStoredConfig || sameStoredConnection) ? saved?.authConfig : undefined),
      timeoutMs: useStoredConfig
        ? saved?.timeoutMs
        : typeof record.timeoutMs === 'number' ? record.timeoutMs : saved?.timeoutMs,
      defaultToolPolicy: saved?.defaultToolPolicy ?? 'allow',
      toolPolicies: saved?.toolPolicies ?? {},
      // OAuth credentials only ever come from storage — a client cannot supply tokens here.
      ...((useStoredConfig || sameStoredConnection) && saved?.authType === 'oauth'
        ? {
          oauthClient: saved.oauthClient,
          oauthScope: saved.oauthScope,
          oauthStatus: saved.oauthStatus,
          oauthTokenVersion: saved.oauthTokenVersion,
          oauthTokens: saved.oauthTokens,
        }
        : {}),
    }

    attemptedAuthType = config.authType
    if (mcpServerId) {
      commandId = await beginMcpCommand({
        mcpServerId,
        userId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        kind: 'test',
      })
    }
    attemptedConnection = true
    const tools = await discoverToolsCatalogForServer(config)

    if (mcpServerId) {
      await persistMcpServerToolCatalog({
        mcpServerId,
        userId: context.auth.userId,
        tools,
      })
    }
    if (mcpServerId && commandId) {
      await finishMcpCommand({
        mcpServerId,
        userId: context.auth.userId,
        workspaceId: context.workspace.workspace.id,
        commandId,
        status: 'succeeded',
        toolCount: tools.length,
      })
    }

    return NextResponse.json({ ok: true, toolCount: tools.length })
  } catch (error) {
    if (mcpServerId) {
      if (commandId) {
        await finishMcpCommand({
          mcpServerId,
          userId: context.auth.userId,
          workspaceId: context.workspace.workspace.id,
          commandId,
          status: 'failed',
        }).catch((_error) => undefined)
      }
      if (attemptedConnection) {
        await persistMcpServerToolCatalog({
          mcpServerId,
          userId: context.auth.userId,
          tools: [],
          catalogError: 'Tool discovery failed.',
        }).catch((_error) => undefined)
      }
    }
    // A 401 from a server we hold no OAuth session for is the signature of an OAuth-only server
    // (Monid, for one). Say so, instead of leaving the user to guess at a bearer token.
    const message = error instanceof Error ? error.message : String(error)
    const looksUnauthorized = /\b401\b|unauthor|invalid_token/i.test(message)
    if (looksUnauthorized && attemptedAuthType !== 'oauth') {
      return NextResponse.json({
        ok: false,
        error: 'This server requires authentication. If it supports OAuth, set Authentication to "OAuth (sign in with browser)" and click Connect.',
        requiresAuth: true,
      }, { status: 502 })
    }
    return NextResponse.json({ ok: false, error: 'Could not connect to this MCP server.' }, { status: 502 })
  }
}

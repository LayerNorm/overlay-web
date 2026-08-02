import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import {
  discoverToolsCatalogForServer,
  persistMcpServerToolCatalog,
  type McpServerConfig,
} from '@/server/tools/mcp-tools'

function parseAuthType(value: unknown): McpServerConfig['authType'] {
  if (value === 'bearer' || value === 'header') return value
  return 'none'
}

function parseTransport(value: unknown): McpServerConfig['transport'] {
  return value === 'sse' ? 'sse' : 'streamable-http'
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  let mcpServerId: string | undefined
  let attemptedAuthType: McpServerConfig['authType'] = 'none'
  try {
    const body = await request.json()
    const record = body as Record<string, unknown>

    const url = record.url
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    mcpServerId = typeof record.mcpServerId === 'string' && record.mcpServerId.length > 0
      ? record.mcpServerId
      : undefined

    const saved = mcpServerId
      ? await getOverlayServerContext().appData.repositories.mcpServers.get({
          mcpServerId,
          userId: context.auth.userId,
        })
      : null
    if (mcpServerId && !saved) {
      return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
    }
    const authConfig = record.authConfig as McpServerConfig['authConfig'] | undefined
    const config: McpServerConfig = {
      _id: mcpServerId ?? 'test',
      userId: context.auth.userId,
      name: 'test',
      transport: parseTransport(record.transport),
      url,
      enabled: true,
      authType: record.authType === undefined && saved ? saved.authType : parseAuthType(record.authType),
      authConfig: authConfig ?? saved?.authConfig,
      timeoutMs: typeof record.timeoutMs === 'number' ? record.timeoutMs : undefined,
      defaultToolPolicy: saved?.defaultToolPolicy ?? 'allow',
      toolPolicies: saved?.toolPolicies ?? {},
      // OAuth credentials only ever come from storage — a client cannot supply tokens here.
      ...(saved?.authType === 'oauth'
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
    const tools = await discoverToolsCatalogForServer(config)

    if (mcpServerId) {
      await persistMcpServerToolCatalog({
        mcpServerId,
        userId: context.auth.userId,
        tools,
      })
    }

    return NextResponse.json({ ok: true, toolCount: tools.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (mcpServerId) {
      await persistMcpServerToolCatalog({
        mcpServerId,
        userId: context.auth.userId,
        tools: [],
        catalogError: message,
      }).catch((_error) => undefined)
    }
    // A 401 from a server we hold no OAuth session for is the signature of an OAuth-only server
    // (Monid, for one). Say so, instead of leaving the user to guess at a bearer token.
    const looksUnauthorized = /\b401\b|unauthor|invalid_token/i.test(message)
    if (looksUnauthorized && attemptedAuthType !== 'oauth') {
      return NextResponse.json({
        ok: false,
        error: 'This server requires authentication. If it supports OAuth, set Authentication to "OAuth (sign in with browser)" and click Connect.',
        requiresAuth: true,
      }, { status: 502 })
    }
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}

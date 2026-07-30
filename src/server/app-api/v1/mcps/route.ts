import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import type {
  McpAuthConfig,
  McpAuthType,
  McpToolPolicyMode,
  McpTransport,
} from '@/server/extensions'
import { McpCredentialConfigurationError } from '@/server/extensions'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'
import { refreshMcpServerToolCatalog } from '@/server/tools/mcp-tools'

function repository() {
  return getOverlayServerContext().appData.repositories.mcpServers
}

function mutationErrorResponse(error: unknown, fallback: string) {
  if (error instanceof McpCredentialConfigurationError) {
    return NextResponse.json(
      {
        error:
          'This deployment cannot store MCP credentials yet: MCP_CREDENTIAL_ENCRYPTION_KEY is not configured. Set it (32+ characters) and restart the server, or use an MCP server without authentication.',
      },
      { status: 503 },
    )
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  )
}

async function validateMcpUrl(url: unknown): Promise<string | null> {
  const result = await validatePublicNetworkUrl(url, { allowLocalDev: true, requireHttps: true })
  return result.ok ? null : result.error
}

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  try {
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined
    return NextResponse.json(await repository().list({ userId: context.auth.userId, projectId }))
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to fetch MCP servers' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = Object.keys(context.parsedJson).length > 0 ? context.parsedJson : await request.json()
    const name = stringValue(body.name)
    const transport = parseTransport(body.transport)
    const url = stringValue(body.url)
    if (!name || !transport || !url) {
      return NextResponse.json({ error: 'name, transport, and url are required' }, { status: 400 })
    }
    const urlError = await validateMcpUrl(url)
    if (urlError) return NextResponse.json({ error: urlError }, { status: 400 })
    const defaultToolPolicy = body.defaultToolPolicy === undefined
      ? 'allow'
      : parsePolicy(body.defaultToolPolicy)
    const toolPolicies = parseToolPolicies(body.toolPolicies)
    if (!defaultToolPolicy || !toolPolicies) {
      return NextResponse.json({ error: 'Invalid MCP tool policy' }, { status: 400 })
    }

    const id = await repository().create({
      userId: context.auth.userId,
      projectId: optionalString(body.projectId),
      name,
      description: optionalString(body.description),
      transport,
      url,
      enabled: body.enabled !== false,
      authType: parseAuthType(body.authType),
      authConfig: parseAuthConfig(body.authConfig),
      timeoutMs: parseTimeout(body.timeoutMs),
      defaultToolPolicy,
      toolPolicies,
    })
    if (body.enabled !== false) {
      void refreshMcpServerToolCatalog({ mcpServerId: id, userId: context.auth.userId })
        .catch((_error) => undefined)
    }
    return NextResponse.json({ id })
  } catch (error) {
    return mutationErrorResponse(error, 'Failed to create MCP server')
  }
}

export async function PATCH(request: NextRequest, context: AppApiRouteContext) {
  try {
    const body = Object.keys(context.parsedJson).length > 0 ? context.parsedJson : await request.json()
    const mcpServerId = stringValue(body.mcpServerId)
    if (!mcpServerId) return NextResponse.json({ error: 'mcpServerId required' }, { status: 400 })
    if (body.url !== undefined) {
      const urlError = await validateMcpUrl(body.url)
      if (urlError) return NextResponse.json({ error: urlError }, { status: 400 })
    }
    const defaultToolPolicy = body.defaultToolPolicy === undefined
      ? undefined
      : parsePolicy(body.defaultToolPolicy)
    const toolPolicies = body.toolPolicies === undefined
      ? undefined
      : parseToolPolicies(body.toolPolicies)
    if (defaultToolPolicy === null || toolPolicies === null) {
      return NextResponse.json({ error: 'Invalid MCP tool policy' }, { status: 400 })
    }
    await repository().update({
      mcpServerId,
      userId: context.auth.userId,
      ...(body.name !== undefined ? { name: stringValue(body.name) } : {}),
      ...(body.description !== undefined ? { description: stringValue(body.description) } : {}),
      ...(body.transport !== undefined ? { transport: parseTransport(body.transport) ?? undefined } : {}),
      ...(body.url !== undefined ? { url: stringValue(body.url) } : {}),
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      ...(body.authType !== undefined ? { authType: parseAuthType(body.authType) } : {}),
      ...(body.authConfig !== undefined ? { authConfig: parseAuthConfig(body.authConfig) } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: parseTimeout(body.timeoutMs) } : {}),
      ...(defaultToolPolicy !== undefined ? { defaultToolPolicy } : {}),
      ...(toolPolicies !== undefined ? { toolPolicies } : {}),
    })
    if (body.enabled !== false) {
      void refreshMcpServerToolCatalog({ mcpServerId, userId: context.auth.userId })
        .catch((_error) => undefined)
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return mutationErrorResponse(error, 'Failed to update MCP server')
  }
}

export async function DELETE(request: NextRequest, context: AppApiRouteContext) {
  try {
    const mcpServerId = request.nextUrl.searchParams.get('mcpServerId')
    if (!mcpServerId) return NextResponse.json({ error: 'mcpServerId required' }, { status: 400 })
    await repository().remove({ mcpServerId, userId: context.auth.userId })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to delete MCP server' }, { status: 500 })
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalString(value: unknown): string | undefined {
  return stringValue(value) || undefined
}

function parseTransport(value: unknown): McpTransport | null {
  return value === 'sse' || value === 'streamable-http' ? value : null
}

function parseAuthType(value: unknown): McpAuthType {
  return value === 'bearer' || value === 'header' ? value : 'none'
}

function parsePolicy(value: unknown): McpToolPolicyMode | null {
  return value === 'allow' || value === 'approval_required' || value === 'deny' ? value : null
}

function parseTimeout(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1_000 && value <= 120_000
    ? Math.floor(value)
    : undefined
}

function parseAuthConfig(value: unknown): McpAuthConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return {
    bearerToken: optionalString(record.bearerToken),
    headerName: optionalString(record.headerName),
    headerValue: optionalString(record.headerValue),
  }
}

function parseToolPolicies(value: unknown): Record<string, McpToolPolicyMode> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries: Array<[string, McpToolPolicyMode]> = []
  for (const [name, valuePolicy] of Object.entries(value as Record<string, unknown>)) {
    const normalizedName = name.trim()
    if (!normalizedName) continue
    const policy = parsePolicy(valuePolicy)
    if (!policy) return null
    entries.push([normalizedName, policy])
  }
  return Object.fromEntries(entries)
}

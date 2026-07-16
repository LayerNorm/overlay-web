import 'server-only'

import { createHash } from 'node:crypto'
import type { IntegrationProviderCapabilities, IntegrationSummary } from '@overlay/app-core'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { getOverlayServerContext } from '@/server/bootstrap'
import type {
  IntegrationExecutionRequest,
  IntegrationExecutionResult,
  IntegrationProvider,
} from './contracts'

type ExecutorIntegration = {
  slug: string
  name: string
  description: string
  kind: string
  canRemove: boolean
  canRefresh: boolean
  authMethods: Array<{ id: string; kind: 'oauth' | 'apikey' | 'header' | 'none' }>
  displayUrl?: string
  family?: string
}

type ExecutorConnection = {
  owner: 'org' | 'user'
  name: string
  integration: string
  address: string
  identityLabel: string | null
  expiresAt: number | null
  lastHealth: { status?: string } | null
}

type ExecutorTool = {
  address: string
  integration: string
  name: string
  description: string
  requiresApproval?: boolean
}

type ExecutorExecutionResponse = {
  status: 'completed' | 'paused'
  text: string
  structured: unknown
  isError?: boolean
}

const EXECUTOR_TOOL_ADDRESS_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/

export interface ExecutorIntegrationProviderOptions {
  apiBaseUrl: string
  webBaseUrl: string
  apiKey: string
  connectionOwner?: 'org' | 'user'
  requestTimeoutMs?: number
  fetcher?: typeof fetch
}

export const EXECUTOR_INTEGRATION_CAPABILITIES: IntegrationProviderCapabilities = {
  provider: 'executor',
  hosted: false,
  selfHosted: true,
  oauthOwnership: 'customer-managed',
  connectionSetup: 'provider-console',
  connectionLifecycle: 'provider-managed',
  supportsApprovals: true,
  supportsDisconnect: false,
  supportedSchemas: ['mcp', 'openapi', 'graphql'],
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function logoUrl(displayUrl?: string): string | null {
  if (!displayUrl) return null
  try {
    return `https://integrations.sh/logo/${new URL(displayUrl).hostname}?sz=80`
  } catch (_error) {
    return null
  }
}

function connectionState(connection?: ExecutorConnection): NonNullable<IntegrationSummary['authenticationState']> {
  if (!connection) return 'not-connected'
  const status = connection.lastHealth?.status?.toLowerCase()
  if (status === 'expired' || (connection.expiresAt && connection.expiresAt < Date.now())) return 'expired'
  if (status === 'degraded' || status === 'failed') return 'degraded'
  return 'connected'
}

function executorInvocationCode(request: IntegrationExecutionRequest): string {
  if (!EXECUTOR_TOOL_ADDRESS_PATTERN.test(request.toolId)) {
    throw new Error('Executor tool address is invalid')
  }
  const toolIdLiteral = JSON.stringify(request.toolId)
  const argumentsLiteral = JSON.stringify(request.args ?? {})
  // Executor's execution API accepts code, so dynamic values are validated and
  // serialized as JSON literals before interpolation. codeql[js/bad-code-sanitization]
  return `async () => await tools[${toolIdLiteral}](${argumentsLiteral})`
}

export class ExecutorIntegrationProvider implements IntegrationProvider {
  readonly id = 'executor' as const
  readonly capabilities = EXECUTOR_INTEGRATION_CAPABILITIES
  private readonly apiBaseUrl: string
  private readonly webBaseUrl: string
  private readonly apiKey: string
  private readonly owner: 'org' | 'user'
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch

  constructor(options: ExecutorIntegrationProviderOptions) {
    this.apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl)
    this.webBaseUrl = normalizeBaseUrl(options.webBaseUrl)
    this.apiKey = options.apiKey
    this.owner = options.connectionOwner ?? 'org'
    this.timeoutMs = options.requestTimeoutMs ?? 30_000
    this.fetcher = options.fetcher ?? fetch
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.apiBaseUrl}${path}`, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500)
      throw new Error(`Executor ${path} returned HTTP ${response.status}${body ? `: ${body}` : ''}`)
    }
    return await response.json() as T
  }

  async health() {
    try {
      await this.request<unknown>('/health')
      return { provider: this.id, status: 'healthy' as const, checkedAt: Date.now() }
    } catch (error) {
      return {
        provider: this.id,
        status: 'unavailable' as const,
        checkedAt: Date.now(),
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async remoteConnections() {
    return await this.request<ExecutorConnection[]>(`/connections?owner=${this.owner}`)
  }

  async listConnections(args: { accessToken?: string; userId: string }) {
    const connections = await this.remoteConnections()
    return connections.map((connection) => ({
      id: connection.address,
      provider: this.id,
      providerKey: connection.integration,
      userId: args.userId,
      authenticationState: connectionState(connection),
      identityLabel: connection.identityLabel,
      expiresAt: connection.expiresAt,
    }))
  }

  async listCatalog(query: Parameters<IntegrationProvider['listCatalog']>[0]) {
    const [integrations, connections] = await Promise.all([
      this.request<ExecutorIntegration[]>('/integrations'),
      this.remoteConnections(),
    ])
    const connected = new Map(connections.map((item) => [item.integration, item]))
    const normalizedQuery = query.query?.trim().toLowerCase()
    const start = query.cursor ? Math.max(0, Number.parseInt(query.cursor, 10) || 0) : 0
    const matching = integrations.filter((item) => !normalizedQuery ||
      `${item.slug} ${item.name} ${item.description} ${item.family ?? ''}`.toLowerCase().includes(normalizedQuery))
    const slice = matching.slice(start, start + query.limit)
    const nextOffset = start + slice.length
    const nextCursor = nextOffset < matching.length ? String(nextOffset) : null
    return {
      items: slice.map((item) => this.mapIntegration(item, connected.get(item.slug))),
      nextCursor,
      hasMore: nextCursor !== null,
      syncCursor: createHash('sha256')
        .update(integrations.map((item) => item.slug).sort().join('\n'))
        .digest('hex'),
    }
  }

  async getCatalogEntry(args: { accessToken?: string; providerKey: string; userId: string }) {
    try {
      const [integration, connections] = await Promise.all([
        this.request<ExecutorIntegration>(`/integrations/${encodeURIComponent(args.providerKey)}`),
        this.remoteConnections(),
      ])
      return this.mapIntegration(
        integration,
        connections.find((item) => item.integration === integration.slug),
      )
    } catch (_error) {
      return null
    }
  }

  private mapIntegration(item: ExecutorIntegration, connection?: ExecutorConnection): IntegrationSummary {
    return {
      slug: item.slug,
      providerKey: item.slug,
      provider: this.id,
      name: item.name,
      description: item.description,
      logoUrl: logoUrl(item.displayUrl),
      capabilities: this.capabilities,
      isConnected: Boolean(connection),
      connectedAccountId: connection?.address ?? null,
      authenticationState: connectionState(connection),
      connectionSetupUrl: `${this.webBaseUrl}/integrations/${encodeURIComponent(item.slug)}`,
    }
  }

  async beginConnection(context: Parameters<IntegrationProvider['beginConnection']>[0]) {
    return {
      provider: this.id,
      providerCapabilities: this.capabilities,
      redirectUrl: `${this.webBaseUrl}/integrations/${encodeURIComponent(context.providerKey)}`,
      status: 'provider_console_required',
    }
  }

  async disconnect(_context: Parameters<IntegrationProvider['disconnect']>[0]) {
    throw new Error('Executor connections are managed in the Executor console')
  }

  async deleteConnectionsForUser(_args: { accessToken?: string; userId: string }) {
    // Executor owns its connection lifecycle. A tenant service credential must never
    // delete shared org connections merely because one Overlay account is removed.
    return 0
  }

  async execute(request: IntegrationExecutionRequest): Promise<IntegrationExecutionResult> {
    const code = executorInvocationCode(request)
    const startedAt = Date.now()
    try {
      const result = await this.request<ExecutorExecutionResponse>('/executions', {
        method: 'POST',
        body: JSON.stringify({ code, autoApprove: false }),
      })
      await this.audit(request, result.status === 'completed' && !result.isError ? 'success' : 'failure', {
        durationMs: Date.now() - startedAt,
        status: result.status,
      })
      return {
        status: result.isError ? 'failed' : result.status,
        output: result.structured ?? result.text,
        ...(result.isError ? { error: result.text } : {}),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.audit(request, 'failure', { durationMs: Date.now() - startedAt, error: message })
      return { status: 'failed', error: message }
    }
  }

  async createToolSet(args: Parameters<IntegrationProvider['createToolSet']>[0]): Promise<ToolSet> {
    return {
      EXECUTOR_SEARCH_TOOLS: tool({
        description: 'Search connected Executor integrations for tools. Use the exact returned address with EXECUTOR_EXECUTE_TOOL.',
        inputSchema: z.object({
          query: z.string().describe('Capability to search for'),
          integration: z.string().optional().describe('Optional integration slug'),
          limit: z.number().int().min(1).max(25).default(10),
        }),
        execute: async ({ query, integration, limit }) => {
          const params = new URLSearchParams({ query, includeAnnotations: 'true' })
          if (integration) params.set('integration', integration)
          const tools = await this.request<ExecutorTool[]>(`/tools?${params}`)
          return JSON.stringify({
            tools: tools.slice(0, limit).map((item) => ({
              address: item.address,
              integration: item.integration,
              name: item.name,
              description: item.description,
              requiresApproval: item.requiresApproval === true,
            })),
          })
        },
      }),
      EXECUTOR_EXECUTE_TOOL: tool({
        description: 'Execute one exact Executor tool address returned by EXECUTOR_SEARCH_TOOLS.',
        inputSchema: z.object({
          toolAddress: z.string().min(1),
          arguments: z.record(z.string(), z.unknown()).optional(),
        }),
        execute: async ({ toolAddress, arguments: toolArgs }) => await this.execute({
          userId: args.userId,
          conversationId: args.conversationId,
          turnId: args.turnId,
          toolId: toolAddress,
          args: toolArgs ?? {},
        }),
      }),
    }
  }

  private async audit(
    request: IntegrationExecutionRequest,
    outcome: 'success' | 'failure',
    metadata: Record<string, unknown>,
  ) {
    try {
      await getOverlayServerContext().auditService.record({
        action: 'integration.tool.execute',
        actorType: 'user',
        actorUserId: request.userId,
        resourceType: 'integration_tool',
        resourceId: request.toolId,
        outcome,
        metadata: { provider: this.id, conversationId: request.conversationId, turnId: request.turnId, ...metadata },
      })
    } catch (_error) {
      // Tool execution should not fail because best-effort audit persistence is unavailable.
    }
  }
}

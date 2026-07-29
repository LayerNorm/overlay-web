import 'server-only'

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IntegrationProviderCapabilities, IntegrationSummary } from '@overlay/app-core'
import type { ToolSet } from 'ai'
import type { IntegrationProvider } from './contracts'
import { getServerProviderKey } from '@/server/ai/provider-keys'
import { createBrowserUnifiedTools } from '@/server/tools/composio-tools'

const COMPOSIO_API_BASE_URL = 'https://backend.composio.dev/api/v3'

type ComposioToolkitRecord = {
  slug?: string
  name?: string
  description?: string
  logo?: string
  logoUrl?: string
  meta?: { description?: string; logo?: string }
}

type ComposioConnectedAccountRecord = {
  id?: string
  appName?: string
  status?: string
  toolkit?: { slug?: string }
}

export const COMPOSIO_INTEGRATION_CAPABILITIES: IntegrationProviderCapabilities = {
  provider: 'composio',
  hosted: true,
  selfHosted: false,
  oauthOwnership: 'provider-managed',
  connectionSetup: 'in-app-oauth',
  connectionLifecycle: 'overlay-managed',
  supportsApprovals: false,
  supportsDisconnect: true,
  supportedSchemas: ['native'],
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
}

function displayName(slug: string): string {
  return slug.split(/[_-]+/).filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export interface ComposioSdkFacade {
  authConfigs: {
    list(args: { toolkit: string }): Promise<{ items?: Array<{ id?: string }> } | Array<{ id?: string }>>
    create(toolkit: string, args: { type: string }): Promise<{ id: string }>
  }
  connectedAccounts: {
    link(userId: string, authConfigId: string, args: { callbackUrl: string }): Promise<{
      id?: string
      redirectUrl?: string
      status?: string
    }>
    list(args: { userIds: string[]; toolkitSlugs: string[] }): Promise<{ items?: unknown[] }>
    delete(id: string): Promise<unknown>
  }
  tools: {
    execute(toolId: string, args: {
      arguments: Record<string, unknown>
      dangerouslySkipVersionCheck?: boolean
      userId: string
    }): Promise<{
      data: Record<string, unknown>
      error: string | null
      successful: boolean
      logId?: string
    }>
  }
}

export interface ComposioIntegrationProviderOptions {
  fetcher?: typeof fetch
  apiKeyResolver?: (accessToken?: string) => Promise<string | null>
  sdkFactory?: (apiKey: string) => Promise<ComposioSdkFacade>
  toolSetFactory?: (args: { accessToken?: string; userId: string }) => Promise<ToolSet>
}

async function loadComposioSdk(apiKey: string): Promise<ComposioSdkFacade> {
  let sdkModule: {
    Composio: new (args: {
      apiKey: string
      autoUploadDownloadFiles?: boolean
    }) => ComposioSdkFacade
  }
  try {
    sdkModule = await import('@composio/core') as unknown as typeof sdkModule
  } catch (_error) {
    const url = pathToFileURL(
      path.resolve(process.cwd(), '../overlay-desktop/node_modules/@composio/core/dist/index.mjs'),
    ).href
    sdkModule = await import(/* webpackIgnore: true */ url) as unknown as typeof sdkModule
  }
  return new sdkModule.Composio({ apiKey, autoUploadDownloadFiles: true })
}

async function resolveApiKey(accessToken?: string): Promise<string | null> {
  if (!accessToken) return process.env.COMPOSIO_API_KEY ?? null
  return await getServerProviderKey('composio') ?? process.env.COMPOSIO_API_KEY ?? null
}

function mapToolkit(record: ComposioToolkitRecord): Omit<IntegrationSummary, 'isConnected' | 'connectedAccountId'> {
  const slug = normalizeSlug(firstString(record.slug, record.name) ?? '')
  return {
    slug,
    providerKey: slug,
    provider: 'composio',
    name: firstString(record.name) ?? displayName(slug),
    description: firstString(record.description, record.meta?.description) ?? '',
    logoUrl: firstString(record.logoUrl, record.logo, record.meta?.logo),
    capabilities: COMPOSIO_INTEGRATION_CAPABILITIES,
    authenticationState: 'not-connected',
  }
}

export class ComposioIntegrationProvider implements IntegrationProvider {
  readonly id = 'composio' as const
  readonly capabilities = COMPOSIO_INTEGRATION_CAPABILITIES
  private readonly fetcher: typeof fetch
  private readonly apiKeyResolver: (accessToken?: string) => Promise<string | null>
  private readonly sdkFactory: (apiKey: string) => Promise<ComposioSdkFacade>
  private readonly toolSetFactory: (args: { accessToken?: string; userId: string }) => Promise<ToolSet>

  constructor(options: ComposioIntegrationProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch
    this.apiKeyResolver = options.apiKeyResolver ?? resolveApiKey
    this.sdkFactory = options.sdkFactory ?? loadComposioSdk
    this.toolSetFactory = options.toolSetFactory ?? createBrowserUnifiedTools
  }

  async health() {
    const apiKey = await this.apiKeyResolver()
    if (!apiKey) return { provider: this.id, status: 'unconfigured' as const, checkedAt: Date.now() }
    const response = await this.fetcher(`${COMPOSIO_API_BASE_URL}/toolkits?limit=1`, {
      headers: { 'x-api-key': apiKey },
      cache: 'no-store',
    }).catch((_error) => null)
    return {
      provider: this.id,
      status: response?.ok ? 'healthy' as const : 'unavailable' as const,
      checkedAt: Date.now(),
      ...(response && !response.ok ? { message: `HTTP ${response.status}` } : {}),
    }
  }

  private async connectedAccounts(accessToken: string | undefined, userId: string) {
    const apiKey = await this.apiKeyResolver(accessToken)
    if (!apiKey) return []
    const url = new URL(`${COMPOSIO_API_BASE_URL}/connected_accounts`)
    url.searchParams.set('user_ids', userId)
    url.searchParams.set('limit', '100')
    const response = await this.fetcher(url, { headers: { 'x-api-key': apiKey }, cache: 'no-store' })
    if (!response.ok) return []
    const data = await response.json() as { items?: ComposioConnectedAccountRecord[] }
    return Array.isArray(data.items) ? data.items : []
  }

  async listConnections(args: { accessToken?: string; userId: string }) {
    const rows = await this.connectedAccounts(args.accessToken, args.userId)
    return rows.flatMap((row) => {
      const providerKey = normalizeSlug(firstString(row.toolkit?.slug, row.appName) ?? '')
      if (!providerKey || !row.id || (row.status && row.status !== 'ACTIVE')) return []
      return [{
        id: row.id,
        provider: this.id,
        providerKey,
        userId: args.userId,
        authenticationState: 'connected' as const,
      }]
    })
  }

  async listCatalog(query: Parameters<IntegrationProvider['listCatalog']>[0]) {
    const apiKey = await this.apiKeyResolver(query.accessToken)
    if (!apiKey) return { items: [], nextCursor: null, hasMore: false }
    const connections = await this.listConnections(query)
    const connected = new Map(connections.map((item) => [item.providerKey, item]))
    const url = new URL(`${COMPOSIO_API_BASE_URL}/toolkits`)
    if (query.query) url.searchParams.set('search', query.query)
    if (query.cursor) url.searchParams.set('cursor', query.cursor)
    url.searchParams.set('limit', String(query.limit))
    const response = await this.fetcher(url, { headers: { 'x-api-key': apiKey }, cache: 'no-store' })
    if (!response.ok) return { items: [], nextCursor: null, hasMore: false }
    const data = await response.json() as {
      items?: ComposioToolkitRecord[]
      nextCursor?: string
      next_cursor?: string
    } | ComposioToolkitRecord[]
    const rows = Array.isArray(data) ? data : data.items ?? []
    const normalizedQuery = query.query?.trim().toLowerCase()
    const items = rows.map((row) => {
      const item = mapToolkit(row)
      const connection = connected.get(item.providerKey)
      return {
        ...item,
        isConnected: Boolean(connection),
        connectedAccountId: connection?.id ?? null,
        authenticationState: connection ? 'connected' as const : 'not-connected' as const,
      }
    }).filter((item) => item.slug && (!normalizedQuery ||
      `${item.slug} ${item.name} ${item.description}`.toLowerCase().includes(normalizedQuery)))
    const nextCursor = Array.isArray(data) ? null : firstString(data.nextCursor, data.next_cursor)
    return { items, nextCursor, hasMore: nextCursor !== null, syncCursor: nextCursor }
  }

  async getCatalogEntry(args: { accessToken?: string; providerKey: string; userId: string }) {
    const apiKey = await this.apiKeyResolver(args.accessToken)
    if (!apiKey) return null
    const response = await this.fetcher(
      `${COMPOSIO_API_BASE_URL}/toolkits/${encodeURIComponent(args.providerKey)}`,
      { headers: { 'x-api-key': apiKey }, cache: 'no-store' },
    )
    const record = response.ok ? await response.json() as ComposioToolkitRecord : null
    if (!record) return null
    const item = mapToolkit(record)
    const connection = (await this.listConnections(args)).find((row) => row.providerKey === item.providerKey)
    return {
      ...item,
      isConnected: Boolean(connection),
      connectedAccountId: connection?.id ?? null,
      authenticationState: connection ? 'connected' as const : 'not-connected' as const,
    }
  }

  async beginConnection(context: Parameters<IntegrationProvider['beginConnection']>[0]) {
    const apiKey = await this.apiKeyResolver(context.accessToken)
    if (!apiKey) return { provider: this.id, error: 'Composio not configured' }
    const composio = await this.sdkFactory(apiKey)
    const authConfigs = await composio.authConfigs.list({ toolkit: context.providerKey })
    const firstConfig = (Array.isArray(authConfigs) ? authConfigs : authConfigs.items ?? [])[0]
    const authConfigId = firstConfig?.id ?? (await composio.authConfigs.create(context.providerKey, {
      type: 'use_composio_managed_auth',
    })).id
    const request = await composio.connectedAccounts.link(context.userId, authConfigId, {
      callbackUrl: `${context.callbackOrigin}/auth/composio/callback`,
    })
    return {
      provider: this.id,
      providerCapabilities: this.capabilities,
      redirectUrl: typeof request.redirectUrl === 'string' ? request.redirectUrl : null,
      connectionId: typeof request.id === 'string' ? request.id : null,
      status: typeof request.status === 'string' ? request.status : 'initiated',
    }
  }

  async disconnect(context: Parameters<IntegrationProvider['disconnect']>[0]) {
    const apiKey = await this.apiKeyResolver(context.accessToken)
    if (!apiKey) throw new Error('Composio not configured')
    const composio = await this.sdkFactory(apiKey)
    const accounts = await composio.connectedAccounts.list({
      userIds: [context.userId],
      toolkitSlugs: [context.providerKey],
    })
    await Promise.all((accounts.items ?? []).flatMap((account: unknown) => {
      if (!account || typeof account !== 'object' || !('id' in account) || typeof account.id !== 'string') return []
      return [composio.connectedAccounts.delete(account.id)]
    }))
  }

  async deleteConnectionsForUser(args: { accessToken?: string; userId: string }) {
    const connections = await this.listConnections(args)
    const providerKeys = [...new Set(connections.map((item) => item.providerKey))]
    await Promise.all(providerKeys.map((providerKey) => this.disconnect({
      ...args,
      callbackOrigin: '',
      providerKey,
    })))
    return connections.length
  }

  async createToolSet(args: Parameters<IntegrationProvider['createToolSet']>[0]) {
    return await this.toolSetFactory(args)
  }

  async execute(request: Parameters<IntegrationProvider['execute']>[0]) {
    const apiKey = await this.apiKeyResolver()
    if (!apiKey) return { status: 'failed' as const, error: 'Composio not configured' }
    try {
      const composio = await this.sdkFactory(apiKey)
      const result = await composio.tools.execute(request.toolId, {
        arguments: isRecord(request.args) ? request.args : {},
        dangerouslySkipVersionCheck: true,
        userId: request.userId,
      })
      if (!result.successful) {
        return {
          status: 'failed' as const,
          error: result.error ?? 'Composio tool execution failed',
          executionId: result.logId,
        }
      }
      return {
        status: 'completed' as const,
        output: result.data,
        executionId: result.logId,
      }
    } catch (error) {
      return {
        status: 'failed' as const,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

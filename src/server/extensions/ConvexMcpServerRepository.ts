import 'server-only'

import type { Id } from '../../../convex/_generated/dataModel'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { McpCredentialCipher } from './McpCredentialCipher'
import type {
  CreateMcpServerInput,
  McpAuthConfig,
  McpExecutionRecord,
  McpOAuthClient,
  McpOAuthSession,
  McpOAuthStatus,
  McpOAuthTokens,
  McpServerRecord,
  McpServerRepository,
  McpServerSummary,
  UpdateMcpServerInput,
} from './McpServerRepository'

type ConvexMcpRecord =
  & Omit<
    McpServerRecord,
    '_id' | 'defaultToolPolicy' | 'toolPolicies' | 'toolCatalog' | 'hasAuth' | 'oauthTokens' | 'oauthClient'
  >
  & {
    _id: Id<'mcpServers'>
    authConfig?: McpAuthConfig
    encryptedAuthConfig?: string
    encryptedOAuthTokens?: string
    encryptedOAuthClient?: string
    defaultToolPolicy?: McpServerRecord['defaultToolPolicy']
    toolPolicies?: McpServerRecord['toolPolicies']
    toolCatalog?: McpServerRecord['toolCatalog']
  }

type ConvexMcpSummary = Omit<McpServerSummary, '_id' | 'defaultToolPolicy' | 'toolPolicies'> & {
  _id: Id<'mcpServers'>
  defaultToolPolicy?: McpServerRecord['defaultToolPolicy']
  toolPolicies?: McpServerRecord['toolPolicies']
}

export class ConvexMcpServerRepository implements McpServerRepository {
  constructor(private readonly cipher = McpCredentialCipher.fromEnvironment()) {}

  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async list(args: { userId: string; projectId?: string }): Promise<McpServerSummary[]> {
    const rows = await convex.query<ConvexMcpSummary[]>('integrations/mcpServers:list', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
    return rows.map((row) => ({
      ...row,
      _id: String(row._id),
      defaultToolPolicy: row.defaultToolPolicy ?? 'allow',
      toolPolicies: row.toolPolicies ?? {},
    }))
  }

  async listEnabled(args: { userId: string; projectId?: string }): Promise<McpServerRecord[]> {
    const rows = await convex.query<ConvexMcpRecord[]>('integrations/mcpServers:listEnabled', {
      ...args,
      serverSecret: this.serverSecret,
    }) ?? []
    return rows.map((row) => this.normalizeRecord(row))
  }

  async get(args: { mcpServerId: string; userId: string }): Promise<McpServerRecord | null> {
    const row = await convex.query<ConvexMcpRecord | null>('integrations/mcpServers:get', {
      ...args,
      mcpServerId: args.mcpServerId as Id<'mcpServers'>,
      serverSecret: this.serverSecret,
    })
    return row ? this.normalizeRecord(row) : null
  }

  async create(args: CreateMcpServerInput): Promise<string> {
    const encryptedAuthConfig = this.cipher.encrypt(
      args.authType === 'none' ? undefined : args.authConfig,
    )
    const id = await convex.mutation<string>('integrations/mcpServers:create', {
      ...args,
      authConfig: undefined,
      encryptedAuthConfig,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Convex MCP server create returned no id')
    return id
  }

  async update(args: UpdateMcpServerInput): Promise<void> {
    const current = await this.get(args)
    if (!current) throw new Error('Unauthorized')
    const authType = args.authType ?? current.authType
    const shouldReplaceCredentials = args.authConfig !== undefined ||
      authType === 'none' ||
      (args.authType !== undefined && args.authType !== current.authType)
    const encryptedAuthConfig = shouldReplaceCredentials
      ? this.cipher.encrypt(authType === 'none' ? undefined : args.authConfig)
      : undefined
    await convex.mutation('integrations/mcpServers:update', {
      ...args,
      encryptedAuthConfig,
      clearAuthConfig: shouldReplaceCredentials && !encryptedAuthConfig,
      mcpServerId: args.mcpServerId as Id<'mcpServers'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async remove(args: { mcpServerId: string; userId: string }): Promise<void> {
    await convex.mutation('integrations/mcpServers:remove', {
      ...args,
      mcpServerId: args.mcpServerId as Id<'mcpServers'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async updateToolCatalog(args: {
    mcpServerId: string
    userId: string
    tools: McpServerRecord['toolCatalog']
    catalogError?: string
  }): Promise<void> {
    await convex.mutation('integrations/mcpServers:updateToolCatalog', {
      ...args,
      mcpServerId: args.mcpServerId as Id<'mcpServers'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async recordExecution(args: Omit<McpExecutionRecord, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: number
  }): Promise<string> {
    const id = await convex.mutation<string>('integrations/mcpServers:recordExecution', {
      ...args,
      mcpServerId: args.mcpServerId as Id<'mcpServers'>,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!id) throw new Error('Convex MCP execution create returned no id')
    return id
  }

  async listExecutions(args: {
    userId: string
    mcpServerId?: string
    limit?: number
  }): Promise<McpExecutionRecord[]> {
    const rows = await convex.query<Array<Omit<McpExecutionRecord, 'id'> & { _id: string }>>(
      'integrations/mcpServers:listExecutions',
      {
        ...args,
        mcpServerId: args.mcpServerId as Id<'mcpServers'> | undefined,
        serverSecret: this.serverSecret,
      },
    ) ?? []
    return rows.map(({ _id, ...row }) => ({ id: String(_id), ...row }))
  }

  async updateOAuthState(args: {
    mcpServerId: string
    userId: string
    tokens?: McpOAuthTokens | null
    client?: McpOAuthClient | null
    status?: McpOAuthStatus
    issuer?: string
    scope?: string
    resource?: string
    error?: string | null
    expectedTokenVersion?: number
  }): Promise<boolean> {
    const applied = await convex.mutation<boolean>('integrations/mcpServers:updateOAuthState', {
      mcpServerId: args.mcpServerId as Id<'mcpServers'>,
      userId: args.userId,
      ...(args.tokens === undefined
        ? {}
        : { encryptedOAuthTokens: args.tokens === null ? null : this.sealJson(args.tokens) }),
      ...(args.client === undefined
        ? {}
        : {
          encryptedOAuthClient: args.client === null ? null : this.sealJson(args.client),
          oauthClientId: args.client === null ? null : args.client.clientId,
        }),
      ...(args.status !== undefined ? { oauthStatus: args.status } : {}),
      ...(args.issuer !== undefined ? { oauthIssuer: args.issuer } : {}),
      ...(args.scope !== undefined ? { oauthScope: args.scope } : {}),
      ...(args.resource !== undefined ? { oauthResource: args.resource } : {}),
      ...(args.error !== undefined ? { oauthError: args.error } : {}),
      ...(args.expectedTokenVersion !== undefined
        ? { expectedTokenVersion: args.expectedTokenVersion }
        : {}),
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    return applied !== false
  }

  async createOAuthSession(
    args: Omit<McpOAuthSession, 'createdAt'> & { createdAt?: number },
  ): Promise<void> {
    await convex.mutation('integrations/mcpServers:createOAuthSession', {
      sessionId: args.id,
      userId: args.userId,
      mcpServerId: args.mcpServerId as Id<'mcpServers'>,
      encryptedCodeVerifier: this.sealJson({ codeVerifier: args.codeVerifier }),
      surface: args.surface,
      returnTo: args.returnTo,
      sessionBindingHash: args.sessionBindingHash,
      expiresAt: args.expiresAt,
      createdAt: args.createdAt,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async consumeOAuthSession(args: { sessionId: string }): Promise<McpOAuthSession | null> {
    const row = await convex.mutation<{
      sessionId: string
      userId: string
      mcpServerId: Id<'mcpServers'>
      encryptedCodeVerifier: string
      surface: McpOAuthSession['surface']
      returnTo?: string
      sessionBindingHash?: string
      expiresAt: number
      createdAt: number
    } | null>('integrations/mcpServers:consumeOAuthSession', {
      sessionId: args.sessionId,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!row) return null
    return {
      id: row.sessionId,
      userId: row.userId,
      mcpServerId: String(row.mcpServerId),
      codeVerifier: this.openJson<{ codeVerifier: string }>(row.encryptedCodeVerifier).codeVerifier,
      surface: row.surface,
      returnTo: row.returnTo,
      sessionBindingHash: row.sessionBindingHash,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }
  }

  async deleteExpiredOAuthSessions(args: { now?: number } = {}): Promise<number> {
    const deleted = await convex.mutation<number>(
      'integrations/mcpServers:deleteExpiredOAuthSessions',
      { now: args.now, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    return deleted ?? 0
  }

  /**
   * The cipher seals McpAuthConfig shapes, so arbitrary OAuth payloads ride inside the
   * `bearerToken` slot as JSON. That keeps one audited crypto path for every MCP secret.
   */
  private sealJson(value: unknown): string {
    const sealed = this.cipher.encrypt({ bearerToken: JSON.stringify(value) })
    if (!sealed) throw new Error('Failed to seal MCP OAuth payload')
    return sealed
  }

  private openJson<T>(payload: string): T {
    const opened = this.cipher.decrypt(payload)
    if (!opened?.bearerToken) throw new Error('Failed to open MCP OAuth payload')
    return JSON.parse(opened.bearerToken) as T
  }

  private normalizeRecord(row: ConvexMcpRecord): McpServerRecord {
    const authConfig = row.encryptedAuthConfig
      ? this.cipher.decrypt(row.encryptedAuthConfig)
      : row.authConfig
    return {
      ...row,
      _id: String(row._id),
      authConfig,
      hasAuth: Boolean(authConfig) || row.oauthStatus === 'connected',
      defaultToolPolicy: row.defaultToolPolicy ?? 'allow',
      toolPolicies: row.toolPolicies ?? {},
      toolCatalog: row.toolCatalog ?? [],
      oauthTokens: row.encryptedOAuthTokens
        ? this.openJson<McpOAuthTokens>(row.encryptedOAuthTokens)
        : undefined,
      oauthClient: row.encryptedOAuthClient
        ? this.openJson<McpOAuthClient>(row.encryptedOAuthClient)
        : undefined,
    }
  }
}

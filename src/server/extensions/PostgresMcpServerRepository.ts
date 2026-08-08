import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { mcpOAuthSessions, mcpServers, mcpToolExecutions } from '@/server/database/postgres/schema'
import { assertActivePostgresProject } from '@/server/projects/PostgresProjectAccess'
import { McpCredentialCipher } from './McpCredentialCipher'
import type {
  CreateMcpServerInput,
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

type McpServerRow = typeof mcpServers.$inferSelect
type McpExecutionRow = typeof mcpToolExecutions.$inferSelect

export class PostgresMcpServerRepository implements McpServerRepository {
  constructor(
    private readonly db: OverlayPostgresDb,
    private readonly cipher = McpCredentialCipher.fromEnvironment(),
  ) {}

  async list(args: { userId: string; projectId?: string; workspaceId?: string }): Promise<McpServerSummary[]> {
    const rows = await this.selectServers(args)
    return rows.map(mapSummary)
  }

  async listEnabled(args: { userId: string; projectId?: string; workspaceId?: string }): Promise<McpServerRecord[]> {
    const rows = await this.selectServers(args, true)
    return rows.map((row) => this.mapRecord(row))
  }

  async get(args: { mcpServerId: string; userId: string; workspaceId?: string }): Promise<McpServerRecord | null> {
    const [row] = await this.db
      .select()
      .from(mcpServers)
      .where(and(
        eq(mcpServers.id, args.mcpServerId),
        eq(mcpServers.userId, args.userId),
        args.workspaceId ? eq(mcpServers.workspaceId, args.workspaceId) : undefined,
      ))
      .limit(1)
    return row ? this.mapRecord(row) : null
  }

  async create(args: CreateMcpServerInput): Promise<string> {
    await assertActivePostgresProject(this.db, args)
    const id = `mcp_${randomUUID()}`
    const authConfig = args.authType === 'none' ? undefined : args.authConfig
    await this.db.insert(mcpServers).values({
      authType: args.authType ?? 'none',
      defaultToolPolicy: args.defaultToolPolicy ?? 'allow',
      description: args.description?.trim(),
      enabled: args.enabled !== false,
      encryptedAuthConfig: this.cipher.encrypt(authConfig),
      id,
      name: args.name.trim(),
      projectId: args.projectId,
      timeoutMs: args.timeoutMs,
      toolPolicies: args.toolPolicies ?? {},
      transport: args.transport,
      url: args.url,
      userId: args.userId,
      workspaceId: args.workspaceId,
    })
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
    const rows = await this.db
      .update(mcpServers)
      .set({
        ...(args.name !== undefined ? { name: args.name.trim() } : {}),
        ...(args.description !== undefined ? { description: args.description.trim() } : {}),
        ...(args.transport !== undefined ? { transport: args.transport } : {}),
        ...(args.url !== undefined ? { url: args.url } : {}),
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.authType !== undefined ? { authType: args.authType } : {}),
        ...(shouldReplaceCredentials ? { encryptedAuthConfig: encryptedAuthConfig ?? null } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.defaultToolPolicy !== undefined ? { defaultToolPolicy: args.defaultToolPolicy } : {}),
        ...(args.toolPolicies !== undefined ? { toolPolicies: args.toolPolicies } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(mcpServers.id, args.mcpServerId),
        eq(mcpServers.userId, args.userId),
        args.workspaceId ? eq(mcpServers.workspaceId, args.workspaceId) : undefined,
      ))
      .returning({ id: mcpServers.id })
    if (rows.length === 0) throw new Error('Unauthorized')
  }

  async remove(args: { mcpServerId: string; userId: string; workspaceId?: string }): Promise<void> {
    const rows = await this.db
      .delete(mcpServers)
      .where(and(
        eq(mcpServers.id, args.mcpServerId),
        eq(mcpServers.userId, args.userId),
        args.workspaceId ? eq(mcpServers.workspaceId, args.workspaceId) : undefined,
      ))
      .returning({ id: mcpServers.id })
    if (rows.length === 0) throw new Error('Unauthorized')
  }

  async updateToolCatalog(args: {
    mcpServerId: string
    userId: string
    tools: McpServerRecord['toolCatalog']
    catalogError?: string
  }): Promise<void> {
    const rows = await this.db
      .update(mcpServers)
      .set({
        toolCatalog: args.tools,
        toolCatalogError: args.catalogError ?? null,
        toolCatalogUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(mcpServers.id, args.mcpServerId), eq(mcpServers.userId, args.userId)))
      .returning({ id: mcpServers.id })
    if (rows.length === 0) throw new Error('Unauthorized')
  }

  async recordExecution(args: Omit<McpExecutionRecord, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: number
  }): Promise<string> {
    const id = args.id ?? `mcp_execution_${randomUUID()}`
    await this.db.insert(mcpToolExecutions).values({
      argumentsHash: args.argumentsHash,
      conversationId: args.conversationId,
      createdAt: new Date(args.createdAt ?? Date.now()),
      durationMs: args.durationMs,
      errorMessage: args.errorMessage?.slice(0, 2_000),
      id,
      mcpServerId: args.mcpServerId,
      modelId: args.modelId,
      policyDecision: args.policyDecision,
      projectId: args.projectId,
      status: args.status,
      toolName: args.toolName,
      turnId: args.turnId,
      userId: args.userId,
    }).onConflictDoNothing()
    return id
  }

  async listExecutions(args: {
    userId: string
    mcpServerId?: string
    limit?: number
  }): Promise<McpExecutionRecord[]> {
    const rows = await this.db
      .select()
      .from(mcpToolExecutions)
      .where(and(
        eq(mcpToolExecutions.userId, args.userId),
        args.mcpServerId ? eq(mcpToolExecutions.mcpServerId, args.mcpServerId) : undefined,
      ))
      .orderBy(desc(mcpToolExecutions.createdAt))
      .limit(Math.min(Math.max(args.limit ?? 50, 1), 200))
    return rows.map(mapExecution)
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
    const patch: Partial<typeof mcpServers.$inferInsert> = { updatedAt: new Date() }
    if (args.tokens !== undefined) {
      patch.encryptedOauthTokens = args.tokens === null ? null : this.sealJson(args.tokens)
      patch.oauthTokenVersion = sql`${mcpServers.oauthTokenVersion} + 1` as unknown as number
      if (args.tokens !== null) patch.oauthConnectedAt = new Date()
    }
    if (args.client !== undefined) {
      patch.encryptedOauthClient = args.client === null ? null : this.sealJson(args.client)
      patch.oauthClientId = args.client === null ? null : args.client.clientId
    }
    if (args.status !== undefined) patch.oauthStatus = args.status
    if (args.issuer !== undefined) patch.oauthIssuer = args.issuer
    if (args.scope !== undefined) patch.oauthScope = args.scope
    if (args.resource !== undefined) patch.oauthResource = args.resource
    if (args.error !== undefined) patch.oauthError = args.error

    const rows = await this.db
      .update(mcpServers)
      .set(patch)
      .where(and(
        eq(mcpServers.id, args.mcpServerId),
        eq(mcpServers.userId, args.userId),
        args.expectedTokenVersion !== undefined
          ? eq(mcpServers.oauthTokenVersion, args.expectedTokenVersion)
          : undefined,
      ))
      .returning({ id: mcpServers.id })

    if (rows.length > 0) return true
    // A compare-and-set miss is an expected lost race, not an authorization failure.
    if (args.expectedTokenVersion !== undefined) return false
    throw new Error('Unauthorized')
  }

  async createOAuthSession(
    args: Omit<McpOAuthSession, 'createdAt'> & { createdAt?: number },
  ): Promise<void> {
    await this.db.insert(mcpOAuthSessions).values({
      id: args.id,
      userId: args.userId,
      mcpServerId: args.mcpServerId,
      encryptedCodeVerifier: this.sealJson({ codeVerifier: args.codeVerifier }),
      surface: args.surface,
      returnTo: args.returnTo,
      sessionBindingHash: args.sessionBindingHash,
      expiresAt: new Date(args.expiresAt),
      createdAt: new Date(args.createdAt ?? Date.now()),
    })
  }

  async consumeOAuthSession(args: { sessionId: string }): Promise<McpOAuthSession | null> {
    // Delete-and-return makes consumption atomic: a replayed `state` deletes nothing and gets null.
    const [row] = await this.db
      .delete(mcpOAuthSessions)
      .where(eq(mcpOAuthSessions.id, args.sessionId))
      .returning()
    if (!row) return null
    if (row.expiresAt.getTime() < Date.now()) return null
    return {
      id: row.id,
      userId: row.userId,
      mcpServerId: row.mcpServerId,
      codeVerifier: this.openJson<{ codeVerifier: string }>(row.encryptedCodeVerifier).codeVerifier,
      surface: row.surface,
      returnTo: row.returnTo ?? undefined,
      sessionBindingHash: row.sessionBindingHash ?? undefined,
      expiresAt: row.expiresAt.getTime(),
      createdAt: row.createdAt.getTime(),
    }
  }

  async deleteExpiredOAuthSessions(args: { now?: number } = {}): Promise<number> {
    const rows = await this.db
      .delete(mcpOAuthSessions)
      .where(lt(mcpOAuthSessions.expiresAt, new Date(args.now ?? Date.now())))
      .returning({ id: mcpOAuthSessions.id })
    return rows.length
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

  private async selectServers(
    args: { userId: string; projectId?: string; workspaceId?: string },
    enabledOnly = false,
  ): Promise<McpServerRow[]> {
    return await this.db
      .select()
      .from(mcpServers)
      .where(and(
        eq(mcpServers.userId, args.userId),
        args.projectId ? eq(mcpServers.projectId, args.projectId) : isNull(mcpServers.projectId),
        enabledOnly ? eq(mcpServers.enabled, true) : undefined,
        args.workspaceId ? eq(mcpServers.workspaceId, args.workspaceId) : undefined,
      ))
      .orderBy(desc(mcpServers.updatedAt))
      .limit(200)
  }

  private mapRecord(row: McpServerRow): McpServerRecord {
    return {
      ...mapCommon(row),
      authConfig: this.cipher.decrypt(row.encryptedAuthConfig ?? undefined),
      hasAuth: hasAuthFor(row),
      toolCatalog: row.toolCatalog,
      oauthTokens: row.encryptedOauthTokens
        ? this.openJson<McpOAuthTokens>(row.encryptedOauthTokens)
        : undefined,
      oauthClient: row.encryptedOauthClient
        ? this.openJson<McpOAuthClient>(row.encryptedOauthClient)
        : undefined,
    }
  }
}

function mapSummary(row: McpServerRow): McpServerSummary {
  return {
    ...mapCommon(row),
    hasAuth: hasAuthFor(row),
    toolCatalogCount: row.toolCatalog.length,
  }
}

function hasAuthFor(row: McpServerRow): boolean {
  return Boolean(row.encryptedAuthConfig) || row.oauthStatus === 'connected'
}

function mapCommon(row: McpServerRow) {
  return {
    _id: row.id,
    userId: row.userId,
    projectId: row.projectId ?? undefined,
    name: row.name,
    description: row.description ?? undefined,
    transport: row.transport,
    url: row.url,
    enabled: row.enabled,
    authType: row.authType,
    timeoutMs: row.timeoutMs ?? undefined,
    defaultToolPolicy: row.defaultToolPolicy,
    toolPolicies: row.toolPolicies,
    toolCatalogUpdatedAt: row.toolCatalogUpdatedAt?.getTime(),
    toolCatalogError: row.toolCatalogError ?? undefined,
    oauthStatus: row.oauthStatus ?? undefined,
    oauthClientId: row.oauthClientId ?? undefined,
    oauthIssuer: row.oauthIssuer ?? undefined,
    oauthScope: row.oauthScope ?? undefined,
    oauthResource: row.oauthResource ?? undefined,
    oauthConnectedAt: row.oauthConnectedAt?.getTime(),
    oauthError: row.oauthError ?? undefined,
    oauthTokenVersion: row.oauthTokenVersion,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function mapExecution(row: McpExecutionRow): McpExecutionRecord {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId ?? undefined,
    mcpServerId: row.mcpServerId,
    toolName: row.toolName,
    argumentsHash: row.argumentsHash,
    policyDecision: row.policyDecision,
    status: row.status,
    conversationId: row.conversationId ?? undefined,
    turnId: row.turnId ?? undefined,
    modelId: row.modelId ?? undefined,
    durationMs: row.durationMs ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt.getTime(),
  }
}

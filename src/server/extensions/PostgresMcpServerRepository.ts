import 'server-only'

import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { OverlayPostgresDb } from '@/server/database/postgres/client'
import { mcpServers, mcpToolExecutions } from '@/server/database/postgres/schema'
import { assertActivePostgresProject } from '@/server/projects/PostgresProjectAccess'
import { McpCredentialCipher } from './McpCredentialCipher'
import type {
  CreateMcpServerInput,
  McpExecutionRecord,
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

  async list(args: { userId: string; projectId?: string }): Promise<McpServerSummary[]> {
    const rows = await this.selectServers(args)
    return rows.map(mapSummary)
  }

  async listEnabled(args: { userId: string; projectId?: string }): Promise<McpServerRecord[]> {
    const rows = await this.selectServers(args, true)
    return rows.map((row) => this.mapRecord(row))
  }

  async get(args: { mcpServerId: string; userId: string }): Promise<McpServerRecord | null> {
    const [row] = await this.db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, args.mcpServerId), eq(mcpServers.userId, args.userId)))
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
      .where(and(eq(mcpServers.id, args.mcpServerId), eq(mcpServers.userId, args.userId)))
      .returning({ id: mcpServers.id })
    if (rows.length === 0) throw new Error('Unauthorized')
  }

  async remove(args: { mcpServerId: string; userId: string }): Promise<void> {
    const rows = await this.db
      .delete(mcpServers)
      .where(and(eq(mcpServers.id, args.mcpServerId), eq(mcpServers.userId, args.userId)))
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

  private async selectServers(
    args: { userId: string; projectId?: string },
    enabledOnly = false,
  ): Promise<McpServerRow[]> {
    return await this.db
      .select()
      .from(mcpServers)
      .where(and(
        eq(mcpServers.userId, args.userId),
        args.projectId ? eq(mcpServers.projectId, args.projectId) : isNull(mcpServers.projectId),
        enabledOnly ? eq(mcpServers.enabled, true) : undefined,
      ))
      .orderBy(desc(mcpServers.updatedAt))
      .limit(200)
  }

  private mapRecord(row: McpServerRow): McpServerRecord {
    return {
      ...mapCommon(row),
      authConfig: this.cipher.decrypt(row.encryptedAuthConfig ?? undefined),
      hasAuth: Boolean(row.encryptedAuthConfig),
      toolCatalog: row.toolCatalog,
    }
  }
}

function mapSummary(row: McpServerRow): McpServerSummary {
  return {
    ...mapCommon(row),
    hasAuth: Boolean(row.encryptedAuthConfig),
    toolCatalogCount: row.toolCatalog.length,
  }
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

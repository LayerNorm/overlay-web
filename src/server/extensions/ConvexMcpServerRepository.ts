import 'server-only'

import type { Id } from '../../../convex/_generated/dataModel'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { McpCredentialCipher } from './McpCredentialCipher'
import type {
  CreateMcpServerInput,
  McpAuthConfig,
  McpExecutionRecord,
  McpServerRecord,
  McpServerRepository,
  McpServerSummary,
  UpdateMcpServerInput,
} from './McpServerRepository'

type ConvexMcpRecord = Omit<McpServerRecord, '_id' | 'defaultToolPolicy' | 'toolPolicies' | 'toolCatalog' | 'hasAuth'> & {
  _id: Id<'mcpServers'>
  authConfig?: McpAuthConfig
  encryptedAuthConfig?: string
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

  private normalizeRecord(row: ConvexMcpRecord): McpServerRecord {
    const authConfig = row.encryptedAuthConfig
      ? this.cipher.decrypt(row.encryptedAuthConfig)
      : row.authConfig
    return {
      ...row,
      _id: String(row._id),
      authConfig,
      hasAuth: Boolean(authConfig),
      defaultToolPolicy: row.defaultToolPolicy ?? 'allow',
      toolPolicies: row.toolPolicies ?? {},
      toolCatalog: row.toolCatalog ?? [],
    }
  }
}

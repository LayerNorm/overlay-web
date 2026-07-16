import 'server-only'

export type McpAuthType = 'none' | 'bearer' | 'header'
export type McpTransport = 'sse' | 'streamable-http'
export type McpToolPolicyMode = 'allow' | 'approval_required' | 'deny'
export type McpExecutionStatus = 'succeeded' | 'failed' | 'denied'

export type McpAuthConfig = {
  bearerToken?: string
  headerName?: string
  headerValue?: string
}

export type McpToolCatalogEntry = {
  name: string
  description?: string
  inputSchema?: unknown
}

export type McpServerRecord = {
  _id: string
  userId: string
  projectId?: string
  name: string
  description?: string
  transport: McpTransport
  url: string
  enabled: boolean
  authType: McpAuthType
  authConfig?: McpAuthConfig
  hasAuth: boolean
  timeoutMs?: number
  defaultToolPolicy: McpToolPolicyMode
  toolPolicies: Record<string, McpToolPolicyMode>
  toolCatalog: McpToolCatalogEntry[]
  toolCatalogUpdatedAt?: number
  toolCatalogError?: string
  createdAt: number
  updatedAt: number
}

export type McpServerSummary = Omit<McpServerRecord, 'authConfig' | 'toolCatalog'> & {
  toolCatalogCount: number
}

export type CreateMcpServerInput = {
  userId: string
  projectId?: string
  name: string
  description?: string
  transport: McpTransport
  url: string
  enabled?: boolean
  authType?: McpAuthType
  authConfig?: McpAuthConfig
  timeoutMs?: number
  defaultToolPolicy?: McpToolPolicyMode
  toolPolicies?: Record<string, McpToolPolicyMode>
}

export type UpdateMcpServerInput = Partial<Omit<CreateMcpServerInput, 'userId'>> & {
  mcpServerId: string
  userId: string
}

export type McpExecutionRecord = {
  id: string
  userId: string
  projectId?: string
  mcpServerId: string
  toolName: string
  argumentsHash: string
  policyDecision: McpToolPolicyMode
  status: McpExecutionStatus
  conversationId?: string
  turnId?: string
  modelId?: string
  durationMs?: number
  errorMessage?: string
  createdAt: number
}

export interface McpServerRepository {
  list(args: { userId: string; projectId?: string }): Promise<McpServerSummary[]>
  listEnabled(args: { userId: string; projectId?: string }): Promise<McpServerRecord[]>
  get(args: { mcpServerId: string; userId: string }): Promise<McpServerRecord | null>
  create(args: CreateMcpServerInput): Promise<string>
  update(args: UpdateMcpServerInput): Promise<void>
  remove(args: { mcpServerId: string; userId: string }): Promise<void>
  updateToolCatalog(args: {
    mcpServerId: string
    userId: string
    tools: McpToolCatalogEntry[]
    catalogError?: string
  }): Promise<void>
  recordExecution(args: Omit<McpExecutionRecord, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: number
  }): Promise<string>
  listExecutions(args: {
    userId: string
    mcpServerId?: string
    limit?: number
  }): Promise<McpExecutionRecord[]>
}

export function resolveMcpToolPolicy(
  server: Pick<McpServerRecord, 'defaultToolPolicy' | 'toolPolicies'>,
  toolName: string,
): McpToolPolicyMode {
  return server.toolPolicies[toolName] ?? server.defaultToolPolicy
}

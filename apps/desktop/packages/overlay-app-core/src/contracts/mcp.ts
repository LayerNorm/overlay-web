export interface McpServerSummary {
  _id: string
  name: string
  description?: string
  transport: 'sse' | 'streamable-http'
  url: string
  enabled: boolean
  authType: 'none' | 'bearer' | 'header'
  hasAuth?: boolean
  timeoutMs?: number
  projectId?: string
  defaultToolPolicy?: McpToolPolicyMode
  toolPolicies?: Record<string, McpToolPolicyMode>
  toolCatalogCount?: number
  createdAt: number
  updatedAt: number
}

export type McpAuthType = 'none' | 'bearer' | 'header'
export type McpTransport = 'sse' | 'streamable-http'
export type McpToolPolicyMode = 'allow' | 'approval_required' | 'deny'

export type McpAuthConfig =
  | { bearerToken: string }
  | { headerName: string; headerValue: string }
  | Record<string, never>

export interface CreateMcpServerRequest {
  name: string
  description?: string
  transport: McpTransport
  url: string
  enabled?: boolean
  authType?: McpAuthType
  authConfig?: McpAuthConfig | null
  timeoutMs?: number
  projectId?: string
  defaultToolPolicy?: McpToolPolicyMode
  toolPolicies?: Record<string, McpToolPolicyMode>
  accessToken?: string
  userId?: string
}

export interface UpdateMcpServerRequest extends Partial<CreateMcpServerRequest> {
  mcpServerId: string
}

export interface TestMcpServerRequest {
  url: string
  transport?: McpTransport
  authType?: McpAuthType
  authConfig?: McpAuthConfig
  mcpServerId?: string
  timeoutMs?: number
  accessToken?: string
  userId?: string
}

export interface TestMcpServerResponse {
  ok: boolean
  toolCount?: number
  error?: string
}

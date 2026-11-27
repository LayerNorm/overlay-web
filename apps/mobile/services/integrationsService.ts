import { appJson, appList } from './appApi'
import type { IntegrationSummary, McpServerSummary, SkillSummary } from '@overlay/app-core'
import { getCurrentMode } from './modeState'

export async function listConnectedIntegrations(): Promise<{ connected: string[] }> {
  return appJson<{ connected: string[] }>('/api/v1/integrations')
}

export type IntegrationScope = 'personal' | 'workspace'
export type IntegrationRequestScope = { workspaceId: string; scope: IntegrationScope }

export async function listIntegrationItems(options: IntegrationRequestScope): Promise<{
  connected: string[]
  items?: IntegrationSummary[]
  workspaceConnectors?: Array<{ providerKey: string; canDisconnect: boolean }>
}> {
  return appJson('/api/v1/integrations', {
    workspaceId: options.workspaceId,
    query: { view: options.scope },
  })
}

export async function searchIntegrations(
  query: string,
  options: IntegrationRequestScope,
): Promise<{ items: IntegrationSummary[]; nextCursor?: string | null }> {
  return appJson('/api/v1/integrations', {
    workspaceId: options.workspaceId,
    query: { action: 'search', q: query || undefined, limit: 50, view: options.scope },
  })
}

export async function listSkills(): Promise<SkillSummary[]> {
  return appList<SkillSummary>('/api/v1/skills', { query: { view: getCurrentMode() } })
}

export async function connectIntegration(toolkit: string, options: IntegrationRequestScope): Promise<{
  redirectUrl?: string | null
  connectionId?: string | null
  status?: string | null
}> {
  return appJson('/api/v1/integrations', {
    method: 'POST',
    workspaceId: options.workspaceId,
    json: { action: 'connect', toolkit, scope: options.scope },
  })
}

export async function disconnectIntegration(toolkit: string, options: IntegrationRequestScope): Promise<void> {
  await appJson('/api/v1/integrations', {
    method: 'POST',
    workspaceId: options.workspaceId,
    json: { action: 'disconnect', toolkit, scope: options.scope },
  })
}

export async function createSkill(input: {
  name: string
  description: string
  instructions: string
  enabled?: boolean
}, requestOptions: { workspaceId?: string; signal?: AbortSignal } = {}): Promise<{ id: string }> {
  return appJson<{ id: string }>('/api/v1/skills', {
    method: 'POST',
    json: { ...input, scope: getCurrentMode() },
    ...requestOptions,
  })
}

export async function updateSkill(
  skillId: string,
  patch: Partial<Pick<SkillSummary, 'name' | 'description' | 'instructions' | 'enabled'>>,
): Promise<void> {
  await appJson('/api/v1/skills', {
    method: 'PATCH',
    json: { skillId, ...patch },
  })
}

export async function deleteSkill(skillId: string): Promise<void> {
  await appJson('/api/v1/skills', {
    method: 'DELETE',
    query: { skillId },
  })
}

export async function listMcpServers(): Promise<McpServerSummary[]> {
  return appList<McpServerSummary>('/api/v1/mcps', { query: { view: getCurrentMode() } })
}

export async function createMcpServer(input: {
  name: string
  description?: string
  transport: 'sse' | 'streamable-http'
  url: string
  enabled?: boolean
  authType?: 'none' | 'bearer' | 'header' | 'oauth'
  authConfig?: Record<string, unknown>
  timeoutMs?: number
}): Promise<{ id: string }> {
  return appJson<{ id: string }>('/api/v1/mcps', {
    method: 'POST',
    json: { ...input, scope: getCurrentMode() },
  })
}

export async function updateMcpServer(
  mcpServerId: string,
  patch: Partial<Omit<McpServerSummary, '_id' | 'createdAt' | 'updatedAt' | 'hasAuth'>> & {
    authConfig?: Record<string, unknown> | null
  },
): Promise<void> {
  await appJson('/api/v1/mcps', {
    method: 'PATCH',
    json: { mcpServerId, ...patch },
  })
}

export async function deleteMcpServer(mcpServerId: string): Promise<void> {
  await appJson('/api/v1/mcps', {
    method: 'DELETE',
    query: { mcpServerId },
  })
}

export async function testMcpServer(input: {
  url: string
  transport?: 'sse' | 'streamable-http'
  authType?: 'none' | 'bearer' | 'header' | 'oauth'
  authConfig?: Record<string, unknown>
  mcpServerId?: string
  timeoutMs?: number
}): Promise<{ ok: boolean; toolCount?: number; error?: string; requiresAuth?: boolean }> {
  return appJson('/api/v1/mcps/test', {
    method: 'POST',
    json: input,
  })
}

// ---------------------------------------------------------------------------
// MCP OAuth — POST /mcps/oauth returns the provider authorization URL. Mobile
// uses `surface: 'desktop'` so the callback finishes on the overlay:// deep
// link (same path the desktop app uses) instead of the web settings page.
// ---------------------------------------------------------------------------

export async function startMcpOAuth(input: {
  mcpServerId: string
  scope?: string
}): Promise<{ redirectUrl?: string; alreadyConnected?: boolean; error?: string }> {
  return appJson('/api/v1/mcps/oauth', {
    method: 'POST',
    json: { mcpServerId: input.mcpServerId, surface: 'desktop', scope: input.scope },
  })
}

export async function disconnectMcpOAuth(mcpServerId: string): Promise<void> {
  await appJson('/api/v1/mcps/oauth', {
    method: 'DELETE',
    query: { mcpServerId },
  })
}

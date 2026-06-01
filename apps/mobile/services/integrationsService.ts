import { appJson } from './appApi'
import type { IntegrationSummary, McpServerSummary, SkillSummary } from '@overlay/app-core'

export async function listConnectedIntegrations(): Promise<{ connected: string[] }> {
  return appJson<{ connected: string[] }>('/api/v1/integrations')
}

export async function listIntegrationItems(): Promise<{
  connected: string[]
  items?: IntegrationSummary[]
}> {
  return appJson<{ connected: string[]; items?: IntegrationSummary[] }>('/api/v1/integrations')
}

export async function searchIntegrations(query = ''): Promise<{
  items: IntegrationSummary[]
  nextCursor?: string | null
}> {
  return appJson<{ items: IntegrationSummary[]; nextCursor?: string | null }>(
    '/api/v1/integrations',
    {
      query: {
        action: 'search',
        q: query || undefined,
        limit: 50,
      },
    },
  )
}

export async function listSkills(projectId?: string): Promise<SkillSummary[]> {
  return appJson<SkillSummary[]>('/api/v1/skills', {
    query: { projectId: projectId || undefined },
  })
}

export async function connectIntegration(toolkit: string): Promise<{
  redirectUrl?: string | null
  connectionId?: string | null
  status?: string | null
}> {
  return appJson('/api/v1/integrations', {
    method: 'POST',
    json: { action: 'connect', toolkit },
  })
}

export async function disconnectIntegration(toolkit: string): Promise<void> {
  await appJson('/api/v1/integrations', {
    method: 'POST',
    json: { action: 'disconnect', toolkit },
  })
}

export async function createSkill(input: {
  name: string
  description: string
  instructions: string
  projectId?: string
}): Promise<{ id: string }> {
  return appJson<{ id: string }>('/api/v1/skills', {
    method: 'POST',
    json: input,
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
  return appJson<McpServerSummary[]>('/api/v1/mcps')
}

export async function createMcpServer(input: {
  name: string
  description?: string
  transport: 'sse' | 'streamable-http'
  url: string
  enabled?: boolean
  authType?: 'none' | 'bearer' | 'header'
  authConfig?: Record<string, unknown>
  timeoutMs?: number
}): Promise<{ id: string }> {
  return appJson<{ id: string }>('/api/v1/mcps', {
    method: 'POST',
    json: input,
  })
}

export async function updateMcpServer(
  mcpServerId: string,
  patch: Partial<Omit<McpServerSummary, '_id' | 'createdAt' | 'updatedAt' | 'hasAuth'>>,
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
  transport: 'sse' | 'streamable-http'
  authType?: 'none' | 'bearer' | 'header'
  authConfig?: Record<string, unknown>
}): Promise<{ ok: boolean; toolCount?: number; error?: string }> {
  return appJson('/api/v1/mcps/test', {
    method: 'POST',
    json: input,
  })
}

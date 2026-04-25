import { appJson } from './appApi'
import type { IntegrationSummary, SkillSummary } from '@overlay/app-core'

export async function listConnectedIntegrations(): Promise<{ connected: string[] }> {
  return appJson<{ connected: string[] }>('/api/app/integrations')
}

export async function searchIntegrations(query = ''): Promise<{
  items: IntegrationSummary[]
  nextCursor?: string | null
}> {
  return appJson<{ items: IntegrationSummary[]; nextCursor?: string | null }>(
    '/api/app/integrations',
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
  return appJson<SkillSummary[]>('/api/app/skills', {
    query: { projectId: projectId || undefined },
  })
}

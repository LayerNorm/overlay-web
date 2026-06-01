import { appJson } from './appApi'
import type {
  AutomationSchedule,
  AutomationRunDetail,
  AutomationRunSummary,
  AutomationSummary,
} from '@overlay/app-core'

export async function listAutomations(): Promise<AutomationSummary[]> {
  return appJson<AutomationSummary[]>('/api/v1/automations')
}

export async function createAutomation(input: {
  name: string
  description: string
  instructions: string
  enabled?: boolean
  schedule: AutomationSchedule
  timezone?: string
  projectId?: string
  modelId?: string
  concurrencyPolicy?: 'skip' | 'queue'
}): Promise<{ success: boolean; id: string }> {
  return appJson<{ success: boolean; id: string }>('/api/v1/automations', {
    method: 'POST',
    json: input,
  })
}

export async function updateAutomation(
  automationId: string,
  patch: {
    name?: string
    description?: string
    instructions?: string
    enabled?: boolean
    schedule?: AutomationSchedule
    timezone?: string
    projectId?: string
    modelId?: string
    concurrencyPolicy?: 'skip' | 'queue'
  },
): Promise<void> {
  await appJson('/api/v1/automations', {
    method: 'PATCH',
    json: { automationId, ...patch },
  })
}

export async function setAutomationEnabled(automationId: string, enabled: boolean): Promise<void> {
  await appJson('/api/v1/automations', {
    method: 'PATCH',
    json: { automationId, action: enabled ? 'resume' : 'pause' },
  })
}

export async function deleteAutomation(automationId: string): Promise<void> {
  await appJson('/api/v1/automations', {
    method: 'DELETE',
    query: { automationId },
  })
}

export async function listAutomationRuns(
  automationId: string,
): Promise<AutomationRunSummary[]> {
  return appJson<AutomationRunSummary[]>('/api/v1/automations', {
    query: { automationId, runs: true },
  })
}

export async function getAutomationRunDetail(
  automationId: string,
  automationRunId: string,
): Promise<AutomationRunDetail | null> {
  const runs = await listAutomationRuns(automationId)
  return (runs.find((run) => run._id === automationRunId) as AutomationRunDetail | undefined) ?? null
}

import { appJson, appXhrStreamSse } from './appApi'
import type {
  AutomationRunDetail,
  AutomationRunEvent,
  AutomationRunSummary,
  AutomationSchedule,
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

// ---------------------------------------------------------------------------
// Durable run lifecycle — mirrors POST /automations/[id]/run, the workflow
// status endpoint /automations/[workflowRunId]/stream, the SSE event feed at
// /automations/[workflowRunId]/events, and the approval hook at
// /automations/[id]/approve.
// ---------------------------------------------------------------------------

export interface AutomationRunTrigger {
  ok?: boolean
  runId?: string
  workflowRunId?: string
  durable?: boolean
  approvalRequired?: boolean
  approvalToken?: string
  error?: string
  message?: string
}

export async function runAutomationNow(automationId: string): Promise<AutomationRunTrigger> {
  return appJson<AutomationRunTrigger>(`/api/v1/automations/${encodeURIComponent(automationId)}/run`, {
    method: 'POST',
  })
}

export interface AutomationTestResult {
  success?: boolean
  runId?: string
  conversationId?: string
  error?: string
  message?: string
}

export async function testAutomation(automationId: string): Promise<AutomationTestResult> {
  return appJson<AutomationTestResult>('/api/v1/automations/test', {
    method: 'POST',
    json: { automationId },
  })
}

export async function cancelAutomationRun(automationId: string, runId: string): Promise<void> {
  await appJson('/api/v1/automations', {
    method: 'PATCH',
    json: { automationId, action: 'cancel-run', runId },
  })
}

export async function retryAutomationRun(automationId: string, runId: string): Promise<void> {
  await appJson('/api/v1/automations', {
    method: 'PATCH',
    json: { automationId, action: 'retry-run', runId },
  })
}

export interface AutomationWorkflowStatus {
  workflowRunId: string
  status: string
  workflowName?: string
  result?: { conversationId?: string; runId?: string }
  error?: string
}

export async function getAutomationRunStatus(
  workflowRunId: string,
): Promise<AutomationWorkflowStatus> {
  return appJson<AutomationWorkflowStatus>(
    `/api/v1/automations/${encodeURIComponent(workflowRunId)}/stream`,
  )
}

export type AutomationRunStreamMessage =
  | { type: 'connected'; workflowRunId: string }
  | { type: 'event'; event: AutomationRunEvent }
  | { type: 'terminal'; runStatus: string }
  | { type: 'error'; error: string }

export function streamAutomationRunEvents(
  workflowRunId: string,
  cursor?: string,
): AsyncGenerator<AutomationRunStreamMessage> {
  return appXhrStreamSse<AutomationRunStreamMessage>(
    `/api/v1/automations/${encodeURIComponent(workflowRunId)}/events`,
    { method: 'GET', query: { cursor } },
  )
}

export async function approveAutomationRun(
  automationId: string,
  input: { token: string; approved: boolean; reason?: string },
): Promise<void> {
  await appJson(`/api/v1/automations/${encodeURIComponent(automationId)}/approve`, {
    method: 'POST',
    json: input,
  })
}

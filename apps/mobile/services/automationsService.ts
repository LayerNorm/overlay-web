import { appJson, getRequestWorkspaceId } from './appApi'
import { createIdempotencyKey } from '@overlay/api-client'
import { api, convexWorkspaceId, queryConvex, subscribeConvex, type Id } from './convexClient'
import type {
  AutomationRunDetail,
  AutomationRunEvent,
  AutomationRunSummary,
  AutomationSchedule,
  AutomationSummary,
} from '@overlay/app-core'

export async function listAutomations(): Promise<AutomationSummary[]> {
  const rows = await queryConvex(api.automations.browse.list, { workspaceId: convexWorkspaceId(), includeAgentBound: true })
  if (rows === null) throw new Error('Automations are unavailable in this workspace.')
  return rows
}

export function subscribeAutomations(workspaceId: string, onValue: (rows: AutomationSummary[] | null) => void, onError: (error: unknown) => void) {
  return subscribeConvex(api.automations.browse.list, { workspaceId, includeAgentBound: true }, onValue, onError)
}

export function getAutomation(automationId: string) {
  return queryConvex(api.automations.browse.get, { workspaceId: convexWorkspaceId(), automationId: automationId as Id<'automations'> })
}

export function subscribeAutomationRuns(workspaceId: string, automationId: string, onValue: (rows: AutomationRunSummary[]) => void, onError: (error: unknown) => void) {
  return subscribeConvex(api.automations.browse.runs, { workspaceId, automationId: automationId as Id<'automations'> }, onValue, onError)
}

export function subscribeWorkflowSteps(args: { userId: string; accessToken: string; workflowRunId: string }, onValue: (events: AutomationRunEvent[]) => void, onError: (error: unknown) => void) {
  return subscribeConvex(api.automations.workflowEvents.watchWorkflowStepEvents, args, events => onValue(events.map(event => ({ eventId: event._id, eventType: event.stepStatus, stepName: event.stepName, attempt: event.attempt, error: event.error, stack: event.stack, createdAt: new Date(event.createdAt).toISOString() }))), onError)
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
  return appJson<{ success: boolean; id: string }>('/api/v1/automations', { workspaceId: getRequestWorkspaceId(),
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
  await appJson('/api/v1/automations', { workspaceId: getRequestWorkspaceId(),
    method: 'PATCH',
    json: { automationId, ...patch },
  })
}

export async function setAutomationEnabled(automationId: string, enabled: boolean): Promise<void> {
  await appJson('/api/v1/automations', { workspaceId: getRequestWorkspaceId(),
    method: 'PATCH',
    json: { automationId, action: enabled ? 'resume' : 'pause' },
  })
}

export async function deleteAutomation(automationId: string): Promise<void> {
  await appJson('/api/v1/automations', { workspaceId: getRequestWorkspaceId(),
    method: 'DELETE',
    query: { automationId },
  })
}

export async function listAutomationRuns(
  automationId: string,
): Promise<AutomationRunSummary[]> {
  return queryConvex(api.automations.browse.runs, { workspaceId: convexWorkspaceId(), automationId: automationId as Id<'automations'> })
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

export async function runAutomationNow(automationId: string, idempotencyKey = createIdempotencyKey()): Promise<AutomationRunTrigger> {
  return appJson<AutomationRunTrigger>(`/api/v1/automations/${encodeURIComponent(automationId)}/run`, { workspaceId: getRequestWorkspaceId(),
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
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
  return appJson<AutomationTestResult>('/api/v1/automations/test', { workspaceId: getRequestWorkspaceId(),
    method: 'POST',
    json: { automationId },
  })
}

export async function cancelAutomationRun(automationId: string, runId: string): Promise<void> {
  await appJson('/api/v1/automations', { workspaceId: getRequestWorkspaceId(),
    method: 'PATCH',
    json: { automationId, action: 'cancel-run', runId },
  })
}

export async function retryAutomationRun(automationId: string, runId: string): Promise<void> {
  await appJson('/api/v1/automations', { workspaceId: getRequestWorkspaceId(),
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


export async function approveAutomationRun(
  automationId: string,
  input: { token: string; approved: boolean; reason?: string },
): Promise<void> {
  await appJson(`/api/v1/automations/${encodeURIComponent(automationId)}/approve`, { workspaceId: getRequestWorkspaceId(),
    method: 'POST',
    json: input,
  })
}

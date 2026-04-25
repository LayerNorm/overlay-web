import { appJson } from './appApi'
import type {
  AutomationRunDetail,
  AutomationRunSummary,
  AutomationSummary,
} from '@overlay/app-core'

export async function listAutomations(): Promise<AutomationSummary[]> {
  return appJson<AutomationSummary[]>('/api/app/automations')
}

export async function runAutomation(automationId: string): Promise<{
  success?: boolean
  automationRunId?: string
  resultSummary?: string
}> {
  return appJson('/api/app/automations/run-now', {
    method: 'POST',
    json: { automationId },
  })
}

export async function listAutomationRuns(
  automationId: string,
): Promise<AutomationRunSummary[]> {
  return appJson<AutomationRunSummary[]>('/api/app/automations/runs', {
    query: { automationId },
  })
}

export async function getAutomationRunDetail(
  automationRunId: string,
): Promise<AutomationRunDetail> {
  return appJson<AutomationRunDetail>('/api/app/automations/runs/detail', {
    query: { automationRunId },
  })
}

export async function retryAutomationRun(automationRunId: string): Promise<{
  success?: boolean
  automationRunId?: string
}> {
  return appJson('/api/app/automations/runs/retry', {
    method: 'POST',
    json: { automationRunId },
  })
}

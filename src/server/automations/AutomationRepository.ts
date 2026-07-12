import 'server-only'

import type {
  AutomationRunSummary,
  AutomationSchedule,
  AutomationSummary,
} from '@overlay/app-core'

export type { AutomationSchedule } from '@overlay/app-core'

export type AutomationRecord = AutomationSummary & {
  userId: string
}

export type AutomationForUpdateNote = AutomationRecord

export type AutomationRunTarget = AutomationRecord

export type AutomationExecutionPayload = {
  run: AutomationRunSummary & {
    userId: string
  }
  automation: AutomationRunTarget
}

export type CreateAutomationInput = {
  userId: string
  name: string
  description?: string
  instructions: string
  enabled?: boolean
  schedule: AutomationSchedule
  timezone?: string
  projectId?: string
  modelId?: string
  graphSource?: string
  sourceConversationId?: string
  concurrencyPolicy?: 'skip' | 'queue'
}

export type UpdateAutomationInput = Partial<Omit<CreateAutomationInput, 'userId'>> & {
  automationId: string
  userId: string
}

export interface AutomationRepository {
  listAutomations(args: {
    includeDeleted?: boolean
    projectId?: string
    userId: string
  }): Promise<AutomationRecord[]>
  listRuns(args: {
    automationId: string
    userId: string
  }): Promise<AutomationRunSummary[]>
  getAutomation(args: {
    automationId: string
    userId: string
  }): Promise<AutomationForUpdateNote | null>
  getAutomationRunTarget(args: {
    automationId: string
    userId: string
  }): Promise<AutomationRunTarget | null>
  createAutomation(args: CreateAutomationInput): Promise<string>
  updateAutomation(args: UpdateAutomationInput): Promise<void>
  pauseAutomation(args: {
    automationId: string
    userId: string
  }): Promise<void>
  resumeAutomation(args: {
    automationId: string
    userId: string
  }): Promise<void>
  removeAutomation(args: {
    automationId: string
    userId: string
  }): Promise<void>
  requestRunCancellation(args: {
    runId: string
    userId: string
  }): Promise<boolean>
  retryRun(args: {
    runId: string
    userId: string
  }): Promise<string | null>
  removeConversation(args: {
    conversationId: string
    userId: string
  }): Promise<void>
  appendAutomationUpdateNote(args: {
    automationId: string
    content: string
    conversationId: string
    userId: string
  }): Promise<void>
  createManualRun(args: {
    automationId: string
    scheduledFor: number
    userId: string
  }): Promise<string | null>
  markManualRunStarted(args: {
    conversationId?: string
    now: number
    runId: string
    turnId: string
    userId: string
  }): Promise<void>
  markManualRunCompleted(args: {
    conversationId: string
    now: number
    runId: string
    userId: string
  }): Promise<void>
  markManualRunFailed(args: {
    error: string
    now: number
    runId: string
    userId: string
  }): Promise<void>
  getRunForExecution(args: {
    runId: string
  }): Promise<AutomationExecutionPayload | null>
}

export type AutomationSchedule =
  | { kind: 'interval'; intervalMinutes?: number }
  | { kind: 'daily'; hourUTC?: number; minuteUTC?: number }
  | { kind: 'weekly'; dayOfWeekUTC?: number; hourUTC?: number; minuteUTC?: number }
  | { kind: 'monthly'; dayOfMonthUTC?: number; hourUTC?: number; minuteUTC?: number }

export interface AutomationSummary {
  _id: string
  name?: string
  title?: string
  description?: string
  instructions?: string
  instructionsMarkdown?: string
  enabled?: boolean
  schedule?: AutomationSchedule
  timezone?: string
  nextRunAt?: number
  lastRunAt?: number
  lastRunStatus?: string
  lastError?: string
  projectId?: string
  modelId?: string
  graphSource?: string
  sourceConversationId?: string
  conversationId?: string
  concurrencyPolicy?: 'skip' | 'queue'
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'skipped'
  | 'dead_letter'

export interface AutomationRunSummary {
  _id: string
  automationId: string
  userId?: string
  status: AutomationRunStatus
  scheduledFor: number
  startedAt?: number
  completedAt?: number
  finishedAt?: number
  conversationId?: string
  turnId?: string
  error?: string
  errorCode?: string
  errorMessage?: string
  resultSummary?: string
  retryOfRunId?: string
  triggerSource?: string
  createdAt: number
  updatedAt?: number
}

export interface AutomationRunDetail extends AutomationRunSummary {
  attemptNumber?: number
  assistantMessage?: string
  assistantPersisted?: boolean
  durationMs?: number
  executor?: unknown
  failureStage?: string
  lastHeartbeatAt?: number
  mode?: 'ask' | 'act'
  modelId?: string
  promptSnapshot?: string
  readinessState?: string
  requestId?: string
  stage?: string
}

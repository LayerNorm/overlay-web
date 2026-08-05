export type AutomationSchedule =
  | { kind: 'interval'; intervalMinutes?: number }
  | { kind: 'daily'; hourUTC?: number; minuteUTC?: number }
  | { kind: 'weekly'; dayOfWeekUTC?: number; hourUTC?: number; minuteUTC?: number }
  | { kind: 'monthly'; dayOfMonthUTC?: number; hourUTC?: number; minuteUTC?: number }

// ---------------------------------------------------------------------------
// AutomationGraph — versioned, structured graph model for automations.
//
// This is the source of truth for the visual editor and (in Step 3) for
// durable step execution. The legacy `graphSource` Mermaid string is now a
// derived projection computed from this model.
//
// Node kinds:
//   trigger   — schedule or event that starts the automation (root node)
//   prompt    — an LLM prompt step (the current linear chain is all prompts)
//   tool      — a specific tool execution step
//   condition — a branch/conditional node (wired in Step 5)
//   output    — writes a result to the automation chat or external sink
//
// The schema supports branching/parallelism from day one, but Step 3 only
// wires up linear execution. Branch execution arrives in Step 5.
// ---------------------------------------------------------------------------

export const AUTOMATION_GRAPH_VERSION = 1 as const

export type AutomationGraphNodeKind = 'trigger' | 'prompt' | 'tool' | 'condition' | 'output'

export interface AutomationGraphNodeConfig {
  /** Prompt text for `prompt` nodes; tool name/args for `tool` nodes; etc. */
  text?: string
  /** Model ID override for this node (falls back to automation-level `modelId`). */
  modelId?: string
  /** Tool identifier for `tool` nodes. */
  toolId?: string
  /** Condition expression for `condition` nodes. */
  condition?: string
  /** Output destination label for `output` nodes. */
  outputKind?: string
  /** Schedule config for `trigger` nodes (mirrors AutomationSchedule). */
  schedule?: AutomationSchedule
  /** Arbitrary extra config keys. */
  [key: string]: unknown
}

export interface AutomationGraphNode {
  id: string
  kind: AutomationGraphNodeKind
  label: string
  config: AutomationGraphNodeConfig
  /** User-adjusted position from the visual editor. Auto-computed if absent. */
  position?: { x: number; y: number }
}

export interface AutomationGraphEdge {
  from: string
  to: string
  /** Condition label for edges leaving a `condition` node. */
  condition?: string
}

export interface AutomationGraph {
  version: typeof AUTOMATION_GRAPH_VERSION
  nodes: AutomationGraphNode[]
  edges: AutomationGraphEdge[]
}

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
  /** Structured graph model — the source of truth for the visual editor. */
  graph?: AutomationGraph
  /** Legacy Mermaid string, now derived from `graph`. Kept for backward compat. */
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
  workflowRunId?: string
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

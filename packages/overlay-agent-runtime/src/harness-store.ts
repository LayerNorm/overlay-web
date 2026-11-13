export const HARNESS_CONTROL_TOOLS = [
  'harness_set_plan',
  'harness_update_step',
  'harness_read_evidence',
  'harness_read_artifact',
  'harness_report_blocker',
  'harness_delegate',
  'harness_read_child',
] as const

import type {
  HarnessCheckpointPurpose, HarnessChild, HarnessEvidence, HarnessPlanInput, HarnessPolicy, HarnessReceipt,
  HarnessSnapshot, HarnessStepStatus,
  HarnessCompaction,
} from './harness-state'
import type { HarnessDiagnostic } from './harness-diagnostic'

export type HarnessToolFailureIssue = {
  path: string[]
  code: 'custom' | 'invalid_element' | 'invalid_format' | 'invalid_input' | 'invalid_key' | 'invalid_type'
    | 'invalid_union' | 'invalid_value' | 'not_multiple_of' | 'too_big' | 'too_small' | 'unrecognized_keys'
}

export type HarnessToolFailure = {
  toolCallId: string
  toolName: string
  phase: 'pre_dispatch' | 'execution'
  causeClass: 'abort_error' | 'convex_error' | 'error' | 'range_error' | 'schema_validation'
    | 'timeout_error' | 'type_error' | 'unknown_error' | 'zod_error'
  causeCode: 'ABORT_ERR' | 'EAI_AGAIN' | 'ECONNREFUSED' | 'ECONNRESET' | 'ENOTFOUND' | 'ETIMEDOUT'
    | 'INVALID_TOOL_INPUT' | 'TOOL_EXECUTION_FAILED' | 'ZOD_ERROR_DURING_EXECUTION'
  safeSummary: 'Tool input was rejected before execution.' | 'Tool execution failed; its effect may be uncertain.'
  validationIssues?: HarnessToolFailureIssue[]
}

export type HarnessSource = { conversationId: string; noteId?: never } | { noteId: string; conversationId?: never }

export type HarnessAdmission = {
  runId: string
  goal: string
  constraints: string[]
  policy: HarnessPolicy
  source: HarnessSource
  deliveryAgentRunId?: string
}

export type HarnessOperation =
  | { type: 'claim_execution'; workflowRunId: string; generation?: number }
  | { type: 'reserve_model'; id: string; maxCostMicros: number }
  | { type: 'bind_model_dispatch'; id: string; modelId: string; billingReservationId: string | null }
  | { type: 'replace_plan'; steps: HarnessPlanInput[] }
  | { type: 'transition_step'; id: string; status: HarnessStepStatus; evidenceRefs?: string[]; skipReason?: string }
  | { type: 'record_evidence'; evidence: HarnessEvidence }
  | { type: 'record_tool_failure'; failure: HarnessToolFailure }
  | { type: 'record_verification'; verification: import('./harness-state').HarnessVerification }
  | { type: 'set_compaction'; compaction: HarnessCompaction }
  | { type: 'record_receipt'; receipt: HarnessReceipt }
  | { type: 'checkpoint'; summary: string; purpose?: HarnessCheckpointPurpose; unverifiedNarrative?: string }
  | { type: 'block'; blocker: NonNullable<HarnessSnapshot['blocker']>; diagnostic?: HarnessDiagnostic }
  | { type: 'record_diagnostic'; diagnostic: HarnessDiagnostic }
  | { type: 'resume' }
  | { type: 'pause_for_authorization' }
  | { type: 'wait_for_children' }
  | { type: 'admit_child'; child: HarnessChild; goal: string; constraints: string[] }
  | {
      type: 'admit_named_child'
      child: HarnessChild
      step: { title: string; acceptanceCriteria: string[] }
      goal: string
      constraints: string[]
      target: { deliveryAgentRunId: string; conversationId: string }
    }
  | { type: 'settle_child'; childRunId: string }
  | { type: 'finish'; resultSummary?: string }
  | { type: 'terminate'; status: 'cancelled' | 'failed'; reason: string; diagnostic?: HarnessDiagnostic }

export type HarnessMutationInput = {
  actorUserId: string
  runId: string
  workflowRunId: string
  executionGeneration: number
  operationId: string
  expectedRevision: number
  operation: HarnessOperation
}

export type HarnessMutationResult = {
  applied: boolean
  conflict: boolean
  snapshot: HarnessSnapshot
}

export type HarnessWaitRequest =
  | { kind: 'input'; token: string }
  | {
      kind: 'approval'
      token: string
      requests: Array<{ approvalId: string; toolCallId: string; toolName: string; input: unknown }>
    }

export type HarnessWait = HarnessWaitRequest & {
  runId: string
  rootRunId: string
  workflowRunId: string
  question: string
  createdAt: number
  resolvedAt?: number
}

export type HarnessWaitReference = {
  actorUserId: string
  runId: string
  workflowRunId: string
}

export type HarnessTranscriptPersistence = {
  content: string
  parts: Array<Record<string, unknown>>
  /** The model call stopped at its output-token cap; the next call continues its text. */
  outputLimitReached?: boolean
}

export type HarnessTranscriptStep = {
  receiptId: string
  stepNumber: number
  sequence: number
  executionGeneration?: number
  persistence: HarnessTranscriptPersistence
  fullPersistenceUrl?: string | null
  fullPersistenceDigest?: string
}

export type HarnessTranscriptPage = {
  steps: HarnessTranscriptStep[]
  cursor: string
  isDone: boolean
}

export interface HarnessRepository {
  admit(input: HarnessAdmission): Promise<HarnessSnapshot>
  get(input: { actorUserId: string; runId: string }): Promise<HarnessSnapshot | null>
  apply(input: HarnessMutationInput): Promise<HarnessMutationResult>
  readEvidence(input: { actorUserId: string; runId: string; evidenceId?: string; cursor?: string; limit?: number }): Promise<
    HarnessEvidence | null
    | { observations: Array<Pick<HarnessEvidence, 'id' | 'source' | 'verdict' | 'createdAt'>>; nextCursor: string | null }
  >
  publishWait(input: HarnessWaitReference & { request: HarnessWaitRequest }): Promise<HarnessWait>
  resolveWait(input: HarnessWaitReference & { token: string }): Promise<void>
  listPendingWaits(input: HarnessWaitReference): Promise<HarnessWait[]>
}

import type {
  HarnessCheckpointPurpose, HarnessChild, HarnessEvidence, HarnessPlanInput, HarnessPolicy, HarnessReceipt,
  HarnessSnapshot, HarnessStepStatus,
  HarnessCompaction,
} from './harness-state'
import type {
  HarnessConsumeResourceGrantInput,
  HarnessGrantResourcesInput,
  HarnessResourcePauseInput,
  HarnessResourceRequestRecord,
  HarnessResourceRequestReference,
  HarnessResourceConsumeResult,
  HarnessResourceGrantReceipt,
} from './harness-resource'

export type HarnessSource = { conversationId: string; noteId?: never } | { noteId: string; conversationId?: never }

export type HarnessAdmission = {
  runId: string
  goal: string
  constraints: string[]
  policy: HarnessPolicy
  source: HarnessSource
  deliveryAgentRunId?: string
  resourcePauseAuthority?: 'personal_chat_work'
}

export type HarnessOperation =
  | { type: 'claim_execution'; workflowRunId: string }
  | { type: 'reserve_model'; id: string; maxCostMicros: number }
  | { type: 'bind_model_dispatch'; id: string; modelId: string; billingReservationId: string | null }
  | { type: 'replace_plan'; steps: HarnessPlanInput[] }
  | { type: 'transition_step'; id: string; status: HarnessStepStatus; evidenceRefs?: string[]; skipReason?: string }
  | { type: 'record_evidence'; evidence: HarnessEvidence }
  | { type: 'record_verification'; verification: import('./harness-state').HarnessVerification }
  | { type: 'set_compaction'; compaction: HarnessCompaction }
  | { type: 'record_receipt'; receipt: HarnessReceipt }
  | { type: 'checkpoint'; summary: string; purpose?: HarnessCheckpointPurpose; unverifiedNarrative?: string }
  | { type: 'block'; blocker: NonNullable<HarnessSnapshot['blocker']> }
  | { type: 'resume' }
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
  | { type: 'terminate'; status: 'cancelled' | 'failed'; reason: string }

export type HarnessMutationInput = {
  actorUserId: string
  runId: string
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

export interface HarnessRepository {
  admit(input: HarnessAdmission): Promise<HarnessSnapshot>
  get(input: { actorUserId: string; runId: string }): Promise<HarnessSnapshot | null>
  apply(input: HarnessMutationInput): Promise<HarnessMutationResult>
  readEvidence(input: { actorUserId: string; runId: string; evidenceId: string }): Promise<HarnessEvidence | null>
  publishWait(input: HarnessWaitReference & { request: HarnessWaitRequest }): Promise<HarnessWait>
  resolveWait(input: HarnessWaitReference & { token: string }): Promise<void>
  listPendingWaits(input: HarnessWaitReference): Promise<HarnessWait[]>
  pauseForResources(input: HarnessResourcePauseInput): Promise<HarnessResourceRequestRecord>
  getResourceRequest(input: HarnessResourceRequestReference): Promise<HarnessResourceRequestRecord | null>
  grantResources(input: HarnessGrantResourcesInput): Promise<HarnessResourceGrantReceipt>
  consumeResourceGrant(input: HarnessConsumeResourceGrantInput): Promise<HarnessResourceConsumeResult>
}

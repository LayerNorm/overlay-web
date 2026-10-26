import type {
  HarnessChild, HarnessEvidence, HarnessPlanInput, HarnessPolicy, HarnessReceipt,
  HarnessSnapshot, HarnessStepStatus,
} from './harness-state'

export type HarnessSource = { conversationId: string; noteId?: never } | { noteId: string; conversationId?: never }

export type HarnessAdmission = {
  runId: string
  goal: string
  constraints: string[]
  policy: HarnessPolicy
  source: HarnessSource
}

export type HarnessOperation =
  | { type: 'claim_execution'; workflowRunId: string }
  | { type: 'replace_plan'; steps: HarnessPlanInput[] }
  | { type: 'transition_step'; id: string; status: HarnessStepStatus; evidenceRefs?: string[]; skipReason?: string }
  | { type: 'record_evidence'; evidence: HarnessEvidence }
  | { type: 'record_receipt'; receipt: HarnessReceipt }
  | { type: 'checkpoint'; summary: string }
  | { type: 'block'; blocker: NonNullable<HarnessSnapshot['blocker']> }
  | { type: 'resume' }
  | { type: 'wait_for_children' }
  | { type: 'admit_child'; child: HarnessChild; goal: string; constraints: string[] }
  | { type: 'settle_child'; childRunId: string }
  | { type: 'finish' }
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

export interface HarnessRepository {
  admit(input: HarnessAdmission): Promise<HarnessSnapshot>
  get(input: { actorUserId: string; runId: string }): Promise<HarnessSnapshot | null>
  apply(input: HarnessMutationInput): Promise<HarnessMutationResult>
  readEvidence(input: { actorUserId: string; runId: string; evidenceId: string }): Promise<HarnessEvidence | null>
}

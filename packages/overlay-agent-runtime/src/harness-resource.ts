import type { HarnessStatus } from './harness-state'

export const MAX_HARNESS_RESOURCE_SPEND_MICROS = 100_000_000

export const HARNESS_RESOURCE_TIME_GRANTS_MS = [
  3_600_000,
  86_400_000,
  604_800_000,
] as const

export type HarnessResourceReason = 'model_spend' | 'time'

export type HarnessResourceRequest = {
  token: string
  runId: string
  rootRunId: string
  workflowRunId: string
  policyRevision: number
  reason: HarnessResourceReason
  currentMaxCostMicros: number
  usedCostMicros: number
  reservedCostMicros: number
  requiredCostMicros: number
  deadlineAt: number
  requestedAt: number
}

export type HarnessResourceGrant =
  | { kind: 'model_spend'; newMaxCostMicros: number }
  | { kind: 'time'; durationMs: number }

export type HarnessResourceGrantReceipt = {
  token: string
  runId: string
  rootRunId: string
  workflowRunId: string
  grant: HarnessResourceGrant
  policyRevisionBefore: number
  policyRevisionAfter: number
  grantedAt: number
  maxCostMicros: number
  deadlineAt: number
}

export type HarnessResourceDeliveryProjection = {
  request: HarnessResourceRequest
  receipt?: HarnessResourceGrantReceipt
  awaitingReceipt: boolean
}

export type HarnessResourceRequestRecord = {
  request: HarnessResourceRequest
  previousStatus: Extract<HarnessStatus, 'running' | 'waiting_for_input' | 'waiting_for_approval'>
  previousBlocker?: { kind: 'input' | 'approval' | 'stuck'; question: string }
  authority: {
    actorUserId: string
    workspaceId: string
    conversationId: string
    deliveryAgentRunId: string
    billingAccountId: string
    admissionMarker: 'personal_chat_work'
  }
  state: 'pending' | 'accepted' | 'consumed'
  receipt?: HarnessResourceGrantReceipt
  wakePending: boolean
  consumedAt?: number
}

export type HarnessResourcePauseInput = {
  actorUserId: string
  runId: string
  workflowRunId: string
  expectedRevision: number
  token: string
  reason: HarnessResourceReason
  requiredCostMicros: number
}

export type HarnessResourceRequestReference = {
  actorUserId: string
  runId: string
  workflowRunId: string
  token: string
}

export type HarnessGrantResourcesInput = HarnessResourceRequestReference & {
  workspaceId: string
  policyRevision: number
  grant: HarnessResourceGrant
}

export type HarnessConsumeResourceGrantInput = HarnessResourceRequestReference

export type HarnessResourceConsumeResult =
  | { status: 'pending' }
  | { status: 'pending'; reason: 'awaiting_receipt' }
  | { status: 'consumed'; request: HarnessResourceRequestRecord }

export function assertSafeResourceMicros(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe-integer number of micros.`)
  }
}

export function calculateHarnessResourceGrantReceipt(input: {
  request: HarnessResourceRequest
  grant: HarnessResourceGrant
  grantedAt: number
}): HarnessResourceGrantReceipt {
  const { request, grant, grantedAt } = input
  if (!request.token || !request.runId || !request.rootRunId || !request.workflowRunId) {
    throw new Error('A resource grant requires a complete request identity.')
  }
  if (!Number.isSafeInteger(request.policyRevision) || request.policyRevision < 0
    || request.policyRevision === Number.MAX_SAFE_INTEGER) {
    throw new Error('The resource request policy revision is invalid.')
  }
  assertSafeResourceMicros(request.currentMaxCostMicros, 'Current max cost')
  assertSafeResourceMicros(request.usedCostMicros, 'Used cost')
  assertSafeResourceMicros(request.reservedCostMicros, 'Reserved cost')
  assertSafeResourceMicros(request.requiredCostMicros, 'Required cost')
  if (!Number.isSafeInteger(request.deadlineAt) || request.deadlineAt < 0
    || !Number.isSafeInteger(request.requestedAt) || request.requestedAt < 0
    || !Number.isSafeInteger(grantedAt) || grantedAt < 0) {
    throw new Error('A resource grant requires finite timestamps.')
  }
  if (request.reason !== grant.kind) throw new Error('The grant scope must match the resource request reason.')

  const revisionAfter = request.policyRevision + 1
  if (grant.kind === 'model_spend') {
    assertSafeResourceMicros(grant.newMaxCostMicros, 'New max cost')
    if (grant.newMaxCostMicros <= request.currentMaxCostMicros
      || grant.newMaxCostMicros > MAX_HARNESS_RESOURCE_SPEND_MICROS) {
      throw new Error('The model-spend grant must increase the cap without exceeding 100,000,000 micros.')
    }
    const commitments = request.usedCostMicros + request.reservedCostMicros + request.requiredCostMicros
    assertSafeResourceMicros(commitments, 'Current commitments and forecast')
    if (grant.newMaxCostMicros < commitments) {
      throw new Error('The model-spend grant must cover current commitments and the forecast.')
    }
    return {
      token: request.token,
      runId: request.runId,
      rootRunId: request.rootRunId,
      workflowRunId: request.workflowRunId,
      grant: { ...grant },
      policyRevisionBefore: request.policyRevision,
      policyRevisionAfter: revisionAfter,
      grantedAt,
      maxCostMicros: grant.newMaxCostMicros,
      deadlineAt: request.deadlineAt,
    }
  }

  if (grant.kind !== 'time' || !HARNESS_RESOURCE_TIME_GRANTS_MS.includes(grant.durationMs as (typeof HARNESS_RESOURCE_TIME_GRANTS_MS)[number])) {
    throw new Error('The time grant duration is unsupported.')
  }
  const deadlineAt = Math.max(request.deadlineAt, grantedAt) + grant.durationMs
  if (!Number.isSafeInteger(deadlineAt)) throw new Error('The resulting resource deadline is outside the safe range.')
  return {
    token: request.token,
    runId: request.runId,
    rootRunId: request.rootRunId,
    workflowRunId: request.workflowRunId,
    grant: { ...grant },
    policyRevisionBefore: request.policyRevision,
    policyRevisionAfter: revisionAfter,
    grantedAt,
    maxCostMicros: request.currentMaxCostMicros,
    deadlineAt,
  }
}

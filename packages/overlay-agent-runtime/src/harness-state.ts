import { harnessDiagnosticMessage, type HarnessDiagnostic } from './harness-diagnostic'
import { isSafeHarnessFundingCents, type HarnessResourceGrantReceipt } from './harness-resource'

export type HarnessStatus = 'running' | 'waiting_for_input' | 'waiting_for_approval' | 'waiting_for_children' | 'waiting_for_resources' | 'waiting_for_authorization' | 'completed' | 'cancelled' | 'failed'
export type HarnessAuthorizationPause = {
  reason: 'task_deadline_expired'
  deadlineAt: number
  pausedAt: number
}
export type HarnessFundingPauseReason =
  | 'disabled' | 'pending' | 'payment_failed' | 'monthly_limit_reached' | 'missing_payment_method'
  | 'missing_consent' | 'amount_shortfall' | 'not_paid' | 'authorization_changed' | 'insufficient_budget'
  | 'task_deadline_expired' | 'unknown_receipt'

export type HarnessFundingPause = {
  reason: HarnessFundingPauseReason
  requiredCents: number
  availableCents: number
  reservedCents?: number
  receiptId: string
  autoTopUpReason?: string
}
export type HarnessStepStatus = 'pending' | 'running' | 'blocked' | 'verifying' | 'done' | 'skipped'

export type HarnessPlanStep = {
  id: string
  title: string
  dependsOn: string[]
  acceptanceCriteria: string[]
  requiresVerification: boolean
  evidenceTools?: string[]
  answerOnly?: boolean
  status: HarnessStepStatus
  evidenceRefs: string[]
  skipReason?: string
  childRunId?: string
}

export type HarnessEvidence = {
  id: string
  kind: 'tool_result' | 'artifact' | 'verification' | 'user_input'
  summary: string
  source: string
  verdict: 'observed' | 'passed' | 'failed'
  createdAt: number
  inputDigest?: string
  resource?: {
    id: string
    revision?: string
    operation?: string
    page?: number
  }
  verification?: { stepId: string; planRevision: number }
}

export type HarnessVerification = {
  attemptId: string
  candidateDigest: string
  planRevision: number
  evidenceRevision: number
  supported: boolean
  reason: string
  evidenceIds: string[]
  attempts: number
  createdAt: number
}

export type HarnessCompaction = {
  cycleId: string
  attemptId: string
  status: 'started' | 'completed' | 'interrupted' | 'awaiting_reconciliation'
  retryCount: number
  failureReason?: 'stream_aborted' | 'validation_failed' | 'provider_error' | 'unknown' | 'hold_unsettled'
  updatedAt: number
}

export type HarnessResponseFailure = 'empty_response' | 'provider_error' | 'provider_other'

export type HarnessModelRecovery = {
  receiptId: string
  modelId: string
  code: HarnessResponseFailure | 'route_capacity' | 'route_interrupted' | 'route_unavailable'
  attempt: number
  firstFailureAt: number
  nextRetryAt: number
}

export type HarnessReceipt = {
  id: string
  modelId: string
  provider: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  contextWindow: number | null
  /** Overlay-funded inference cost; external BYOK charges are accounted separately. */
  costMicros: number
  costSource?: 'provider' | 'catalog' | 'external'
  /** Present only for user-funded inference; null means the provider did not report its charge. */
  externalCostMicros?: number | null
  /** Zero-usage rejection or failure of a zero-cost summary attempt. */
  rejectionReason?: 'budget' | 'model_unavailable' | 'route_capacity' | 'route_interrupted' | 'route_unavailable' | 'summary_failed' | 'verification_failed'
  /** A settled response can be unusable even when its token usage is known. */
  responseFailure?: HarnessResponseFailure
}

export type HarnessPolicy = {
  /** Public progress and the settled public transcript journal are enabled only for new admissions. */
  publicProgressVersion?: 1
  publicStreamVersion?: 1
  actorUserId: string
  workspaceId?: string
  resourcePauseVersion?: 1
  executionPolicyVersion?: 2
  spendingMode?: 'workspace' | 'external' | 'none'
  allowedToolIds: string[]
  requiresPlan: boolean
  deadlineAt: number
  taskDeadlineAt?: number
  /** Bounds Overlay-funded inference, not spending on user-owned provider accounts. */
  maxCostMicros: number
  maxParallelChildren: number
  maxDepth: number
}

export function effectiveHarnessDeadlineAt(policy: Pick<HarnessPolicy, 'deadlineAt' | 'taskDeadlineAt'>): number {
  return policy.taskDeadlineAt !== undefined && policy.taskDeadlineAt < policy.deadlineAt
    ? policy.taskDeadlineAt : policy.deadlineAt
}

export type HarnessUsage = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costMicros: number
  externalCostMicros?: number
  unpricedExternalCalls?: number
}

export type HarnessChild = {
  id: string
  stepId: string
  allowedToolIds: string[]
  maxCostMicros: number
  costMicros: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  summary?: string
  evidenceRefs: string[]
  accountedUsage?: HarnessUsage
}

export type HarnessSnapshot = {
  schemaVersion: 1
  runId: string
  rootRunId: string
  parentRunId?: string
  workflowRunId?: string
  handoffWorkflowRunId?: string
  executionGeneration?: number
  depth: number
  goal: string
  constraints: string[]
  policy: HarnessPolicy
  status: HarnessStatus
  revision: number
  policyRevision?: number
  resourceRequestToken?: string
  resourcePause?: HarnessFundingPause
  authorizationPause?: HarnessAuthorizationPause
  progressRevision: number
  planRevision: number
  plan: HarnessPlanStep[]
  evidence: HarnessEvidence[]
  children: HarnessChild[]
  blocker?: { kind: 'input' | 'approval' | 'budget' | 'stuck'; question: string }
  terminalReason?: string
  diagnostic?: HarnessDiagnostic
  workingSummary: string
  /** Model-produced continuity prose. Never authoritative evidence. */
  unverifiedNarrative?: string
  finalVerification?: HarnessVerification
  compaction?: HarnessCompaction
  resultSummary?: string
  continuations: number
  lastContinuationProgressRevision: number
  stalledContinuations: number
  latestReceipt?: HarnessReceipt
  modelRecovery?: HarnessModelRecovery
  summaryRecovery?: HarnessModelRecovery
  modelReservation?: {
    id: string
    maxCostMicros: number
    dispatch?: { modelId: string; billingReservationId: string | null }
  }
  usage: HarnessUsage
  updatedAt: number
}

export type HarnessPlanInput = Pick<HarnessPlanStep, 'id' | 'title' | 'dependsOn' | 'acceptanceCriteria' | 'requiresVerification' | 'evidenceTools' | 'answerOnly'>
export type HarnessCheckpointPurpose = 'continuation' | 'compaction'

export class HarnessPlanValidationError extends Error {
  readonly code = 'HARNESS_PLAN_VALIDATION'

  constructor(message: string) {
    super(message)
    this.name = 'HarnessPlanValidationError'
  }
}

export class HarnessBudgetExceededError extends Error {
  constructor() {
    super('The authorized spending budget is exhausted.')
    this.name = 'HarnessBudgetExceededError'
  }
}

export class HarnessDeadlineExceededError extends Error {
  constructor(message = 'The authorized run deadline is exhausted.') {
    super(message)
    this.name = 'HarnessDeadlineExceededError'
  }
}

type HarnessSnapshotInput = {
  runId: string
  goal: string
  constraints: string[]
  policy: HarnessPolicy
  parentRunId?: string
  rootRunId?: string
  depth?: number
}

function validateHarnessSnapshotIdentityAndBudget(input: HarnessSnapshotInput): void {
  if (!input.runId || !input.goal.trim()) throw new Error('Run identity and goal are required.')
  if (!Number.isSafeInteger(input.policy.maxCostMicros) || input.policy.maxCostMicros < 0) throw new Error('A nonnegative spending authorization is required.')
}

function validateHarnessSnapshotDeadlines(input: HarnessSnapshotInput, now: number): void {
  if (!Number.isFinite(input.policy.deadlineAt) || input.policy.deadlineAt <= now) throw new Error('An unexpired deadline is required.')
  if (input.policy.taskDeadlineAt !== undefined
    && (!Number.isFinite(input.policy.taskDeadlineAt) || input.policy.taskDeadlineAt <= now)) {
    throw new Error('A finite task deadline is required.')
  }
}

function validateHarnessSnapshotExecutionPolicy(policy: HarnessPolicy): void {
  if ((policy.executionPolicyVersion === 2
      && (!policy.spendingMode || policy.maxCostMicros !== 0
        || (policy.spendingMode === 'workspace' && !policy.workspaceId)
        || policy.resourcePauseVersion === 1))
    || (policy.executionPolicyVersion !== 2 && policy.spendingMode !== undefined)) {
    throw new Error('Invalid versioned execution policy.')
  }
}

function harnessSnapshotDepth(input: HarnessSnapshotInput): number {
  if (!Number.isSafeInteger(input.policy.maxParallelChildren) || input.policy.maxParallelChildren < 0
    || !Number.isSafeInteger(input.policy.maxDepth) || input.policy.maxDepth < 0) throw new Error('Invalid child limits.')
  const depth = input.depth ?? 0
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > input.policy.maxDepth) throw new Error('Invalid child depth.')
  return depth
}

export function createHarnessSnapshot(input: HarnessSnapshotInput, now: number): HarnessSnapshot {
  validateHarnessSnapshotIdentityAndBudget(input)
  validateHarnessSnapshotDeadlines(input, now)
  validateHarnessSnapshotExecutionPolicy(input.policy)
  const depth = harnessSnapshotDepth(input)
  return {
    schemaVersion: 1, runId: input.runId, rootRunId: input.rootRunId ?? input.runId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}), depth,
    goal: input.goal, constraints: [...input.constraints],
    policy: { ...input.policy, allowedToolIds: [...new Set(input.policy.allowedToolIds)].sort() },
    status: 'running', revision: 0, ...(input.policy.resourcePauseVersion === 1 ? { policyRevision: 0 } : {}),
    executionGeneration: 0,
    progressRevision: 0, planRevision: 0, plan: [], evidence: [], children: [], workingSummary: '',
    continuations: 0, lastContinuationProgressRevision: 0, stalledContinuations: 0,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0 },
    updatedAt: now,
  }
}

function mutable(state: HarnessSnapshot): HarnessSnapshot {
  return {
    ...state, plan: state.plan.map(step => ({
      ...step,
      ...(step.evidenceTools ? { evidenceTools: [...step.evidenceTools] } : {}),
      evidenceRefs: [...step.evidenceRefs],
    })),
    ...(state.modelReservation ? { modelReservation: { ...state.modelReservation,
      ...(state.modelReservation.dispatch ? { dispatch: { ...state.modelReservation.dispatch } } : {}),
    } } : {}),
    evidence: [...state.evidence], children: state.children.map(child => ({ ...child, evidenceRefs: [...child.evidenceRefs],
      ...(child.accountedUsage ? { accountedUsage: { ...child.accountedUsage } } : {}),
    })),
    usage: { ...state.usage },
  }
}

function assertActive(state: HarnessSnapshot) {
  if (['completed', 'cancelled', 'failed'].includes(state.status)) throw new Error('The run is terminal.')
}

function changed(state: HarnessSnapshot, now: number, progress = true) {
  state.revision++
  if (progress) state.progressRevision++
  state.updatedAt = now
  return state
}

export function replaceHarnessPlan(state: HarnessSnapshot, steps: HarnessPlanInput[], now: number): HarnessSnapshot {
  assertActive(state)
  if (!steps.length || steps.length > 128) throw new HarnessPlanValidationError('Use between one and 128 meaningful milestones.')
  const normalizedSteps = steps
  const byId = new Map(normalizedSteps.map(step => [step.id, step]))
  if (byId.size !== normalizedSteps.length) throw new HarnessPlanValidationError('Plan IDs must be unique.')
  for (const step of normalizedSteps) {
    if (!step.id.trim() || !step.title.trim() || !step.acceptanceCriteria.length || step.acceptanceCriteria.some(criterion => !criterion.trim())) throw new HarnessPlanValidationError('Each milestone needs an identity, title and acceptance criteria.')
    if (step.dependsOn.some(id => !byId.has(id))) throw new HarnessPlanValidationError('Unknown dependency.')
    const previous = state.plan.find(candidate => candidate.id === step.id)
    if (step.answerOnly && (step.requiresVerification || ('childRunId' in step && step.childRunId !== undefined) || previous?.childRunId)) {
      throw new HarnessPlanValidationError('Answer-only milestones cannot require verification or delegate work.')
    }
  }
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new HarnessPlanValidationError('The plan contains a dependency cycle.')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const step of normalizedSteps) visit(step.id)
  if (state.plan.some(step => !byId.has(step.id))) throw new HarnessPlanValidationError('Keep existing milestones; explicitly skip obsolete work with a reason.')
  const next = mutable(state)
  next.plan = normalizedSteps.map(step => {
    const previous = state.plan.find(candidate => candidate.id === step.id)
    const same = previous && previous.title === step.title && previous.requiresVerification === step.requiresVerification
      && previous.answerOnly === step.answerOnly
      && JSON.stringify(previous.evidenceTools) === JSON.stringify(step.evidenceTools)
      && JSON.stringify(previous.acceptanceCriteria) === JSON.stringify(step.acceptanceCriteria)
      && JSON.stringify(previous.dependsOn) === JSON.stringify(step.dependsOn)
    if (previous?.childRunId && !same) throw new HarnessPlanValidationError('A delegated milestone cannot be revised while attached to a child.')
    return same ? { ...previous, evidenceRefs: [...previous.evidenceRefs] } : {
      ...step,
      ...(step.evidenceTools ? { evidenceTools: [...step.evidenceTools] } : {}),
      dependsOn: [...step.dependsOn],
      acceptanceCriteria: [...step.acceptanceCriteria],
      status: 'pending',
      evidenceRefs: [],
    }
  })
  let invalidated: boolean
  do {
    invalidated = false
    for (const step of next.plan) {
      if (step.status === 'done' && step.dependsOn.some(id => !['done', 'skipped'].includes(next.plan.find(candidate => candidate.id === id)!.status))) {
        Object.assign(step, { status: 'pending', evidenceRefs: [] })
        invalidated = true
      }
    }
  } while (invalidated)
  if (JSON.stringify(next.plan) === JSON.stringify(state.plan)) return state
  next.planRevision++
  return changed(next, now)
}

export function recordHarnessEvidence(state: HarnessSnapshot, evidence: HarnessEvidence, now: number): HarnessSnapshot {
  const lateToolResult = state.status === 'cancelled' && evidence.kind === 'tool_result'
  if (!lateToolResult) assertActive(state)
  if (!evidence.id || !evidence.source || !evidence.summary || evidence.summary.length > 2_000) throw new Error('Evidence requires a bounded summary and source reference.')
  if (evidence.kind === 'verification' && (!evidence.verification || evidence.verification.planRevision !== state.planRevision
    || !state.plan.some(step => step.id === evidence.verification!.stepId))) throw new Error('Verification must identify a milestone in the current plan revision.')
  const previous = state.evidence.find(candidate => candidate.id === evidence.id)
  if (previous) {
    if (previous.kind !== evidence.kind || previous.source !== evidence.source || previous.summary !== evidence.summary || previous.verdict !== evidence.verdict
      || previous.inputDigest !== evidence.inputDigest
      || JSON.stringify(previous.resource) !== JSON.stringify(evidence.resource)
      || JSON.stringify(previous.verification) !== JSON.stringify(evidence.verification)) throw new Error('Evidence is immutable; use a new reference for new observations.')
    return state
  }
  const next = mutable(state)
  next.evidence.push({
    ...evidence,
    ...(evidence.verification ? { verification: { ...evidence.verification } } : {}),
  })
  return changed(next, now, !lateToolResult)
}

export function recordHarnessVerification(
  state: HarnessSnapshot,
  verification: HarnessVerification,
  now: number,
): HarnessSnapshot {
  assertActive(state)
  if (!Number.isSafeInteger(verification.planRevision) || verification.planRevision !== state.planRevision
    || !Number.isSafeInteger(verification.evidenceRevision) || verification.evidenceRevision !== state.progressRevision
    || !verification.attemptId || verification.attemptId.length > 256
    || !verification.candidateDigest || verification.reason.length > 1_000
    || verification.evidenceIds.some(id => !state.evidence.some(evidence => evidence.id === id))) {
    throw new Error('Final verification does not match the current plan and evidence.')
  }
  if (state.finalVerification
    && JSON.stringify(state.finalVerification) === JSON.stringify(verification)) return state
  if (state.finalVerification?.candidateDigest === verification.candidateDigest
    && state.finalVerification.planRevision === verification.planRevision
    && state.finalVerification.evidenceRevision === verification.evidenceRevision
    && state.finalVerification.attempts >= verification.attempts) return state
  const next = mutable(state)
  next.finalVerification = { ...verification, evidenceIds: [...verification.evidenceIds] }
  return changed(next, now, false)
}

function validateCompactionIdentity(compaction: HarnessCompaction): void {
  if (!compaction.cycleId || !compaction.attemptId || compaction.retryCount < 0
    || compaction.retryCount > 1 || !Number.isSafeInteger(compaction.retryCount)
    || !Number.isFinite(compaction.updatedAt)) throw new Error('Invalid compaction attempt.')
}

function validateCompactionStart(
  state: HarnessSnapshot,
  previous: HarnessCompaction | undefined,
  compaction: HarnessCompaction,
): void {
  if (state.modelReservation && state.modelReservation.id !== compaction.attemptId) {
    throw new Error('An unrelated model reservation prevents compaction.')
  }
  if (previous?.status === 'started' || previous?.status === 'awaiting_reconciliation') {
    throw new Error('The active compaction attempt must be reconciled first.')
  }
  if (previous?.cycleId === compaction.cycleId
    && (previous.status !== 'interrupted' || compaction.retryCount !== previous.retryCount + 1)) {
    throw new Error('Compaction retry order is invalid.')
  }
  if (previous?.cycleId !== compaction.cycleId && compaction.retryCount !== 0) {
    throw new Error('A new compaction cycle must start at attempt zero.')
  }
}

function hasMatchingLateCompactionReceipt(
  state: HarnessSnapshot,
  previous: HarnessCompaction | undefined,
  compaction: HarnessCompaction,
): boolean {
  return previous?.cycleId === compaction.cycleId
    && previous.attemptId === compaction.attemptId
    && previous.status === 'awaiting_reconciliation'
    && compaction.status === 'interrupted'
    && compaction.retryCount === previous.retryCount
    && state.latestReceipt?.id === compaction.attemptId
    && state.modelReservation?.id !== compaction.attemptId
}

function hasDuplicateInterruptedCompaction(
  state: HarnessSnapshot,
  previous: HarnessCompaction | undefined,
  compaction: HarnessCompaction,
): boolean {
  return previous?.cycleId === compaction.cycleId && previous.attemptId === compaction.attemptId
    && previous.status === 'interrupted' && compaction.status === 'interrupted'
    && compaction.retryCount === previous.retryCount && state.latestReceipt?.id === compaction.attemptId
}

function validateCompactionTransition(
  state: HarnessSnapshot,
  previous: HarnessCompaction | undefined,
  compaction: HarnessCompaction,
): void {
  if (!previous || previous.cycleId !== compaction.cycleId || previous.attemptId !== compaction.attemptId
    || previous.status !== 'started') throw new Error('Compaction transition does not match its active attempt.')
  if (compaction.status === 'completed' && state.modelReservation?.id === compaction.attemptId) {
    throw new Error('Compaction cannot complete with an unsettled model hold.')
  }
  if (compaction.status === 'awaiting_reconciliation'
    && state.modelReservation?.id !== compaction.attemptId) {
    throw new Error('Only the matching unresolved hold can await reconciliation.')
  }
}

export function setHarnessCompaction(
  state: HarnessSnapshot,
  compaction: HarnessCompaction,
  now: number,
): HarnessSnapshot {
  assertActive(state)
  validateCompactionIdentity(compaction)
  const previous = state.compaction
  if (previous?.cycleId === compaction.cycleId && previous.attemptId === compaction.attemptId
    && JSON.stringify(previous) === JSON.stringify(compaction)) return state
  if (compaction.status === 'started') {
    validateCompactionStart(state, previous, compaction)
  } else if (hasMatchingLateCompactionReceipt(state, previous, compaction)) {
    const next = mutable(state)
    next.compaction = { ...compaction }
    return changed(next, now, false)
  } else if (hasDuplicateInterruptedCompaction(state, previous, compaction)) {
    return state
  } else {
    validateCompactionTransition(state, previous, compaction)
  }
  const next = mutable(state)
  next.compaction = { ...compaction }
  return changed(next, now, false)
}

function validateStepCompletion(state: HarnessSnapshot, step: HarnessPlanStep): void {
  if (step.dependsOn.some(id => !['done', 'skipped'].includes(state.plan.find(candidate => candidate.id === id)!.status))) {
    throw new Error('Dependencies are not complete.')
  }
  if (step.childRunId && !state.children.some(child => child.id === step.childRunId && child.status === 'completed')) {
    throw new Error('The delegated child has not completed.')
  }
}

export function transitionHarnessStep(state: HarnessSnapshot, input: {
  id: string; status: HarnessStepStatus; evidenceRefs?: string[]; skipReason?: string
}, now: number): HarnessSnapshot {
  assertActive(state)
  const next = mutable(state)
  const step = next.plan.find(candidate => candidate.id === input.id)
  if (!step) throw new Error('Unknown milestone.')
  if (step.status === 'done' || step.status === 'skipped') {
    if (step.status === input.status) return state
    throw new Error('Revise the milestone before reopening it.')
  }
  const evidenceRefs = [...new Set(input.evidenceRefs ?? step.evidenceRefs)]
  if (input.status === 'done') validateStepCompletion(state, step)
  if (input.status === 'skipped' && !input.skipReason?.trim()) throw new Error('Skipping work requires a reason.')
  if (step.status === input.status && JSON.stringify(step.evidenceRefs) === JSON.stringify(evidenceRefs)) return state
  Object.assign(step, { status: input.status, evidenceRefs, ...(input.status === 'skipped' ? { skipReason: input.skipReason } : {}) })
  return changed(next, now)
}

function validateResponseFailure(receipt: HarnessReceipt) {
  if (receipt.responseFailure !== undefined && (receipt.rejectionReason !== undefined
    || !['empty_response', 'provider_error', 'provider_other'].includes(receipt.responseFailure))) {
    throw new Error('Invalid settled model response failure.')
  }
}

function validateRejection(receipt: HarnessReceipt) {
  if (receipt.rejectionReason !== undefined && (
    !['budget', 'model_unavailable', 'route_capacity', 'route_interrupted', 'route_unavailable', 'summary_failed', 'verification_failed'].includes(receipt.rejectionReason)
    || [receipt.inputTokens, receipt.outputTokens, receipt.reasoningTokens, receipt.cacheReadTokens,
      receipt.cacheWriteTokens, receipt.costMicros].some(value => value !== 0)
    || receipt.costSource !== 'catalog' || receipt.externalCostMicros !== undefined
  )) throw new Error('Rejected inference must have confirmed zero usage and cost.')
}

function validateUsage(receipt: HarnessReceipt) {
  for (const value of [receipt.inputTokens, receipt.outputTokens, receipt.reasoningTokens, receipt.cacheReadTokens, receipt.cacheWriteTokens, receipt.costMicros]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Usage and cost must be known nonnegative integers.')
  }
}

function validateReceiptIdentity(receipt: HarnessReceipt) {
  if (!receipt.id || !receipt.modelId || !receipt.provider) throw new Error('A receipt requires actual routing identity.')
  if (receipt.contextWindow !== null && (!Number.isSafeInteger(receipt.contextWindow) || receipt.contextWindow <= 0)) throw new Error('Invalid context window.')
}

function validateReceiptUsageShape(receipt: HarnessReceipt) {
  if (receipt.cacheReadTokens + receipt.cacheWriteTokens > receipt.inputTokens) throw new Error('Cached tokens exceed total input usage.')
}

function validateExternalCost(receipt: HarnessReceipt) {
  if (receipt.externalCostMicros !== undefined) {
    if (receipt.costMicros !== 0 || receipt.costSource !== 'external'
      || (receipt.externalCostMicros !== null && (!Number.isSafeInteger(receipt.externalCostMicros) || receipt.externalCostMicros < 0))) throw new Error('Invalid external provider cost.')
  } else if (receipt.costSource === 'external') throw new Error('External provider cost must be reported or explicitly unknown.')
}

export function validateHarnessReceipt(receipt: HarnessReceipt) {
  validateResponseFailure(receipt)
  validateRejection(receipt)
  validateUsage(receipt)
  validateReceiptIdentity(receipt)
  validateReceiptUsageShape(receipt)
  validateExternalCost(receipt)
}

const usageKeys = ['inputTokens', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costMicros', 'externalCostMicros', 'unpricedExternalCalls'] as const

function receiptUsage(receipt: HarnessReceipt): HarnessUsage {
  return { ...receipt, externalCostMicros: receipt.externalCostMicros ?? 0, unpricedExternalCalls: receipt.externalCostMicros === null ? 1 : 0 }
}

function addHarnessUsage(target: HarnessUsage, delta: HarnessUsage) {
  for (const key of usageKeys) {
    const value = delta[key] ?? 0
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Usage cannot decrease.')
    target[key] = (target[key] ?? 0) + value
    if (!Number.isSafeInteger(target[key])) throw new Error('Usage overflow.')
  }
}

function nextModelRecovery(previous: HarnessModelRecovery | undefined, receipt: HarnessReceipt, now: number, deadlineAt: number): HarnessModelRecovery | undefined {
  const code = receipt.responseFailure
  if (!code) return receipt.rejectionReason ? previous : undefined
  const attempt = Math.min((previous?.attempt ?? 0) + 1, Number.MAX_SAFE_INTEGER)
  const delay = Math.min(5_000 * 2 ** Math.min(attempt - 1, 6), 300_000)
  return {
    receiptId: receipt.id, modelId: receipt.modelId, code, attempt,
    firstFailureAt: previous?.firstFailureAt ?? now,
    nextRetryAt: Math.min(now + delay, deadlineAt),
  }
}

function validateFailedInferenceReceipt(state: HarnessSnapshot, receipt: HarnessReceipt): void {
  if (receipt.rejectionReason !== 'verification_failed' && receipt.rejectionReason !== 'summary_failed') return
  const reservation = state.modelReservation
  const dispatch = reservation?.dispatch
  if (reservation?.id !== receipt.id || reservation.maxCostMicros !== 0
    || dispatch?.billingReservationId !== null || dispatch.modelId !== receipt.modelId
    || (receipt.modelId !== 'openrouter/free' && receipt.modelId !== 'overlay/free')
    || receipt.provider !== 'overlay-free-router' || receipt.costMicros !== 0
    || receipt.inputTokens !== 0 || receipt.outputTokens !== 0 || receipt.reasoningTokens !== 0
    || receipt.cacheReadTokens !== 0 || receipt.cacheWriteTokens !== 0
    || (receipt.externalCostMicros ?? 0) !== 0) {
    throw new Error('Failed inference reconciliation requires the exact zero-cost unbilled free hold.')
  }
}

// The caller must atomically deduplicate receipt.id per run before recording.
export function recordHarnessReceipt(state: HarnessSnapshot, receipt: HarnessReceipt, now: number): HarnessSnapshot {
  if (state.latestReceipt?.id === receipt.id) {
    if (JSON.stringify(state.latestReceipt) !== JSON.stringify(receipt)) throw new Error('Receipt identity cannot be reused for different usage.')
    return state
  }
  validateHarnessReceipt(receipt)
  validateFailedInferenceReceipt(state, receipt)
  const next = mutable(state)
  if (next.modelReservation?.id === receipt.id) next.modelReservation = undefined
  next.latestReceipt = { ...receipt }
  if (next.compaction?.attemptId === receipt.id
    && (next.compaction.status === 'awaiting_reconciliation' || receipt.rejectionReason === 'summary_failed')
    && next.modelReservation?.id !== receipt.id) {
    next.compaction = {
      ...next.compaction,
      status: 'interrupted',
      failureReason: receipt.rejectionReason === 'summary_failed' ? 'provider_error' : 'stream_aborted',
      updatedAt: now,
    }
  }
  const recoveryKey = receipt.id.startsWith('summary:') ? 'summaryRecovery' : 'modelRecovery'
  next[recoveryKey] = nextModelRecovery(state[recoveryKey], receipt, now, effectiveHarnessDeadlineAt(state.policy))
  addHarnessUsage(next.usage, receiptUsage(receipt))
  return changed(next, now, false)
}

// Apply once to each ancestor in the same transaction as the originating receipt.
export function recordHarnessChildReceipt(state: HarnessSnapshot, childRunId: string, receipt: HarnessReceipt, now: number): HarnessSnapshot {
  validateHarnessReceipt(receipt)
  const next = mutable(state)
  const child = next.children.find(candidate => candidate.id === childRunId)
  if (!child) throw new Error('Unknown child reservation for usage reconciliation.')
  const accounted = child.accountedUsage ?? { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0 }
  addHarnessUsage(accounted, receiptUsage(receipt))
  child.accountedUsage = accounted
  child.costMicros = accounted.costMicros
  addHarnessUsage(next.usage, receiptUsage(receipt))
  return changed(next, now, false)
}

function validateHarnessChildAdmission(state: HarnessSnapshot, child: HarnessChild) {
  if (!child.id) throw new Error('A child identity is required.')
  if (state.children.some(candidate => candidate.id === child.id)) throw new Error('Child identity is already reserved.')
  const step = state.plan.find(candidate => candidate.id === child.stepId)
  if (!step || step.childRunId || ['done', 'skipped'].includes(step.status)) throw new Error('Delegate an unfinished unassigned milestone.')
  if (step.dependsOn.some(id => !['done', 'skipped'].includes(state.plan.find(candidate => candidate.id === id)!.status))) throw new Error('Finish dependencies before delegating a milestone.')
  if (state.depth >= state.policy.maxDepth) throw new Error('The child depth budget is exhausted.')
  const active = state.children.filter(candidate => candidate.status === 'running')
  if (active.length >= state.policy.maxParallelChildren) throw new Error('The child concurrency budget is exhausted.')
  if (child.allowedToolIds.some(id => !state.policy.allowedToolIds.includes(id))) throw new Error('Child capabilities cannot exceed the parent.')
  if (!Number.isSafeInteger(child.maxCostMicros) || child.maxCostMicros < 0
    || (state.policy.executionPolicyVersion !== 2
      && state.usage.costMicros + reservedHarnessCostMicros(state) + child.maxCostMicros > state.policy.maxCostMicros)) {
    throw new Error('The root spending budget cannot cover this child.')
  }
  if (child.status !== 'running' || child.evidenceRefs.length || child.costMicros !== 0 || child.accountedUsage !== undefined) throw new Error('A new child must be empty and running.')
}

export function admitHarnessChild(state: HarnessSnapshot, child: HarnessChild, now: number): HarnessSnapshot {
  assertHarnessRunnable(state, now)
  validateHarnessChildAdmission(state, child)
  const next = mutable(state)
  next.children.push({
    ...child,
    ...(state.policy.executionPolicyVersion === 2 ? { maxCostMicros: 0 } : {}),
    allowedToolIds: [...child.allowedToolIds],
    evidenceRefs: [...child.evidenceRefs],
  })
  const delegatedStep = next.plan.find(candidate => candidate.id === child.stepId)!
  Object.assign(delegatedStep, { childRunId: child.id, status: 'running' })
  return changed(next, now)
}

export function admitHarnessNamedChild(
  state: HarnessSnapshot,
  child: HarnessChild,
  step: { title: string; acceptanceCriteria: string[] },
  now: number,
): HarnessSnapshot {
  assertHarnessRunnable(state, now)
  if (!child.id) throw new Error('A child identity is required.')
  if (state.children.some(candidate => candidate.id === child.id)) throw new Error('Child identity is already reserved.')
  if (state.plan.some(candidate => candidate.id === child.stepId)) throw new Error('Named child milestone identity already exists.')
  if (state.plan.length >= 128) throw new Error('A harness plan may contain at most 128 milestones.')
  if (!step.title.trim() || !step.acceptanceCriteria.length || step.acceptanceCriteria.some(criterion => !criterion.trim())) {
    throw new Error('Each milestone needs an identity, title and acceptance criteria.')
  }
  if (state.depth >= state.policy.maxDepth) throw new Error('The child depth budget is exhausted.')
  if (state.children.filter(candidate => candidate.status === 'running').length >= state.policy.maxParallelChildren) {
    throw new Error('The child concurrency budget is exhausted.')
  }
  if (child.allowedToolIds.some(id => !state.policy.allowedToolIds.includes(id))) {
    throw new Error('Child capabilities cannot exceed the parent.')
  }
  if (!Number.isSafeInteger(child.maxCostMicros) || child.maxCostMicros < 0
    || (state.policy.executionPolicyVersion !== 2
      && state.usage.costMicros + reservedHarnessCostMicros(state) + child.maxCostMicros > state.policy.maxCostMicros)) {
    throw new Error('The root spending budget cannot cover this child.')
  }
  if (child.status !== 'running' || child.evidenceRefs.length || child.costMicros !== 0 || child.accountedUsage !== undefined) {
    throw new Error('A new child must be empty and running.')
  }
  const next = mutable(state)
  next.plan.push({
    id: child.stepId,
    title: step.title,
    dependsOn: [],
    acceptanceCriteria: [...step.acceptanceCriteria],
    requiresVerification: false,
    status: 'running',
    evidenceRefs: [],
    childRunId: child.id,
  })
  next.planRevision++
  next.children.push({ ...child, allowedToolIds: [...child.allowedToolIds], evidenceRefs: [...child.evidenceRefs] })
  return changed(next, now)
}

export function harnessCompletionIssues(state: HarnessSnapshot): string[] {
  const answerOnlyReady = (step: HarnessPlanStep) => step.answerOnly
    && step.status === 'pending'
    && step.dependsOn.every(id => state.plan.some(candidate => candidate.id === id && ['done', 'skipped'].includes(candidate.status)))
  return [
    ...(state.status !== 'running' ? ['The run is not running.'] : []),
    ...(state.blocker ? ['A blocker remains unresolved.'] : []),
    ...(state.plan.length && !state.plan.some(step => step.status === 'done' || answerOnlyReady(step)) ? ['No milestone was completed.'] : []),
    ...state.plan.filter(step => !['done', 'skipped'].includes(step.status) && !answerOnlyReady(step)).map(step => `Milestone ${step.id} is unfinished.`),
    ...(state.children.some(child => child.status === 'running') ? ['Child work is still running.'] : []),
    ...(state.modelReservation ? ['Model usage is awaiting reconciliation.'] : []),
  ]
}

export function reservedHarnessCostMicros(state: HarnessSnapshot): number {
  return (state.modelReservation?.maxCostMicros ?? 0)
    + state.children.filter(child => child.status === 'running').reduce((sum, child) => sum
      + Math.max(0, child.maxCostMicros - child.costMicros), 0)
}

export function reserveHarnessModel(state: HarnessSnapshot, id: string, maxCostMicros: number, now: number): HarnessSnapshot {
  assertActive(state)
  if (!id.trim() || id.length > 256 || !Number.isSafeInteger(maxCostMicros) || maxCostMicros < 0) throw new Error('Invalid model reservation.')
  if (state.modelReservation) {
    if (state.modelReservation.id === id && state.modelReservation.maxCostMicros === maxCostMicros) return state
    throw new Error('Reconcile the previous model call before reserving another.')
  }
  assertHarnessRunnable(state, now, maxCostMicros)
  const next = mutable(state)
  next.modelReservation = { id, maxCostMicros }
  return changed(next, now, false)
}

export function bindHarnessModelDispatch(
  state: HarnessSnapshot,
  id: string,
  dispatch: { modelId: string; billingReservationId: string | null },
  now: number,
): HarnessSnapshot {
  assertHarnessRunnable(state, now)
  if (!state.modelReservation || state.modelReservation.id !== id) throw new Error('Model dispatch requires its matching reservation.')
  if (!dispatch.modelId.trim() || dispatch.modelId.length > 256
    || (dispatch.billingReservationId !== null && (!dispatch.billingReservationId.trim() || dispatch.billingReservationId.length > 256))) {
    throw new Error('Invalid model dispatch identity.')
  }
  const existing = state.modelReservation.dispatch
  if (existing) {
    if (existing.modelId === dispatch.modelId && existing.billingReservationId === dispatch.billingReservationId) return state
    throw new Error('Model dispatch cannot change its billing reservation or model.')
  }
  const next = mutable(state)
  next.modelReservation = { ...state.modelReservation, dispatch: { ...dispatch } }
  return changed(next, now, false)
}

export function assertHarnessRunnable(state: HarnessSnapshot, now: number, estimatedNextCostMicros = 0) {
  assertActive(state)
  if (state.status !== 'running' || state.blocker) throw new Error('The run is waiting for a blocker to resolve.')
  if (now >= state.policy.deadlineAt) throw new HarnessDeadlineExceededError()
  if (state.policy.taskDeadlineAt !== undefined && now >= state.policy.taskDeadlineAt) {
    throw new HarnessDeadlineExceededError('The authorized task deadline is exhausted.')
  }
  if (!Number.isSafeInteger(estimatedNextCostMicros) || estimatedNextCostMicros < 0) throw new Error('A nonnegative cost reservation is required.')
  const reserved = reservedHarnessCostMicros(state)
  if (state.policy.executionPolicyVersion !== 2
    && state.usage.costMicros + reserved + estimatedNextCostMicros > state.policy.maxCostMicros) {
    throw new HarnessBudgetExceededError()
  }
}

export function blockHarness(state: HarnessSnapshot, blocker: NonNullable<HarnessSnapshot['blocker']>, now: number): HarnessSnapshot {
  assertActive(state)
  if (state.status === 'waiting_for_resources' || state.resourceRequestToken) {
    throw new Error('A resource pause must be consumed before the run can be blocked.')
  }
  if (!blocker.question.trim() || blocker.question.length > 2_000) throw new Error('A blocker requires a concise question or explanation.')
  const next = mutable(state)
  next.blocker = { ...blocker }
  next.status = blocker.kind === 'approval' ? 'waiting_for_approval' : 'waiting_for_input'
  return changed(next, now)
}

export function recordHarnessDiagnostic(
  state: HarnessSnapshot,
  diagnostic: HarnessDiagnostic,
  now: number,
): HarnessSnapshot {
  if (state.diagnostic) {
    if (state.diagnostic.diagnosticId === diagnostic.diagnosticId) {
      if (JSON.stringify(state.diagnostic) !== JSON.stringify(diagnostic)) {
        throw new Error('Harness diagnostic identity cannot be reused.')
      }
      return state
    }
  }
  const next = mutable(state)
  next.diagnostic = { ...diagnostic }
  if (state.status === 'failed') next.terminalReason = harnessDiagnosticMessage(diagnostic)
  return changed(next, now, false)
}

export function resumeHarness(state: HarnessSnapshot, now: number): HarnessSnapshot {
  assertActive(state)
  if (state.modelReservation) throw new Error('A model hold must be reconciled before the run can resume.')
  if (state.status === 'waiting_for_authorization' || state.authorizationPause) {
    throw new Error('Expired authorization cannot be resumed by an input or approval reply.')
  }
  if (state.status === 'waiting_for_resources' || state.resourceRequestToken) {
    throw new Error('A resource pause must be consumed before the run can resume.')
  }
  if (!state.blocker && state.status !== 'waiting_for_children') throw new Error('There is no blocker to resolve.')
  const next = mutable(state)
  next.blocker = undefined
  next.diagnostic = undefined
  next.status = 'running'
  next.stalledContinuations = 0
  next.lastContinuationProgressRevision = next.progressRevision
  return changed(next, now)
}

export function pauseHarnessForAuthorization(state: HarnessSnapshot, now: number): HarnessSnapshot {
  assertActive(state)
  const deadlineAt = state.policy.taskDeadlineAt
  if (state.policy.executionPolicyVersion !== 2 || deadlineAt === undefined || now < deadlineAt
    || state.status === 'waiting_for_authorization' || state.resourceRequestToken) {
    throw new Error('Invalid task-deadline authorization pause.')
  }
  const next = mutable(state)
  next.status = 'waiting_for_authorization'
  next.authorizationPause = { reason: 'task_deadline_expired', deadlineAt, pausedAt: now }
  return changed(next, now, false)
}

export function pauseHarnessForFunding(
  state: HarnessSnapshot,
  pause: HarnessFundingPause,
  now: number,
): HarnessSnapshot {
  assertActive(state)
  if (state.policy.executionPolicyVersion !== 2 || state.policy.spendingMode !== 'workspace'
    || state.status !== 'running' || state.modelReservation || state.resourceRequestToken
    || state.resourcePause || !pause.receiptId.trim()
    || !isSafeHarnessFundingCents(pause.requiredCents) || pause.requiredCents <= 0
    || !isSafeHarnessFundingCents(pause.availableCents)
    || (pause.reservedCents !== undefined
      && !isSafeHarnessFundingCents(pause.reservedCents))) {
    throw new Error('Invalid workspace funding pause.')
  }
  const next = mutable(state)
  next.status = 'waiting_for_resources'
  next.resourcePause = { ...pause }
  return changed(next, now, false)
}

export function resumeHarnessFunding(state: HarnessSnapshot, now: number): HarnessSnapshot {
  assertActive(state)
  if (state.policy.executionPolicyVersion !== 2 || state.status !== 'waiting_for_resources'
    || !state.resourcePause || state.resourceRequestToken) {
    throw new Error('There is no v2 workspace funding pause to resume.')
  }
  const next = mutable(state)
  next.status = 'running'
  next.resourcePause = undefined
  return changed(next, now, false)
}

export function pauseHarnessForResources(state: HarnessSnapshot, token: string, now: number): HarnessSnapshot {
  assertActive(state)
  if (state.policy.resourcePauseVersion !== 1) throw new Error('Resource pauses are not enabled for this run.')
  if (!token.trim() || token.length > 256) throw new Error('A resource pause token is required.')
  if (state.resourceRequestToken) throw new Error('A resource pause is already pending.')
  if (state.status === 'running' && state.blocker !== undefined) {
    throw new Error('A running harness cannot carry a blocker.')
  }
  if (state.status === 'waiting_for_input' && state.blocker?.kind !== 'input' && state.blocker?.kind !== 'stuck') {
    throw new Error('Only an input wait can be suspended by a resource pause.')
  }
  if (state.status === 'waiting_for_approval' && state.blocker?.kind !== 'approval') {
    throw new Error('Only an approval wait can be suspended by a resource pause.')
  }
  if (state.status !== 'running' && state.status !== 'waiting_for_input' && state.status !== 'waiting_for_approval') {
    throw new Error('Only an active harness can be paused for resources.')
  }
  const next = mutable(state)
  next.status = 'waiting_for_resources'
  next.resourceRequestToken = token
  return changed(next, now, false)
}

export function applyHarnessResourceGrant(
  state: HarnessSnapshot,
  receipt: HarnessResourceGrantReceipt,
  now: number,
): HarnessSnapshot {
  assertActive(state)
  if (state.status !== 'waiting_for_resources' || state.resourceRequestToken !== receipt.token) {
    throw new Error('The resource grant does not match the pending pause.')
  }
  if ((state.policyRevision ?? 0) !== receipt.policyRevisionBefore
    || receipt.policyRevisionAfter !== receipt.policyRevisionBefore + 1) {
    throw new Error('The resource grant policy revision is stale.')
  }
  if (receipt.grant.kind === 'model_spend') {
    if (receipt.deadlineAt !== state.policy.deadlineAt || receipt.maxCostMicros <= state.policy.maxCostMicros) {
      throw new Error('The model-spend grant changed an unrelated policy field.')
    }
  } else if (receipt.maxCostMicros !== state.policy.maxCostMicros
    || receipt.deadlineAt <= state.policy.deadlineAt) {
    throw new Error('The time grant changed an unrelated policy field.')
  }
  const next = mutable(state)
  next.policy = {
    ...state.policy,
    maxCostMicros: receipt.maxCostMicros,
    deadlineAt: receipt.deadlineAt,
  }
  next.policyRevision = receipt.policyRevisionAfter
  return changed(next, now, false)
}

export function consumeHarnessResourcePause(
  state: HarnessSnapshot,
  input: {
    token: string
    previousStatus: Extract<HarnessStatus, 'running' | 'waiting_for_input' | 'waiting_for_approval'>
    previousBlocker?: { kind: 'input' | 'approval' | 'stuck'; question: string }
  },
  now: number,
): HarnessSnapshot {
  assertActive(state)
  if (state.status !== 'waiting_for_resources' || state.resourceRequestToken !== input.token) {
    throw new Error('The resource pause does not match the run.')
  }
  const next = mutable(state)
  next.status = input.previousStatus
  if (input.previousBlocker === undefined) delete next.blocker
  else next.blocker = { ...input.previousBlocker }
  delete next.resourceRequestToken
  return changed(next, now, false)
}

export function hasRunnableHarnessMilestones(state: HarnessSnapshot): boolean {
  return state.plan.some(step => !['done', 'skipped'].includes(step.status)
    && step.dependsOn.every(id => state.plan.some(candidate => candidate.id === id && ['done', 'skipped'].includes(candidate.status)))
    && (!step.childRunId || !state.children.some(child => child.id === step.childRunId && child.status === 'running')))
}

export function claimHarnessExecution(
  state: HarnessSnapshot,
  workflowRunId: string,
  now: number,
  generation = state.executionGeneration ?? 0,
): HarnessSnapshot {
  assertActive(state)
  if (state.status === 'waiting_for_authorization' || state.authorizationPause) {
    throw new Error('Expired authorization cannot be claimed for execution.')
  }
  if (!workflowRunId.trim() || workflowRunId.length > 256) throw new Error('Invalid workflow execution identity.')
  if (!Number.isSafeInteger(generation) || generation !== (state.executionGeneration ?? 0)) {
    throw new Error('HARNESS_EXECUTION_GENERATION_CHANGED')
  }
  if (state.workflowRunId) {
    if (state.workflowRunId !== workflowRunId) throw new Error('HARNESS_EXECUTION_ALREADY_CLAIMED')
    return state
  }
  const next = mutable(state)
  next.workflowRunId = workflowRunId
  delete next.handoffWorkflowRunId
  return changed(next, now, false)
}

export function waitForHarnessChildren(state: HarnessSnapshot, now: number): HarnessSnapshot {
  assertHarnessRunnable(state, now)
  if (!state.children.some(child => child.status === 'running') || hasRunnableHarnessMilestones(state)) {
    throw new Error('Only wait for children when no local milestone is ready.')
  }
  const next = mutable(state)
  next.status = 'waiting_for_children'
  return changed(next, now, false)
}

export function checkpointHarness(
  state: HarnessSnapshot,
  summary: string,
  now: number,
  purpose: HarnessCheckpointPurpose = 'continuation',
  unverifiedNarrative?: string,
): HarnessSnapshot {
  assertActive(state)
  if (summary.length > 8_000) throw new Error('Keep the working summary under 8,000 characters; store larger outputs as artifacts.')
  if (unverifiedNarrative !== undefined && unverifiedNarrative.length > 8_000) {
    throw new Error('Keep unverified narrative under 8,000 characters.')
  }
  const next = mutable(state)
  if (purpose === 'compaction') {
    next.workingSummary = summary
    next.unverifiedNarrative = summary
    return changed(next, now, false)
  }
  next.workingSummary = summary
  if (unverifiedNarrative !== undefined) next.unverifiedNarrative = unverifiedNarrative
  next.continuations++
  next.stalledContinuations = state.progressRevision === state.lastContinuationProgressRevision ? state.stalledContinuations + 1 : 0
  next.lastContinuationProgressRevision = state.progressRevision
  return changed(next, now, false)
}

export function finishHarness(state: HarnessSnapshot, now: number, resultSummary?: string): HarnessSnapshot {
  assertActive(state)
  if (resultSummary !== undefined && resultSummary.length > 8_000) throw new Error('Keep the result summary under 8,000 characters.')
  const issues = harnessCompletionIssues(state)
  if (issues.length) throw new Error(issues.join(' '))
  const next = mutable(state)
  for (const step of next.plan) {
    if (step.answerOnly && step.status === 'pending'
      && step.dependsOn.every(id => next.plan.some(candidate => candidate.id === id && ['done', 'skipped'].includes(candidate.status)))) {
      step.status = 'done'
    }
  }
  next.status = 'completed'
  if (resultSummary !== undefined) next.resultSummary = resultSummary
  return changed(next, now)
}

function settleNamedChildMilestone(state: HarnessSnapshot, child: HarnessChild, childState: HarnessSnapshot): void {
  const step = state.plan.find(candidate => candidate.id === child.stepId && candidate.childRunId === child.id
    && candidate.id.startsWith('ask:') && candidate.status !== 'done' && candidate.status !== 'skipped')
  if (!step) return
  if (childState.status === 'completed') {
    step.status = 'done'
    return
  }
  const reason = childState.terminalReason?.trim()
    || childState.resultSummary?.trim()
    || childState.workingSummary.trim()
    || 'Child run ended without a summary.'
  step.status = 'skipped'
  step.skipReason = `${childState.status}: ${reason}`
}

function assertChildSettlementLineage(state: HarnessSnapshot, childState: HarnessSnapshot): HarnessChild {
  const child = state.children.find(candidate => candidate.id === childState.runId)
  if (!child || childState.parentRunId !== state.runId || childState.rootRunId !== state.rootRunId
    || childState.policy.actorUserId !== state.policy.actorUserId || childState.policy.workspaceId !== state.policy.workspaceId) throw new Error('The child does not belong to this run and authority.')
  return child
}

function assertChildDelegatedAuthority(state: HarnessSnapshot, child: HarnessChild, childState: HarnessSnapshot): void {
  if (childState.depth !== state.depth + 1
    || childState.policy.allowedToolIds.some(id => !child.allowedToolIds.includes(id))
    || (state.policy.executionPolicyVersion !== 2 && childState.policy.maxCostMicros > child.maxCostMicros)
    || (state.policy.executionPolicyVersion !== 2 && childState.policy.deadlineAt > state.policy.deadlineAt)
    || (childState.policy.taskDeadlineAt !== undefined
      && (state.policy.taskDeadlineAt === undefined || childState.policy.taskDeadlineAt > state.policy.taskDeadlineAt))
    || childState.policy.maxDepth > state.policy.maxDepth
      || childState.policy.maxParallelChildren > state.policy.maxParallelChildren) throw new Error('The child exceeds its delegated authority.')
}

function assertChildSettlementComplete(state: HarnessSnapshot, child: HarnessChild, childState: HarnessSnapshot): void {
  if (!['completed', 'failed', 'cancelled'].includes(childState.status)) throw new Error('Child work has not finished.')
  if (childState.modelReservation || childState.children.some(child => child.status === 'running' || child.status === 'cancelled')) throw new Error('Reconcile outstanding child model calls before releasing its budget.')
  if (state.policy.executionPolicyVersion !== 2 && childState.usage.costMicros > child.maxCostMicros) {
    throw new Error('Child usage exceeded its authorization; reconcile before continuing.')
  }
}

export function settleHarnessChild(state: HarnessSnapshot, childState: HarnessSnapshot, now: number): HarnessSnapshot {
  assertActive(state)
  const child = assertChildSettlementLineage(state, childState)
  assertChildDelegatedAuthority(state, child, childState)
  if (child.status !== 'running') return state
  assertChildSettlementComplete(state, child, childState)
  const next = mutable(state)
  Object.assign(next.children.find(candidate => candidate.id === child.id)!, {
    status: childState.status, costMicros: childState.usage.costMicros,
    summary: childState.resultSummary ?? childState.workingSummary, evidenceRefs: childState.evidence.map(item => item.id),
    accountedUsage: { ...childState.usage },
  })
  settleNamedChildMilestone(next, child, childState)
  const delta = { ...childState.usage }
  for (const key of usageKeys) {
    delta[key] = (delta[key] ?? 0) - (child.accountedUsage?.[key] ?? 0)
  }
  addHarnessUsage(next.usage, delta)
  return changed(next, now)
}

export function terminateHarness(
  state: HarnessSnapshot,
  status: 'cancelled' | 'failed',
  reason: string,
  now: number,
  diagnostic?: HarnessDiagnostic,
): HarnessSnapshot {
  if (['completed', 'cancelled', 'failed'].includes(state.status)) return state
  if (!reason.trim() || reason.length > 2_000) throw new Error('A concise termination reason is required.')
  const next = mutable(state)
  next.status = status
  next.terminalReason = reason
  if (diagnostic) next.diagnostic = { ...diagnostic }
  next.children = next.children.map(child => child.status === 'running' ? { ...child, status: 'cancelled' } : child)
  return changed(next, now)
}

export function currentHarnessContext(state: HarnessSnapshot) {
  const receipt = state.latestReceipt
  return {
    inputTokens: receipt?.inputTokens ?? null,
    contextWindow: receipt?.contextWindow ?? null,
    occupancy: receipt?.contextWindow ? Math.min(1, receipt.inputTokens / receipt.contextWindow) : null,
    outputTokens: receipt?.outputTokens ?? null, reasoningTokens: receipt?.reasoningTokens ?? null,
    cacheReadTokens: receipt?.cacheReadTokens ?? null, cacheWriteTokens: receipt?.cacheWriteTokens ?? null,
    costMicros: receipt?.costMicros ?? null,
  }
}

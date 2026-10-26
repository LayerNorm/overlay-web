export type HarnessStatus = 'running' | 'waiting_for_input' | 'waiting_for_approval' | 'waiting_for_children' | 'completed' | 'cancelled' | 'failed'
export type HarnessStepStatus = 'pending' | 'running' | 'blocked' | 'verifying' | 'done' | 'skipped'

export type HarnessPlanStep = {
  id: string
  title: string
  dependsOn: string[]
  acceptanceCriteria: string[]
  requiresVerification: boolean
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
  verification?: { stepId: string; planRevision: number }
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
}

export type HarnessPolicy = {
  actorUserId: string
  workspaceId?: string
  allowedToolIds: string[]
  requiresPlan: boolean
  deadlineAt: number
  /** Bounds Overlay-funded inference, not spending on user-owned provider accounts. */
  maxCostMicros: number
  maxParallelChildren: number
  maxDepth: number
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
  depth: number
  goal: string
  constraints: string[]
  policy: HarnessPolicy
  status: HarnessStatus
  revision: number
  progressRevision: number
  planRevision: number
  plan: HarnessPlanStep[]
  evidence: HarnessEvidence[]
  children: HarnessChild[]
  blocker?: { kind: 'input' | 'approval' | 'budget' | 'stuck'; question: string }
  terminalReason?: string
  workingSummary: string
  continuations: number
  lastContinuationProgressRevision: number
  stalledContinuations: number
  latestReceipt?: HarnessReceipt
  modelReservation?: {
    id: string
    maxCostMicros: number
    dispatch?: { modelId: string; billingReservationId: string | null }
  }
  usage: HarnessUsage
  updatedAt: number
}

export type HarnessPlanInput = Pick<HarnessPlanStep, 'id' | 'title' | 'dependsOn' | 'acceptanceCriteria' | 'requiresVerification'>

export function createHarnessSnapshot(input: {
  runId: string
  goal: string
  constraints: string[]
  policy: HarnessPolicy
  parentRunId?: string
  rootRunId?: string
  depth?: number
}, now: number): HarnessSnapshot {
  if (!input.runId || !input.goal.trim()) throw new Error('Run identity and goal are required.')
  if (!Number.isSafeInteger(input.policy.maxCostMicros) || input.policy.maxCostMicros < 0) throw new Error('A nonnegative spending authorization is required.')
  if (!Number.isFinite(input.policy.deadlineAt) || input.policy.deadlineAt <= now) throw new Error('An unexpired deadline is required.')
  if (!Number.isSafeInteger(input.policy.maxParallelChildren) || input.policy.maxParallelChildren < 0
    || !Number.isSafeInteger(input.policy.maxDepth) || input.policy.maxDepth < 0) throw new Error('Invalid child limits.')
  const depth = input.depth ?? 0
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > input.policy.maxDepth) throw new Error('Invalid child depth.')
  return {
    schemaVersion: 1, runId: input.runId, rootRunId: input.rootRunId ?? input.runId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}), depth,
    goal: input.goal, constraints: [...input.constraints],
    policy: { ...input.policy, allowedToolIds: [...new Set(input.policy.allowedToolIds)].sort() },
    status: 'running', revision: 0, progressRevision: 0, planRevision: 0, plan: [], evidence: [], children: [], workingSummary: '',
    continuations: 0, lastContinuationProgressRevision: 0, stalledContinuations: 0,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0 },
    updatedAt: now,
  }
}

function mutable(state: HarnessSnapshot): HarnessSnapshot {
  return {
    ...state, plan: state.plan.map(step => ({ ...step, evidenceRefs: [...step.evidenceRefs] })),
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
  if (!steps.length || steps.length > 128) throw new Error('Use between one and 128 meaningful milestones.')
  const byId = new Map(steps.map(step => [step.id, step]))
  if (byId.size !== steps.length) throw new Error('Plan IDs must be unique.')
  for (const step of steps) {
    if (!step.id.trim() || !step.title.trim() || !step.acceptanceCriteria.length || step.acceptanceCriteria.some(criterion => !criterion.trim())) throw new Error('Each milestone needs an identity, title and acceptance criteria.')
    if (step.dependsOn.some(id => !byId.has(id))) throw new Error('Unknown dependency.')
  }
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('The plan contains a dependency cycle.')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const step of steps) visit(step.id)
  if (state.plan.some(step => !byId.has(step.id))) throw new Error('Keep existing milestones; explicitly skip obsolete work with a reason.')
  const next = mutable(state)
  next.plan = steps.map(step => {
    const previous = state.plan.find(candidate => candidate.id === step.id)
    const same = previous && previous.title === step.title && previous.requiresVerification === step.requiresVerification
      && JSON.stringify(previous.acceptanceCriteria) === JSON.stringify(step.acceptanceCriteria)
      && JSON.stringify(previous.dependsOn) === JSON.stringify(step.dependsOn)
    if (previous?.childRunId && !same) throw new Error('A delegated milestone cannot be revised while attached to a child.')
    return same ? { ...previous, evidenceRefs: [...previous.evidenceRefs] } : { ...step, dependsOn: [...step.dependsOn], acceptanceCriteria: [...step.acceptanceCriteria], status: 'pending', evidenceRefs: [] }
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
  assertActive(state)
  if (!evidence.id || !evidence.source || !evidence.summary || evidence.summary.length > 2_000) throw new Error('Evidence requires a bounded summary and source reference.')
  if (evidence.kind === 'verification' && (!evidence.verification || evidence.verification.planRevision !== state.planRevision
    || !state.plan.some(step => step.id === evidence.verification!.stepId))) throw new Error('Verification must identify a milestone in the current plan revision.')
  const previous = state.evidence.find(candidate => candidate.id === evidence.id)
  if (previous) {
    if (previous.kind !== evidence.kind || previous.source !== evidence.source || previous.summary !== evidence.summary || previous.verdict !== evidence.verdict
      || JSON.stringify(previous.verification) !== JSON.stringify(evidence.verification)) throw new Error('Evidence is immutable; use a new reference for new observations.')
    return state
  }
  const next = mutable(state)
  next.evidence.push({
    ...evidence,
    ...(evidence.verification ? { verification: { ...evidence.verification } } : {}),
  })
  return changed(next, now)
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
  const evidence = evidenceRefs.map(id => state.evidence.find(candidate => candidate.id === id))
  if (evidence.some(item => !item || item.verdict === 'failed')) throw new Error('Evidence must reference successful observations from this run.')
  if (input.status === 'done') {
    if (step.dependsOn.some(id => !['done', 'skipped'].includes(next.plan.find(candidate => candidate.id === id)!.status))) throw new Error('Dependencies are not complete.')
    if (!evidence.length) throw new Error('Completion requires evidence.')
    if (step.requiresVerification && !evidence.some(item => item?.kind === 'verification' && item.verdict === 'passed'
      && item.verification?.stepId === step.id && item.verification.planRevision === state.planRevision)) throw new Error('Independent verification of this milestone in the current plan revision is required.')
    if (step.childRunId && !state.children.some(child => child.id === step.childRunId && child.status === 'completed')) throw new Error('The delegated child has not completed.')
  }
  if (input.status === 'skipped' && !input.skipReason?.trim()) throw new Error('Skipping work requires a reason.')
  if (step.status === input.status && JSON.stringify(step.evidenceRefs) === JSON.stringify(evidenceRefs)) return state
  Object.assign(step, { status: input.status, evidenceRefs, ...(input.status === 'skipped' ? { skipReason: input.skipReason } : {}) })
  return changed(next, now)
}

function validateHarnessReceipt(receipt: HarnessReceipt) {
  for (const value of [receipt.inputTokens, receipt.outputTokens, receipt.reasoningTokens, receipt.cacheReadTokens, receipt.cacheWriteTokens, receipt.costMicros]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Usage and cost must be known nonnegative integers.')
  }
  if (!receipt.id || !receipt.modelId || !receipt.provider) throw new Error('A receipt requires actual routing identity.')
  if (receipt.contextWindow !== null && (!Number.isSafeInteger(receipt.contextWindow) || receipt.contextWindow <= 0)) throw new Error('Invalid context window.')
  if (receipt.cacheReadTokens + receipt.cacheWriteTokens > receipt.inputTokens) throw new Error('Cached tokens exceed total input usage.')
  if (receipt.externalCostMicros !== undefined) {
    if (receipt.costMicros !== 0 || receipt.costSource !== 'external'
      || (receipt.externalCostMicros !== null && (!Number.isSafeInteger(receipt.externalCostMicros) || receipt.externalCostMicros < 0))) throw new Error('Invalid external provider cost.')
  } else if (receipt.costSource === 'external') throw new Error('External provider cost must be reported or explicitly unknown.')
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

// The caller must atomically deduplicate receipt.id per run before recording.
export function recordHarnessReceipt(state: HarnessSnapshot, receipt: HarnessReceipt, now: number): HarnessSnapshot {
  if (state.latestReceipt?.id === receipt.id) {
    if (JSON.stringify(state.latestReceipt) !== JSON.stringify(receipt)) throw new Error('Receipt identity cannot be reused for different usage.')
    return state
  }
  validateHarnessReceipt(receipt)
  const next = mutable(state)
  if (next.modelReservation?.id === receipt.id) next.modelReservation = undefined
  next.latestReceipt = { ...receipt }
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

export function admitHarnessChild(state: HarnessSnapshot, child: HarnessChild, now: number): HarnessSnapshot {
  assertHarnessRunnable(state, now)
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
    || state.usage.costMicros + reservedHarnessCostMicros(state) + child.maxCostMicros > state.policy.maxCostMicros) throw new Error('The root spending budget cannot cover this child.')
  if (child.status !== 'running' || child.evidenceRefs.length || child.costMicros !== 0 || child.accountedUsage !== undefined) throw new Error('A new child must be empty and running.')
  const next = mutable(state)
  next.children.push({ ...child, allowedToolIds: [...child.allowedToolIds], evidenceRefs: [...child.evidenceRefs] })
  Object.assign(next.plan.find(candidate => candidate.id === child.stepId)!, { childRunId: child.id, status: 'running' })
  return changed(next, now)
}

export function harnessCompletionIssues(state: HarnessSnapshot): string[] {
  return [
    ...(state.status !== 'running' ? ['The run is not running.'] : []),
    ...(state.blocker ? ['A blocker remains unresolved.'] : []),
    ...(state.policy.requiresPlan && !state.plan.length ? ['A durable plan is required.'] : []),
    ...(state.plan.length && !state.plan.some(step => step.status === 'done') ? ['No milestone was completed.'] : []),
    ...state.plan.filter(step => !['done', 'skipped'].includes(step.status)).map(step => `Milestone ${step.id} is unfinished.`),
    ...(state.children.some(child => child.status === 'running') ? ['Child work is still running.'] : []),
    ...(state.modelReservation ? ['Model usage is awaiting reconciliation.'] : []),
  ]
}

export function reservedHarnessCostMicros(state: HarnessSnapshot): number {
  return (state.modelReservation?.maxCostMicros ?? 0)
    + state.children.filter(child => child.status === 'running').reduce((sum, child) => sum + Math.max(0, child.maxCostMicros - child.costMicros), 0)
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
  if (now >= state.policy.deadlineAt) throw new Error('The authorized run deadline is exhausted.')
  if (!Number.isSafeInteger(estimatedNextCostMicros) || estimatedNextCostMicros < 0) throw new Error('A nonnegative cost reservation is required.')
  const reserved = reservedHarnessCostMicros(state)
  if (state.usage.costMicros + reserved + estimatedNextCostMicros > state.policy.maxCostMicros) throw new Error('The authorized spending budget is exhausted.')
}

export function blockHarness(state: HarnessSnapshot, blocker: NonNullable<HarnessSnapshot['blocker']>, now: number): HarnessSnapshot {
  assertActive(state)
  if (!blocker.question.trim() || blocker.question.length > 2_000) throw new Error('A blocker requires a concise question or explanation.')
  const next = mutable(state)
  next.blocker = { ...blocker }
  next.status = blocker.kind === 'approval' ? 'waiting_for_approval' : 'waiting_for_input'
  return changed(next, now)
}

export function resumeHarness(state: HarnessSnapshot, now: number): HarnessSnapshot {
  assertActive(state)
  if (!state.blocker && state.status !== 'waiting_for_children') throw new Error('There is no blocker to resolve.')
  const next = mutable(state)
  next.blocker = undefined
  next.status = 'running'
  return changed(next, now)
}

export function hasRunnableHarnessMilestones(state: HarnessSnapshot): boolean {
  if (state.policy.requiresPlan && !state.plan.length) return true
  return state.plan.some(step => !['done', 'skipped'].includes(step.status)
    && step.dependsOn.every(id => state.plan.some(candidate => candidate.id === id && ['done', 'skipped'].includes(candidate.status)))
    && (!step.childRunId || !state.children.some(child => child.id === step.childRunId && child.status === 'running')))
}

export function claimHarnessExecution(state: HarnessSnapshot, workflowRunId: string, now: number): HarnessSnapshot {
  assertActive(state)
  if (!workflowRunId.trim() || workflowRunId.length > 256) throw new Error('Invalid workflow execution identity.')
  if (state.workflowRunId) {
    if (state.workflowRunId !== workflowRunId) throw new Error('HARNESS_EXECUTION_ALREADY_CLAIMED')
    return state
  }
  const next = mutable(state)
  next.workflowRunId = workflowRunId
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

export function checkpointHarness(state: HarnessSnapshot, summary: string, now: number): HarnessSnapshot {
  assertActive(state)
  if (summary.length > 8_000) throw new Error('Keep the working summary under 8,000 characters; store larger outputs as artifacts.')
  const next = mutable(state)
  next.workingSummary = summary
  next.continuations++
  next.stalledContinuations = state.progressRevision === state.lastContinuationProgressRevision ? state.stalledContinuations + 1 : 0
  next.lastContinuationProgressRevision = state.progressRevision
  if (next.stalledContinuations >= 2) return blockHarness(next, { kind: 'stuck', question: 'No durable progress after two continuation attempts. User input or a revised approach is required.' }, now)
  return changed(next, now, false)
}

export function finishHarness(state: HarnessSnapshot, now: number): HarnessSnapshot {
  assertHarnessRunnable(state, now)
  const issues = harnessCompletionIssues(state)
  if (issues.length) throw new Error(issues.join(' '))
  const next = mutable(state)
  next.status = 'completed'
  return changed(next, now)
}

export function settleHarnessChild(state: HarnessSnapshot, childState: HarnessSnapshot, now: number): HarnessSnapshot {
  assertActive(state)
  const child = state.children.find(candidate => candidate.id === childState.runId)
  if (!child || childState.parentRunId !== state.runId || childState.rootRunId !== state.rootRunId
    || childState.policy.actorUserId !== state.policy.actorUserId || childState.policy.workspaceId !== state.policy.workspaceId) throw new Error('The child does not belong to this run and authority.')
  if (childState.depth !== state.depth + 1
    || childState.policy.allowedToolIds.some(id => !child.allowedToolIds.includes(id))
    || childState.policy.maxCostMicros > child.maxCostMicros
    || childState.policy.deadlineAt > state.policy.deadlineAt
    || childState.policy.maxDepth > state.policy.maxDepth
    || childState.policy.maxParallelChildren > state.policy.maxParallelChildren) throw new Error('The child exceeds its delegated authority.')
  if (child.status !== 'running') return state
  if (!['completed', 'failed', 'cancelled'].includes(childState.status)) throw new Error('Child work has not finished.')
  if (childState.modelReservation || childState.children.some(child => child.status === 'running' || child.status === 'cancelled')) throw new Error('Reconcile outstanding child model calls before releasing its budget.')
  if (childState.usage.costMicros > child.maxCostMicros) throw new Error('Child usage exceeded its authorization; reconcile before continuing.')
  const next = mutable(state)
  Object.assign(next.children.find(candidate => candidate.id === child.id)!, {
    status: childState.status, costMicros: childState.usage.costMicros,
    summary: childState.workingSummary, evidenceRefs: childState.evidence.map(item => item.id),
    accountedUsage: { ...childState.usage },
  })
  const delta = { ...childState.usage }
  for (const key of usageKeys) {
    delta[key] = (delta[key] ?? 0) - (child.accountedUsage?.[key] ?? 0)
  }
  addHarnessUsage(next.usage, delta)
  return changed(next, now)
}

export function terminateHarness(state: HarnessSnapshot, status: 'cancelled' | 'failed', reason: string, now: number): HarnessSnapshot {
  if (['completed', 'cancelled', 'failed'].includes(state.status)) return state
  if (!reason.trim() || reason.length > 2_000) throw new Error('A concise termination reason is required.')
  const next = mutable(state)
  next.status = status
  next.terminalReason = reason
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

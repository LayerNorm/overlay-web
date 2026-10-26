import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireConversationAccess } from '../collaboration/directMessages'
import { validateServerSecret } from '../lib/auth'
import { getReadableRow } from '../lib/resourceScope'
import {
  admitHarnessChild,
  blockHarness,
  checkpointHarness,
  claimHarnessExecution,
  createHarnessSnapshot,
  finishHarness,
  recordHarnessEvidence,
  recordHarnessChildReceipt,
  recordHarnessReceipt,
  replaceHarnessPlan,
  resumeHarness,
  settleHarnessChild,
  terminateHarness,
  transitionHarnessStep,
  waitForHarnessChildren,
  type HarnessChild,
  type HarnessEvidence,
  type HarnessPolicy,
  type HarnessSnapshot,
} from '../../packages/overlay-agent-runtime/src/harness-state'
import type {
  HarnessAdmission,
  HarnessMutationResult,
  HarnessOperation,
  HarnessSource,
} from '../../packages/overlay-agent-runtime/src/harness-store'
import { v } from 'convex/values'

const MAX_ID_LENGTH = 256
const MAX_EVIDENCE_ID_LENGTH = 512
const MAX_GOAL_LENGTH = 32_000
const MAX_CONSTRAINTS = 32
const MAX_CONSTRAINT_LENGTH = 2_000
const MAX_TOOL_IDS = 512
const MAX_TOOL_ID_LENGTH = 256
const MAX_PLAN_STEPS = 128
const MAX_ACCEPTANCE_CRITERIA = 16
const MAX_EVIDENCE_REFS = 32
const MAX_EVIDENCE_SUMMARY_LENGTH = 2_000
const MAX_WORKING_SUMMARY_LENGTH = 8_000
const MAX_HARNESS_DEPTH = 32
const MAX_OPERATION_JSON_BYTES = 256 * 1024
const MAX_PLAN_JSON_BYTES = 512 * 1024

const policyValidator = v.object({
  actorUserId: v.string(),
  workspaceId: v.optional(v.string()),
  allowedToolIds: v.array(v.string()),
  requiresPlan: v.boolean(),
  deadlineAt: v.number(),
  maxCostMicros: v.number(),
  maxParallelChildren: v.number(),
  maxDepth: v.number(),
})

const sourceValidator = v.union(
  v.object({ conversationId: v.string() }),
  v.object({ noteId: v.string() }),
)

const admissionValidator = v.object({
  runId: v.string(),
  goal: v.string(),
  constraints: v.array(v.string()),
  policy: policyValidator,
  source: sourceValidator,
})

const planInputValidator = v.object({
  id: v.string(),
  title: v.string(),
  dependsOn: v.array(v.string()),
  acceptanceCriteria: v.array(v.string()),
  requiresVerification: v.boolean(),
})

const evidenceValidator = v.object({
  id: v.string(),
  kind: v.union(
    v.literal('tool_result'),
    v.literal('artifact'),
    v.literal('verification'),
    v.literal('user_input'),
  ),
  summary: v.string(),
  source: v.string(),
  verdict: v.union(v.literal('observed'), v.literal('passed'), v.literal('failed')),
  createdAt: v.number(),
  verification: v.optional(v.object({
    stepId: v.string(),
    planRevision: v.number(),
  })),
})

const receiptValidator = v.object({
  id: v.string(),
  modelId: v.string(),
  provider: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  reasoningTokens: v.number(),
  cacheReadTokens: v.number(),
  cacheWriteTokens: v.number(),
  contextWindow: v.union(v.number(), v.null()),
  costMicros: v.number(),
})

const childValidator = v.object({
  id: v.string(),
  stepId: v.string(),
  allowedToolIds: v.array(v.string()),
  maxCostMicros: v.number(),
  costMicros: v.number(),
  status: v.union(v.literal('running'), v.literal('completed'), v.literal('failed'), v.literal('cancelled')),
  summary: v.optional(v.string()),
  evidenceRefs: v.array(v.string()),
})

const operationValidator = v.union(
  v.object({ type: v.literal('claim_execution'), workflowRunId: v.string() }),
  v.object({ type: v.literal('replace_plan'), steps: v.array(planInputValidator) }),
  v.object({
    type: v.literal('transition_step'),
    id: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('running'),
      v.literal('blocked'),
      v.literal('verifying'),
      v.literal('done'),
      v.literal('skipped'),
    ),
    evidenceRefs: v.optional(v.array(v.string())),
    skipReason: v.optional(v.string()),
  }),
  v.object({ type: v.literal('record_evidence'), evidence: evidenceValidator }),
  v.object({ type: v.literal('record_receipt'), receipt: receiptValidator }),
  v.object({ type: v.literal('checkpoint'), summary: v.string() }),
  v.object({
    type: v.literal('block'),
    blocker: v.object({
      kind: v.union(v.literal('input'), v.literal('approval'), v.literal('budget'), v.literal('stuck')),
      question: v.string(),
    }),
  }),
  v.object({ type: v.literal('resume') }),
  v.object({ type: v.literal('wait_for_children') }),
  v.object({
    type: v.literal('admit_child'),
    child: childValidator,
    goal: v.string(),
    constraints: v.array(v.string()),
  }),
  v.object({ type: v.literal('settle_child'), childRunId: v.string() }),
  v.object({ type: v.literal('finish') }),
  v.object({
    type: v.literal('terminate'),
    status: v.union(v.literal('cancelled'), v.literal('failed')),
    reason: v.string(),
  }),
)

type HarnessMetadata = Omit<HarnessSnapshot, 'plan' | 'evidence' | 'children'>
type ReadContext = Pick<QueryCtx, 'db'>
type RunRow = Doc<'harnessRuns'>

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalize(entry)]),
      )
    }
    return item
  }
  const json = JSON.stringify(normalize(value))
  if (json === undefined) throw new Error('Harness state must be JSON serializable.')
  return json
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function metadataFromSnapshot(snapshot: HarnessSnapshot): HarnessMetadata {
  return {
    schemaVersion: snapshot.schemaVersion,
    runId: snapshot.runId,
    rootRunId: snapshot.rootRunId,
    ...(snapshot.parentRunId === undefined ? {} : { parentRunId: snapshot.parentRunId }),
    ...(snapshot.workflowRunId === undefined ? {} : { workflowRunId: snapshot.workflowRunId }),
    depth: snapshot.depth,
    goal: snapshot.goal,
    constraints: snapshot.constraints,
    policy: snapshot.policy,
    status: snapshot.status,
    revision: snapshot.revision,
    progressRevision: snapshot.progressRevision,
    planRevision: snapshot.planRevision,
    ...(snapshot.blocker === undefined ? {} : { blocker: snapshot.blocker }),
    ...(snapshot.terminalReason === undefined ? {} : { terminalReason: snapshot.terminalReason }),
    workingSummary: snapshot.workingSummary,
    continuations: snapshot.continuations,
    lastContinuationProgressRevision: snapshot.lastContinuationProgressRevision,
    stalledContinuations: snapshot.stalledContinuations,
    ...(snapshot.latestReceipt === undefined ? {} : { latestReceipt: snapshot.latestReceipt }),
    usage: snapshot.usage,
    updatedAt: snapshot.updatedAt,
  }
}

function canonicalSource(source: HarnessSource, normalizedId: string): HarnessSource {
  return 'conversationId' in source
    ? { conversationId: normalizedId }
    : { noteId: normalizedId }
}

function canonicalAdmission(input: HarnessAdmission, source: HarnessSource): HarnessAdmission {
  return {
    ...input,
    source,
    constraints: [...input.constraints],
    policy: {
      ...input.policy,
      allowedToolIds: [...new Set(input.policy.allowedToolIds)].sort(),
    },
  }
}

function assertBoundedAdmission(input: HarnessAdmission) {
  if (!input.runId.trim() || input.runId.length > MAX_ID_LENGTH) throw new Error('Invalid harness run id.')
  if (!input.goal.trim() || input.goal.length > MAX_GOAL_LENGTH) throw new Error('Harness goal must be nonempty and at most 32,000 characters.')
  if (input.constraints.length > MAX_CONSTRAINTS
    || input.constraints.some(constraint => !constraint.trim() || constraint.length > MAX_CONSTRAINT_LENGTH)) {
    throw new Error('Harness constraints must contain at most 32 nonempty entries of at most 2,000 characters.')
  }
  if (input.policy.allowedToolIds.length > MAX_TOOL_IDS
    || input.policy.allowedToolIds.some(id => !id.trim() || id.length > MAX_TOOL_ID_LENGTH)) {
    throw new Error('Harness policy tool ids exceed their bounds.')
  }
  if (!input.policy.actorUserId.trim()
    || (input.policy.workspaceId !== undefined && !input.policy.workspaceId.trim())
    || !Number.isFinite(input.policy.deadlineAt)
    || !Number.isSafeInteger(input.policy.maxCostMicros)
    || input.policy.maxCostMicros < 0
    || !Number.isSafeInteger(input.policy.maxParallelChildren)
    || input.policy.maxParallelChildren < 0
    || !Number.isSafeInteger(input.policy.maxDepth)
    || input.policy.maxDepth < 0
    || input.policy.maxDepth > MAX_HARNESS_DEPTH) {
    throw new Error('Invalid harness policy.')
  }
}

function assertBoundedOperation(operation: HarnessOperation) {
  switch (operation.type) {
    case 'replace_plan':
      if (operation.steps.length > MAX_PLAN_STEPS) throw new Error('A harness plan may contain at most 128 milestones.')
      for (const step of operation.steps) {
        if (!step.id.trim() || step.id.length > MAX_ID_LENGTH
          || !step.title.trim() || step.title.length > 500
          || step.dependsOn.length > MAX_PLAN_STEPS
          || step.dependsOn.some(id => !id.trim() || id.length > MAX_ID_LENGTH)
          || operation.steps.length > MAX_PLAN_STEPS
          || step.acceptanceCriteria.length > MAX_ACCEPTANCE_CRITERIA
          || step.acceptanceCriteria.some(item => !item.trim() || item.length > MAX_CONSTRAINT_LENGTH)) {
          throw new Error('Harness plan milestones exceed their bounds.')
        }
      }
      break
    case 'transition_step':
      if (!operation.id.trim() || operation.id.length > MAX_ID_LENGTH
        || (operation.evidenceRefs?.length ?? 0) > MAX_EVIDENCE_REFS
        || operation.evidenceRefs?.some(id => !id.trim() || id.length > MAX_EVIDENCE_ID_LENGTH)
        || (operation.skipReason !== undefined && operation.skipReason.length > MAX_EVIDENCE_SUMMARY_LENGTH)) {
        throw new Error('Harness step transition exceeds its bounds.')
      }
      break
    case 'record_evidence':
      if (!operation.evidence.id.trim() || operation.evidence.id.length > MAX_EVIDENCE_ID_LENGTH
        || !operation.evidence.source.trim() || operation.evidence.source.length > MAX_EVIDENCE_ID_LENGTH
        || !operation.evidence.summary.trim() || operation.evidence.summary.length > MAX_EVIDENCE_SUMMARY_LENGTH
        || !Number.isFinite(operation.evidence.createdAt) || operation.evidence.createdAt < 0
        || (operation.evidence.verification !== undefined
          && (!operation.evidence.verification.stepId.trim()
            || operation.evidence.verification.stepId.length > MAX_ID_LENGTH
            || !Number.isSafeInteger(operation.evidence.verification.planRevision)
            || operation.evidence.verification.planRevision < 0))) {
        throw new Error('Harness evidence exceeds its bounds.')
      }
      break
    case 'record_receipt':
      if (!operation.receipt.id.trim() || operation.receipt.id.length > MAX_ID_LENGTH
        || !operation.receipt.modelId.trim() || operation.receipt.modelId.length > MAX_ID_LENGTH
        || !operation.receipt.provider.trim() || operation.receipt.provider.length > MAX_ID_LENGTH) {
        throw new Error('Harness receipt exceeds its bounds.')
      }
      break
    case 'checkpoint':
      if (operation.summary.length > MAX_WORKING_SUMMARY_LENGTH) throw new Error('Harness working summary exceeds 8,000 characters.')
      break
    case 'block':
      if (!operation.blocker.question.trim() || operation.blocker.question.length > MAX_EVIDENCE_SUMMARY_LENGTH) {
        throw new Error('Harness blocker exceeds its bounds.')
      }
      break
    case 'admit_child':
      if (!operation.child.id.trim() || operation.child.id.length > MAX_ID_LENGTH
        || !operation.child.stepId.trim() || operation.child.stepId.length > MAX_ID_LENGTH
        || operation.child.allowedToolIds.length > MAX_TOOL_IDS
        || operation.child.allowedToolIds.some(id => !id.trim() || id.length > MAX_TOOL_ID_LENGTH)
        || operation.child.evidenceRefs.length > MAX_EVIDENCE_REFS
        || operation.child.evidenceRefs.some(id => !id.trim() || id.length > MAX_EVIDENCE_ID_LENGTH)
        || (operation.child.summary !== undefined)
        || !operation.goal.trim() || operation.goal.length > MAX_GOAL_LENGTH
        || operation.constraints.length > MAX_CONSTRAINTS
        || operation.constraints.some(item => !item.trim() || item.length > MAX_CONSTRAINT_LENGTH)) {
        throw new Error('Harness child admission exceeds its bounds.')
      }
      break
    case 'settle_child':
      if (!operation.childRunId.trim() || operation.childRunId.length > MAX_ID_LENGTH) {
        throw new Error('Invalid harness child run id.')
      }
      break
    case 'terminate':
      if (!operation.reason.trim() || operation.reason.length > MAX_EVIDENCE_SUMMARY_LENGTH) {
        throw new Error('Harness termination reason exceeds its bounds.')
      }
      break
  }
}

function requireHarnessServerSecret(secret: string) {
  if (!validateServerSecret(secret)) throw new Error('Unauthorized')
}

async function normalizeAndCheckSource(
  ctx: ReadContext,
  source: HarnessSource,
  actorUserId: string,
  policy: HarnessPolicy,
  serverSecret: string,
): Promise<HarnessSource> {
  if ('conversationId' in source) {
    if (typeof source.conversationId !== 'string') throw new Error('CONVERSATION_ACCESS_DENIED')
    const conversationId = ctx.db.normalizeId('conversations', source.conversationId)
    if (!conversationId) throw new Error('CONVERSATION_ACCESS_DENIED')
    const conversation = await ctx.db.get(conversationId)
    if (!conversation || conversation.deletedAt) throw new Error('CONVERSATION_ACCESS_DENIED')
    if (conversation.workspaceId !== undefined) {
      if (policy.workspaceId !== conversation.workspaceId) throw new Error('CONVERSATION_ACCESS_DENIED')
      await requireConversationAccess(ctx, {
        actorUserId,
        conversationId,
        workspaceId: conversation.workspaceId,
        serverSecret,
      })
    } else if (policy.workspaceId !== undefined || conversation.userId !== actorUserId) {
      throw new Error('CONVERSATION_ACCESS_DENIED')
    }
    return canonicalSource(source, conversationId)
  }

  const noteId = ctx.db.normalizeId('files', source.noteId)
  if (!noteId) throw new Error('NOTE_ACCESS_DENIED')
  const file = await ctx.db.get(noteId)
  if (!file || file.kind !== 'note' || file.deletedAt) throw new Error('NOTE_ACCESS_DENIED')
  if (file.workspaceId !== policy.workspaceId) throw new Error('NOTE_ACCESS_DENIED')
  const readable = await getReadableRow(ctx, {
    row: file,
    userId: actorUserId,
    workspaceId: policy.workspaceId,
  })
  if (!readable) throw new Error('NOTE_ACCESS_DENIED')
  return canonicalSource(source, noteId)
}

async function findRun(ctx: ReadContext, runId: string): Promise<RunRow | null> {
  return await ctx.db.query('harnessRuns')
    .withIndex('by_runId', query => query.eq('runId', runId))
    .unique()
}

async function assertStoredRunAccess(
  ctx: ReadContext,
  run: RunRow,
  actorUserId: string,
  serverSecret: string,
): Promise<HarnessMetadata> {
  const metadata = parseJson<HarnessMetadata>(run.metadataJson)
  if (run.actorUserId !== actorUserId || metadata.policy.actorUserId !== actorUserId) {
    throw new Error('HARNESS_ACCESS_DENIED')
  }
  if (metadata.runId !== run.runId || metadata.rootRunId !== run.rootRunId
    || metadata.parentRunId !== run.parentRunId) throw new Error('Invalid stored harness authority.')
  const source = parseJson<HarnessSource>(run.sourceJson)
  await normalizeAndCheckSource(ctx, source, actorUserId, metadata.policy, serverSecret)
  return metadata
}

type LineageEntry = { run: RunRow; metadata: HarnessMetadata }

function isTerminalStatus(status: HarnessMetadata['status']) {
  return status === 'completed' || status === 'cancelled' || status === 'failed'
}

async function loadLineage(
  ctx: ReadContext,
  run: RunRow,
  actorUserId: string,
  serverSecret: string,
): Promise<LineageEntry[]> {
  const entries: LineageEntry[] = []
  const seen = new Set<string>()
  let current: RunRow | null = run
  while (current) {
    if (entries.length > MAX_HARNESS_DEPTH + 1 || seen.has(current.runId)) {
      throw new Error('Invalid harness parent lineage.')
    }
    seen.add(current.runId)
    const metadata = await assertStoredRunAccess(ctx, current, actorUserId, serverSecret)
    if (metadata.depth > MAX_HARNESS_DEPTH) throw new Error('Invalid harness depth.')
    checkedActiveCount(current.activeDescendantCount)
    entries.push({ run: current, metadata })
    if (current.parentRunId === undefined) break
    const parent = await findRun(ctx, current.parentRunId)
    if (!parent || parent.rootRunId !== run.rootRunId) throw new Error('HARNESS_PARENT_NOT_FOUND')
    current = parent
  }
  const root = entries.at(-1)
  if (!root || root.run.rootRunId !== root.run.runId || root.run.parentRunId !== undefined
    || root.metadata.depth !== 0 || root.run.runId !== run.rootRunId) {
    throw new Error('HARNESS_ROOT_NOT_FOUND')
  }
  for (let index = 0; index < entries.length - 1; index++) {
    const child = entries[index]
    const parent = entries[index + 1]
    if (child.metadata.parentRunId !== parent.run.runId
      || child.metadata.rootRunId !== parent.run.rootRunId
      || child.metadata.depth !== parent.metadata.depth + 1
      || child.metadata.policy.actorUserId !== parent.metadata.policy.actorUserId
      || child.metadata.policy.workspaceId !== parent.metadata.policy.workspaceId) {
      throw new Error('Invalid harness parent lineage.')
    }
  }
  return entries
}

async function hydrateSnapshot(
  ctx: ReadContext,
  run: RunRow,
  extraEvidenceRefs: string[] = [],
  transitionStepId?: string,
  hydrateExistingStepRefs = false,
): Promise<HarnessSnapshot> {
  const metadata = parseJson<HarnessMetadata>(run.metadataJson)
  const planRows = await ctx.db.query('harnessPlanSteps')
    .withIndex('by_runId', query => query.eq('runId', run.runId))
    .collect()
  const plan = planRows
    .sort((left, right) => left.position - right.position)
    .map(row => parseJson<HarnessSnapshot['plan'][number]>(row.stepJson))
  const evidenceRefs = new Set(extraEvidenceRefs)
  if (hydrateExistingStepRefs && transitionStepId) {
    for (const evidenceId of plan.find(step => step.id === transitionStepId)?.evidenceRefs ?? []) {
      evidenceRefs.add(evidenceId)
    }
  }
  const childRows = await ctx.db.query('harnessChildren')
    .withIndex('by_runId', query => query.eq('runId', run.runId))
    .collect()
  const recentEvidenceRows = await ctx.db.query('harnessEvidence')
    .withIndex('by_runId_createdAt', query => query.eq('runId', run.runId))
    .order('desc')
    .take(32)
  const evidenceById = new Map<string, HarnessEvidence>()
  for (const row of recentEvidenceRows) evidenceById.set(row.evidenceId, parseJson<HarnessEvidence>(row.evidenceJson))
  for (const evidenceId of evidenceRefs) {
    if (evidenceById.has(evidenceId)) continue
    const row = await ctx.db.query('harnessEvidence')
      .withIndex('by_runId_evidenceId', query => query.eq('runId', run.runId).eq('evidenceId', evidenceId))
      .unique()
    if (row) evidenceById.set(row.evidenceId, parseJson<HarnessEvidence>(row.evidenceJson))
  }
  return {
    ...metadata,
    plan,
    evidence: [...evidenceById.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
    children: childRows
      .map(row => parseJson<HarnessChild>(row.childJson))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function projectAncestorTermination(snapshot: HarnessSnapshot, lineage: LineageEntry[]): HarnessSnapshot {
  if (isTerminalStatus(snapshot.status)) return snapshot
  const terminalAncestor = lineage.slice(1).find(entry => isTerminalStatus(entry.metadata.status))
  if (!terminalAncestor) return snapshot
  return {
    ...snapshot,
    status: 'cancelled',
    terminalReason: terminalAncestor.metadata.terminalReason ?? 'An ancestor harness run terminated.',
    children: snapshot.children.map(child => child.status === 'running' ? { ...child, status: 'cancelled' } : child),
  }
}

async function currentSnapshot(
  ctx: ReadContext,
  run: RunRow,
  lineage: LineageEntry[],
  extraEvidenceRefs: string[] = [],
  transitionStepId?: string,
  hydrateExistingStepRefs = false,
): Promise<HarnessSnapshot> {
  return projectAncestorTermination(
    await hydrateSnapshot(ctx, run, extraEvidenceRefs, transitionStepId, hydrateExistingStepRefs),
    lineage,
  )
}

async function persistMetadata(ctx: MutationCtx, run: RunRow, snapshot: HarnessSnapshot) {
  await ctx.db.patch(run._id, {
    metadataJson: stableJson(metadataFromSnapshot(snapshot)),
    updatedAt: snapshot.updatedAt,
  })
}

async function persistPlan(
  ctx: MutationCtx,
  runId: string,
  previousPlanRevision: number,
  previousPlan: HarnessSnapshot['plan'],
  snapshot: HarnessSnapshot,
  now: number,
) {
  const planChanged = stableJson(previousPlan) !== stableJson(snapshot.plan)
  const planJson = stableJson(snapshot.plan)
  if (planChanged || snapshot.planRevision !== previousPlanRevision) {
    if (new TextEncoder().encode(planJson).byteLength > MAX_PLAN_JSON_BYTES) {
      throw new Error('Harness plan revision exceeds the 512 KiB encoded limit.')
    }
  }
  if (planChanged) {
    const previousRows = await ctx.db.query('harnessPlanSteps')
      .withIndex('by_runId', query => query.eq('runId', runId))
      .collect()
    for (const row of previousRows) await ctx.db.delete(row._id)
    for (const [position, step] of snapshot.plan.entries()) {
      await ctx.db.insert('harnessPlanSteps', {
        runId,
        stepId: step.id,
        position,
        stepJson: stableJson(step),
      })
    }
  }
  if (snapshot.planRevision !== previousPlanRevision) {
    await ctx.db.insert('harnessPlanRevisions', {
      runId,
      planRevision: snapshot.planRevision,
      planJson,
      createdAt: now,
    })
  }
}

async function persistChildren(
  ctx: MutationCtx,
  runId: string,
  previous: HarnessChild[],
  next: HarnessChild[],
) {
  const existingRows = await ctx.db.query('harnessChildren')
    .withIndex('by_runId', query => query.eq('runId', runId))
    .collect()
  const rowsByChildId = new Map(existingRows.map(row => [row.childRunId, row]))
  const previousById = new Map(previous.map(child => [child.id, child]))
  for (const child of next) {
    const row = rowsByChildId.get(child.id)
    if (row) {
      if (stableJson(previousById.get(child.id)) !== stableJson(child)) {
        await ctx.db.patch(row._id, { childJson: stableJson(child) })
      }
    } else {
      await ctx.db.insert('harnessChildren', {
        runId,
        childRunId: child.id,
        childJson: stableJson(child),
      })
    }
  }
}

function sameEvidence(left: HarnessEvidence, right: HarnessEvidence): boolean {
  return stableJson({ ...left, createdAt: undefined }) === stableJson({ ...right, createdAt: undefined })
}

async function getEvidenceRow(ctx: ReadContext, runId: string, evidenceId: string) {
  return await ctx.db.query('harnessEvidence')
    .withIndex('by_runId_evidenceId', query => query.eq('runId', runId).eq('evidenceId', evidenceId))
    .unique()
}

function childAdmission(parent: HarnessSnapshot, operation: Extract<HarnessOperation, { type: 'admit_child' }>) {
  const constraints = [...parent.constraints, ...operation.constraints]
  if (constraints.length > MAX_CONSTRAINTS) throw new Error('Child constraints exceed the 32-entry limit.')
  const policy: HarnessPolicy = {
    actorUserId: parent.policy.actorUserId,
    ...(parent.policy.workspaceId ? { workspaceId: parent.policy.workspaceId } : {}),
    allowedToolIds: [...new Set(operation.child.allowedToolIds)].sort(),
    requiresPlan: true,
    deadlineAt: parent.policy.deadlineAt,
    maxCostMicros: operation.child.maxCostMicros,
    maxParallelChildren: parent.policy.maxParallelChildren,
    maxDepth: parent.policy.maxDepth,
  }
  return {
    runId: operation.child.id,
    goal: operation.goal,
    constraints,
    policy,
    parentRunId: parent.runId,
    rootRunId: parent.rootRunId,
    depth: parent.depth + 1,
  }
}

function checkedActiveCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid active descendant count.')
  return value
}

async function incrementAncestorCounts(ctx: MutationCtx, lineage: LineageEntry[]) {
  for (const entry of lineage) {
    const nextCount = checkedActiveCount(entry.run.activeDescendantCount + 1)
    await ctx.db.patch(entry.run._id, { activeDescendantCount: nextCount })
  }
}

async function releaseTerminalSubtree(
  ctx: MutationCtx,
  run: RunRow,
  lineage: LineageEntry[],
) {
  const subtreeSize = checkedActiveCount(run.activeDescendantCount + 1)
  for (const entry of lineage.slice(1)) {
    const nextCount = checkedActiveCount(entry.run.activeDescendantCount - subtreeSize)
    await ctx.db.patch(entry.run._id, { activeDescendantCount: nextCount })
  }
  await ctx.db.patch(run._id, { activeDescendantCount: 0 })
}

async function applyReducer(
  ctx: MutationCtx,
  run: RunRow,
  current: HarnessSnapshot,
  operation: HarnessOperation,
  serverSecret: string,
  now: number,
): Promise<{
  snapshot: HarnessSnapshot
  childRun?: { admission: ReturnType<typeof childAdmission>; snapshot: HarnessSnapshot }
  evidenceToPersist?: HarnessEvidence
}> {
  switch (operation.type) {
    case 'claim_execution':
      return { snapshot: claimHarnessExecution(current, operation.workflowRunId, now) }
    case 'replace_plan':
      return { snapshot: replaceHarnessPlan(current, operation.steps, now) }
    case 'transition_step':
      return { snapshot: transitionHarnessStep(current, operation, now) }
    case 'record_evidence': {
      const stored = await getEvidenceRow(ctx, run.runId, operation.evidence.id)
      if (stored) {
        const previous = parseJson<HarnessEvidence>(stored.evidenceJson)
        if (!sameEvidence(previous, operation.evidence)) throw new Error('Evidence identity cannot be reused for different observations.')
        return { snapshot: current }
      }
      return {
        snapshot: recordHarnessEvidence(current, operation.evidence, now),
        evidenceToPersist: operation.evidence,
      }
    }
    case 'record_receipt':
      return { snapshot: recordHarnessReceipt(current, operation.receipt, now) }
    case 'checkpoint':
      return { snapshot: checkpointHarness(current, operation.summary, now) }
    case 'block':
      return { snapshot: blockHarness(current, operation.blocker, now) }
    case 'resume':
      return { snapshot: resumeHarness(current, now) }
    case 'wait_for_children':
      return { snapshot: waitForHarnessChildren(current, now) }
    case 'admit_child': {
      const admission = childAdmission(current, operation)
      if (await findRun(ctx, admission.runId)) throw new Error('Harness child run id already exists.')
      const snapshot = admitHarnessChild(current, operation.child, now)
      const childSnapshot = createHarnessSnapshot({
        runId: admission.runId,
        goal: admission.goal,
        constraints: admission.constraints,
        policy: admission.policy,
        parentRunId: admission.parentRunId,
        rootRunId: admission.rootRunId,
        depth: admission.depth,
      }, now)
      return { snapshot, childRun: { admission, snapshot: childSnapshot } }
    }
    case 'settle_child': {
      const childRun = await findRun(ctx, operation.childRunId)
      if (!childRun || childRun.parentRunId !== run.runId || childRun.rootRunId !== run.rootRunId) {
        throw new Error('HARNESS_CHILD_NOT_FOUND')
      }
      const childLineage = await loadLineage(ctx, childRun, current.policy.actorUserId, serverSecret)
      const childMetadata = childLineage[0]!.metadata
      const childSnapshot = await hydrateSnapshot(ctx, childRun)
      let snapshot = settleHarnessChild(current, childSnapshot, now)
      if (childSnapshot.status === 'completed') {
        const rawSummary = childSnapshot.workingSummary.trim() || `Completed child run ${childSnapshot.runId}.`
        const summary = rawSummary.length > MAX_EVIDENCE_SUMMARY_LENGTH
          ? `${rawSummary.slice(0, MAX_EVIDENCE_SUMMARY_LENGTH - 1)}…`
          : rawSummary
        const evidence: HarnessEvidence = {
          id: `child:${childSnapshot.runId}:${childSnapshot.revision}`,
          kind: 'tool_result',
          summary,
          source: `child:${childSnapshot.runId}:${childSnapshot.revision}`,
          verdict: 'observed',
          createdAt: now,
        }
        const existingEvidence = await getEvidenceRow(ctx, run.runId, evidence.id)
        if (existingEvidence) {
          const previous = parseJson<HarnessEvidence>(existingEvidence.evidenceJson)
          if (!sameEvidence(previous, evidence)) throw new Error('Child evidence identity cannot be reused.')
        } else if (snapshot.revision !== current.revision) {
          snapshot = recordHarnessEvidence(snapshot, evidence, now)
          return { snapshot, evidenceToPersist: evidence }
        }
      }
      if (childMetadata.parentRunId !== run.runId || childMetadata.rootRunId !== run.rootRunId) {
        throw new Error('Invalid stored child authority.')
      }
      return { snapshot }
    }
    case 'finish':
      return { snapshot: finishHarness(current, now) }
    case 'terminate':
      return { snapshot: terminateHarness(current, operation.status, operation.reason, now) }
  }
}

export const admit = mutation({
  args: { ...admissionValidator.fields, serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireHarnessServerSecret(args.serverSecret)
    const { serverSecret, ...rawAdmission } = args
    const input = rawAdmission as HarnessAdmission
    assertBoundedAdmission(input)
    const source = await normalizeAndCheckSource(
      ctx,
      input.source,
      input.policy.actorUserId,
      input.policy,
      serverSecret,
    )
    const admission = canonicalAdmission(input, source)
    const admissionJson = stableJson(admission)
    const existing = await findRun(ctx, admission.runId)
    if (existing) {
      await assertStoredRunAccess(ctx, existing, admission.policy.actorUserId, serverSecret)
      if (existing.parentRunId !== undefined || existing.admissionJson !== admissionJson) {
        throw new Error('HARNESS_ADMISSION_CONFLICT')
      }
      const lineage = await loadLineage(ctx, existing, admission.policy.actorUserId, serverSecret)
      return await currentSnapshot(ctx, existing, lineage)
    }

    const now = Date.now()
    const snapshot = createHarnessSnapshot({
      runId: admission.runId,
      goal: admission.goal,
      constraints: admission.constraints,
      policy: admission.policy,
    }, now)
    await ctx.db.insert('harnessRuns', {
      runId: snapshot.runId,
      actorUserId: admission.policy.actorUserId,
      rootRunId: snapshot.rootRunId,
      activeDescendantCount: 0,
      sourceJson: stableJson(source),
      admissionJson,
      metadataJson: stableJson(metadataFromSnapshot(snapshot)),
      createdAt: now,
      updatedAt: now,
    })
    return snapshot
  },
})

export const get = query({
  args: {
    actorUserId: v.string(),
    runId: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireHarnessServerSecret(args.serverSecret)
    if (!args.actorUserId.trim() || !args.runId.trim() || args.runId.length > MAX_ID_LENGTH) {
      throw new Error('Invalid harness read identity.')
    }
    const run = await findRun(ctx, args.runId)
    if (!run) return null
    const lineage = await loadLineage(ctx, run, args.actorUserId, args.serverSecret)
    return await currentSnapshot(ctx, run, lineage)
  },
})

export const apply = mutation({
  args: {
    actorUserId: v.string(),
    runId: v.string(),
    operationId: v.string(),
    expectedRevision: v.number(),
    operation: operationValidator,
    serverSecret: v.string(),
  },
  handler: async (ctx, args): Promise<HarnessMutationResult> => {
    requireHarnessServerSecret(args.serverSecret)
    if (!args.actorUserId.trim() || !args.runId.trim() || args.runId.length > MAX_ID_LENGTH
      || !args.operationId.trim() || args.operationId.length > MAX_ID_LENGTH
      || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) {
      throw new Error('Invalid harness mutation identity or revision.')
    }
    const operation = args.operation as HarnessOperation
    assertBoundedOperation(operation)
    const run = await findRun(ctx, args.runId)
    if (!run) throw new Error('HARNESS_RUN_NOT_FOUND')
    const lineage = await loadLineage(ctx, run, args.actorUserId, args.serverSecret)
    const metadata = lineage[0]!.metadata
    const operationJson = stableJson(operation)
    if (new TextEncoder().encode(operationJson).byteLength > MAX_OPERATION_JSON_BYTES) {
      throw new Error('Harness operation exceeds the 256 KiB encoded limit.')
    }
    const existingOperation = await ctx.db.query('harnessOperations')
      .withIndex('by_runId_operationId', query => (
        query.eq('runId', run.runId).eq('operationId', args.operationId)
      ))
      .unique()
    if (existingOperation) {
      if (existingOperation.operationJson !== operationJson) throw new Error('HARNESS_OPERATION_ID_CONFLICT')
      const replaySnapshot = await currentSnapshot(
        ctx,
        run,
        lineage,
        operation.type === 'transition_step' ? operation.evidenceRefs ?? [] : [],
        operation.type === 'transition_step' && operation.evidenceRefs === undefined ? operation.id : undefined,
        operation.type === 'transition_step' && operation.evidenceRefs === undefined,
      )
      return { applied: false, conflict: false, snapshot: replaySnapshot }
    }

    const ancestorTerminal = lineage.some(entry => isTerminalStatus(entry.metadata.status))
    const isLateReceipt = operation.type === 'record_receipt' && ancestorTerminal
    if (ancestorTerminal && !isLateReceipt) throw new Error('The harness run is terminal.')

    const extraEvidenceRefs = operation.type === 'transition_step' ? operation.evidenceRefs ?? [] : []
    const hydrateExistingStepRefs = operation.type === 'transition_step' && operation.evidenceRefs === undefined
    const transitionStepId = hydrateExistingStepRefs && operation.type === 'transition_step' ? operation.id : undefined
    const currentState = await hydrateSnapshot(ctx, run, extraEvidenceRefs, transitionStepId, hydrateExistingStepRefs)
    const current = projectAncestorTermination(currentState, lineage)
    if (current.revision !== args.expectedRevision) {
      return { applied: false, conflict: true, snapshot: current }
    }

    if (operation.type === 'record_receipt') {
      const receiptJson = stableJson(operation.receipt)
      const existingReceipt = await ctx.db.query('harnessReceipts')
        .withIndex('by_runId_receiptId', query => (
          query.eq('runId', run.runId).eq('receiptId', operation.receipt.id)
        ))
        .unique()
      if (existingReceipt && existingReceipt.receiptJson !== receiptJson) {
        throw new Error('HARNESS_RECEIPT_ID_CONFLICT')
      }
      if (existingReceipt) {
        const now = Date.now()
        await ctx.db.insert('harnessOperations', {
          runId: run.runId,
          operationId: args.operationId,
          operationJson,
          appliedRevision: current.revision,
          createdAt: now,
        })
        return { applied: false, conflict: false, snapshot: current }
      }
    }

    if (operation.type === 'admit_child') {
      const root = lineage.at(-1)!
      if (root.run.activeDescendantCount >= root.metadata.policy.maxParallelChildren) {
        throw new Error('The root child concurrency budget is exhausted.')
      }
    }

    const now = Date.now()
    const result = await applyReducer(ctx, run, currentState, operation, args.serverSecret, now)
    const next = result.snapshot
    const changed = next.revision !== current.revision
    const becameTerminal = !isTerminalStatus(metadata.status) && isTerminalStatus(next.status)
    if (result.evidenceToPersist) {
      await ctx.db.insert('harnessEvidence', {
        runId: run.runId,
        evidenceId: result.evidenceToPersist.id,
        evidenceJson: stableJson(result.evidenceToPersist),
        createdAt: result.evidenceToPersist.createdAt,
      })
    }
    if (operation.type === 'record_receipt') {
      await ctx.db.insert('harnessReceipts', {
        runId: run.runId,
        receiptId: operation.receipt.id,
        receiptJson: stableJson(operation.receipt),
        createdAt: now,
      })
    }

    if (operation.type === 'admit_child') await incrementAncestorCounts(ctx, lineage)
    if (becameTerminal) await releaseTerminalSubtree(ctx, run, lineage)

    if (changed) {
      await persistMetadata(ctx, run, next)
      await persistPlan(ctx, run.runId, current.planRevision, current.plan, next, now)
      await persistChildren(ctx, run.runId, current.children, next.children)
    }
    if (operation.type === 'record_receipt') {
      for (let index = 1; index < lineage.length; index++) {
        const parent = lineage[index]!
        const child = lineage[index - 1]!
        const parentSnapshot = await hydrateSnapshot(ctx, parent.run)
        const reconciled = recordHarnessChildReceipt(parentSnapshot, child.run.runId, operation.receipt, now)
        await persistMetadata(ctx, parent.run, reconciled)
        await persistChildren(ctx, parent.run.runId, parentSnapshot.children, reconciled.children)
      }
    }
    if (result.childRun) {
      const { admission, snapshot } = result.childRun
      await ctx.db.insert('harnessRuns', {
        runId: snapshot.runId,
        actorUserId: snapshot.policy.actorUserId,
        rootRunId: snapshot.rootRunId,
        parentRunId: snapshot.parentRunId,
        activeDescendantCount: 0,
        sourceJson: run.sourceJson,
        admissionJson: stableJson({
          runId: admission.runId,
          goal: admission.goal,
          constraints: admission.constraints,
          policy: admission.policy,
          source: parseJson<HarnessSource>(run.sourceJson),
          rootRunId: admission.rootRunId,
          parentRunId: admission.parentRunId,
          depth: admission.depth,
        }),
        metadataJson: stableJson(metadataFromSnapshot(snapshot)),
        createdAt: now,
        updatedAt: now,
      })
    }
    if (operation.type === 'checkpoint') {
      await ctx.db.insert('harnessCheckpoints', {
        runId: run.runId,
        operationId: args.operationId,
        revision: next.revision,
        metadataJson: stableJson(metadataFromSnapshot(next)),
        planRevision: next.planRevision,
        createdAt: now,
      })
    }
    await ctx.db.insert('harnessOperations', {
      runId: run.runId,
      operationId: args.operationId,
      operationJson,
      appliedRevision: next.revision,
      createdAt: now,
    })
    const updatedRun = await findRun(ctx, run.runId)
    if (!updatedRun) throw new Error('HARNESS_RUN_NOT_FOUND')
    const updatedLineage = await loadLineage(ctx, updatedRun, args.actorUserId, args.serverSecret)
    const returned = await currentSnapshot(
      ctx,
      updatedRun,
      updatedLineage,
      extraEvidenceRefs,
      transitionStepId,
      hydrateExistingStepRefs,
    )
    return { applied: changed, conflict: false, snapshot: returned }
  },
})

export const readEvidence = query({
  args: {
    actorUserId: v.string(),
    runId: v.string(),
    evidenceId: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireHarnessServerSecret(args.serverSecret)
    if (!args.actorUserId.trim() || !args.runId.trim() || args.runId.length > MAX_ID_LENGTH
      || !args.evidenceId.trim() || args.evidenceId.length > MAX_EVIDENCE_ID_LENGTH) {
      throw new Error('Invalid harness evidence identity.')
    }
    const run = await findRun(ctx, args.runId)
    if (!run) return null
    await loadLineage(ctx, run, args.actorUserId, args.serverSecret)
    const evidence = await getEvidenceRow(ctx, run.runId, args.evidenceId)
    return evidence ? parseJson<HarnessEvidence>(evidence.evidenceJson) : null
  },
})

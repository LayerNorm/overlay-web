import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { requireConversationAccess } from '../collaboration/directMessages'
import { validateServerSecret } from '../lib/auth'
import { getReadableRow } from '../lib/resourceScope'
import { assertNativeThreadWritable } from '../lib/nativeThreadCompatibility'
import { uniqueWorkspaceAccount } from '../billing/accountModel'
import { isHarnessDeliveryConversation, validateNativeHarnessDelivery } from './nativeDelivery'
import {
  admitHarnessChild,
  admitHarnessNamedChild,
  blockHarness,
  bindHarnessModelDispatch,
  checkpointHarness,
  claimHarnessExecution,
  createHarnessSnapshot,
  finishHarness,
  applyHarnessResourceGrant,
  consumeHarnessResourcePause,
  HarnessPlanValidationError,
  recordHarnessEvidence,
  recordHarnessVerification,
  setHarnessCompaction,
  recordHarnessChildReceipt,
  recordHarnessReceipt,
  reserveHarnessModel,
  reservedHarnessCostMicros,
  pauseHarnessForResources,
  replaceHarnessPlan,
  resumeHarness,
  settleHarnessChild,
  terminateHarness,
  transitionHarnessStep,
  waitForHarnessChildren,
  type HarnessChild,
  type HarnessEvidence,
  type HarnessPolicy,
  type HarnessReceipt,
  type HarnessSnapshot,
} from '../../packages/overlay-agent-runtime/src/harness-state'
import {
  assertSafeResourceMicros,
  calculateHarnessResourceGrantReceipt,
  MAX_HARNESS_RESOURCE_SPEND_MICROS,
  type HarnessResourceGrant,
  type HarnessResourceGrantReceipt,
  type HarnessResourceRequest,
  type HarnessResourceRequestRecord,
  type HarnessResourceRequestReference,
} from '../../packages/overlay-agent-runtime/src/harness-resource'
import type {
  HarnessAdmission,
  HarnessMutationResult,
  HarnessOperation,
  HarnessSource,
  HarnessWait,
  HarnessWaitReference,
  HarnessWaitRequest,
} from '../../packages/overlay-agent-runtime/src/harness-store'
import { harnessToolsRequirePlan } from '../../packages/overlay-agent-runtime/src/harness-write-tools'
import { ConvexError, v } from 'convex/values'
import { OPENROUTER_FREE_MODEL_ID, OVERLAY_FREE_MODEL_ID } from '@/shared/ai/gateway/overlay-free-policy'

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
const MAX_WAIT_REQUESTS = 128

const waitRequestValidator = v.union(
  v.object({
    kind: v.literal('input'),
    token: v.string(),
  }),
  v.object({
    kind: v.literal('approval'),
    token: v.string(),
    requests: v.array(v.object({
      approvalId: v.string(),
      toolCallId: v.string(),
      toolName: v.string(),
      input: v.any(),
    })),
  }),
)

const waitReferenceFields = {
  actorUserId: v.string(),
  runId: v.string(),
  workflowRunId: v.string(),
}

const policyValidator = v.object({
  actorUserId: v.string(),
  workspaceId: v.optional(v.string()),
  resourcePauseVersion: v.optional(v.literal(1)),
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
  deliveryAgentRunId: v.optional(v.string()),
  resourcePauseAuthority: v.optional(v.literal('personal_chat_work')),
})

const planInputValidator = v.object({
  id: v.string(),
  title: v.string(),
  dependsOn: v.array(v.string()),
  acceptanceCriteria: v.array(v.string()),
  evidenceTools: v.optional(v.array(v.string())),
  requiresVerification: v.boolean(),
  answerOnly: v.optional(v.boolean()),
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
  inputDigest: v.optional(v.string()),
  resource: v.optional(v.object({
    id: v.string(),
    revision: v.optional(v.string()),
    operation: v.optional(v.string()),
    page: v.optional(v.number()),
  })),
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
  costSource: v.optional(v.union(v.literal('provider'), v.literal('catalog'), v.literal('external'))),
  externalCostMicros: v.optional(v.union(v.number(), v.null())),
  rejectionReason: v.optional(v.union(
    v.literal('budget'),
    v.literal('model_unavailable'),
    v.literal('route_capacity'),
    v.literal('route_interrupted'),
    v.literal('route_unavailable'),
    v.literal('summary_failed'),
  )),
  responseFailure: v.optional(v.union(v.literal('empty_response'), v.literal('provider_error'), v.literal('provider_other'))),
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
  v.object({ type: v.literal('reserve_model'), id: v.string(), maxCostMicros: v.number() }),
  v.object({ type: v.literal('bind_model_dispatch'), id: v.string(), modelId: v.string(), billingReservationId: v.union(v.string(), v.null()) }),
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
  v.object({
    type: v.literal('record_verification'),
    verification: v.object({
      attemptId: v.string(),
      candidateDigest: v.string(),
      planRevision: v.number(),
      evidenceRevision: v.number(),
      supported: v.boolean(),
      reason: v.string(),
      evidenceIds: v.array(v.string()),
      attempts: v.number(),
      createdAt: v.number(),
    }),
  }),
  v.object({
    type: v.literal('set_compaction'),
    compaction: v.object({
      cycleId: v.string(),
      attemptId: v.string(),
      status: v.union(v.literal('started'), v.literal('completed'), v.literal('interrupted'), v.literal('awaiting_reconciliation')),
      retryCount: v.number(),
      failureReason: v.optional(v.union(
        v.literal('stream_aborted'), v.literal('validation_failed'), v.literal('provider_error'),
        v.literal('unknown'), v.literal('hold_unsettled'),
      )),
      updatedAt: v.number(),
    }),
  }),
  v.object({ type: v.literal('record_receipt'), receipt: receiptValidator }),
  v.object({
    type: v.literal('checkpoint'),
    summary: v.string(),
    purpose: v.optional(v.union(v.literal('continuation'), v.literal('compaction'))),
    unverifiedNarrative: v.optional(v.string()),
  }),
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
  v.object({
    type: v.literal('admit_named_child'),
    child: childValidator,
    step: v.object({ title: v.string(), acceptanceCriteria: v.array(v.string()) }),
    goal: v.string(),
    constraints: v.array(v.string()),
    target: v.object({ deliveryAgentRunId: v.string(), conversationId: v.string() }),
  }),
  v.object({ type: v.literal('settle_child'), childRunId: v.string() }),
  v.object({ type: v.literal('finish'), resultSummary: v.optional(v.string()) }),
  v.object({
    type: v.literal('terminate'),
    status: v.union(v.literal('cancelled'), v.literal('failed')),
    reason: v.string(),
  }),
)

type HarnessMetadata = Omit<HarnessSnapshot, 'plan' | 'evidence' | 'children'>
type ReadContext = Pick<QueryCtx, 'db'>
type RunRow = Doc<'harnessRuns'>
type WaitRow = Doc<'harnessWaits'>
type ResourceRow = Doc<'harnessResourceRequests'>

function isHarnessDeliveryRun(
  run: Pick<RunRow, 'runId' | 'rootRunId' | 'parentRunId' | 'deliveryAgentRunId'>,
  delivery: Doc<'conversationAgentRuns'>,
) {
  if (run.deliveryAgentRunId !== delivery._id) return false
  const isRoot = run.parentRunId === undefined && run.rootRunId === run.runId
  if (delivery.mode !== 'room') return isRoot
  return delivery.executionEngine === 'overlay_harness'
    && run.runId === `workspace:${delivery._id}`
    && (run.parentRunId === undefined ? isRoot : run.rootRunId !== run.runId)
}

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
    ...(snapshot.policyRevision === undefined ? {} : { policyRevision: snapshot.policyRevision }),
    ...(snapshot.resourceRequestToken === undefined ? {} : { resourceRequestToken: snapshot.resourceRequestToken }),
    progressRevision: snapshot.progressRevision,
    planRevision: snapshot.planRevision,
    ...(snapshot.blocker === undefined ? {} : { blocker: snapshot.blocker }),
    ...(snapshot.terminalReason === undefined ? {} : { terminalReason: snapshot.terminalReason }),
    workingSummary: snapshot.workingSummary,
    ...(snapshot.resultSummary === undefined ? {} : { resultSummary: snapshot.resultSummary }),
    continuations: snapshot.continuations,
    lastContinuationProgressRevision: snapshot.lastContinuationProgressRevision,
    stalledContinuations: snapshot.stalledContinuations,
    ...(snapshot.latestReceipt === undefined ? {} : { latestReceipt: snapshot.latestReceipt }),
    ...(snapshot.routeInterruptionCount === undefined ? {} : { routeInterruptionCount: snapshot.routeInterruptionCount }),
    ...(snapshot.modelRecovery === undefined ? {} : { modelRecovery: snapshot.modelRecovery }),
    ...(snapshot.summaryRecovery === undefined ? {} : { summaryRecovery: snapshot.summaryRecovery }),
    ...(snapshot.unverifiedNarrative === undefined ? {} : { unverifiedNarrative: snapshot.unverifiedNarrative }),
    ...(snapshot.finalVerification === undefined ? {} : { finalVerification: snapshot.finalVerification }),
    ...(snapshot.compaction === undefined ? {} : { compaction: snapshot.compaction }),
    ...(snapshot.modelReservation === undefined ? {} : { modelReservation: snapshot.modelReservation }),
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
  if (input.deliveryAgentRunId !== undefined
    && (!input.deliveryAgentRunId.trim() || input.deliveryAgentRunId.length > MAX_ID_LENGTH)) {
    throw new Error('Invalid harness delivery run id.')
  }
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
  if (input.resourcePauseAuthority !== undefined && input.policy.resourcePauseVersion !== 1) {
    throw new Error('Resource-pause admission authority requires version 1.')
  }
  if (input.policy.resourcePauseVersion === 1 && (
    input.resourcePauseAuthority !== 'personal_chat_work'
    || input.policy.workspaceId === undefined
    || input.policy.maxDepth !== 0
    || input.policy.maxParallelChildren !== 0
    || input.policy.maxCostMicros > MAX_HARNESS_RESOURCE_SPEND_MICROS
    || !input.deliveryAgentRunId
    || !('conversationId' in input.source)
  )) {
    throw new Error('Resource-pause admission is limited to an owned personal chat/work root.')
  }
}

async function requireActivePersonalWorkspaceMembership(
  ctx: MutationCtx,
  actorUserId: string,
  workspaceId: string,
): Promise<Doc<'workspaces'>> {
  const [preference, workspace] = await Promise.all([
    ctx.db.query('workspaceUserPreferences')
      .withIndex('by_userId', q => q.eq('userId', actorUserId))
      .unique(),
    ctx.db.query('workspaces')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId))
      .unique(),
  ])
  if (!preference || preference.activeWorkspaceId !== workspaceId
    || !workspace || workspace.kind !== 'personal' || workspace.status !== 'active'
    || workspace.personalOwnerUserId !== actorUserId) {
    throw new Error('HARNESS_RESOURCE_WORKSPACE_DENIED')
  }
  const principals = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', actorUserId))
    .take(2)
  if (principals.length !== 1 || principals[0]!.type !== 'human' || principals[0]!.archivedAt !== undefined) {
    throw new Error('HARNESS_RESOURCE_MEMBERSHIP_DENIED')
  }
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => (
      q.eq('workspaceId', workspaceId).eq('principalId', principals[0]!.principalId)
    ))
    .unique()
  if (membership?.status !== 'active' || membership.role !== 'owner') {
    throw new Error('HARNESS_RESOURCE_MEMBERSHIP_DENIED')
  }
  return workspace
}

function hasUnsupportedResourceConversationSurface(conversation: Doc<'conversations'>): boolean {
  return Boolean(conversation.isAutomation || conversation.externalPlatform !== undefined
    || conversation.externalChannelId !== undefined || conversation.externalThreadId !== undefined
    || conversation.surfaceBindingId !== undefined)
}

async function assertResourcePauseAdmissionContext(ctx: MutationCtx, admission: HarnessAdmission): Promise<void> {
  if (admission.policy.resourcePauseVersion !== 1) return
  if (!('conversationId' in admission.source) || !admission.policy.workspaceId
    || admission.resourcePauseAuthority !== 'personal_chat_work') {
    throw new Error('HARNESS_RESOURCE_ADMISSION_DENIED')
  }
  await requireActivePersonalWorkspaceMembership(ctx, admission.policy.actorUserId, admission.policy.workspaceId)
  const conversationId = ctx.db.normalizeId('conversations', (admission.source as Extract<HarnessSource, { conversationId: string }>).conversationId)
  const conversation = conversationId ? await ctx.db.get(conversationId) : null
  if (!conversation || conversation.deletedAt || conversation.userId !== admission.policy.actorUserId
    || hasUnsupportedResourceConversationSurface(conversation)
    || (conversation.conversationType ?? 'personal') !== 'personal'
    || conversation.workspaceId !== admission.policy.workspaceId) {
    throw new Error('HARNESS_RESOURCE_ADMISSION_DENIED')
  }
}

async function validatePersonalDeliveryAdmission(
  ctx: ReadContext,
  admission: HarnessAdmission,
  source: HarnessSource,
): Promise<Doc<'conversationAgentRuns'>> {
  if (!('conversationId' in source) || typeof source.conversationId !== 'string') {
    throw new Error('HARNESS_DELIVERY_SOURCE_DENIED')
  }
  const conversationId = ctx.db.normalizeId('conversations', (source as Extract<HarnessSource, { conversationId: string }>).conversationId)
  const conversation = conversationId ? await ctx.db.get(conversationId) : null
  if (!conversation || conversation.deletedAt || conversation.workspaceId !== admission.policy.workspaceId
    || (conversation.conversationType ?? 'personal') !== 'personal'
    || conversation.userId !== admission.policy.actorUserId) {
    throw new Error('HARNESS_DELIVERY_SOURCE_DENIED')
  }
  const deliveryId = ctx.db.normalizeId('conversationAgentRuns', admission.deliveryAgentRunId!)
  const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
  if (!delivery || delivery.conversationId !== conversationId
    || delivery.userId !== admission.policy.actorUserId
    || delivery.runner !== 'workflow' || delivery.executionEngine !== 'overlay_harness' || delivery.mode === 'room'
    || delivery.status !== 'queued' || delivery.startedAt !== undefined
    || delivery.workflowRunId !== undefined || delivery.harnessRunId !== undefined
    || delivery.completedAt !== undefined || delivery.failedAt !== undefined || delivery.cancelledAt !== undefined) {
    throw new Error('HARNESS_DELIVERY_TARGET_DENIED')
  }
  if (admission.policy.resourcePauseVersion === 1 && delivery.mode !== 'chat' && delivery.mode !== 'work') {
    throw new Error('HARNESS_RESOURCE_DELIVERY_DENIED')
  }
  return delivery
}

async function bindLegacyPersonalSource(ctx: MutationCtx, admission: HarnessAdmission): Promise<void> {
  if (!admission.deliveryAgentRunId || !admission.policy.workspaceId
    || !('conversationId' in admission.source) || typeof admission.source.conversationId !== 'string') return
  const conversationId = ctx.db.normalizeId('conversations', admission.source.conversationId)
  const conversation = conversationId ? await ctx.db.get(conversationId) : null
  if (!conversation || conversation.workspaceId !== undefined) return
  await validatePersonalDeliveryAdmission(ctx, {
    ...admission, policy: { ...admission.policy, workspaceId: undefined },
  }, admission.source)
  const workspace = await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', q => q.eq('workspaceId', admission.policy.workspaceId!)).unique()
  if (!workspace || workspace.status !== 'active' || workspace.kind !== 'personal'
    || workspace.personalOwnerUserId !== admission.policy.actorUserId) {
    throw new Error('HARNESS_DELIVERY_SOURCE_DENIED')
  }
  // Materialize only the owner's implicit personal scope, in the same transaction
  // as admission. Never move legacy chats into a selected organization workspace.
  await ctx.db.patch(conversation._id, { workspaceId: workspace.workspaceId })
}

async function validateHarnessDeliveryAdmission(
  ctx: ReadContext,
  admission: HarnessAdmission,
  source: HarnessSource,
  serverSecret: string,
): Promise<Doc<'conversationAgentRuns'>> {
  const deliveryId = ctx.db.normalizeId('conversationAgentRuns', admission.deliveryAgentRunId!)
  const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
  return delivery?.mode === 'room'
    ? validateNativeHarnessDelivery(ctx, admission, source, delivery, serverSecret)
    : validatePersonalDeliveryAdmission(ctx, admission, source)
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
        if (step.evidenceTools !== undefined && (
          step.evidenceTools.length > 8
          || step.evidenceTools.some(id => !id.trim() || id.length > MAX_ID_LENGTH)
        )) {
          throw new Error(`Milestone "${step.id}" evidenceTools exceed their bounds.`)
        }
        if (step.answerOnly && (step.requiresVerification
          || ('childRunId' in step && step.childRunId !== undefined))) {
          throw new Error('Answer-only milestones cannot require verification or delegate work.')
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
        || (operation.evidence.inputDigest !== undefined && !/^[a-f0-9]{64}$/.test(operation.evidence.inputDigest))
        || !Number.isFinite(operation.evidence.createdAt) || operation.evidence.createdAt < 0
        || (operation.evidence.verification !== undefined
          && (!operation.evidence.verification.stepId.trim()
            || operation.evidence.verification.stepId.length > MAX_ID_LENGTH
            || !Number.isSafeInteger(operation.evidence.verification.planRevision)
            || operation.evidence.verification.planRevision < 0))) {
        throw new Error('Harness evidence exceeds its bounds.')
      }
      if (operation.evidence.resource && (
        !operation.evidence.resource.id.trim()
        || operation.evidence.resource.id.length > MAX_EVIDENCE_ID_LENGTH
        || (operation.evidence.resource.revision !== undefined && operation.evidence.resource.revision.length > 256)
        || (operation.evidence.resource.operation !== undefined && operation.evidence.resource.operation.length > 256)
        || (operation.evidence.resource.page !== undefined
          && (!Number.isSafeInteger(operation.evidence.resource.page) || operation.evidence.resource.page < 1))
      )) throw new Error('Harness evidence resource identity exceeds its bounds.')
      break
    case 'record_verification':
      if (!operation.verification.attemptId.trim() || operation.verification.attemptId.length > 256
        || !operation.verification.candidateDigest.trim() || operation.verification.candidateDigest.length > 128
        || !Number.isSafeInteger(operation.verification.planRevision) || operation.verification.planRevision < 0
        || !Number.isSafeInteger(operation.verification.evidenceRevision) || operation.verification.evidenceRevision < 0
        || operation.verification.reason.length > 1_000
        || operation.verification.evidenceIds.length > 48
        || operation.verification.evidenceIds.some(id => !id.trim() || id.length > MAX_EVIDENCE_ID_LENGTH)
        || !Number.isSafeInteger(operation.verification.attempts)
        || operation.verification.attempts < 1 || operation.verification.attempts > 3
        || !Number.isFinite(operation.verification.createdAt) || operation.verification.createdAt < 0) {
        throw new Error('Harness answer verification exceeds its bounds.')
      }
      break
    case 'set_compaction':
      if (!operation.compaction.cycleId.trim() || operation.compaction.cycleId.length > MAX_ID_LENGTH
        || !operation.compaction.attemptId.trim() || operation.compaction.attemptId.length > MAX_ID_LENGTH
        || !Number.isSafeInteger(operation.compaction.retryCount)
        || operation.compaction.retryCount < 0 || operation.compaction.retryCount > 1
        || !Number.isFinite(operation.compaction.updatedAt)
        || (operation.compaction.failureReason !== undefined && operation.compaction.failureReason.length > 64)) {
        throw new Error('Harness compaction state exceeds its bounds.')
      }
      break
    case 'record_receipt':
      if (!operation.receipt.id.trim() || operation.receipt.id.length > MAX_ID_LENGTH
        || !operation.receipt.modelId.trim() || operation.receipt.modelId.length > MAX_ID_LENGTH
        || !operation.receipt.provider.trim() || operation.receipt.provider.length > MAX_ID_LENGTH) {
        throw new Error('Harness receipt exceeds its bounds.')
      }
      break
    case 'reserve_model':
    case 'bind_model_dispatch':
      if (!operation.id.trim() || operation.id.length > MAX_ID_LENGTH) throw new Error('Invalid model reservation identity.')
      break
    case 'checkpoint':
      if (operation.summary.length > MAX_WORKING_SUMMARY_LENGTH
        || operation.unverifiedNarrative !== undefined && operation.unverifiedNarrative.length > MAX_WORKING_SUMMARY_LENGTH) {
        throw new Error('Harness working summary exceeds 8,000 characters.')
      }
      break
    case 'finish':
      if (operation.resultSummary !== undefined && operation.resultSummary.length > MAX_WORKING_SUMMARY_LENGTH) throw new Error('Harness result summary exceeds 8,000 characters.')
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
    case 'admit_named_child':
      if (!operation.child.id.trim() || operation.child.id.length > MAX_ID_LENGTH
        || !operation.child.stepId.trim() || operation.child.stepId.length > MAX_ID_LENGTH
        || operation.child.allowedToolIds.length > MAX_TOOL_IDS
        || operation.child.allowedToolIds.some(id => !id.trim() || id.length > MAX_TOOL_ID_LENGTH)
        || operation.child.evidenceRefs.length > MAX_EVIDENCE_REFS
        || operation.child.evidenceRefs.some(id => !id.trim() || id.length > MAX_EVIDENCE_ID_LENGTH)
        || operation.child.summary !== undefined
        || !operation.step.title.trim() || operation.step.title.length > MAX_EVIDENCE_SUMMARY_LENGTH
        || !operation.step.acceptanceCriteria.length || operation.step.acceptanceCriteria.length > MAX_ACCEPTANCE_CRITERIA
        || operation.step.acceptanceCriteria.some(item => !item.trim() || item.length > MAX_EVIDENCE_SUMMARY_LENGTH)
        || !operation.target.deliveryAgentRunId.trim() || operation.target.deliveryAgentRunId.length > MAX_ID_LENGTH
        || !operation.target.conversationId.trim() || operation.target.conversationId.length > MAX_ID_LENGTH
        || !operation.goal.trim() || operation.goal.length > MAX_GOAL_LENGTH
        || operation.constraints.length > MAX_CONSTRAINTS
        || operation.constraints.some(item => !item.trim() || item.length > MAX_CONSTRAINT_LENGTH)) {
        throw new Error('Harness named child admission exceeds its bounds.')
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

function assertCancellationLineageEntry(
  run: RunRow,
  metadata: HarnessMetadata,
  root: RunRow,
  rootMetadata: HarnessMetadata,
  source: HarnessSource,
  actorUserId: string,
) {
  const runSource = parseJson<HarnessSource>(run.sourceJson)
  const sourceMismatch = stableJson(runSource) !== stableJson(source)
  if (run.rootRunId !== root.runId || run.actorUserId !== actorUserId
    || metadata.runId !== run.runId || metadata.rootRunId !== root.runId
    || metadata.parentRunId !== run.parentRunId || metadata.policy.actorUserId !== actorUserId
    || metadata.policy.workspaceId !== rootMetadata.policy.workspaceId
    || metadata.depth > MAX_HARNESS_DEPTH
    || (sourceMismatch && (run.parentRunId === undefined || run.deliveryAgentRunId === undefined))) {
    throw new Error('Invalid harness cancellation lineage.')
  }
}

async function validateCancellationLineage(
  ctx: ReadContext,
  run: RunRow,
  root: RunRow,
  source: HarnessSource,
  rootMetadata: HarnessMetadata,
  actorUserId: string,
): Promise<{ metadata: HarnessMetadata; lineageRunIds: string[] }> {
  const entries: LineageEntry[] = []
  const seen = new Set<string>()
  let current: RunRow | null = run
  while (current) {
    if (entries.length >= MAX_HARNESS_DEPTH + 1 || seen.has(current.runId)) {
      throw new Error('Invalid harness cancellation lineage.')
    }
    seen.add(current.runId)
    const metadata = parseJson<HarnessMetadata>(current.metadataJson)
    if (current.deliveryAgentRunId) {
      const deliveryId = ctx.db.normalizeId('conversationAgentRuns', current.deliveryAgentRunId)
      const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
      const namedSource = parseJson<HarnessSource>(current.sourceJson)
      const conversationId = namedSource && 'conversationId' in namedSource && typeof namedSource.conversationId === 'string'
        ? ctx.db.normalizeId('conversations', namedSource.conversationId) : null
      const conversation = conversationId ? await ctx.db.get(conversationId) : null
      if (!delivery || delivery.harnessRunId !== current.runId
        || !isHarnessDeliveryRun(current, delivery)
        || delivery.conversationId !== conversationId || delivery.userId !== actorUserId
        || delivery.runner !== 'workflow'
        || !isHarnessDeliveryConversation(conversation, delivery, current.runId)) {
        throw new Error('Invalid harness delivery cancellation binding.')
      }
    }
    checkedActiveCount(current.activeDescendantCount)
    entries.push({ run: current, metadata })
    if (current.runId === root.runId) break
    if (current.parentRunId === undefined) throw new Error('Invalid harness cancellation lineage.')
    current = await findRun(ctx, current.parentRunId)
    if (!current) throw new Error('Invalid harness cancellation lineage.')
  }
  const lineageRoot = entries.at(-1)
  if (!lineageRoot || lineageRoot.run._id !== root._id
    || lineageRoot.run.parentRunId !== undefined || lineageRoot.metadata.parentRunId !== undefined
    || lineageRoot.metadata.depth !== 0) {
    throw new Error('Invalid harness cancellation lineage.')
  }
  for (let index = 0; index < entries.length - 1; index++) {
    const child = entries[index]
    const parent = entries[index + 1]
    if (child.run.parentRunId !== parent.run.runId
      || child.metadata.parentRunId !== parent.run.runId
      || child.metadata.depth !== parent.metadata.depth + 1) {
      throw new Error('Invalid harness cancellation lineage.')
    }
  }
  let inheritedSource = source
  for (const entry of entries.slice().reverse()) {
    assertCancellationLineageEntry(entry.run, entry.metadata, root, rootMetadata, inheritedSource, actorUserId)
    inheritedSource = parseJson<HarnessSource>(entry.run.sourceJson)
  }
  return { metadata: entries[0]!.metadata, lineageRunIds: entries.map(entry => entry.run.runId) }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const keys = Reflect.ownKeys(record)
  return keys.length === expected.length
    && keys.every(key => typeof key === 'string' && expected.includes(key))
}

function assertWaitJsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || !isPlainRecordOrArray(value)) {
    throw new Error('Harness wait request input must be JSON serializable.')
  }
  if (ancestors.has(value)) throw new Error('Harness wait request input must not be cyclic.')
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (const entry of value) assertWaitJsonValue(entry, ancestors)
  } else {
    for (const entry of Object.values(value)) assertWaitJsonValue(entry, ancestors)
  }
  ancestors.delete(value)
}

function isPlainRecordOrArray(value: object): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isPlainRecord(value)
}

function assertWaitText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID_LENGTH) {
    throw new Error(`Invalid harness wait ${field}.`)
  }
}

function canonicalWaitRequest(value: unknown): { request: HarnessWaitRequest; requestJson: string } {
  if (!isPlainRecord(value)) throw new Error('Invalid harness wait request shape.')
  let request: HarnessWaitRequest
  if (value.kind === 'input') {
    if (!hasExactKeys(value, ['kind', 'token'])) throw new Error('Invalid harness input wait request shape.')
    assertWaitText(value.token, 'token')
    request = { kind: 'input', token: value.token }
  } else if (value.kind === 'approval') {
    if (!hasExactKeys(value, ['kind', 'token', 'requests'])) {
      throw new Error('Invalid harness approval wait request shape.')
    }
    assertWaitText(value.token, 'token')
    if (!Array.isArray(value.requests) || value.requests.length < 1 || value.requests.length > MAX_WAIT_REQUESTS) {
      throw new Error('Harness approval waits must contain between 1 and 128 requests.')
    }
    const requests: Array<{ approvalId: string; toolCallId: string; toolName: string; input: unknown }> = []
    const approvalIds = new Set<string>()
    const toolCallIds = new Set<string>()
    for (const entry of value.requests) {
      if (!isPlainRecord(entry) || !hasExactKeys(entry, ['approvalId', 'toolCallId', 'toolName', 'input'])
        || !Object.prototype.hasOwnProperty.call(entry, 'input')) {
        throw new Error('Invalid harness approval request shape.')
      }
      assertWaitText(entry.approvalId, 'approval id')
      assertWaitText(entry.toolCallId, 'approval tool call id')
      assertWaitText(entry.toolName, 'approval tool name')
      if (approvalIds.has(entry.approvalId) || toolCallIds.has(entry.toolCallId)) {
        throw new Error('Harness approval waits must not contain duplicate approval or tool-call ids.')
      }
      approvalIds.add(entry.approvalId)
      toolCallIds.add(entry.toolCallId)
      assertWaitJsonValue(entry.input)
      requests.push({
        approvalId: entry.approvalId,
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
        input: entry.input,
      })
    }
    request = { kind: 'approval', token: value.token, requests }
  } else {
    throw new Error('Invalid harness wait request kind.')
  }

  const requestJson = stableJson(request)
  if (new TextEncoder().encode(requestJson).byteLength > MAX_OPERATION_JSON_BYTES) {
    throw new Error('Harness wait request exceeds the 256 KiB encoded limit.')
  }
  return { request: parseJson<HarnessWaitRequest>(requestJson), requestJson }
}

function waitFromRow(row: WaitRow): HarnessWait {
  const { request } = canonicalWaitRequest(parseJson<unknown>(row.requestJson))
  if (request.kind !== row.kind || request.token !== row.token) {
    throw new Error('Invalid stored harness wait authority.')
  }
  return {
    ...request,
    runId: row.runId,
    rootRunId: row.rootRunId,
    workflowRunId: row.workflowRunId,
    question: row.question,
    createdAt: row.createdAt,
    ...(row.resolvedAt === undefined ? {} : { resolvedAt: row.resolvedAt }),
  }
}

function assertWaitReference(reference: HarnessWaitReference): void {
  if (!reference.actorUserId.trim()
    || !reference.runId.trim() || reference.runId.length > MAX_ID_LENGTH
    || !reference.workflowRunId.trim() || reference.workflowRunId.length > MAX_ID_LENGTH) {
    throw new Error('Invalid harness wait identity.')
  }
}

async function loadWaitAuthority(
  ctx: ReadContext,
  reference: HarnessWaitReference,
  serverSecret: string,
): Promise<{ run: RunRow; lineage: LineageEntry[]; metadata: HarnessMetadata }> {
  assertWaitReference(reference)
  const run = await findRun(ctx, reference.runId)
  if (!run) throw new Error('HARNESS_RUN_NOT_FOUND')
  const lineage = await loadLineage(ctx, run, reference.actorUserId, serverSecret)
  const metadata = lineage[0]!.metadata
  if (metadata.workflowRunId !== reference.workflowRunId) throw new Error('HARNESS_WORKFLOW_ACCESS_DENIED')
  return { run, lineage, metadata }
}

function assertActiveWaitLineage(lineage: LineageEntry[]): void {
  if (lineage.some(entry => isTerminalStatus(entry.metadata.status))) {
    throw new Error('The harness run or an ancestor is terminal.')
  }
}

export async function requireHarnessPublicationAuthority(
  ctx: ReadContext,
  reference: HarnessWaitReference,
  serverSecret: string,
) {
  requireHarnessServerSecret(serverSecret)
  const { run, lineage, metadata } = await loadWaitAuthority(ctx, reference, serverSecret)
  assertActiveWaitLineage(lineage)
  if (metadata.status !== 'running' || !metadata.policy.workspaceId
    || !metadata.policy.allowedToolIds.includes('computer_publish_file')
    || !metadata.policy.allowedToolIds.includes('write_file')
    || lineage.some(entry => entry.metadata.policy.deadlineAt <= Date.now())) {
    throw new Error('HARNESS_PUBLICATION_NOT_AUTHORIZED')
  }
  return { rootRunId: run.rootRunId, workspaceId: metadata.policy.workspaceId,
    deadlineAt: Math.min(...lineage.map(entry => entry.metadata.policy.deadlineAt)) }
}

function waitBlockerQuestion(metadata: HarnessMetadata, kind: HarnessWaitRequest['kind']): string {
  const expectedStatus = kind === 'input' ? 'waiting_for_input' : 'waiting_for_approval'
  const blocker = metadata.blocker
  const matches = blocker?.kind === kind || (kind === 'input' && blocker?.kind === 'stuck')
  if (metadata.status !== expectedStatus || !blocker || !matches) {
    throw new Error('HARNESS_WAIT_KIND_MISMATCH')
  }
  const question = blocker.question
  if (!question.trim() || question.length > MAX_EVIDENCE_SUMMARY_LENGTH) {
    throw new Error('Invalid stored harness wait question.')
  }
  return question
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
  if (isTerminalStatus(snapshot.status)) {
    const expiresAt = snapshot.updatedAt + 30 * 24 * 60 * 60_000
    const artifacts = await ctx.db.query('harnessContextArtifacts')
      .withIndex('by_runId_createdAt', q => q.eq('runId', run.runId))
      .take(1_025)
    if (artifacts.length > 1_024) throw new Error('Harness artifact count exceeds cleanup bounds.')
    await Promise.all(artifacts.filter(artifact => artifact.expiresAt !== expiresAt)
      .map(artifact => ctx.db.patch(artifact._id, { expiresAt })))
  }
}

export async function failUnclaimedNativeHarnessInTransaction(ctx: MutationCtx, input: {
  runId: string
  actorUserId: string
  deliveryAgentRunId: string
  reason: string
}): Promise<boolean> {
  const run = await findRun(ctx, input.runId)
  if (!run) return true
  if (run.actorUserId !== input.actorUserId || run.deliveryAgentRunId !== input.deliveryAgentRunId
    || run.rootRunId !== run.runId || run.activeDescendantCount !== 0) return false
  const snapshot = await hydrateSnapshot(ctx, run)
  if (snapshot.workflowRunId || snapshot.modelReservation || isTerminalStatus(snapshot.status)) return false
  await persistMetadata(ctx, run, terminateHarness(snapshot, 'failed', input.reason, Date.now()))
  return true
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

function childAdmission(
  parent: HarnessSnapshot,
  operation: Extract<HarnessOperation, { type: 'admit_child' | 'admit_named_child' }>,
) {
  const constraints = [...parent.constraints, ...operation.constraints]
  if (constraints.length > MAX_CONSTRAINTS) throw new Error('Child constraints exceed the 32-entry limit.')
  const policy: HarnessPolicy = {
    actorUserId: parent.policy.actorUserId,
    ...(parent.policy.workspaceId ? { workspaceId: parent.policy.workspaceId } : {}),
    allowedToolIds: [...new Set(operation.child.allowedToolIds)].sort(),
    requiresPlan: parent.policy.requiresPlan && harnessToolsRequirePlan(operation.child.allowedToolIds),
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
    if (isTerminalStatus(entry.metadata.status)) break
    const nextCount = checkedActiveCount(entry.run.activeDescendantCount - subtreeSize)
    await ctx.db.patch(entry.run._id, { activeDescendantCount: nextCount })
  }
  await ctx.db.patch(run._id, { activeDescendantCount: 0 })
}

export async function cancelHarnessDelivery(
  ctx: MutationCtx,
  delivery: Doc<'conversationAgentRuns'>,
  now: number,
  serverSecret: string,
): Promise<{ agentRunId: string; runId: string }> {
  if (!delivery.harnessRunId) throw new Error('HARNESS_DELIVERY_BINDING_MISSING')
  const run = await findRun(ctx, delivery.harnessRunId)
  const source = run ? parseJson<HarnessSource>(run.sourceJson) : null
  const conversation = await ctx.db.get(delivery.conversationId)
  if (!run || !isHarnessDeliveryRun(run, delivery)
    || run.actorUserId !== delivery.userId || delivery.runner !== 'workflow'
    || !source || !('conversationId' in source) || source.conversationId !== delivery.conversationId
    || !isHarnessDeliveryConversation(conversation, delivery, run.runId)) {
    throw new Error('HARNESS_DELIVERY_BINDING_INVALID')
  }
  const lineage = run.parentRunId === undefined
    ? [{ run, metadata: parseJson<HarnessMetadata>(run.metadataJson) }]
    : await loadLineage(ctx, run, delivery.userId, serverSecret)
  const metadata = lineage[0]!.metadata
  if (metadata.runId !== run.runId || metadata.rootRunId !== run.rootRunId
    || metadata.parentRunId !== run.parentRunId || metadata.policy.actorUserId !== delivery.userId
    || metadata.policy.workspaceId !== conversation?.workspaceId) {
    throw new Error('HARNESS_DELIVERY_BINDING_INVALID')
  }
  if (isTerminalStatus(metadata.status)) {
    return { agentRunId: delivery._id, runId: run.runId }
  }
  const snapshot = await hydrateSnapshot(ctx, run)
  const cancellationState = await recordFreeModelTerminalReceipt(ctx, run.runId, snapshot, now)
  const cancelled = terminateHarness(cancellationState, 'cancelled', 'The delivery was cancelled by the user.', now)
  await persistMetadata(ctx, run, cancelled)
  await persistChildren(ctx, run.runId, snapshot.children, cancelled.children)
  await releaseTerminalSubtree(ctx, run, lineage)
  return { agentRunId: delivery._id, runId: run.runId }
}

function freeModelTerminalReceipt(state: HarnessSnapshot): HarnessReceipt | undefined {
  const reservation = state.modelReservation
  const dispatch = reservation?.dispatch
  if (!reservation || reservation.maxCostMicros !== 0
    || !dispatch || dispatch.billingReservationId !== null
    || (dispatch.modelId !== OPENROUTER_FREE_MODEL_ID && dispatch.modelId !== OVERLAY_FREE_MODEL_ID)) {
    return undefined
  }
  return {
    id: reservation.id,
    modelId: dispatch.modelId,
    provider: 'overlay-free-router',
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextWindow: null,
    costMicros: 0,
    costSource: 'catalog',
    ...(reservation.id.startsWith('summary:') ? { rejectionReason: 'summary_failed' as const } : {}),
  }
}

async function recordFreeModelTerminalReceipt(
  ctx: MutationCtx,
  runId: string,
  state: HarnessSnapshot,
  now: number,
): Promise<HarnessSnapshot> {
  const receipt = freeModelTerminalReceipt(state)
  if (!receipt) return state
  const receiptJson = stableJson(receipt)
  const existingReceipt = await ctx.db.query('harnessReceipts')
    .withIndex('by_runId_receiptId', query => query.eq('runId', runId).eq('receiptId', receipt.id))
    .unique()
  if (existingReceipt && existingReceipt.receiptJson !== receiptJson) {
    throw new Error('HARNESS_RECEIPT_ID_CONFLICT')
  }
  if (!existingReceipt) {
    await ctx.db.insert('harnessReceipts', {
      runId,
      receiptId: receipt.id,
      receiptJson,
      createdAt: now,
    })
  }
  return recordHarnessReceipt(state, receipt, now)
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
  childRun?: {
    admission: ReturnType<typeof childAdmission> & { source?: HarnessSource; deliveryAgentRunId?: string }
    snapshot: HarnessSnapshot
    delivery?: Doc<'conversationAgentRuns'>
  }
  evidenceToPersist?: HarnessEvidence
}> {
  switch (operation.type) {
    case 'claim_execution':
      return { snapshot: claimHarnessExecution(current, operation.workflowRunId, now) }
    case 'reserve_model':
      return { snapshot: reserveHarnessModel(current, operation.id, operation.maxCostMicros, now) }
    case 'bind_model_dispatch':
      return { snapshot: bindHarnessModelDispatch(current, operation.id, {
        modelId: operation.modelId, billingReservationId: operation.billingReservationId,
      }, now) }
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
    case 'record_verification':
      return { snapshot: recordHarnessVerification(current, operation.verification, now) }
    case 'set_compaction':
      return { snapshot: setHarnessCompaction(current, operation.compaction, now) }
    case 'record_receipt':
      if (operation.receipt.rejectionReason === 'route_interrupted'
        || operation.receipt.rejectionReason === 'route_unavailable'
        || operation.receipt.rejectionReason === 'summary_failed') {
        const reservation = current.modelReservation
        if ((operation.receipt.modelId !== OPENROUTER_FREE_MODEL_ID && operation.receipt.modelId !== OVERLAY_FREE_MODEL_ID)
          || operation.receipt.provider !== 'overlay-free-router'
          || reservation?.id !== operation.receipt.id
          || reservation.maxCostMicros !== 0
          || reservation.dispatch?.modelId !== operation.receipt.modelId
          || reservation.dispatch.billingReservationId !== null) {
          throw new Error('This rejection requires a matching zero-cost free-router dispatch without billing.')
        }
      }
      return { snapshot: recordHarnessReceipt(current, operation.receipt, now) }
    case 'checkpoint':
      return { snapshot: checkpointHarness(current, operation.summary, now, operation.purpose, operation.unverifiedNarrative) }
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
    case 'admit_named_child': {
      const admission = childAdmission(current, operation)
      if (admission.runId !== `workspace:${operation.target.deliveryAgentRunId}`) {
        throw new Error('HARNESS_DELIVERY_TARGET_DENIED')
      }
      if (await findRun(ctx, admission.runId)) throw new Error('Harness child run id already exists.')
      const deliveryId = ctx.db.normalizeId('conversationAgentRuns', operation.target.deliveryAgentRunId)
      const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
      if (!delivery) throw new Error('HARNESS_DELIVERY_TARGET_DENIED')
      const source: HarnessSource = { conversationId: operation.target.conversationId }
      await validateNativeHarnessDelivery(ctx, {
        ...admission,
        deliveryAgentRunId: delivery._id,
        source,
      }, source, delivery, serverSecret)
      const root = await findRun(ctx, run.rootRunId)
      const parentDeliveryRunId = run.deliveryAgentRunId ?? root?.deliveryAgentRunId
      const parentDeliveryId = parentDeliveryRunId
        ? ctx.db.normalizeId('conversationAgentRuns', parentDeliveryRunId) : null
      const parentDelivery = parentDeliveryId ? await ctx.db.get(parentDeliveryId) : null
      const targetConversation = await ctx.db.get(delivery.conversationId)
      const trigger = await ctx.db.get(delivery.userMessageId)
      if (!parentDelivery?.agentPrincipalId || !targetConversation || !trigger
        || targetConversation.workspaceId !== current.policy.workspaceId
        || delivery.conversationId !== targetConversation._id
        || trigger.conversationId !== targetConversation._id
        || trigger.authorPrincipalId !== parentDelivery.agentPrincipalId) {
        throw new Error('HARNESS_DELIVERY_TARGET_DENIED')
      }
      const snapshot = admitHarnessNamedChild(current, operation.child, operation.step, now)
      const childSnapshot = createHarnessSnapshot({
        runId: admission.runId,
        goal: admission.goal,
        constraints: admission.constraints,
        policy: admission.policy,
        parentRunId: admission.parentRunId,
        rootRunId: admission.rootRunId,
        depth: admission.depth,
      }, now)
      return {
        snapshot,
        childRun: {
          admission: { ...admission, source, deliveryAgentRunId: delivery._id },
          snapshot: childSnapshot,
          delivery,
        },
      }
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
        const rawSummary = childSnapshot.resultSummary?.trim() || childSnapshot.workingSummary.trim() || `Completed child run ${childSnapshot.runId}.`
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
      return { snapshot: finishHarness(current, now, operation.resultSummary) }
    case 'terminate': {
      const settled = await recordFreeModelTerminalReceipt(ctx, run.runId, current, now)
      return { snapshot: terminateHarness(settled, operation.status, operation.reason, now) }
    }
  }
}

export const admit = mutation({
  args: { ...admissionValidator.fields, serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireHarnessServerSecret(args.serverSecret)
    const { serverSecret, ...rawAdmission } = args
    const input = rawAdmission as HarnessAdmission
    assertBoundedAdmission(input)
    await assertResourcePauseAdmissionContext(ctx, input)
    await bindLegacyPersonalSource(ctx, input)
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
      if (admission.deliveryAgentRunId !== undefined) {
        const deliveryId = ctx.db.normalizeId('conversationAgentRuns', admission.deliveryAgentRunId)
        const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
        if (existing.deliveryAgentRunId !== deliveryId || delivery?.harnessRunId !== existing.runId) {
          throw new Error('HARNESS_ADMISSION_CONFLICT')
        }
      }
      const lineage = await loadLineage(ctx, existing, admission.policy.actorUserId, serverSecret)
      return await currentSnapshot(ctx, existing, lineage)
    }

    const delivery = admission.deliveryAgentRunId
      ? await validateHarnessDeliveryAdmission(ctx, admission, source, serverSecret)
      : undefined
    if (admission.policy.resourcePauseVersion === 1 && (!delivery || (delivery.mode !== 'chat' && delivery.mode !== 'work'))) {
      throw new Error('HARNESS_RESOURCE_DELIVERY_DENIED')
    }
    if ('conversationId' in source && typeof source.conversationId === 'string') {
      const conversationId = ctx.db.normalizeId('conversations', source.conversationId)
      const conversation = conversationId ? await ctx.db.get(conversationId) : null
      if (!conversation) throw new Error('HARNESS_DELIVERY_SOURCE_DENIED')
      const trigger = delivery ? await ctx.db.get(delivery.userMessageId) : null
      if (delivery && (!trigger || trigger.conversationId !== conversation._id || trigger.deletedAt)) {
        throw new Error('HARNESS_DELIVERY_TARGET_DENIED')
      }
      await assertNativeThreadWritable(
        ctx,
        conversation,
        trigger?.threadRootMessageId ?? trigger?._id,
      )
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
      ...(delivery ? { deliveryAgentRunId: delivery._id } : {}),
      activeDescendantCount: 0,
      sourceJson: stableJson(source),
      admissionJson,
      metadataJson: stableJson(metadataFromSnapshot(snapshot)),
      createdAt: now,
      updatedAt: now,
    })
    if (delivery) await ctx.db.patch(delivery._id, { harnessRunId: snapshot.runId })
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

    const terminalRun = lineage.some(entry => isTerminalStatus(entry.metadata.status))
    const terminalAncestor = lineage.slice(1).some(entry => isTerminalStatus(entry.metadata.status))
    const isLateReceipt = operation.type === 'record_receipt' && terminalRun
    const isLateToolResult = operation.type === 'record_evidence'
      && operation.evidence.kind === 'tool_result'
      && metadata.status === 'cancelled'
      && !terminalAncestor
    if (terminalRun && !isLateReceipt && !isLateToolResult) throw new Error('The harness run is terminal.')

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
    let result: Awaited<ReturnType<typeof applyReducer>>
    try {
      result = await applyReducer(ctx, run, currentState, operation, args.serverSecret, now)
    } catch (error) {
      throw new ConvexError({
        code: error instanceof HarnessPlanValidationError ? 'HARNESS_PLAN_VALIDATION' : 'HARNESS_OPERATION_REJECTED',
        message: error instanceof Error ? error.message : 'Harness operation rejected.',
      })
    }
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

    if (operation.type === 'admit_child' || operation.type === 'admit_named_child') {
      await incrementAncestorCounts(ctx, lineage)
    }
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
      const { admission, snapshot, delivery } = result.childRun
      const source = admission.source ?? parseJson<HarnessSource>(run.sourceJson)
      await ctx.db.insert('harnessRuns', {
        runId: snapshot.runId,
        actorUserId: snapshot.policy.actorUserId,
        rootRunId: snapshot.rootRunId,
        parentRunId: snapshot.parentRunId,
        ...(delivery ? { deliveryAgentRunId: delivery._id } : {}),
        activeDescendantCount: 0,
        sourceJson: stableJson(source),
        admissionJson: stableJson({
          runId: admission.runId,
          goal: admission.goal,
          constraints: admission.constraints,
          policy: admission.policy,
          source,
          rootRunId: admission.rootRunId,
          parentRunId: admission.parentRunId,
          depth: admission.depth,
          ...(delivery ? { deliveryAgentRunId: delivery._id } : {}),
        }),
        metadataJson: stableJson(metadataFromSnapshot(snapshot)),
        createdAt: now,
        updatedAt: now,
      })
      if (delivery) await ctx.db.patch(delivery._id, { harnessRunId: snapshot.runId })
    }
    if (operation.type === 'checkpoint') {
      await ctx.db.insert('harnessCheckpoints', {
        runId: run.runId,
        operationId: args.operationId,
        revision: next.revision,
        metadataJson: stableJson(metadataFromSnapshot(next)),
        planRevision: next.planRevision,
        purpose: operation.purpose ?? 'continuation',
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

export const publishWait = mutation({
  args: {
    ...waitReferenceFields,
    request: waitRequestValidator,
    serverSecret: v.string(),
  },
  handler: async (ctx, args): Promise<HarnessWait> => {
    requireHarnessServerSecret(args.serverSecret)
    const reference: HarnessWaitReference = {
      actorUserId: args.actorUserId,
      runId: args.runId,
      workflowRunId: args.workflowRunId,
    }
    const { run, lineage, metadata } = await loadWaitAuthority(ctx, reference, args.serverSecret)
    if (metadata.status === 'waiting_for_resources' || metadata.resourceRequestToken !== undefined) {
      throw new Error('HARNESS_RESOURCE_PAUSE_ACTIVE')
    }
    const { request, requestJson } = canonicalWaitRequest(args.request)
    const existing = await ctx.db.query('harnessWaits')
      .withIndex('by_token', q => q.eq('token', request.token))
      .unique()
    if (existing) {
      if (existing.runId !== run.runId
        || existing.rootRunId !== run.rootRunId
        || existing.workflowRunId !== reference.workflowRunId
        || existing.kind !== request.kind
        || existing.requestJson !== requestJson) {
        throw new Error('HARNESS_WAIT_TOKEN_CONFLICT')
      }
      return waitFromRow(existing)
    }

    assertActiveWaitLineage(lineage)
    const question = waitBlockerQuestion(metadata, request.kind)
    const pending = await ctx.db.query('harnessWaits')
      .withIndex('by_runId_resolvedAt', q => q.eq('runId', run.runId).eq('resolvedAt', undefined))
      .take(2)
    if (pending.length) throw new Error('HARNESS_WAIT_ALREADY_PENDING')

    const createdAt = Date.now()
    await ctx.db.insert('harnessWaits', {
      runId: run.runId,
      rootRunId: run.rootRunId,
      workflowRunId: reference.workflowRunId,
      token: request.token,
      kind: request.kind,
      requestJson,
      question,
      createdAt,
    })
    return {
      ...request,
      runId: run.runId,
      rootRunId: run.rootRunId,
      workflowRunId: reference.workflowRunId,
      question,
      createdAt,
    }
  },
})

export const resolveWait = mutation({
  args: {
    ...waitReferenceFields,
    token: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    requireHarnessServerSecret(args.serverSecret)
    const reference: HarnessWaitReference = {
      actorUserId: args.actorUserId,
      runId: args.runId,
      workflowRunId: args.workflowRunId,
    }
    const { run } = await loadWaitAuthority(ctx, reference, args.serverSecret)
    const current = await hydrateSnapshot(ctx, run)
    if (current.status === 'waiting_for_resources' || current.resourceRequestToken !== undefined) {
      throw new Error('HARNESS_RESOURCE_PAUSE_ACTIVE')
    }
    assertWaitText(args.token, 'token')
    const wait = await ctx.db.query('harnessWaits')
      .withIndex('by_token', q => q.eq('token', args.token))
      .unique()
    if (!wait
      || wait.runId !== run.runId
      || wait.rootRunId !== run.rootRunId
      || wait.workflowRunId !== reference.workflowRunId) {
      throw new Error('HARNESS_WAIT_NOT_FOUND')
    }
    if (wait.resolvedAt !== undefined) return
    await ctx.db.patch(wait._id, { resolvedAt: Date.now() })
  },
})

export const listPendingWaits = query({
  args: {
    ...waitReferenceFields,
    serverSecret: v.string(),
  },
  handler: async (ctx, args): Promise<HarnessWait[]> => {
    requireHarnessServerSecret(args.serverSecret)
    const reference: HarnessWaitReference = {
      actorUserId: args.actorUserId,
      runId: args.runId,
      workflowRunId: args.workflowRunId,
    }
    const { run } = await loadWaitAuthority(ctx, reference, args.serverSecret)
    const candidates = await ctx.db.query('harnessWaits')
      .withIndex('by_rootRunId_resolvedAt', q => (
        q.eq('rootRunId', run.rootRunId).eq('resolvedAt', undefined)
      ))
      .take(513)
    if (candidates.length > 512) throw new Error('HARNESS_WAIT_SCAN_LIMIT_EXCEEDED')

    const pendingRunIds = new Set<string>()
    const waits: HarnessWait[] = []
    for (const candidate of candidates) {
      if (candidate.resolvedAt !== undefined) continue
      if (candidate.rootRunId !== run.rootRunId) throw new Error('Invalid stored harness wait lineage.')
      if (pendingRunIds.has(candidate.runId)) throw new Error('Multiple pending harness waits exist for one run.')
      pendingRunIds.add(candidate.runId)
      const candidateRun = await findRun(ctx, candidate.runId)
      if (!candidateRun || candidateRun.rootRunId !== run.rootRunId) {
        throw new Error('Invalid stored harness wait lineage.')
      }
      const candidateLineage = await loadLineage(ctx, candidateRun, reference.actorUserId, args.serverSecret)
      if (candidateLineage[0]!.metadata.workflowRunId !== candidate.workflowRunId) {
        throw new Error('Invalid stored harness wait workflow owner.')
      }
      if (!candidateLineage.some(entry => entry.run.runId === run.runId)) continue
      if (candidateLineage.some(entry => isTerminalStatus(entry.metadata.status))) continue
      waits.push(waitFromRow(candidate))
    }
    return waits.sort((left, right) => left.createdAt - right.createdAt || left.token.localeCompare(right.token))
  },
})

function resourceRecord(row: ResourceRow): HarnessResourceRequestRecord {
  const request = parseJson<HarnessResourceRequest>(row.requestJson)
  const authority = parseJson<HarnessResourceRequestRecord['authority']>(row.authorityJson)
  const previousBlocker = row.previousBlockerJson
    ? parseJson<HarnessResourceRequestRecord['previousBlocker']>(row.previousBlockerJson)
    : undefined
  const receipt = row.receiptJson ? parseJson<HarnessResourceGrantReceipt>(row.receiptJson) : undefined
  return {
    request,
    previousStatus: row.previousStatus,
    ...(previousBlocker ? { previousBlocker } : {}),
    authority,
    state: row.state,
    ...(receipt ? { receipt } : {}),
    wakePending: row.wakePending,
    ...(row.consumedAt === undefined ? {} : { consumedAt: row.consumedAt }),
  }
}

function resourceDeliveryProjection(record: HarnessResourceRequestRecord, awaitingReceipt: boolean) {
  return {
    request: record.request,
    ...(record.receipt ? { receipt: record.receipt } : {}),
    awaitingReceipt,
  }
}

async function projectResourceRequest(
  ctx: MutationCtx,
  delivery: Doc<'conversationAgentRuns'>,
  record: HarnessResourceRequestRecord,
  awaitingReceipt: boolean,
  now: number,
): Promise<void> {
  const projection = resourceDeliveryProjection(record, awaitingReceipt)
  if (stableJson(delivery.resourceRequest) === stableJson(projection)) return
  await ctx.db.patch(delivery._id, { resourceRequest: projection, updatedAt: now })
}

function assertResourceRequestBinding(
  record: HarnessResourceRequestRecord,
  authority: Awaited<ReturnType<typeof loadResourceMutationAuthority>>,
  actorUserId: string,
): void {
  if (record.authority.actorUserId !== actorUserId
    || record.authority.workspaceId !== authority.workspace.workspaceId
    || record.authority.billingAccountId !== authority.account.billingAccountId
    || record.authority.conversationId !== authority.source.conversationId
    || record.authority.deliveryAgentRunId !== authority.delivery._id
    || record.authority.admissionMarker !== 'personal_chat_work') {
    throw new Error('HARNESS_RESOURCE_AUTHORITY_CHANGED')
  }
}

function resourceGrantArgValidator() {
  return v.union(
    v.object({ kind: v.literal('model_spend'), newMaxCostMicros: v.number() }),
    v.object({ kind: v.literal('time'), durationMs: v.number() }),
  )
}

async function loadResourceMutationAuthority(
  ctx: MutationCtx,
  reference: HarnessResourceRequestReference,
  serverSecret: string,
) {
  const { run, lineage, metadata } = await loadWaitAuthority(ctx, reference, serverSecret)
  if (lineage.some(entry => isTerminalStatus(entry.metadata.status))
    || metadata.policy.resourcePauseVersion !== 1
    || metadata.policy.workspaceId === undefined) {
    throw new Error('HARNESS_RESOURCE_NOT_AUTHORIZED')
  }
  const admission = parseJson<HarnessAdmission>(run.admissionJson)
  if (admission.resourcePauseAuthority !== 'personal_chat_work'
    || admission.policy.resourcePauseVersion !== 1
    || run.parentRunId !== undefined || run.rootRunId !== run.runId
    || run.deliveryAgentRunId === undefined) {
    throw new Error('HARNESS_RESOURCE_NOT_AUTHORIZED')
  }
  const workspace = await requireActivePersonalWorkspaceMembership(ctx, reference.actorUserId, metadata.policy.workspaceId)
  const account = await uniqueWorkspaceAccount(ctx, workspace.workspaceId)
  if (!account || account.status !== 'active' || account.scope !== 'workspace'
    || account.workspaceId !== workspace.workspaceId) {
    throw new Error('HARNESS_RESOURCE_PAYER_DENIED')
  }
  const source = parseJson<HarnessSource>(run.sourceJson)
  if (!('conversationId' in source)) throw new Error('HARNESS_RESOURCE_SOURCE_DENIED')
  const conversationId = ctx.db.normalizeId('conversations', (source as { conversationId: string }).conversationId)
  const conversation = conversationId ? await ctx.db.get(conversationId) : null
  const deliveryId = ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId)
  const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
  if (!conversation || conversation.deletedAt || conversation.workspaceId !== workspace.workspaceId
    || hasUnsupportedResourceConversationSurface(conversation)
    || (conversation.conversationType ?? 'personal') !== 'personal'
    || conversation.userId !== reference.actorUserId
    || !delivery || delivery.conversationId !== conversation._id || delivery.userId !== reference.actorUserId
    || delivery.harnessRunId !== run.runId || delivery.runner !== 'workflow'
    || delivery.executionEngine !== 'overlay_harness'
    || (delivery.mode !== 'chat' && delivery.mode !== 'work')
    || delivery.workflowRunId !== reference.workflowRunId
    || delivery.status === 'completed' || delivery.status === 'failed' || delivery.status === 'cancelled'
    || delivery.completedAt !== undefined || delivery.failedAt !== undefined || delivery.cancelledAt !== undefined) {
    throw new Error('HARNESS_RESOURCE_SOURCE_DENIED')
  }
  return { run, lineage, metadata, workspace, account, source, delivery }
}

export const pauseForResources = mutation({
  args: {
    actorUserId: v.string(), runId: v.string(), workflowRunId: v.string(), expectedRevision: v.number(),
    token: v.string(), reason: v.union(v.literal('model_spend'), v.literal('time')),
    requiredCostMicros: v.number(), serverSecret: v.string(),
  },
  handler: async (ctx, args): Promise<HarnessResourceRequestRecord> => {
    requireHarnessServerSecret(args.serverSecret)
    const reference = { actorUserId: args.actorUserId, runId: args.runId, workflowRunId: args.workflowRunId, token: args.token }
    const authority = await loadResourceMutationAuthority(ctx, reference, args.serverSecret)
    const existing = await ctx.db.query('harnessResourceRequests').withIndex('by_token', q => q.eq('token', args.token)).unique()
    if (existing) {
      const old = resourceRecord(existing)
      if (existing.runId !== args.runId || existing.workflowRunId !== args.workflowRunId
        || existing.stateRevisionAtRequest !== args.expectedRevision
        || old.request.reason !== args.reason || old.request.requiredCostMicros !== args.requiredCostMicros
        || old.authority.actorUserId !== args.actorUserId) {
        throw new Error('HARNESS_RESOURCE_TOKEN_CONFLICT')
      }
      return old
    }
    if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) throw new Error('Invalid harness state revision.')
    assertSafeResourceMicros(args.requiredCostMicros, 'Required cost')
    const rootRows = await ctx.db.query('harnessRuns').withIndex('by_rootRunId', q => q.eq('rootRunId', args.runId)).take(2)
    if (rootRows.length !== 1 || rootRows[0]!.runId !== args.runId || authority.run.activeDescendantCount !== 0) {
      throw new Error('HARNESS_RESOURCE_CHILDREN_DENIED')
    }
    const snapshot = await currentSnapshot(ctx, authority.run, authority.lineage)
    if (snapshot.revision !== args.expectedRevision) throw new Error('HARNESS_STATE_CONFLICT')
    const reserved = reservedHarnessCostMicros(snapshot)
    assertSafeResourceMicros(snapshot.usage.costMicros, 'Used cost')
    assertSafeResourceMicros(reserved, 'Reserved cost')
    assertSafeResourceMicros(
      snapshot.usage.costMicros + reserved + args.requiredCostMicros,
      'Current commitments and forecast',
    )
    const now = Date.now()
    const budgetExhausted = snapshot.usage.costMicros + reserved + args.requiredCostMicros > snapshot.policy.maxCostMicros
    const timeExhausted = now >= snapshot.policy.deadlineAt
    if ((args.reason === 'time' && !timeExhausted) || (args.reason === 'model_spend' && !budgetExhausted)) {
      throw new Error('HARNESS_RESOURCE_NOT_EXHAUSTED')
    }
    const previousStatus = snapshot.status as HarnessResourceRequestRecord['previousStatus']
    const previousBlocker = snapshot.blocker?.kind === 'input'
      || snapshot.blocker?.kind === 'approval'
      || snapshot.blocker?.kind === 'stuck'
      ? { kind: snapshot.blocker.kind, question: snapshot.blocker.question } : undefined
    const request: HarnessResourceRequest = {
      token: args.token, runId: snapshot.runId, rootRunId: snapshot.rootRunId, workflowRunId: args.workflowRunId,
      policyRevision: snapshot.policyRevision ?? 0, reason: args.reason,
      currentMaxCostMicros: snapshot.policy.maxCostMicros, usedCostMicros: snapshot.usage.costMicros,
      reservedCostMicros: reserved, requiredCostMicros: args.requiredCostMicros,
      deadlineAt: snapshot.policy.deadlineAt, requestedAt: now,
    }
    const pendingRows = await ctx.db.query('harnessResourceRequests')
      .withIndex('by_runId_pending', q => q.eq('runId', args.runId).eq('state', 'pending'))
      .take(1)
    const acceptedRows = await ctx.db.query('harnessResourceRequests')
      .withIndex('by_runId_pending', q => q.eq('runId', args.runId).eq('state', 'accepted'))
      .take(1)
    if (pendingRows.length || acceptedRows.length) throw new Error('HARNESS_RESOURCE_ALREADY_PENDING')
    const next = pauseHarnessForResources(snapshot, args.token, now)
    const row = {
      runId: snapshot.runId, rootRunId: snapshot.rootRunId, workflowRunId: args.workflowRunId, token: args.token,
      policyRevision: request.policyRevision, stateRevisionAtRequest: args.expectedRevision, requestJson: stableJson(request),
      previousStatus, ...(previousBlocker ? { previousBlockerJson: stableJson(previousBlocker) } : {}),
      authorityJson: stableJson({
        actorUserId: args.actorUserId, workspaceId: authority.workspace.workspaceId,
        conversationId: authority.source.conversationId, deliveryAgentRunId: authority.delivery._id,
        billingAccountId: authority.account.billingAccountId, admissionMarker: 'personal_chat_work' as const,
      }),
      state: 'pending' as const, wakePending: false, createdAt: now, updatedAt: now,
    }
    await ctx.db.insert('harnessResourceRequests', row)
    await persistMetadata(ctx, authority.run, next)
    await ctx.db.patch(authority.delivery._id, {
      status: 'waiting_for_resources',
      resourceRequest: resourceDeliveryProjection(resourceRecord(row as ResourceRow), Boolean(snapshot.modelReservation)),
      updatedAt: now,
    })
    return resourceRecord(row as ResourceRow)
  },
})

export const getResourceRequest = query({
  args: { actorUserId: v.string(), runId: v.string(), workflowRunId: v.string(), token: v.string(), serverSecret: v.string() },
  handler: async (ctx, args): Promise<HarnessResourceRequestRecord | null> => {
    requireHarnessServerSecret(args.serverSecret)
    const { run } = await loadWaitAuthority(ctx, { actorUserId: args.actorUserId, runId: args.runId, workflowRunId: args.workflowRunId }, args.serverSecret)
    const row = await ctx.db.query('harnessResourceRequests').withIndex('by_token', q => q.eq('token', args.token)).unique()
    if (!row || row.runId !== run.runId || row.workflowRunId !== args.workflowRunId) return null
    return resourceRecord(row)
  },
})

export const grantResources = mutation({
  args: {
    actorUserId: v.string(), workspaceId: v.string(), runId: v.string(), workflowRunId: v.string(), token: v.string(),
    policyRevision: v.number(), grant: resourceGrantArgValidator(), serverSecret: v.string(),
  },
  handler: async (ctx, args): Promise<HarnessResourceGrantReceipt> => {
    requireHarnessServerSecret(args.serverSecret)
    const reference = { actorUserId: args.actorUserId, runId: args.runId, workflowRunId: args.workflowRunId, token: args.token }
    const authority = await loadResourceMutationAuthority(ctx, reference, args.serverSecret)
    if (args.workspaceId !== authority.workspace.workspaceId) throw new Error('HARNESS_RESOURCE_WORKSPACE_DENIED')
    const row = await ctx.db.query('harnessResourceRequests').withIndex('by_token', q => q.eq('token', args.token)).unique()
    if (!row || row.runId !== args.runId || row.workflowRunId !== args.workflowRunId) throw new Error('HARNESS_RESOURCE_NOT_FOUND')
    const record = resourceRecord(row)
    assertResourceRequestBinding(record, authority, args.actorUserId)
    if (record.receipt) {
      if (args.policyRevision !== record.request.policyRevision || stableJson(args.grant) !== stableJson(record.receipt.grant)) throw new Error('HARNESS_RESOURCE_GRANT_CONFLICT')
      return record.receipt
    }
    if (row.state !== 'pending' || authority.metadata.status !== 'waiting_for_resources'
      || authority.metadata.resourceRequestToken !== args.token || (authority.metadata.policyRevision ?? 0) !== args.policyRevision) {
      throw new Error('HARNESS_RESOURCE_STALE')
    }
    const snapshot = await currentSnapshot(ctx, authority.run, authority.lineage)
    const currentReservedCostMicros = reservedHarnessCostMicros(snapshot)
    assertSafeResourceMicros(snapshot.usage.costMicros, 'Current used cost')
    assertSafeResourceMicros(currentReservedCostMicros, 'Current reserved cost')
    assertSafeResourceMicros(record.request.requiredCostMicros, 'Required forecast')
    const currentCommitments = snapshot.usage.costMicros + currentReservedCostMicros + record.request.requiredCostMicros
    assertSafeResourceMicros(currentCommitments, 'Current commitments and forecast')
    if (args.grant.kind === 'model_spend' && args.grant.newMaxCostMicros < currentCommitments) {
      throw new Error('The model-spend grant must cover current commitments and the forecast.')
    }
    const receipt = calculateHarnessResourceGrantReceipt({ request: record.request, grant: args.grant as HarnessResourceGrant, grantedAt: Date.now() })
    const next = applyHarnessResourceGrant(snapshot, receipt, receipt.grantedAt)
    await ctx.db.patch(row._id, { state: 'accepted', receiptJson: stableJson(receipt), wakePending: true, updatedAt: receipt.grantedAt })
    await persistMetadata(ctx, authority.run, next)
    await ctx.db.patch(authority.delivery._id, {
      resourceRequest: resourceDeliveryProjection({ ...record, receipt }, Boolean(snapshot.modelReservation)),
      updatedAt: receipt.grantedAt,
    })
    return receipt
  },
})

export const consumeResourceGrant = mutation({
  args: { actorUserId: v.string(), runId: v.string(), workflowRunId: v.string(), token: v.string(), serverSecret: v.string() },
  handler: async (ctx, args): Promise<import('../../packages/overlay-agent-runtime/src/harness-resource').HarnessResourceConsumeResult> => {
    requireHarnessServerSecret(args.serverSecret)
    const reference = { actorUserId: args.actorUserId, runId: args.runId, workflowRunId: args.workflowRunId, token: args.token }
    const authority = await loadResourceMutationAuthority(ctx, reference, args.serverSecret)
    const row = await ctx.db.query('harnessResourceRequests').withIndex('by_token', q => q.eq('token', args.token)).unique()
    if (!row || row.runId !== args.runId || row.workflowRunId !== args.workflowRunId) return { status: 'pending' }
    const record = resourceRecord(row)
    assertResourceRequestBinding(record, authority, args.actorUserId)
    if (row.state === 'consumed') return { status: 'consumed', request: record }
    const snapshot = await currentSnapshot(ctx, authority.run, authority.lineage)
    const now = Date.now()
    if (row.state === 'pending' || !record.receipt) {
      await projectResourceRequest(ctx, authority.delivery, record, Boolean(snapshot.modelReservation), now)
      return { status: 'pending' }
    }
    await projectResourceRequest(ctx, authority.delivery, record, Boolean(snapshot.modelReservation), now)
    if (snapshot.modelReservation) return { status: 'pending', reason: 'awaiting_receipt' }
    const next = consumeHarnessResourcePause(snapshot, {
      token: args.token, previousStatus: record.previousStatus, previousBlocker: record.previousBlocker,
    }, now)
    await ctx.db.patch(row._id, { state: 'consumed', wakePending: false, consumedAt: now, updatedAt: now })
    await persistMetadata(ctx, authority.run, next)
    await ctx.db.patch(authority.delivery._id, {
      status: next.status as 'running' | 'waiting_for_input' | 'waiting_for_approval',
      resourceRequest: undefined,
      updatedAt: now,
    })
    return { status: 'consumed', request: resourceRecord({ ...row, state: 'consumed', wakePending: false, consumedAt: now }) }
  },
})

export const listDeliveryWorkflowRuns = query({
  args: {
    actorUserId: v.string(),
    agentRunId: v.string(),
    rootRunId: v.string(),
    cursor: v.union(v.string(), v.null()),
    serverSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireHarnessServerSecret(args.serverSecret)
    if (!args.actorUserId.trim() || !args.agentRunId.trim() || !args.rootRunId.trim()
      || args.actorUserId.length > MAX_ID_LENGTH || args.agentRunId.length > MAX_ID_LENGTH
      || args.rootRunId.length > MAX_ID_LENGTH) {
      throw new Error('Invalid delivery workflow query identity.')
    }
    const deliveryId = ctx.db.normalizeId('conversationAgentRuns', args.agentRunId)
    const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
    if (!delivery || delivery._id !== deliveryId || delivery.userId !== args.actorUserId
      || delivery.runner !== 'workflow'
      || delivery.status !== 'cancelled' || delivery.harnessRunId !== args.rootRunId) {
      throw new Error('HARNESS_DELIVERY_ACCESS_DENIED')
    }
    const target = await findRun(ctx, args.rootRunId)
    if (!target || !isHarnessDeliveryRun(target, delivery) || target.actorUserId !== args.actorUserId) {
      throw new Error('HARNESS_DELIVERY_ACCESS_DENIED')
    }
    const targetSource = parseJson<HarnessSource>(target.sourceJson)
    const targetConversationId = targetSource && 'conversationId' in targetSource && typeof targetSource.conversationId === 'string'
      ? ctx.db.normalizeId('conversations', targetSource.conversationId)
      : null
    const targetConversation = targetConversationId ? await ctx.db.get(targetConversationId) : null
    if (!targetSource || !('conversationId' in targetSource)
      || targetSource.conversationId !== delivery.conversationId
      || !isHarnessDeliveryConversation(targetConversation, delivery, target.runId)) {
      throw new Error('HARNESS_DELIVERY_ACCESS_DENIED')
    }
    const targetMetadata = parseJson<HarnessMetadata>(target.metadataJson)
    if (targetMetadata.runId !== target.runId || targetMetadata.rootRunId !== target.rootRunId
      || targetMetadata.parentRunId !== target.parentRunId || targetMetadata.policy.actorUserId !== args.actorUserId
      || targetMetadata.policy.workspaceId !== targetConversation?.workspaceId
      || !isTerminalStatus(targetMetadata.status)) {
      throw new Error('HARNESS_DELIVERY_ACCESS_DENIED')
    }
    const root = await findRun(ctx, target.rootRunId)
    if (!root || root.parentRunId !== undefined || root.rootRunId !== root.runId
      || root.actorUserId !== args.actorUserId || !root.deliveryAgentRunId) {
      throw new Error('HARNESS_DELIVERY_ACCESS_DENIED')
    }
    const rootDeliveryId = ctx.db.normalizeId('conversationAgentRuns', root.deliveryAgentRunId)
    const rootDelivery = rootDeliveryId ? await ctx.db.get(rootDeliveryId) : null
    const source = parseJson<HarnessSource>(root.sourceJson)
    const conversationId = source && 'conversationId' in source && typeof source.conversationId === 'string'
      ? ctx.db.normalizeId('conversations', source.conversationId)
      : null
    const conversation = conversationId ? await ctx.db.get(conversationId) : null
    if (!rootDelivery || rootDelivery.harnessRunId !== root.runId
      || !isHarnessDeliveryConversation(conversation, rootDelivery, root.runId)) {
      throw new Error('HARNESS_DELIVERY_ACCESS_DENIED')
    }
    const rootMetadata = parseJson<HarnessMetadata>(root.metadataJson)
    if (rootMetadata.runId !== root.runId || rootMetadata.rootRunId !== root.rootRunId
      || rootMetadata.parentRunId !== undefined || rootMetadata.depth !== 0
      || rootMetadata.policy.actorUserId !== args.actorUserId
      || rootMetadata.policy.workspaceId !== conversation?.workspaceId) {
      throw new Error('HARNESS_DELIVERY_ACCESS_DENIED')
    }
    if (target.runId === root.runId && !isTerminalStatus(rootMetadata.status)) {
      throw new Error('HARNESS_DELIVERY_ROOT_ACTIVE')
    }
    const rootSource = parseJson<HarnessSource>(root.sourceJson)
    const page = await ctx.db.query('harnessRuns')
      .withIndex('by_rootRunId', query => query.eq('rootRunId', target.rootRunId))
      .paginate({ cursor: args.cursor, numItems: 100 })
    const workflowRunIds: string[] = []
    for (const row of page.page) {
      const validated = await validateCancellationLineage(
        ctx, row, root, rootSource, rootMetadata, args.actorUserId,
      )
      if (!validated.lineageRunIds.includes(target.runId)) continue
      if (row.runId === target.runId || !isTerminalStatus(validated.metadata.status)) {
        if (validated.metadata.workflowRunId) workflowRunIds.push(validated.metadata.workflowRunId)
      }
    }
    return {
      workflowRunIds: [...new Set(workflowRunIds)],
      cursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireConversationAccess } from './directMessages'
import { requireServerSecret } from '../lib/auth'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { parseByoModelId } from '../../src/shared/agents/agent-model'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'

type DbContext = MutationCtx | QueryCtx
type AssignmentArgs = {
  workspaceId: string
  requesterUserId: string
  assignmentId: string
  idempotencyKey: string
  toolCallId: string
  parentConversationId: Doc<'conversations'>['_id']
  parentRunId: string
  rootRunId: string
  callerAgentId: string
  assignedAgentId: string
  brief: string
  questionTurnId: string
  revisionOfAssignmentId?: string
  expectedAttemptId?: string
}

function dispatchFingerprint(args: AssignmentArgs) {
  return JSON.stringify([args.workspaceId, args.requesterUserId, args.assignmentId, args.parentConversationId,
    args.parentRunId, args.rootRunId, args.callerAgentId, args.assignedAgentId, args.brief, args.questionTurnId,
    args.revisionOfAssignmentId ?? null, args.expectedAttemptId ?? null])
}

async function createAttempt(ctx: MutationCtx, args: AssignmentArgs, conversationId: Doc<'conversations'>['_id'], ordinal: number) {
  const attemptId = `attempt:${args.idempotencyKey}`
  await ctx.db.insert('agentAssignmentAttempts', {
    workspaceId: args.workspaceId, assignmentId: args.assignmentId, conversationId,
    attemptId, ordinal, dispatchKey: args.idempotencyKey, expectedAttemptId: args.expectedAttemptId,
    dispatchFingerprint: dispatchFingerprint(args),
    parentRunId: args.parentRunId, rootRunId: args.rootRunId, requesterUserId: args.requesterUserId,
    brief: args.brief, questionTurnId: args.questionTurnId, createdAt: Date.now(),
  })
  return attemptId
}

async function requireRequester(ctx: DbContext, args: { workspaceId: string; requesterUserId: string }) {
  const [workspace, principal] = await Promise.all([
    ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).unique(),
    ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', args.requesterUserId))
    .unique(),
  ])
  if (!workspace || workspace.status !== 'active' || workspace.archivedAt !== undefined
    || !principal || principal.type !== 'human' || principal.archivedAt !== undefined) {
    throw new Error('WORKSPACE_ACCESS_DENIED')
  }
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', args.workspaceId).eq('principalId', principal.principalId))
    .unique()
  if (!membership || membership.status !== 'active' || membership.role === 'guest') {
    throw new Error('WORKSPACE_MEMBER_REQUIRED')
  }
  return principal
}

async function requireActiveAgent(
  ctx: DbContext,
  workspaceId: string,
  agentId: string,
): Promise<{ agent: Doc<'workspaceAgentDefinitions'>; principal: Doc<'workspacePrincipals'> }> {
  const agent = await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_agentId', q => q.eq('agentId', agentId))
    .unique()
  if (!agent || agent.workspaceId !== workspaceId) throw new Error('AGENT_NOT_FOUND')
  if (agent.archivedAt !== undefined) throw new Error('AGENT_ARCHIVED')
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_principalId', q => q.eq('principalId', agent.principalId))
    .unique()
  if (!principal || principal.workspaceId !== workspaceId || principal.type !== 'agent'
    || principal.agentId !== agentId || principal.archivedAt !== undefined) {
    throw new Error('AGENT_NOT_FOUND')
  }
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('AGENT_NOT_FOUND')
  return { agent, principal }
}

function visibleToRequester(agent: Doc<'workspaceAgentDefinitions'>, requesterPrincipalId: string, requesterUserId: string) {
  if (agent.agentRole === 'personal_chief' && agent.chiefOwnerUserId !== requesterUserId) {
    throw new Error('PERSONAL_CHIEF_GRANT_REQUIRED')
  }
  if (agent.visibility === 'creator' && agent.createdByPrincipalId !== requesterPrincipalId) {
    throw new Error('AGENT_NOT_VISIBLE')
  }
}

async function assertCallerRun(
  ctx: DbContext,
  args: AssignmentArgs,
  callerPrincipalId: string,
) {
  const run = await ctx.db.query('harnessRuns')
    .withIndex('by_runId', q => q.eq('runId', args.parentRunId))
    .unique()
  if (!run || run.actorUserId !== args.requesterUserId || run.rootRunId !== args.rootRunId) {
    throw new Error('HARNESS_ACCESS_DENIED')
  }
  const root = await ctx.db.query('harnessRuns')
    .withIndex('by_runId', q => q.eq('runId', args.rootRunId))
    .unique()
  if (!root || root.runId !== root.rootRunId || root.parentRunId !== undefined
    || root.actorUserId !== args.requesterUserId) {
    throw new Error('HARNESS_ACCESS_DENIED')
  }
  const seen = new Set<string>()
  let ancestor = run
  while (ancestor.runId !== args.rootRunId) {
    if (seen.has(ancestor.runId) || !ancestor.parentRunId) throw new Error('HARNESS_ACCESS_DENIED')
    seen.add(ancestor.runId)
    const parent = await ctx.db.query('harnessRuns')
      .withIndex('by_runId', q => q.eq('runId', ancestor.parentRunId!))
      .unique()
    if (!parent || parent.rootRunId !== args.rootRunId || parent.actorUserId !== args.requesterUserId) {
      throw new Error('HARNESS_ACCESS_DENIED')
    }
    ancestor = parent
  }
  let metadata: {
    runId?: unknown
    rootRunId?: unknown
    parentRunId?: unknown
    status?: unknown
    policy?: { actorUserId?: unknown; workspaceId?: unknown }
  }
  let source: { conversationId?: unknown }
  try {
    metadata = JSON.parse(run.metadataJson) as typeof metadata
    source = JSON.parse(run.sourceJson) as typeof source
  } catch {
    throw new Error('HARNESS_ACCESS_DENIED')
  }
  if (metadata.runId !== run.runId || metadata.rootRunId !== args.rootRunId
    || metadata.parentRunId !== run.parentRunId || metadata.policy?.actorUserId !== args.requesterUserId
    || metadata.policy?.workspaceId !== args.workspaceId || source.conversationId !== args.parentConversationId
    || ['completed', 'failed', 'cancelled'].includes(String(metadata.status))) {
    throw new Error('HARNESS_ACCESS_DENIED')
  }
  const deliveryId = run.deliveryAgentRunId
    ? ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId)
    : null
  const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
  if (!delivery || delivery.harnessRunId !== args.parentRunId || delivery.userId !== args.requesterUserId
    || delivery.conversationId !== args.parentConversationId || delivery.agentId !== args.callerAgentId
    || delivery.agentPrincipalId !== callerPrincipalId) {
    throw new Error('HARNESS_ACCESS_DENIED')
  }
  if (delivery.runner !== 'workflow' || delivery.executionEngine !== 'overlay_harness' || delivery.mode !== 'room'
    || ['completed', 'failed', 'cancelled'].includes(delivery.status)) {
    throw new Error('HARNESS_ACCESS_DENIED')
  }
  return run
}

async function accessibleConversation(
  ctx: DbContext,
  viewer: Awaited<ReturnType<typeof requireNativeWorkspace>>,
  workspaceId: string,
  conversationId: Doc<'conversations'>['_id'],
) {
  const conversation = await ctx.db.get(conversationId)
  if (!conversation || conversation.deletedAt !== undefined || conversation.workspaceId !== workspaceId) return null
  if ((conversation.conversationType ?? 'personal') === 'personal') {
    return conversation.userId === viewer.userId ? conversation : null
  }
  const participant = await ctx.db.query('conversationParticipants')
    .withIndex('by_conversationId_principalId', q => q.eq('conversationId', conversationId)
      .eq('principalId', viewer.principal.principalId))
    .unique()
  return participant?.status === 'active' && participant.workspaceId === workspaceId ? conversation : null
}

async function visibleAgentForViewer(
  ctx: DbContext,
  workspaceId: string,
  agentId: string,
  viewer: Awaited<ReturnType<typeof requireNativeWorkspace>>,
) {
  const agent = await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_agentId', q => q.eq('agentId', agentId))
    .unique()
  if (!agent || agent.workspaceId !== workspaceId || agent.archivedAt !== undefined
    || (agent.visibility === 'creator' && agent.createdByPrincipalId !== viewer.principal.principalId)
    || (agent.agentRole === 'personal_chief' && agent.chiefOwnerUserId !== viewer.userId)) return null
  return agent
}

function agentScope(agent: Doc<'workspaceAgentDefinitions'>): 'workspace' | 'personal' {
  return agent.agentRole === 'personal_chief' || agent.visibility === 'creator' ? 'personal' : 'workspace'
}

async function projectedStatus(ctx: DbContext, assignment: Doc<'agentAssignments'>) {
  if (assignment.currentAttemptId) {
    const attempt = await ctx.db.query('agentAssignmentAttempts').withIndex('by_attemptId', q => q.eq('attemptId', assignment.currentAttemptId!)).unique()
    if (!attempt?.deliveryAgentRunId) return 'queued'
    const result = await ctx.db.query('agentAssignmentResults').withIndex('by_attemptId', q => q.eq('attemptId', attempt.attemptId)).unique()
    if (result?.publicationPending) return 'publication_pending'
    const delivery = await ctx.db.get(attempt.deliveryAgentRunId)
    return result?.runStatus ?? delivery?.status ?? 'queued'
  }
  const runs = await ctx.db.query('conversationAgentRuns')
    .withIndex('by_conversationId_createdAt', q => q.eq('conversationId', assignment.conversationId))
    .order('desc')
    .collect()
  return runs.find(run => run.agentId === assignment.assignedAgentId)?.status ?? 'queued'
}

const navigationScope = v.union(v.literal('workspace'), v.literal('personal'))
const originView = v.object({ platform: v.literal('slack'), channelName: v.optional(v.string()), channelId: v.string(), threadLinkId: v.string() })

async function authorizedOrigin(ctx: QueryCtx, viewer: Awaited<ReturnType<typeof requireNativeWorkspace>>, workspaceId: string, conversationId: Doc<'conversations'>['_id']) {
  const visited = new Set<string>()
  let current = conversationId
  while (!visited.has(current)) {
    visited.add(current)
    if (!await accessibleConversation(ctx, viewer, workspaceId, current)) return undefined
    const link = await ctx.db.query('surfaceThreadLinks').withIndex('by_conversationId', q => q.eq('conversationId', current)).unique()
    if (link) {
      const connection = await ctx.db.query('surfaceConnections').withIndex('by_entityId', q => q.eq('id', link.connectionId)).unique()
      if (link.workspaceId !== workspaceId || !connection || connection.workspaceId !== workspaceId
        || connection.status === 'uninstalled' || connection.externalTeamId !== link.externalTeamId) return undefined
      return { platform: link.platform, channelName: link.channelName, channelId: link.channelId, threadLinkId: String(link._id) }
    }
    const assignment = await ctx.db.query('agentAssignments').withIndex('by_conversationId', q => q.eq('conversationId', current)).unique()
    if (!assignment || assignment.workspaceId !== workspaceId) return undefined
    current = assignment.parentConversationId
  }
  return undefined
}
const parentView = v.object({
  assignmentId: v.string(),
  conversationId: v.id('conversations'),
  title: v.string(),
  agentId: v.string(),
  scope: navigationScope,
})
const assignmentView = v.object({
  assignmentId: v.string(),
  conversationId: v.id('conversations'),
  agentId: v.string(),
  agentName: v.string(),
  title: v.string(),
  status: v.string(),
  scope: navigationScope,
  currentAttemptId: v.optional(v.string()),
})

export const createAgentAssignment = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    requesterUserId: v.string(),
    assignmentId: v.string(),
    idempotencyKey: v.string(),
    toolCallId: v.string(),
    parentConversationId: v.id('conversations'),
    parentRunId: v.string(),
    rootRunId: v.string(),
    callerAgentId: v.string(),
    assignedAgentId: v.string(),
    brief: v.string(),
    questionTurnId: v.string(),
    revisionOfAssignmentId: v.optional(v.string()),
    expectedAttemptId: v.optional(v.string()),
  },
  returns: v.object({ assignmentId: v.string(), attemptId: v.optional(v.string()), conversationId: v.id('conversations'), title: v.string() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    if (!args.assignmentId.trim() || !args.toolCallId.trim() || args.toolCallId.length > 256
      || args.idempotencyKey !== `harness-run:${args.parentRunId}:tool:${args.toolCallId}`
      || !args.brief.trim() || args.brief.length > 8_000 || !args.questionTurnId.trim()
      || args.callerAgentId === args.assignedAgentId) {
      throw new Error('Invalid agent assignment identity.')
    }
    const requester = await requireRequester(ctx, args)
    await requireConversationAccess(ctx, {
      actorUserId: args.requesterUserId,
      conversationId: args.parentConversationId,
      workspaceId: args.workspaceId,
      serverSecret: args.serverSecret,
    })
    const [caller, target] = await Promise.all([
      requireActiveAgent(ctx, args.workspaceId, args.callerAgentId),
      requireActiveAgent(ctx, args.workspaceId, args.assignedAgentId),
    ])
    if (target.agent.harness !== 'overlay' || parseByoModelId(target.agent.modelId) !== null) {
      throw new Error('NATIVE_HARNESS_TARGET_REQUIRED')
    }
    visibleToRequester(caller.agent, requester.principalId, args.requesterUserId)
    visibleToRequester(target.agent, requester.principalId, args.requesterUserId)
    const callerRun = await assertCallerRun(ctx, args, caller.principal.principalId)
    if (args.revisionOfAssignmentId && args.revisionOfAssignmentId !== args.assignmentId) throw new Error('ASSIGNMENT_REVISION_CONFLICT')

    const replay = await ctx.db.query('agentAssignmentAttempts')
      .withIndex('by_workspaceId_dispatchKey', q => q.eq('workspaceId', args.workspaceId).eq('dispatchKey', args.idempotencyKey)).unique()
    if (replay) {
      const assignment = await ctx.db.query('agentAssignments').withIndex('by_assignmentId', q => q.eq('assignmentId', replay.assignmentId)).unique()
      if (!assignment || replay.dispatchFingerprint !== dispatchFingerprint(args)
        || assignment.assignedAgentId !== args.assignedAgentId || assignment.callerAgentId !== args.callerAgentId
        || assignment.parentConversationId !== args.parentConversationId || replay.assignmentId !== args.assignmentId
        || replay.requesterUserId !== args.requesterUserId || replay.parentRunId !== args.parentRunId
        || replay.rootRunId !== args.rootRunId || replay.brief !== args.brief || replay.questionTurnId !== args.questionTurnId
        || replay.expectedAttemptId !== args.expectedAttemptId
        || Boolean(args.revisionOfAssignmentId) !== (replay.ordinal > 1)) throw new Error('ASSIGNMENT_IDEMPOTENCY_CONFLICT')
      const child = await requireConversationAccess(ctx, { actorUserId: args.requesterUserId, workspaceId: args.workspaceId,
        conversationId: replay.conversationId, serverSecret: args.serverSecret })
      return { assignmentId: replay.assignmentId, attemptId: replay.attemptId, conversationId: replay.conversationId, title: child.conversation.title }
    }
    if (args.revisionOfAssignmentId) {
      if (args.assignmentId !== args.revisionOfAssignmentId || !args.expectedAttemptId) throw new Error('ASSIGNMENT_REVISION_CONFLICT')
      const assignment = await ctx.db.query('agentAssignments').withIndex('by_assignmentId', q => q.eq('assignmentId', args.assignmentId)).unique()
      if (!assignment || assignment.workspaceId !== args.workspaceId || assignment.requesterUserId !== args.requesterUserId
        || assignment.callerAgentId !== args.callerAgentId || assignment.assignedAgentId !== args.assignedAgentId
        || assignment.parentConversationId !== args.parentConversationId) throw new Error('ASSIGNMENT_ACCESS_DENIED')
      await requireConversationAccess(ctx, { actorUserId: args.requesterUserId, workspaceId: args.workspaceId,
        conversationId: assignment.conversationId, serverSecret: args.serverSecret })
      if (!assignment.currentAttemptId) throw new Error('LEGACY_ASSIGNMENT_REVISION_UNSUPPORTED')
      if (assignment.currentAttemptId !== args.expectedAttemptId) throw new Error('ASSIGNMENT_REVISION_CONFLICT')
      const previous = await ctx.db.query('agentAssignmentAttempts').withIndex('by_attemptId', q => q.eq('attemptId', args.expectedAttemptId!)).unique()
      if (!previous || previous.assignmentId !== assignment.assignmentId) throw new Error('ASSIGNMENT_REVISION_CONFLICT')
      const attemptId = await createAttempt(ctx, args, assignment.conversationId, previous.ordinal + 1)
      await ctx.db.patch(previous._id, { disposition: 'revision_requested', dispositionReason: args.brief,
        disposedByRunId: args.parentRunId, disposedAt: Date.now() })
      await ctx.db.patch(assignment._id, { currentAttemptId: attemptId, coordinationRevision: (assignment.coordinationRevision ?? 0) + 1, updatedAt: Date.now() })
      const conversation = await ctx.db.get(assignment.conversationId)
      return { assignmentId: args.assignmentId, attemptId, conversationId: assignment.conversationId, title: conversation!.title }
    }
    if (args.expectedAttemptId) throw new Error('ASSIGNMENT_REVISION_CONFLICT')

    const existing = await ctx.db.query('agentAssignments')
      .withIndex('by_workspaceId_idempotencyKey', q => q.eq('workspaceId', args.workspaceId)
        .eq('idempotencyKey', args.idempotencyKey))
      .unique()
    if (existing) {
      if (existing.assignmentId !== args.assignmentId
        || existing.parentConversationId !== args.parentConversationId
        || existing.parentRunId !== args.parentRunId || existing.rootRunId !== args.rootRunId
        || existing.callerAgentId !== args.callerAgentId || existing.assignedAgentId !== args.assignedAgentId
        || existing.requesterUserId !== args.requesterUserId || existing.brief !== args.brief
        || existing.questionTurnId !== args.questionTurnId) {
        throw new Error('ASSIGNMENT_IDEMPOTENCY_CONFLICT')
      }
      const child = await requireConversationAccess(ctx, {
        actorUserId: args.requesterUserId,
        conversationId: existing.conversationId,
        workspaceId: args.workspaceId,
        serverSecret: args.serverSecret,
      })
      return { assignmentId: existing.assignmentId, conversationId: existing.conversationId,
        title: child.conversation.title }
    }

    const now = Date.now()
    const title = args.brief.trim().replace(/\s+/g, ' ').slice(0, 120) || 'Agent assignment'
    const conversationId = await ctx.db.insert('conversations', {
      userId: args.requesterUserId,
      workspaceId: args.workspaceId,
      conversationType: 'dm',
      createdByPrincipalId: requester.principalId,
      title,
      lastModified: now,
      updatedAt: now,
      createdAt: now,
      lastMode: 'act',
      askModelIds: [DEFAULT_MODEL_ID],
      actModelId: DEFAULT_MODEL_ID,
      agentId: args.assignedAgentId,
    })
    await Promise.all([
      { principal: requester, role: 'moderator' as const },
      { principal: caller.principal, role: 'member' as const },
      { principal: target.principal, role: 'member' as const },
    ].map(({ principal, role }) => ctx.db.insert('conversationParticipants', {
      conversationId,
      workspaceId: args.workspaceId,
      principalId: principal.principalId,
      principalType: principal.type as 'human' | 'agent',
      role,
      status: 'active',
      notificationLevel: 'all',
      joinedAt: now,
      updatedAt: now,
      lastReadAt: principal.principalId === requester.principalId ? now : undefined,
    })))
    await ctx.db.insert('workspaceResourceScopes', {
      workspaceId: args.workspaceId,
      resourceType: 'conversation',
      resourceId: conversationId,
      createdAt: now,
      updatedAt: now,
    })
    const attemptId = await createAttempt(ctx, args, conversationId, 1)
    await ctx.db.insert('agentAssignments', {
      workspaceId: args.workspaceId,
      assignmentId: args.assignmentId,
      idempotencyKey: args.idempotencyKey,
      parentConversationId: args.parentConversationId,
      parentRunId: args.parentRunId,
      rootRunId: args.rootRunId,
      callerAgentId: args.callerAgentId,
      assignedAgentId: args.assignedAgentId,
      requesterUserId: args.requesterUserId,
      conversationId,
      brief: args.brief,
      questionTurnId: args.questionTurnId,
      currentAttemptId: attemptId, coordinationRevision: 0, authorityPolicyVersion: JSON.parse(callerRun.metadataJson).policyRevision ?? 0,
      contextRefs: [], dependsOnAssignmentIds: [], updatedAt: now,
      createdAt: now,
    })
    return { assignmentId: args.assignmentId, attemptId, conversationId, title }
  },
})

export const forConversation = query({
  args: { workspaceId: v.string(), conversationId: v.string() },
  returns: v.object({ parent: v.union(v.null(), parentView), assignments: v.array(assignmentView), origin: v.optional(originView) }),
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    await requireNativeCapability(ctx, viewer.userId, 'conversations.read')
    const conversationId = ctx.db.normalizeId('conversations', args.conversationId)
    if (!conversationId) return { parent: null, assignments: [] }
    const current = await accessibleConversation(ctx, viewer, args.workspaceId, conversationId)
    if (!current) return { parent: null, assignments: [] }

    let parent: {
      assignmentId: string
      conversationId: Doc<'conversations'>['_id']
      title: string
      agentId: string
      scope: 'workspace' | 'personal'
    } | null = null
    const childAssignment = await ctx.db.query('agentAssignments')
      .withIndex('by_conversationId', q => q.eq('conversationId', conversationId))
      .unique()
    if (childAssignment) {
      const parentConversation = await accessibleConversation(
        ctx, viewer, args.workspaceId, childAssignment.parentConversationId,
      )
      const caller = await visibleAgentForViewer(ctx, args.workspaceId, childAssignment.callerAgentId, viewer)
      if (parentConversation && caller) {
        parent = {
          assignmentId: childAssignment.assignmentId,
          conversationId: parentConversation._id,
          title: parentConversation.title,
          agentId: childAssignment.callerAgentId,
          scope: agentScope(caller),
        }
      }
    }

    const rows = await ctx.db.query('agentAssignments')
      .withIndex('by_parentConversationId', q => q.eq('parentConversationId', conversationId))
      .collect()
    const assignments = []
    for (const assignment of rows) {
      const [child, agent] = await Promise.all([
        accessibleConversation(ctx, viewer, args.workspaceId, assignment.conversationId),
        visibleAgentForViewer(ctx, args.workspaceId, assignment.assignedAgentId, viewer),
      ])
      if (!child || !agent) continue
      assignments.push({
        assignmentId: assignment.assignmentId,
        conversationId: child._id,
        agentId: assignment.assignedAgentId,
        agentName: agent.name,
        title: child.title,
        status: await projectedStatus(ctx, assignment),
        scope: agentScope(agent),
        currentAttemptId: assignment.currentAttemptId,
      })
    }
    const origin = await authorizedOrigin(ctx, viewer, args.workspaceId, conversationId)
    return { parent, assignments, ...(origin ? { origin } : {}) }
  },
})

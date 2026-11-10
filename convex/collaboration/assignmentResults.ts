import { v } from 'convex/values'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { AssignmentChildHandle, AssignmentResultView } from '../../src/shared/agents/assignment-result'
import type { Doc } from '../_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { requireConversationAccess } from './directMessages'
import { assertSourceReadable } from '../harness/artifactMetadata'

async function replyDigest(content: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function bindAssignmentAttempt(ctx: MutationCtx, delivery: Doc<'conversationAgentRuns'>, childRunId: string, parentRunId: string, rootRunId: string) {
  const trigger = await ctx.db.get(delivery.userMessageId)
  if (!trigger?.turnId) return
  const attempt = await ctx.db.query('agentAssignmentAttempts').withIndex('by_conversationId_questionTurnId', q =>
    q.eq('conversationId', delivery.conversationId).eq('questionTurnId', trigger.turnId!)).unique()
  if (!attempt) {
    const assignment = await ctx.db.query('agentAssignments').withIndex('by_conversationId', q => q.eq('conversationId', delivery.conversationId)).unique()
    if (assignment?.currentAttemptId) throw new Error('ASSIGNMENT_ATTEMPT_REQUIRED')
    return
  }
  const assignment = await ctx.db.query('agentAssignments').withIndex('by_assignmentId', q => q.eq('assignmentId', attempt.assignmentId)).unique()
  if (!assignment || assignment.assignedAgentId !== delivery.agentId || attempt.requesterUserId !== delivery.userId
    || attempt.parentRunId !== parentRunId || attempt.rootRunId !== rootRunId
    || (attempt.childRunId && attempt.childRunId !== childRunId)
    || (!attempt.childRunId && assignment.currentAttemptId !== attempt.attemptId)) throw new Error('ASSIGNMENT_LINEAGE_DENIED')
  await ctx.db.patch(attempt._id, { childRunId, deliveryAgentRunId: delivery._id, replyTurnId: delivery.turnId,
    questionMessageId: delivery.userMessageId, assistantMessageId: delivery.assistantMessageId })
}

async function boundRun(ctx: QueryCtx | MutationCtx, attempt: Doc<'agentAssignmentAttempts'>) {
  if (!attempt.childRunId || !attempt.deliveryAgentRunId) return null
  const [run, delivery] = await Promise.all([
    ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', attempt.childRunId!)).unique(),
    ctx.db.get(attempt.deliveryAgentRunId),
  ])
  if (!run || !delivery || run.actorUserId !== attempt.requesterUserId || run.parentRunId !== attempt.parentRunId
    || run.rootRunId !== attempt.rootRunId || run.deliveryAgentRunId !== delivery._id
    || delivery.harnessRunId !== run.runId || delivery.userId !== attempt.requesterUserId
    || delivery.conversationId !== attempt.conversationId || delivery.turnId !== attempt.replyTurnId
    || delivery.assistantMessageId !== attempt.assistantMessageId || delivery.userMessageId !== attempt.questionMessageId) {
    throw new Error('ASSIGNMENT_LINEAGE_DENIED')
  }
  const state = JSON.parse(run.metadataJson) as HarnessSnapshot
  const source = JSON.parse(run.sourceJson) as { conversationId?: string }
  if (state.runId !== run.runId || state.parentRunId !== attempt.parentRunId || state.rootRunId !== attempt.rootRunId
    || state.policy.actorUserId !== attempt.requesterUserId || state.policy.workspaceId !== attempt.workspaceId
    || source.conversationId !== attempt.conversationId) throw new Error('ASSIGNMENT_LINEAGE_DENIED')
  const lineage = [run]
  const seen = new Set<string>([run.runId])
  let ancestor = run
  while (ancestor.parentRunId) {
    const parent = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', ancestor.parentRunId!)).unique()
    if (!parent || seen.has(parent.runId) || parent.actorUserId !== attempt.requesterUserId || parent.rootRunId !== attempt.rootRunId) {
      throw new Error('ASSIGNMENT_LINEAGE_DENIED')
    }
    seen.add(parent.runId)
    lineage.push(parent)
    ancestor = parent
  }
  if (ancestor.runId !== attempt.rootRunId) throw new Error('ASSIGNMENT_LINEAGE_DENIED')
  return { run, delivery, state, lineage }
}

export async function settleAssignmentAttempt(ctx: MutationCtx, childRunId: string) {
  const attempt = await ctx.db.query('agentAssignmentAttempts').withIndex('by_childRunId', q => q.eq('childRunId', childRunId)).unique()
  if (!attempt) return
  const bound = await boundRun(ctx, attempt)
  if (!bound) return
  const { state, delivery } = bound
  const previous = await ctx.db.query('agentAssignmentResults').withIndex('by_attemptId', q => q.eq('attemptId', attempt.attemptId)).unique()
  if (previous && ((previous.terminal && !previous.publicationPending) || previous.sourceRevision > state.revision)) return
  const message = await ctx.db.get(delivery.assistantMessageId)
  const childTerminal = ['completed', 'failed', 'cancelled'].includes(state.status)
  const deliveryTerminal = ['completed', 'failed', 'cancelled'].includes(delivery.status)
  const finalMessage = message && message.conversationId === attempt.conversationId && message.turnId === delivery.turnId
    && message.role === 'assistant' && message.authorKind === 'agent' && message.authorPrincipalId === delivery.agentPrincipalId
    && message.deletedAt === undefined && (message.status === 'completed' || message.status === 'error') ? message : null
  const publicationPending = childTerminal && (!deliveryTerminal || !finalMessage)
  const runStatus = state.status === 'completed' && (delivery.status === 'failed' || delivery.status === 'cancelled')
    ? delivery.status : state.status === 'completed' && finalMessage?.status === 'error' ? 'failed' : state.status
  const artifacts = await ctx.db.query('harnessContextArtifacts').withIndex('by_runId_createdAt', q => q.eq('runId', childRunId)).collect()
  const evidence = await ctx.db.query('harnessEvidence').withIndex('by_runId_createdAt', q => q.eq('runId', childRunId)).collect()
  const now = Date.now()
  const envelope = {
    workspaceId: attempt.workspaceId, assignmentId: attempt.assignmentId, attemptId: attempt.attemptId,
    childRunId, deliveryAgentRunId: delivery._id, sourceRevision: state.revision,
    runStatus, terminal: childTerminal, publicationPending, blocker: state.blocker,
    summary: state.resultSummary ?? state.workingSummary ?? '',
    finalReplyMessageId: childTerminal && !publicationPending ? finalMessage?._id : undefined,
    replyDigest: childTerminal && !publicationPending && finalMessage ? await replyDigest(finalMessage.content) : undefined,
    replyTurnId: delivery.turnId, artifactRefs: artifacts.map(row => row.artifactId),
    toolResultRefs: evidence.map(row => row.evidenceId), usageRef: delivery._id,
    failureReason: runStatus === 'failed' || runStatus === 'cancelled' ? state.terminalReason ?? `Assignment ${runStatus}.` : undefined,
    updatedAt: now,
  }
  if (previous) {
    const saved: Record<string, unknown> = previous
    if (Object.entries(envelope).every(([key, value]) => key === 'updatedAt' || JSON.stringify(saved[key]) === JSON.stringify(value))) return
    await ctx.db.patch(previous._id, envelope)
  }
  else {
    const resultId = await ctx.db.insert('agentAssignmentResults', { ...envelope, createdAt: now })
    await ctx.db.patch(attempt._id, { resultId })
  }
  if (envelope.terminal && !envelope.publicationPending) {
    const intent = await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_attemptId', q => q.eq('attemptId', attempt.attemptId)).unique()
    if (intent && intent.state !== 'cancelled') await ctx.db.patch(intent._id, { state: 'settled', updatedAt: now })
  }
}

export const settle = mutation({
  args: { serverSecret: v.string(), childRunId: v.string() },
  handler: async (ctx, args) => { requireServerSecret(args.serverSecret); await settleAssignmentAttempt(ctx, args.childRunId) },
})

export async function authorizeAssignmentAttempt(ctx: QueryCtx, args: { serverSecret: string; actorUserId: string; workspaceId: string }, attempt: Doc<'agentAssignmentAttempts'>) {
  requireServerSecret(args.serverSecret)
  const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).unique()
  if (!workspace || workspace.status !== 'active' || workspace.archivedAt !== undefined) throw new Error('ASSIGNMENT_ACCESS_DENIED')
  const assignment = await ctx.db.query('agentAssignments').withIndex('by_assignmentId', q => q.eq('assignmentId', attempt.assignmentId)).unique()
  if (!assignment || assignment.workspaceId !== args.workspaceId || attempt.workspaceId !== args.workspaceId
    || assignment.conversationId !== attempt.conversationId) throw new Error('ASSIGNMENT_ACCESS_DENIED')
  const visited = new Set<string>()
  let conversationId = assignment.conversationId
  while (!visited.has(conversationId)) {
    visited.add(conversationId)
    await requireConversationAccess(ctx, { ...args, conversationId })
    const ancestor = await ctx.db.query('agentAssignments').withIndex('by_conversationId', q => q.eq('conversationId', conversationId)).unique()
    if (!ancestor) break
    if (ancestor.workspaceId !== args.workspaceId || visited.has(ancestor.parentConversationId)) throw new Error('ASSIGNMENT_LINEAGE_DENIED')
    conversationId = ancestor.parentConversationId
  }
  for (const agentId of [assignment.callerAgentId, assignment.assignedAgentId]) {
    const agent = await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', agentId)).unique()
    if (!agent || agent.workspaceId !== args.workspaceId || agent.archivedAt !== undefined
      || (agent.agentRole === 'personal_chief' && agent.chiefOwnerUserId !== args.actorUserId)) throw new Error('ASSIGNMENT_ACCESS_DENIED')
    if (agent.visibility === 'creator') {
      const principal = await ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', args.actorUserId)).unique()
      if (!principal || principal.principalId !== agent.createdByPrincipalId) throw new Error('ASSIGNMENT_ACCESS_DENIED')
    }
  }
  const bound = await boundRun(ctx, attempt)
  for (const run of bound?.lineage ?? []) {
    const source = JSON.parse(run.sourceJson) as { conversationId?: string }
    const id = source.conversationId ? ctx.db.normalizeId('conversations', source.conversationId) : null
    if (!id) throw new Error('ASSIGNMENT_LINEAGE_DENIED')
    await requireConversationAccess(ctx, { ...args, conversationId: id })
  }
  return assignment
}

export const currentChild = query({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), parentRunId: v.string(), assignmentId: v.string() },
  handler: async (ctx, args): Promise<AssignmentChildHandle | null> => {
    requireServerSecret(args.serverSecret)
    const parent = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', args.parentRunId)).unique()
    if (!parent || parent.actorUserId !== args.actorUserId || JSON.parse(parent.metadataJson).policy.workspaceId !== args.workspaceId) return null
    const assignment = await ctx.db.query('agentAssignments').withIndex('by_assignmentId', q => q.eq('assignmentId', args.assignmentId)).unique()
    if (!assignment?.currentAttemptId) return null
    const attemptId = assignment.currentAttemptId
    const attempt = await ctx.db.query('agentAssignmentAttempts').withIndex('by_attemptId', q => q.eq('attemptId', attemptId)).unique()
    if (!attempt || attempt.assignmentId !== assignment.assignmentId || attempt.parentRunId !== parent.runId || attempt.rootRunId !== parent.rootRunId) return null
    try {
      await authorizeAssignmentAttempt(ctx, args, attempt)
    } catch (error) {
      if (error instanceof Error && ['ASSIGNMENT_ACCESS_DENIED', 'ASSIGNMENT_LINEAGE_DENIED', 'CONVERSATION_ACCESS_DENIED', 'WORKSPACE_ACCESS_DENIED'].includes(error.message)) return null
      throw error
    }
    const intent = await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_attemptId', q => q.eq('attemptId', attempt.attemptId)).unique()
    return { assignmentId: assignment.assignmentId, attemptId: attempt.attemptId, conversationId: attempt.conversationId,
      childRunId: attempt.childRunId, launchPending: !attempt.childRunId && intent?.state === 'pending' }
  },
})

export const read = query({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(),
    conversationId: v.optional(v.id('conversations')), turnId: v.optional(v.string()),
    childRunId: v.optional(v.string()), parentRunId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<AssignmentResultView | null> => {
    requireServerSecret(args.serverSecret)
    const attempt = args.childRunId
      ? await ctx.db.query('agentAssignmentAttempts').withIndex('by_childRunId', q => q.eq('childRunId', args.childRunId!)).unique()
      : args.conversationId && args.turnId
        ? await ctx.db.query('agentAssignmentAttempts').withIndex('by_conversationId_replyTurnId', q => q.eq('conversationId', args.conversationId!).eq('replyTurnId', args.turnId!)).unique() : null
    if (!attempt) {
      if (args.conversationId) {
        const assignment = await ctx.db.query('agentAssignments').withIndex('by_conversationId', q => q.eq('conversationId', args.conversationId!)).unique()
        if (assignment?.currentAttemptId) throw new Error('ASSIGNMENT_HANDLE_NOT_FOUND')
      }
      return null
    }
    const assignment = await authorizeAssignmentAttempt(ctx, args, attempt)
    if (args.parentRunId && args.parentRunId !== attempt.parentRunId) throw new Error('ASSIGNMENT_LINEAGE_DENIED')
    const result = await ctx.db.query('agentAssignmentResults').withIndex('by_attemptId', q => q.eq('attemptId', attempt.attemptId)).unique()
    const message = result?.finalReplyMessageId ? await ctx.db.get(result.finalReplyMessageId) : null
    if (result?.finalReplyMessageId && (!message || message.deletedAt !== undefined || message.conversationId !== attempt.conversationId
      || message._id !== attempt.assistantMessageId || message.turnId !== attempt.replyTurnId
      || !['completed', 'error'].includes(message.status ?? ''))) throw new Error('ASSIGNMENT_REPLY_UNAVAILABLE')
    if (message && result?.replyDigest !== await replyDigest(message.content)) throw new Error('ASSIGNMENT_REPLY_UNAVAILABLE')
    const artifactRefs: AssignmentResultView['artifactRefs'] = []
    if (result) {
      const bound = await boundRun(ctx, attempt)
      for (const artifactId of result.artifactRefs) {
        const row = await ctx.db.query('harnessContextArtifacts').withIndex('by_runId_artifactId', q => q.eq('runId', result.childRunId).eq('artifactId', artifactId)).unique()
        if (!row || row.expiresAt <= Date.now() || !bound) continue
        try { await assertSourceReadable(ctx, bound.run, args.actorUserId, row) } catch { continue }
        artifactRefs.push({ artifactId, runId: row.runId, expiresAt: row.expiresAt, ...(row.resource ? { resource: row.resource } : {}) })
      }
    }
    return {
      assignmentId: assignment.assignmentId, attemptId: attempt.attemptId, conversationId: attempt.conversationId,
      turnId: attempt.replyTurnId!, childRunId: attempt.childRunId, superseded: assignment.currentAttemptId !== attempt.attemptId,
      state: !result?.terminal ? 'working' : result.publicationPending ? 'publication_pending' : 'ready',
      runStatus: result?.runStatus ?? 'running', terminal: result?.terminal ?? false,
      summary: result?.summary ?? '', blocker: result?.blocker, reply: message?.content,
      failureReason: result?.failureReason, artifactRefs,
    }
  },
})

export const settledArtifact = query({
  args: { serverSecret: v.string(), actorUserId: v.string(), workspaceId: v.string(), attemptId: v.string(), artifactId: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const attempt = await ctx.db.query('agentAssignmentAttempts').withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId)).unique()
    if (!attempt) throw new Error('ASSIGNMENT_ACCESS_DENIED')
    await authorizeAssignmentAttempt(ctx, args, attempt)
    const result = await ctx.db.query('agentAssignmentResults').withIndex('by_attemptId', q => q.eq('attemptId', args.attemptId)).unique()
    if (!result?.terminal || result.publicationPending || !result.artifactRefs.includes(args.artifactId)) return null
    const bound = await boundRun(ctx, attempt)
    const row = await ctx.db.query('harnessContextArtifacts').withIndex('by_runId_artifactId', q => q.eq('runId', result.childRunId).eq('artifactId', args.artifactId)).unique()
    if (!bound || !row || row.expiresAt <= Date.now()) return null
    await assertSourceReadable(ctx, bound.run, args.actorUserId, row)
    return { artifactId: row.artifactId, runId: row.runId, workflowRunId: row.workflowRunId,
      toolCallId: row.toolCallId, toolName: row.toolName, digest: row.digest, storageId: String(row.storageId),
      byteSize: row.byteSize, mediaPartCount: row.mediaPartCount, createdAt: row.createdAt, expiresAt: row.expiresAt,
      ...(row.resource ? { resource: row.resource } : {}) }
  },
})

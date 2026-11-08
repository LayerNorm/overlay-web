import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { HarnessSnapshot } from '../../packages/overlay-agent-runtime/src/harness-state'
import type { HarnessTranscriptPersistence } from '../../packages/overlay-agent-runtime/src/harness-store'
import { ACTIVE_AGENT_RUN_STATUSES } from '@/shared/agents/agent-run'
import { compactTranscriptSnapshot } from '@/shared/chat/compact-transcript-snapshot'
import { withTranscriptPartIds } from '@/shared/chat/transcript-part-identity'
import { joinStepTranscripts } from '@/shared/chat/step-text-join'

const ACTIVE = new Set<string>(ACTIVE_AGENT_RUN_STATUSES)
type Metadata = Pick<HarnessSnapshot, 'workflowRunId' | 'status' | 'policy' | 'executionGeneration'>

async function nativeDelivery(ctx: MutationCtx, run: Doc<'harnessRuns'>, metadata: Metadata) {
  if (run.parentRunId || run.rootRunId !== run.runId || !run.deliveryAgentRunId
    || ['completed', 'failed', 'cancelled'].includes(metadata.status)) return null
  const id = ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId)
  const delivery = id ? await ctx.db.get(id) : null
  if (!delivery || delivery.userId !== run.actorUserId || delivery.harnessRunId !== run.runId
    || delivery.workflowRunId !== metadata.workflowRunId || !metadata.workflowRunId
    || delivery.runner !== 'workflow' || delivery.executionEngine !== 'overlay_harness' || !ACTIVE.has(delivery.status)) return null
  const [conversation, user, message] = await Promise.all([
    ctx.db.get(delivery.conversationId), ctx.db.get(delivery.userMessageId), ctx.db.get(delivery.assistantMessageId),
  ])
  // An agent turn in a room or work thread has its own `agent_<trigger>_<agent>` turn id, and
  // its trigger may be another agent's ask, so only the reply must carry the delivery's turn,
  // as admission already requires. Requiring the trigger's turn too skipped every agent
  // thread, leaving only the newest call's live text on screen while the turn ran.
  const agentTurn = delivery.mode === 'room' || delivery.mode === 'work'
  if (!conversation || !conversation.workspaceId
    || conversation.workspaceId !== metadata.policy.workspaceId || conversation.deletedAt !== undefined
    || !user || user.deletedAt !== undefined || user.conversationId !== delivery.conversationId
    || (!agentTurn && (user.role !== 'user' || user.turnId !== delivery.turnId))
    || !message || message.role !== 'assistant' || message.status !== 'generating' || message.deletedAt !== undefined
    || message.conversationId !== delivery.conversationId || message.turnId !== delivery.turnId
    || (message.nativeRunId !== undefined && message.nativeRunId !== delivery._id)) return null
  // Versioned runs settle every step here, writing the checkpoint that retires the step's
  // live stream. A chat this skips would keep its live text on screen next to the step text
  // the legacy progress writer saves, so every enrolled chat kind must be accepted:
  // personal and workspace-scope chats (both owner-only), automations, rooms and work.
  if (metadata.policy.publicStreamVersion === 1) {
    if (delivery.mode === 'room' || delivery.mode === 'work') {
      if (!delivery.agentPrincipalId || message.authorKind !== 'agent'
        || message.authorPrincipalId !== delivery.agentPrincipalId) return null
    } else {
      if (conversation.userId !== run.actorUserId || message.userId !== run.actorUserId
        || message.authorKind === 'agent' || message.authorPrincipalId !== undefined) return null
      if (conversation.isAutomation) {
        const automation = await ctx.db.query('automations')
          .withIndex('by_conversationId_deletedAt', q => q.eq('conversationId', conversation._id).eq('deletedAt', undefined)).first()
        if (!automation) return null
      } else if (!['personal', 'workspace'].includes(conversation.scope ?? 'personal')
        || (conversation.conversationType ?? 'personal') !== 'personal' || conversation.agentId
        || conversation.externalPlatform || conversation.surfaceBindingId) return null
    }
    return { delivery, message }
  }
  if (metadata.policy.publicProgressVersion !== 1 || delivery.mode === 'room'
    || conversation.userId !== run.actorUserId || (conversation.scope ?? 'personal') !== 'personal'
    || (conversation.conversationType ?? 'personal') !== 'personal' || conversation.agentId
    || conversation.isAutomation || conversation.externalPlatform || conversation.surfaceBindingId
    || user.nativeSubmittedAt === undefined || user.userId !== run.actorUserId || message.userId !== run.actorUserId
    || message.authorKind === 'agent' || message.authorPrincipalId !== undefined) return null
  const automation = await ctx.db.query('automations')
    .withIndex('by_conversationId_deletedAt', q => q.eq('conversationId', conversation._id).eq('deletedAt', undefined)).first()
  return automation ? null : { delivery, message }
}

// The caller must first validate the settled receipt and the complete workflow lineage.
export async function projectNativePersonalProgress(
  ctx: MutationCtx,
  run: Doc<'harnessRuns'>,
  metadata: Metadata,
  sequence: number,
) {
  const target = await nativeDelivery(ctx, run, metadata)
  if (!target || (target.message.nativeProgressSequence ?? -1) >= sequence) return
  const rows = await ctx.db.query('harnessTranscriptSteps')
    .withIndex('by_runId_sequence', q => q.eq('runId', run.runId)).order('desc').take(26)
  const steps = rows.slice(0, 25).reverse().map(row => withTranscriptPartIds(
    run.runId, row.receiptId, JSON.parse(row.persistenceJson) as HarnessTranscriptPersistence, row.executionGeneration ?? 0,
  ))
  const earlier = rows.length > 25 ? '[Earlier progress is available in the full trace]' : ''
  const controls = (target.message.parts ?? []).filter(part => part.type.startsWith('data-native-agent-'))
  const joined = joinStepTranscripts([
    ...(earlier ? [{ content: earlier, parts: [{ type: 'text', text: earlier, id: JSON.stringify([run.runId, 'earlier']) }] }] : []),
    ...steps,
  ])
  const persistence = withTranscriptPartIds(run.runId, 'checkpoint', compactTranscriptSnapshot({
    content: joined.content,
    parts: [...joined.parts, ...controls],
  }))
  await ctx.db.patch(target.message._id, {
    content: persistence.content,
    parts: persistence.parts as NonNullable<Doc<'conversationMessages'>['parts']>,
    nativeRunId: target.delivery._id,
    nativeProgressSequence: rows[0]?.sequence ?? sequence,
    ...(metadata.policy.publicStreamVersion === 1 ? { publicStreamCheckpoint: {
      runId: run.runId,
      executionGeneration: metadata.executionGeneration ?? 0,
      receiptId: `model:${sequence}`,
      invocation: sequence,
    } } : {}),
    updatedAt: Date.now(),
  })
}

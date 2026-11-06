import type { Doc } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { HarnessSnapshot } from '../../packages/overlay-agent-runtime/src/harness-state'
import type { HarnessTranscriptPersistence } from '../../packages/overlay-agent-runtime/src/harness-store'
import { ACTIVE_AGENT_RUN_STATUSES } from '@/shared/agents/agent-run'
import { compactTranscriptSnapshot } from '@/shared/chat/compact-transcript-snapshot'
import { withTranscriptPartIds } from '@/shared/chat/transcript-part-identity'

const ACTIVE = new Set<string>(ACTIVE_AGENT_RUN_STATUSES)
type Metadata = Pick<HarnessSnapshot, 'workflowRunId' | 'status' | 'policy'>

async function nativeDelivery(ctx: MutationCtx, run: Doc<'harnessRuns'>, metadata: Metadata) {
  if (run.parentRunId || run.rootRunId !== run.runId || !run.deliveryAgentRunId
    || metadata.policy.publicProgressVersion !== 1 || ['completed', 'failed', 'cancelled'].includes(metadata.status)) return null
  const id = ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId)
  const delivery = id ? await ctx.db.get(id) : null
  if (!delivery || delivery.userId !== run.actorUserId || delivery.harnessRunId !== run.runId
    || delivery.workflowRunId !== metadata.workflowRunId || !metadata.workflowRunId
    || delivery.runner !== 'workflow' || delivery.executionEngine !== 'overlay_harness'
    || delivery.mode === 'room' || !ACTIVE.has(delivery.status)) return null
  const [conversation, user, message] = await Promise.all([
    ctx.db.get(delivery.conversationId), ctx.db.get(delivery.userMessageId), ctx.db.get(delivery.assistantMessageId),
  ])
  if (!conversation || conversation.userId !== run.actorUserId || !conversation.workspaceId
    || conversation.workspaceId !== metadata.policy.workspaceId || conversation.deletedAt !== undefined
    || (conversation.scope ?? 'personal') !== 'personal' || (conversation.conversationType ?? 'personal') !== 'personal'
    || conversation.agentId || conversation.isAutomation || conversation.externalPlatform || conversation.surfaceBindingId
    || !user || user.role !== 'user' || user.nativeSubmittedAt === undefined || user.deletedAt !== undefined
    || !message || message.role !== 'assistant' || message.status !== 'generating' || message.deletedAt !== undefined
    || message.authorKind === 'agent' || message.authorPrincipalId !== undefined
    || [user, message].some(row => row.conversationId !== delivery.conversationId
      || row.userId !== run.actorUserId || row.turnId !== delivery.turnId)
    || (message.nativeRunId !== undefined && message.nativeRunId !== delivery._id)) return null
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
    run.runId, row.receiptId, JSON.parse(row.persistenceJson) as HarnessTranscriptPersistence,
  ))
  const earlier = rows.length > 25 ? '[Earlier progress is available in the full trace]' : ''
  const controls = (target.message.parts ?? []).filter(part => part.type.startsWith('data-native-agent-'))
  const persistence = withTranscriptPartIds(run.runId, 'checkpoint', compactTranscriptSnapshot({
    content: [earlier, ...steps.map(step => step.content)].filter(Boolean).join('\n\n'),
    parts: [
      ...(earlier ? [{ type: 'text', text: earlier, id: JSON.stringify([run.runId, 'earlier']) }] : []),
      ...steps.flatMap(step => step.parts),
      ...controls,
    ],
  }))
  await ctx.db.patch(target.message._id, {
    content: persistence.content,
    parts: persistence.parts as NonNullable<Doc<'conversationMessages'>['parts']>,
    nativeRunId: target.delivery._id,
    nativeProgressSequence: rows[0]?.sequence ?? sequence,
    updatedAt: Date.now(),
  })
}

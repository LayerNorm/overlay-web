import type { MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { acquireNativeTurn } from './nativeTurnQueue'

export async function claimNativeLaunch(ctx: MutationCtx, run: Doc<'harnessRuns'>, workflowRunId: string, generation: number, serverSecret: string) {
  const attempt = await ctx.db.query('agentAssignmentAttempts').withIndex('by_childRunId', q => q.eq('childRunId', run.runId)).unique()
  const intent = attempt ? await ctx.db.query('agentAssignmentLaunchIntents').withIndex('by_attemptId', q => q.eq('attemptId', attempt.attemptId)).unique() : null
  if (intent) {
    const parent = await ctx.db.query('harnessRuns').withIndex('by_runId', q => q.eq('runId', intent.parentRunId)).unique()
    const state = parent ? JSON.parse(parent.metadataJson) : null
    if (!state || ['completed', 'failed', 'cancelled', 'waiting_for_authorization'].includes(state.status)
      || intent.state === 'cancelled' || intent.state === 'settled' || intent.generation > generation
      || (intent.generation === generation && intent.winnerWorkflowRunId && intent.winnerWorkflowRunId !== workflowRunId)) throw new Error('ASSIGNMENT_LAUNCH_FENCED')
    await ctx.db.patch(intent._id, { state: 'launched', generation, winnerWorkflowRunId: workflowRunId, updatedAt: Date.now() })
  }
  const deliveryId = run.deliveryAgentRunId ? ctx.db.normalizeId('conversationAgentRuns', run.deliveryAgentRunId) : null
  const delivery = deliveryId ? await ctx.db.get(deliveryId) : null
  if (!delivery) return
  if (!await acquireNativeTurn(ctx, delivery, serverSecret)) throw new Error('NATIVE_TURN_QUEUED')
  const queue = await ctx.db.query('agentConversationTurnQueue').withIndex('by_deliveryAgentRunId', q => q.eq('deliveryAgentRunId', delivery._id)).unique()
  if (queue) {
    if (queue.generation > generation || (queue.generation === generation && queue.winnerWorkflowRunId && queue.winnerWorkflowRunId !== workflowRunId)) throw new Error('NATIVE_TURN_LAUNCH_FENCED')
    await ctx.db.patch(queue._id, { generation, winnerWorkflowRunId: workflowRunId, updatedAt: Date.now() })
  }
}

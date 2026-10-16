import type {Doc} from '../_generated/dataModel'
import type {MutationCtx} from '../_generated/server'
import type {RemoteRunState} from '../../src/shared/agents/remote-run'

/** Queueing/retrying updates the existing assistant atomically, without touching its text chunks or historical work. */
export async function projectNativePreparation(ctx: MutationCtx, run: Doc<'conversationAgentRuns'>, state: RemoteRunState,
  input: {workspaceId: string; environmentName: unknown; now: number}) {
  if (!run.externalRunId || state.phase !== 'recovering') throw Error('AGENT_NATIVE_PREPARATION_STATE_INVALID')
  const message = await ctx.db.get(run.assistantMessageId)
  if (!message) throw Error('AGENT_REMOTE_MESSAGE_NOT_FOUND')
  const status: Extract<NonNullable<Doc<'conversationMessages'>['parts']>[number], {type: 'data-remote-agent-status'}>['data'] = {
    runId: run.externalRunId, environmentName: typeof input.environmentName === 'string' ? input.environmentName : 'connected environment',
    state: state.phase, queueExpiresAt: state.claimDeadlineAt, hardDeadlineAt: state.hardDeadlineAt, recoveryOutcome: state.recoveryOutcome}
  let found = false
  const parts: NonNullable<Doc<'conversationMessages'>['parts']> = (message.parts ?? []).map(part => {
    if (part.type !== 'data-remote-agent-status' || !('data' in part)) return part
    found = true
    return {...part, data: {...part.data, ...status}}
  })
  if (!found) parts.push({type: 'data-remote-agent-status', data: status})
  await ctx.db.patch(message._id, {parts, updatedAt: input.now})
  await ctx.db.patch(run.conversationId, {lastModified: input.now, updatedAt: input.now})
  await ctx.db.insert('conversationEvents', {conversationId: run.conversationId, workspaceId: input.workspaceId,
    messageId: message._id, type: 'message.delta', userId: run.userId, createdAt: input.now})
}

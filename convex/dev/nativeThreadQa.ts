import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from '../_generated/server'
import { requirePreviewDeployment } from '../lib/preview'
import { seedPreviewWorkspace } from './previewWorkspace'

const threadIds = v.object({
  conversationId: v.id('conversations'),
  userMessageId: v.id('conversationMessages'),
  assistantMessageId: v.id('conversationMessages'),
})

/** Historical data only: no worker, workflow, provider call, or scheduled action. */
export const init = internalMutation({
  args: {},
  returns: v.object({
    userId: v.string(), workspaceId: v.string(), agentId: v.string(),
    personal: threadIds, agent: threadIds, room: threadIds,
  }),
  handler: async (ctx) => {
    requirePreviewDeployment()
    const userId = process.env.PREVIEW_LOGIN_USER_ID?.trim()
    const email = process.env.PREVIEW_LOGIN_EMAIL?.trim()
    if (!userId?.startsWith('user_') || !email) throw new Error('Configure the sandbox preview login identity before seeding')
    const { workspaceId } = await seedPreviewWorkspace(ctx, { userId, email })
    const agentId = `${workspaceId}-personal-agent`
    const scope = { userId, workspaceId, agentId }
    const personal = await seedRetiredConversation(ctx, scope, 'personal')
    const agent = await seedRetiredConversation(ctx, scope, 'agent')
    const room = await seedRetiredConversation(ctx, scope, 'room')
    return { ...scope, personal, agent, room }
  },
})

async function seedRetiredConversation(
  ctx: MutationCtx,
  scope: { userId: string; workspaceId: string; agentId: string },
  kind: 'personal' | 'agent' | 'room',
) {
  const { userId, workspaceId, agentId } = scope
  const clientId = `preview-retired-${kind}-v1`
  const existing = await ctx.db.query('conversations')
    .withIndex('by_userId_clientId', q => q.eq('userId', userId).eq('clientId', clientId)).unique()
  if (existing) {
    if (existing.workspaceId !== workspaceId) throw new Error('Unexpected retirement fixture workspace')
    const run = await ctx.db.query('conversationAgentRuns')
      .withIndex('by_turn_variant', q => q.eq('conversationId', existing._id).eq('turnId', clientId)).unique()
    if (!run) throw new Error('Retirement fixture history changed; inspect before reseeding')
    return { conversationId: existing._id, userMessageId: run.userMessageId, assistantMessageId: run.assistantMessageId }
  }
  const now = Date.now()
  const ownerId = `${workspaceId}-owner`
  const agentPrincipalId = `${agentId}-principal`
  const conversationId = await ctx.db.insert('conversations', {
    userId, workspaceId, clientId, title: `Retired ${kind} QA`,
    conversationType: kind === 'room' ? 'channel' : kind === 'agent' ? 'dm' : 'personal',
    agentId: kind === 'agent' ? agentId : undefined,
    channelSlug: kind === 'room' ? 'retired-thread-qa' : undefined,
    channelVisibility: kind === 'room' ? 'private' : undefined,
    createdByPrincipalId: ownerId, lastMode: 'act',
    askModelIds: ['openrouter/free'], actModelId: 'openrouter/free',
    createdAt: now, updatedAt: now, lastModified: now,
  })
  if (kind !== 'personal') {
    for (const participant of [
      { principalId: ownerId, principalType: 'human' as const, role: 'moderator' as const },
      { principalId: agentPrincipalId, principalType: 'agent' as const, role: 'member' as const },
      ...(kind === 'room' ? [{ principalId: `${workspaceId}-member`, principalType: 'human' as const, role: 'member' as const }] : []),
    ]) {
      await ctx.db.insert('conversationParticipants', {
        ...participant, conversationId, workspaceId, status: 'active', notificationLevel: 'all',
        joinedAt: now, updatedAt: now,
      })
    }
    await ctx.db.insert('workspaceResourceScopes', {
      workspaceId, resourceType: 'conversation', resourceId: conversationId, createdAt: now, updatedAt: now,
    })
  }
  const userMessageId = await ctx.db.insert('conversationMessages', {
    conversationId, userId, turnId: clientId, mode: 'act', role: 'user', contentType: 'text',
    authorKind: 'human', authorPrincipalId: ownerId,
    content: 'Prepare a short launch outline. This synthetic historical task is unfinished.',
    status: 'completed', createdAt: now,
  })
  const assistantMessageId = await ctx.db.insert('conversationMessages', {
    conversationId, userId, turnId: clientId, mode: 'act', role: 'assistant', contentType: 'text',
    authorKind: kind === 'personal' ? 'model' : 'agent',
    authorPrincipalId: kind === 'personal' ? undefined : agentPrincipalId,
    threadRootMessageId: kind === 'room' ? userMessageId : undefined,
    content: 'The outline is unfinished. Start a new thread to continue from this history.',
    status: 'error', createdAt: now + 1,
    parts: [{ type: 'data', dataType: 'overlay.generated_ui', id: 'retired-draft',
      data: { version: 1, kind: 'draft.text', title: 'Historical draft', body: 'Unfinished launch outline.' } }],
  })
  await ctx.db.insert('conversationAgentRuns', {
    conversationId, userId, turnId: clientId, userMessageId, assistantMessageId,
    mode: kind === 'personal' ? 'chat' : 'room', runner: kind === 'personal' ? 'workflow' : 'tool_loop',
    agentId: kind === 'personal' ? undefined : agentId,
    agentPrincipalId: kind === 'personal' ? undefined : agentPrincipalId,
    status: 'failed', terminalError: { code: 'native_runner_retired',
      message: 'The harness has changed. Start a new thread to continue.', retryable: false },
    createdAt: now, updatedAt: now, failedAt: now,
  })
  return { conversationId, userMessageId, assistantMessageId }
}

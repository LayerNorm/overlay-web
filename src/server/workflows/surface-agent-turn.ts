/**
 * Surface Agent Turn — durable execution of an agent turn triggered by an
 * external platform message (Slack first).
 *
 * Started from the Slack webhook handler after the binding resolves and the
 * "working" placeholder is posted. The workflow ensures the thread's Overlay
 * conversation exists, runs the shared durable agent loop (the same
 * prepare → model/tool → finalize steps the automation runner uses), then
 * relays the final reply back to Slack as the bound agent.
 *
 * All inputs must stay JSON-serializable — they cross workflow step
 * boundaries.
 */

import {
  runDurableAgentTurn,
} from '@/server/workflows/automation-agent-turn'
import type {
  AutomationAgentTurnInput,
  SurfaceTurnContext,
} from '@/server/automations/automation-turn-runner'
import { getSlackAdapter } from '@/server/surfaces/chat'
import { ensureSurfaceConversation } from '@/server/surfaces/surface-conversations'
import { postSlackAgentMessage } from '@/server/surfaces/slack-reply'

export type SurfaceAgentTurnInput = Omit<
  AutomationAgentTurnInput,
  'surface' | 'workspaceId'
> & {
  workspaceId: string
  surface: SurfaceTurnContext
}

async function ensureSurfaceConversationStep(input: SurfaceAgentTurnInput): Promise<{
  conversationId: string
  workspaceId: string
}> {
  'use step'
  return await ensureSurfaceConversation(input)
}

/**
 * Delivers the final reply to Slack, editing the "working" placeholder when
 * one was posted. Swallows delivery failures — the turn already persisted in
 * Overlay and a retry loop here can't fix a revoked token.
 */
async function postSurfaceReplyStep(args: {
  surface: SurfaceTurnContext
  text: string
}): Promise<void> {
  'use step'
  if (args.surface.platform !== 'slack') return
  await postSlackAgentMessage({
    adapter: await getSlackAdapter(),
    teamId: args.surface.teamId,
    channelId: args.surface.channelId,
    threadTs: args.surface.threadId || undefined,
    text: args.text,
    agentName: args.surface.agentName,
    editTs: args.surface.placeholderTs,
  })
}

export async function surfaceAgentTurnWorkflow(input: SurfaceAgentTurnInput) {
  'use workflow'

  const ensured = await ensureSurfaceConversationStep(input)
  const turnInput = {
    ...input,
    conversationId: ensured.conversationId,
    workspaceId: ensured.workspaceId,
  }

  try {
    const result = await runDurableAgentTurn(turnInput)
    await postSurfaceReplyStep({
      surface: input.surface,
      text: result.replyText || 'Done.',
    })
    return result
  } catch (error) {
    await postSurfaceReplyStep({
      surface: input.surface,
      text: 'Sorry — I hit an error while working on that. The details are in the Overlay conversation.',
    }).catch((_error) => undefined)
    throw error
  }
}

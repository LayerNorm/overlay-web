import 'server-only'

import { start } from 'workflow/api'
import type { SlackAdapter, SlackEvent } from '@chat-adapter/slack'
import type {
  SurfaceChat,
  SurfaceInboundMessage,
  SurfaceInboundThread,
} from './chat'
import { getOverlayServerContext } from '@/server/bootstrap'
import { resolveSurfaceAuthorStatus } from '@/server/surfaces/surface-authors'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import { stripSlackMentionMarkup } from '@/shared/surfaces/surface-prompts'
import {
  surfaceAgentTurnWorkflow,
  type SurfaceAgentTurnInput,
} from '@/server/workflows/surface-agent-turn'
import { postSlackAgentMessage } from './slack-reply'

const WORKING_PLACEHOLDER = '_Working…_'

/**
 * One inbound Slack message → resolve binding → post placeholder → start the
 * durable surface turn. No-ops quietly for unbound channels, removed
 * bindings, archived agents, and bot/self echoes.
 */
async function handleInboundSlackMessage(args: {
  adapter: SlackAdapter
  thread: SurfaceInboundThread
  message: SurfaceInboundMessage
  /** Mentions in unbound channels get a one-line pointer to Overlay. */
  replyWhenUnbound: boolean
  /** Subscribe the thread so follow-ups route to onSubscribedMessage. */
  subscribe: boolean
}): Promise<void> {
  const { adapter, thread, message } = args
  if (message.author.isMe || message.author.isBot === true || message.author.isSystem) return

  let channelId: string
  let threadTs: string
  try {
    const decoded = adapter.decodeThreadId(thread.id)
    channelId = decoded.channel
    threadTs = decoded.threadTs
  } catch (_error) {
    return
  }
  const raw = message.raw as (
    Omit<SlackEvent, 'team'> & { team?: string | { id?: string } }
  ) | undefined
  const rawTeam = raw?.team
  const teamId = raw?.team_id ?? (typeof rawTeam === 'string' ? rawTeam : rawTeam?.id)
  if (!teamId || !channelId) return

  const context = getOverlayServerContext()
  const resolved = await context.surfaceService.resolveInboundBinding({
    platform: 'slack',
    externalTeamId: teamId,
    channelId,
  })
  if (!resolved) {
    if (args.replyWhenUnbound) {
      await thread.post(
        'No Overlay agent is connected to this channel yet — connect one from the agent editor in Overlay.',
      ).catch((error) => {
        logger.warn('[surfaces/slack] unbound-channel notice failed', {
          channelId,
          error: summarizeErrorForLog(error),
        })
      })
    }
    return
  }

  const text = stripSlackMentionMarkup(message.text ?? '')
  const { binding, agent, connection, creatorUserId, creatorPrincipalId } = resolved

  if (args.subscribe) {
    await thread.subscribe().catch((error) => {
      logger.warn('[surfaces/slack] thread subscribe failed', {
        threadId: thread.id,
        error: summarizeErrorForLog(error),
      })
    })
  }

  const placeholder = await postSlackAgentMessage({
    adapter,
    teamId,
    channelId,
    threadTs: threadTs || undefined,
    text: WORKING_PLACEHOLDER,
    agentName: agent.name,
  })

  const input: SurfaceAgentTurnInput = {
    userId: creatorUserId,
    name: agent.name,
    // Surface turns carry the raw inbound text; the runner skips automation
    // framing when `surface` is set.
    instructions: text || '(the sender mentioned you with no message text)',
    modelId: agent.modelId,
    turnId: `surface:slack:${binding.id}:${message.id}`,
    scheduledFor: Date.now(),
    workspaceId: connection.workspaceId,
    surface: {
      platform: 'slack',
      bindingId: binding.id,
      connectionId: connection.id,
      teamId,
      channelId,
      channelName: binding.channelName ?? undefined,
      threadId: threadTs || message.id,
      messageId: message.id,
      agentId: agent.id,
      agentName: agent.name,
      agentInstructions: agent.instructions,
      agentPrincipalId: agent.principalId,
      agentAllowedToolIds: agent.allowedToolIds,
      agentIsDefault: agent.isDefault === true,
      creatorPrincipalId,
      authorExternalId: message.author.userId,
      authorName: message.author.fullName || message.author.userName,
      authorEmail: message.author.email,
      authorStatus: await resolveSurfaceAuthorStatus({
        context,
        workspaceId: connection.workspaceId,
        email: message.author.email,
      }),
      placeholderTs: placeholder.ts,
    },
  }
  try {
    await start(surfaceAgentTurnWorkflow, [input])
  } catch (error) {
    logger.error('[surfaces/slack] failed to start surface turn workflow', {
      bindingId: binding.id,
      messageId: message.id,
      error: summarizeErrorForLog(error),
    })
    // The "working" placeholder is already up — turn it into an error note so
    // the thread doesn't look like the agent is still running.
    if (placeholder.ts) {
      await postSlackAgentMessage({
        adapter,
        teamId,
        channelId,
        text: 'Sorry — I could not start a run for that. Please try again.',
        agentName: agent.name,
        editTs: placeholder.ts,
      }).catch((_error) => undefined)
    }
  }
}

/**
 * Wires Slack message routing onto the Chat instance. Registered once, from
 * the webhook route — the singleton `Chat` is shared with the OAuth flow
 * which needs no handlers.
 */
export function registerSlackSurfaceHandlers(chat: SurfaceChat): void {
  chat.onNewMention(async (thread, message) => {
    await handleInboundSlackMessage({
      adapter: chat.getAdapter('slack'),
      thread,
      message,
      replyWhenUnbound: true,
      subscribe: true,
    })
  })
  chat.onSubscribedMessage(async (thread, message) => {
    await handleInboundSlackMessage({
      adapter: chat.getAdapter('slack'),
      thread,
      message,
      replyWhenUnbound: false,
      subscribe: false,
    })
  })
}

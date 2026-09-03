import 'server-only'

import { after } from 'next/server'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { logger } from '@/server/observability/logger'
import {
  resolveWorkspaceAgentInvocations,
  runWorkspaceAgentTurn,
} from '@/server/agents/workspace-agent-invocation'
import type { PlatformAgentAccess } from '@/server/agents/PlatformAgentAccess'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import type { WorkspaceGovernanceService } from '@/server/governance/WorkspaceGovernanceService'
import type { WorkspaceAgentService } from '@/server/agents/WorkspaceAgentService'
import {
  loadSlackWebhook,
  type PostSlackMessage,
  type SlackWebhookPayload,
} from './slack-adapter-modules'

export type SlackMentionWork = {
  teamId: string
  channelId: string
  threadTs: string
  text: string
  slackUserId: string
  eventId?: string
}

export type SlackBotDeps = {
  access: Pick<PlatformAgentAccess, 'openAgentDirectMessage'>
  collaboration: Pick<ConversationCollaborationRepository, 'addMessage'>
  governance: Pick<WorkspaceGovernanceService, 'resolvePlatformActor' | 'getPlatformInstallationByTeam'>
  workspaceAgents: Pick<WorkspaceAgentService, 'get' | 'list'>
  runTurn: typeof runWorkspaceAgentTurn
  resolveInvocations: typeof resolveWorkspaceAgentInvocations
  postMessage: PostSlackMessage
  decryptToken: (cipher: string) => string
  assertLimits: (args: { workspaceId: string; principalId: string; conversationId: string }) => Promise<void>
  /** Defers the turn past the ack. Defaults to Next's `after()`; tests inject a recorder. */
  scheduleWork?: (task: () => Promise<void>) => void
}

export type SlackSpikeConfig = {
  signingSecret?: string
  botToken?: string
  workspaceId?: string
  agentId?: string
}

export function slackSpikeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SlackSpikeConfig {
  return {
    signingSecret: env.SLACK_SIGNING_SECRET?.trim() || undefined,
    botToken: env.SLACK_BOT_TOKEN?.trim() || undefined,
    workspaceId: env.SLACK_SPIKE_WORKSPACE_ID?.trim() || undefined,
    agentId: env.SLACK_SPIKE_AGENT_ID?.trim() || undefined,
  }
}

/**
 * Single-workspace Slack webhook service (Phase B0/B1 transport).
 *
 * The route verifies the Slack signature, acknowledges retried deliveries
 * without re-running where the deterministic nonces converge, and schedules
 * the agent turn with `after()` so Slack gets its 200 inside the 3s window
 * while the turn runs to the function's limit. Every authorization decision —
 * install resolution, actor mapping, visibility, DM guards, usage gating —
 * happens in the shared services, never here.
 */
export class SlackWebhookService {
  constructor(private readonly deps: SlackBotDeps) {}

  async handleRequest(request: Request, config: SlackSpikeConfig): Promise<Response> {
    if (!config.signingSecret) {
      return Response.json({ error: 'Slack webhook is not configured' }, { status: 503 })
    }
    let payload: SlackWebhookPayload
    try {
      const { readSlackWebhook } = await loadSlackWebhook()
      payload = await readSlackWebhook(request, { signingSecret: config.signingSecret })
    } catch (_error) {
      void _error
      return Response.json({ error: 'Invalid Slack signature' }, { status: 401 })
    }
    if (payload.kind === 'url_verification') {
      return Response.json({ challenge: payload.challenge })
    }
    if (payload.kind !== 'app_mention' && payload.kind !== 'direct_message') {
      return Response.json({ received: true, handled: false })
    }
    if (!payload.userId || !payload.teamId) {
      return Response.json({ received: true, handled: false })
    }
    const work: SlackMentionWork = {
      teamId: payload.teamId,
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      text: payload.text,
      slackUserId: payload.userId,
      eventId: payload.eventId,
    }
    // Slack retries deliveries it did not get a fast 200 for. The turn
    // pipeline below is idempotent on the deterministic client nonce, so a
    // sequential retry converges instead of double-running; scheduling past
    // the ack keeps retries rare.
    const schedule = this.deps.scheduleWork ?? after
    schedule(() => this.handleMention(work, config).catch((error) => {
      logger.error('[slack-webhook] mention handling failed', {
        channelId: work.channelId,
        error,
        teamId: work.teamId,
      })
    }))
    return Response.json({ received: true, handled: true })
  }

  async handleMention(work: SlackMentionWork, config: SlackSpikeConfig): Promise<void> {
    const installation = await this.resolveInstallation(work.teamId, config)
    if (!installation) {
      logger.warn('[slack-webhook] no installation for team', { teamId: work.teamId })
      return
    }
    let actor: { principalId: string; userId: string }
    try {
      actor = await this.deps.governance.resolvePlatformActor({
        workspaceId: installation.workspaceId,
        directory: 'slack',
        externalId: work.slackUserId,
      })
    } catch (_error) {
      void _error
      // Unmapped Slack users get nothing — not even an error that would
      // confirm the bot is listening for this workspace.
      return
    }
    const agent = await this.resolveSpikeAgent(installation.workspaceId, actor.userId, config)
    if (!agent) return
    const directMessage = await this.deps.access.openAgentDirectMessage({
      workspaceId: installation.workspaceId,
      directory: 'slack',
      externalId: work.slackUserId,
      agentPrincipalId: agent.principalId,
    })
    const clientNonce = `slack:${work.teamId}:${work.channelId}:${work.threadTs}:${work.eventId ?? 'live'}`
    const turnId = `slack-turn:${clientNonce}`
    await this.deps.assertLimits({
      workspaceId: installation.workspaceId,
      principalId: actor.principalId,
      conversationId: directMessage.conversationId,
    })
    // `addMessage` dedupes on clientNonce, so a retried Slack delivery reuses
    // the same Overlay message row and the invocation nonce below stays
    // stable — the prior-reply guard then turns the retry into a no-op.
    const messageId = await this.deps.collaboration.addMessage({
      actorUserId: actor.userId,
      conversationId: directMessage.conversationId,
      workspaceId: installation.workspaceId,
      turnId,
      content: work.text,
      clientNonce,
    })
    const invocations = await this.deps.resolveInvocations({
      actorUserId: actor.userId,
      conversationId: directMessage.conversationId,
      messageId: String(messageId),
      workspaceId: installation.workspaceId,
    })
    const invocation = invocations.find((candidate) => candidate.agentId === agent.id)
    if (!invocation) return
    if (invocation.remoteTarget) {
      // Connected-agent (BYO) turns stream through the Agent Host session
      // lifecycle; the async post-back arrives in Phase B3.
      await this.deps.postMessage({
        channel: work.channelId,
        threadTs: work.threadTs,
        token: installation.botToken,
        text: 'Connected-agent runs from Slack are not enabled yet. Manage this agent in Overlay for now.',
      })
      return
    }
    const result = await this.deps.runTurn({
      actorUserId: actor.userId,
      agentId: invocation.agentId,
      conversationId: directMessage.conversationId,
      messageId: String(messageId),
      workspaceId: installation.workspaceId,
    })
    if (!result) return
    await this.deps.postMessage({
      channel: work.channelId,
      threadTs: work.threadTs,
      token: installation.botToken,
      markdownText: result.content.slice(0, 3_900),
    })
  }

  private async resolveInstallation(teamId: string, config: SlackSpikeConfig) {
    const record = await this.deps.governance.getPlatformInstallationByTeam({
      directory: 'slack',
      externalTeamId: teamId,
    }).catch((_error) => null)
    if (record) {
      try {
        return { workspaceId: record.workspaceId, botToken: this.deps.decryptToken(record.botTokenCipher) }
      } catch (decryptError) {
        logger.error('[slack-webhook] install token undecryptable', { teamId, error: decryptError })
        return null
      }
    }
    // B0 single-workspace fallback: one env token serving one workspace.
    if (config.botToken && config.workspaceId) {
      return { workspaceId: config.workspaceId, botToken: config.botToken }
    }
    return null
  }

  private async resolveSpikeAgent(
    workspaceId: string,
    actorUserId: string,
    config: SlackSpikeConfig,
  ): Promise<WorkspaceAgentDirectoryItem | null> {
    // B0 pins one agent via env; B1+ resolves per-workspace defaults here.
    // `get` enforces visibility, so a creator-only agent stays creator-only.
    if (!config.agentId) return null
    try {
      return await this.deps.workspaceAgents.get({ actorUserId, workspaceId, agentId: config.agentId })
    } catch (_error) {
      void _error
      return null
    }
  }
}

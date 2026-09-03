import 'server-only'

import { after } from 'next/server'
import type {
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentListResponse,
} from '@overlay/workspace-contracts'
import { logger } from '@/server/observability/logger'
import {
  resolveWorkspaceAgentInvocations,
  runWorkspaceAgentTurn,
} from '@/server/agents/workspace-agent-invocation'
import type { PlatformAgentAccess } from '@/server/agents/PlatformAgentAccess'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import type { WorkspaceGovernanceService } from '@/server/governance/WorkspaceGovernanceService'
import type { WorkspaceAgentService } from '@/server/agents/WorkspaceAgentService'
import type { AuditService } from '@/server/admin/AuditService'
import {
  loadSlackWebhook,
  type PostSlackEphemeral,
  type PostSlackMessage,
  type SlackWebhookPayload,
} from './slack-adapter-modules'
import {
  parseOverlayCommand,
  resolveMentionedAgent,
} from './slack-agent-resolution'
import {
  buildAgentReplyBlocks,
  buildAgentsDirectoryBlocks,
  buildHelpBlocks,
  manageAgentUrl,
  MANAGE_ACTION_ID,
} from './slack-reply-blocks'

export type SlackMentionWork = {
  teamId: string
  channelId: string
  threadTs: string
  text: string
  slackUserId: string
  eventId?: string
}

export type SlackSlashWork = {
  teamId?: string
  channelId: string
  text: string
  slackUserId: string
  command: string
  triggerId?: string
}

export type SlackActionWork = {
  teamId?: string
  channelId?: string
  slackUserId: string
  agentId?: string
}

export type SlackBotDeps = {
  access: Pick<PlatformAgentAccess, 'openAgentDirectMessage'>
  collaboration: Pick<ConversationCollaborationRepository, 'addMessage'>
  governance: Pick<WorkspaceGovernanceService, 'resolvePlatformActor' | 'getPlatformInstallationByTeam'>
  workspaceAgents: Pick<WorkspaceAgentService, 'get' | 'list'>
  audit: Pick<AuditService, 'record'>
  runTurn: typeof runWorkspaceAgentTurn
  resolveInvocations: typeof resolveWorkspaceAgentInvocations
  postMessage: PostSlackMessage
  postEphemeral: PostSlackEphemeral
  decryptToken: (cipher: string) => string
  baseUrl: () => string
  assertLimits: (args: { workspaceId: string; principalId: string; conversationId: string }) => Promise<void>
  /** Defers the turn past the ack. Defaults to Next's `after()`; tests inject a recorder. */
  scheduleWork?: (task: () => Promise<void>) => void
}

export type SlackSpikeConfig = {
  signingSecret?: string
  botToken?: string
  workspaceId?: string
}

export function slackSpikeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SlackSpikeConfig {
  return {
    signingSecret: env.SLACK_SIGNING_SECRET?.trim() || undefined,
    botToken: env.SLACK_BOT_TOKEN?.trim() || undefined,
    workspaceId: env.SLACK_SPIKE_WORKSPACE_ID?.trim() || undefined,
  }
}

type ResolvedInstall = { workspaceId: string; botToken: string }
type ResolvedActor = { principalId: string; userId: string }
type AgentContext = {
  installation: ResolvedInstall
  actor: ResolvedActor
  slackUserId: string
}

/**
 * Slack transport (low-level webhook/API subpaths, no `Chat` class yet).
 *
 * The route verifies the Slack signature, acknowledges everything inside the
 * 3s window, and schedules the work past the ack. Every authorization
 * decision — install resolution, actor mapping, visibility, DM guards, usage
 * gating — happens in the shared services, never here.
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
    } catch (_verifyError) {
      void _verifyError
      return Response.json({ error: 'Invalid Slack signature' }, { status: 401 })
    }
    if (payload.kind === 'url_verification') {
      return Response.json({ challenge: payload.challenge })
    }
    const schedule = this.deps.scheduleWork ?? after
    if (payload.kind === 'slash_command') {
      if (!payload.teamId || !payload.userId) return Response.json({ received: true, handled: false })
      const work: SlackSlashWork = {
        teamId: payload.teamId,
        channelId: payload.channelId,
        text: payload.text,
        slackUserId: payload.userId,
        command: payload.command,
        triggerId: payload.triggerId,
      }
      schedule(() => this.failSilent(work, () => this.handleSlash(work, config)))
      return Response.json({ received: true, handled: true })
    }
    if (payload.kind === 'block_actions') {
      const action = payload.actions[0]
      if (payload.teamId && payload.userId && action?.actionId === MANAGE_ACTION_ID && action.value) {
        const work: SlackActionWork = {
          teamId: payload.teamId,
          channelId: payload.channelId,
          slackUserId: payload.userId,
          agentId: action.value,
        }
        schedule(() => this.failSilent(work, () => this.handleManageAction(work, config)))
        return Response.json({ received: true, handled: true })
      }
      return Response.json({ received: true, handled: false })
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
    // sequential retry converges instead of double-running.
    schedule(() => this.failSilent(work, () => this.handleMention(work, config)))
    return Response.json({ received: true, handled: true })
  }

  async handleMention(work: SlackMentionWork, config: SlackSpikeConfig): Promise<void> {
    const context = await this.resolveAgentContext(work.teamId, work.slackUserId, config)
    if (!context) return
    const directory = await this.visibleDirectory(context)
    if (!directory) return
    const agent = resolveMentionedAgent({ text: work.text, visibleAgents: directory.agents })
    if (!agent) return
    await this.invokeAgentAndPost({
      ...context,
      agent,
      prompt: work.text,
      nonce: `slack:${work.teamId}:${work.channelId}:${work.threadTs}:${work.eventId ?? 'live'}`,
      deliver: (blocks, fallback) => this.deps.postMessage({
        channel: work.channelId,
        threadTs: work.threadTs,
        token: context.installation.botToken,
        text: fallback,
        blocks,
      }).then(() => undefined),
    })
  }

  async handleSlash(work: SlackSlashWork, config: SlackSpikeConfig): Promise<void> {
    if (!work.teamId) return
    const context = await this.resolveAgentContext(work.teamId, work.slackUserId, config)
    if (!context) return
    const directory = await this.visibleDirectory(context)
    if (!directory) return
    const parsed = parseOverlayCommand({ command: work.command, text: work.text })
    if (parsed.action === 'agents' || parsed.action === 'help') {
      const built = parsed.action === 'agents'
        ? buildAgentsDirectoryBlocks({
          agents: directory.agents,
          workspaceId: context.installation.workspaceId,
          baseUrl: this.deps.baseUrl(),
        })
        : buildHelpBlocks()
      await this.deps.postEphemeral({
        channel: work.channelId,
        user: work.slackUserId,
        token: context.installation.botToken,
        text: built.fallback,
        blocks: built.blocks,
      })
      return
    }
    const agent = resolveMentionedAgent({ text: parsed.query, visibleAgents: directory.agents })
    if (!agent) return
    await this.invokeAgentAndPost({
      ...context,
      agent,
      prompt: parsed.query,
      nonce: `slack:${work.teamId}:${work.channelId}:${work.triggerId ?? 'slash'}`,
      deliver: (blocks, fallback) => this.deps.postMessage({
        channel: work.channelId,
        token: context.installation.botToken,
        text: fallback,
        blocks,
      }).then(() => undefined),
    })
  }

  /**
   * Manage-button click: the conversion event. Recorded to the audit log with
   * the mapped user, then answered with an ephemeral message carrying the
   * direct deep link (link buttons never dispatch, so the click must arrive
   * here for the event to exist).
   */
  async handleManageAction(work: SlackActionWork, config: SlackSpikeConfig): Promise<void> {
    if (!work.teamId || !work.channelId || !work.agentId) return
    const context = await this.resolveAgentContext(work.teamId, work.slackUserId, config)
    if (!context) return
    let agent: WorkspaceAgentDirectoryItem | null = null
    try {
      agent = await this.deps.workspaceAgents.get({
        actorUserId: context.actor.userId,
        workspaceId: context.installation.workspaceId,
        agentId: work.agentId,
      })
    } catch (_invisibleError) {
      void _invisibleError
      return
    }
    if (!agent) return
    const url = manageAgentUrl({
      baseUrl: this.deps.baseUrl(),
      workspaceId: context.installation.workspaceId,
      agentId: agent.id,
    })
    await this.deps.audit.record({
      action: 'slack.manage_link_click',
      actorType: 'user',
      actorUserId: context.actor.userId,
      resourceType: 'agent',
      resourceId: agent.id,
      outcome: 'success',
      metadata: {
        workspaceId: context.installation.workspaceId,
        directory: 'slack',
        externalTeamId: work.teamId,
        channelId: work.channelId,
      },
    }).catch((_auditError) => {
      logger.warn('[slack-webhook] manage-link audit failed', { error: _auditError })
    })
    await this.deps.postEphemeral({
      channel: work.channelId,
      user: work.slackUserId,
      token: context.installation.botToken,
      text: `Manage ${agent.name} in Overlay: ${url}`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `<${url}|Manage *${agent.name}* in Overlay>` },
      }],
    })
  }

  private async failSilent(work: { teamId?: string; channelId?: string }, task: () => Promise<void>) {
    try {
      await task()
    } catch (error) {
      logger.error('[slack-webhook] handling failed', {
        channelId: work.channelId,
        error,
        teamId: work.teamId,
      })
    }
  }

  private async resolveAgentContext(teamId: string, slackUserId: string, config: SlackSpikeConfig) {
    const installation = await this.resolveInstallation(teamId, config)
    if (!installation) {
      logger.warn('[slack-webhook] no installation for team', { teamId })
      return null
    }
    let actor: ResolvedActor
    try {
      actor = await this.deps.governance.resolvePlatformActor({
        workspaceId: installation.workspaceId,
        directory: 'slack',
        externalId: slackUserId,
      })
    } catch (_unmappedError) {
      void _unmappedError
      // Unmapped Slack users get nothing — not even an error that would
      // confirm the bot is listening for this workspace.
      return null
    }
    return { installation, actor, slackUserId }
  }

  private async visibleDirectory(
    context: AgentContext & { installation: ResolvedInstall },
  ): Promise<WorkspaceAgentListResponse | null> {
    return await this.deps.workspaceAgents.list({
      actorUserId: context.actor.userId,
      workspaceId: context.installation.workspaceId,
    }).catch((_listError) => {
      void _listError
      return null
    })
  }

  private async invokeAgentAndPost(args: AgentContext & {
    installation: ResolvedInstall
    agent: WorkspaceAgentDirectoryItem
    prompt: string
    nonce: string
    deliver: (blocks: unknown[], fallback: string) => Promise<void>
  }): Promise<void> {
    const directMessage = await this.deps.access.openAgentDirectMessage({
      workspaceId: args.installation.workspaceId,
      directory: 'slack',
      externalId: args.slackUserId,
      agentPrincipalId: args.agent.principalId,
    })
    await this.deps.assertLimits({
      workspaceId: args.installation.workspaceId,
      principalId: args.actor.principalId,
      conversationId: directMessage.conversationId,
    })
    // `addMessage` dedupes on clientNonce, so a retried Slack delivery reuses
    // the same Overlay message row and the invocation nonce below stays
    // stable — the prior-reply guard then turns the retry into a no-op.
    const messageId = await this.deps.collaboration.addMessage({
      actorUserId: args.actor.userId,
      conversationId: directMessage.conversationId,
      workspaceId: args.installation.workspaceId,
      turnId: `slack-turn:${args.nonce}`,
      content: args.prompt,
      clientNonce: args.nonce,
    })
    const invocations = await this.deps.resolveInvocations({
      actorUserId: args.actor.userId,
      conversationId: directMessage.conversationId,
      messageId: String(messageId),
      workspaceId: args.installation.workspaceId,
    })
    const invocation = invocations.find((candidate) => candidate.agentId === args.agent.id)
    if (!invocation) return
    if (invocation.remoteTarget) {
      // Connected-agent (BYO) turns stream through the Agent Host session
      // lifecycle; the async post-back arrives with the `Chat` class in B4.
      await args.deliver([{
        type: 'section',
        text: { type: 'mrkdwn', text: 'Connected-agent runs from Slack are not enabled yet. Manage this agent in Overlay for now.' },
      }], 'Connected-agent runs from Slack are not enabled yet.')
      return
    }
    const result = await this.deps.runTurn({
      actorUserId: args.actor.userId,
      agentId: invocation.agentId,
      conversationId: directMessage.conversationId,
      messageId: String(messageId),
      workspaceId: args.installation.workspaceId,
    })
    if (!result) return
    const built = buildAgentReplyBlocks({ text: result.content, agentId: args.agent.id })
    await args.deliver(built.blocks, built.fallback)
  }

  private async resolveInstallation(teamId: string, config: SlackSpikeConfig) {
    const record = await this.deps.governance.getPlatformInstallationByTeam({
      directory: 'slack',
      externalTeamId: teamId,
    }).catch((_lookupError) => {
      void _lookupError
      return null
    })
    if (record) {
      try {
        return { workspaceId: record.workspaceId, botToken: this.deps.decryptToken(record.botTokenCipher) }
      } catch (decryptError) {
        logger.error('[slack-webhook] install token undecryptable', { teamId, error: decryptError })
        return null
      }
    }
    // Single-workspace fallback: one env token serving one workspace.
    if (config.botToken && config.workspaceId) {
      return { workspaceId: config.workspaceId, botToken: config.botToken }
    }
    return null
  }
}

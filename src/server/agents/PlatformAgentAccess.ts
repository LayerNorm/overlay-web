import 'server-only'

import type {
  DirectMessageSummary,
  WorkspaceAgentListResponse,
} from '@overlay/workspace-contracts'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import type { WorkspaceGovernanceService } from '@/server/governance/WorkspaceGovernanceService'
import type { WorkspaceAgentService } from './WorkspaceAgentService'

/**
 * Chat-platform directories with a bot-surface contract. Transport-agnostic:
 * any platform links identities under its own directory string via the
 * manager-gated `linkDirectoryIdentity`; these are the directories Overlay
 * ships bot handling for first.
 */
export const PLATFORM_AGENT_DIRECTORIES = ['slack', 'msteams'] as const
export type PlatformAgentDirectory = (typeof PLATFORM_AGENT_DIRECTORIES)[number]

export type PlatformActorRef = {
  workspaceId: string
  /** Platform directory the external user id belongs to (e.g. 'slack'). */
  directory: string
  /** Platform-native user id (e.g. a Slack `U…` id). */
  externalId: string
}

/**
 * The single seam between chat-platform bots (Slack, Teams, …) and Overlay
 * agents. Every method resolves the platform user to its linked workspace
 * principal first, then calls the same services the first-party clients use —
 * so directory visibility, DM guards, and mention resolution (including
 * creator-only agents) behave identically inside and outside Overlay.
 * Unmapped platform users are rejected before any agent surface is touched.
 *
 * Out of scope here on purpose: the bot processes themselves, platform OAuth
 * and install/token storage, and hosting. Those arrive with the Chat SDK bot;
 * this module is the contract it programs against.
 */
export class PlatformAgentAccess {
  constructor(private readonly deps: {
    governance: Pick<WorkspaceGovernanceService, 'resolvePlatformActor'>
    workspaceAgents: Pick<WorkspaceAgentService, 'assertDirectMessageTargets' | 'list'>
    collaboration: Pick<ConversationCollaborationRepository, 'createDirectMessage'>
  }) {}

  /** Agents the platform user may see — creator-only agents limited to their creator. */
  async listAgents(args: PlatformActorRef): Promise<WorkspaceAgentListResponse> {
    const actor = await this.deps.governance.resolvePlatformActor(args)
    return await this.deps.workspaceAgents.list({ actorUserId: actor.userId, workspaceId: args.workspaceId })
  }

  /**
   * Opens (or reuses) a one-to-one DM between the platform user and an agent.
   * Rejects with the services' `not_found` when the agent is invisible to the
   * caller, so bot transports can map the failure to a silent no-op without
   * disclosing whether the agent exists.
   */
  async openAgentDirectMessage(args: PlatformActorRef & {
    agentPrincipalId: string
    title?: string
  }): Promise<DirectMessageSummary> {
    const actor = await this.deps.governance.resolvePlatformActor(args)
    await this.deps.workspaceAgents.assertDirectMessageTargets({
      actorUserId: actor.userId,
      workspaceId: args.workspaceId,
      principalIds: [args.agentPrincipalId],
    })
    return await this.deps.collaboration.createDirectMessage({
      actorUserId: actor.userId,
      workspaceId: args.workspaceId,
      principalIds: [args.agentPrincipalId],
      ...(args.title === undefined ? {} : { title: args.title }),
    })
  }
}

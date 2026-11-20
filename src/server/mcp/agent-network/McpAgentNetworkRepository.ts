import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { AgentLineage } from '@/shared/agents/agent-lineage'

export type McpAgentJoinStatus = 'pending' | 'approved' | 'declined' | 'removed'

export type McpAgentJoin = {
  id: string
  grantId: string
  userId: string
  workspaceId: string
  name: string
  description?: string
  status: McpAgentJoinStatus
  agentId?: string
  principalId?: string
  pausedAt?: number
  requestedAt: number
  decidedAt?: number
  lastSeenAt?: number
}

export type McpInboxItem = {
  id: string
  conversationId: string
  messageId: string
  turnId: string
  actorUserId: string
  fromName: string
  fromKind: 'person' | 'agent'
  text: string
  lineage?: AgentLineage
  threadRootMessageId?: string
  createdAt: number
  deliveredAt?: number
  repliedAt?: number
}

export type McpAgentPresence = { agentId: string; lastSeenAt?: number; paused: boolean; ownerUserId: string }

export interface McpAgentNetworkRepository {
  getJoinByGrant(grantId: string): Promise<McpAgentJoin | null>
  getJoin(joinId: string): Promise<McpAgentJoin | null>
  listJoins(workspaceId: string): Promise<McpAgentJoin[]>
  requestJoin(args: { grantId: string; userId: string; workspaceId: string; name: string; description?: string; maxOpen: number; now: number }): Promise<{ ok: boolean; reason?: string; join?: McpAgentJoin }>
  decideJoin(args: { joinId: string; workspaceId: string; decidedByUserId: string; decision: 'approved' | 'declined'; agentId?: string; principalId?: string; now: number }): Promise<McpAgentJoin | null>
  updateJoin(args: { joinId: string; workspaceId: string; action: 'pause' | 'resume' | 'remove'; now: number }): Promise<McpAgentJoin | null>
  removeJoinByGrant(args: { grantId: string; now: number }): Promise<McpAgentJoin | null>
  touchPresence(args: { joinId: string; now: number }): Promise<void>
  presence(agentIds: string[]): Promise<McpAgentPresence[]>
  enqueue(args: {
    agentId: string; workspaceId: string; conversationId: string; messageId: string; turnId: string; actorUserId: string
    fromName: string; fromKind: 'person' | 'agent'; text: string; lineage?: AgentLineage; threadRootMessageId?: string; now: number
  }): Promise<{ queued: boolean; lastSeenAt?: number; paused: boolean }>
  notifyOwnerAway(args: { agentId: string; ownerPrincipalId: string; conversationId: string; fromName: string; now: number }): Promise<boolean>
  countUnread(args: { agentId: string; now: number }): Promise<number>
  collect(args: { agentId: string; onlyNew: boolean; limit: number; now: number }): Promise<McpInboxItem[]>
  getInboxItem(args: { agentId: string; itemId: string }): Promise<McpInboxItem | null>
  markReplied(args: { agentId: string; itemId: string; now: number }): Promise<boolean>
  latestDelivered(args: { agentId: string; since: number }): Promise<McpInboxItem | null>
  deleteAllForUser(userId: string): Promise<number>
}

const call = { throwOnError: true } as const
const secret = () => ({ serverSecret: getInternalApiSecret() })

export class ConvexMcpAgentNetworkRepository implements McpAgentNetworkRepository {
  async getJoinByGrant(grantId: string) {
    return await convex.query<McpAgentJoin | null>('mcp/agentNetwork:getJoinByGrantByServer', { ...secret(), grantId }, call)
  }
  async getJoin(joinId: string) {
    return await convex.query<McpAgentJoin | null>('mcp/agentNetwork:getJoinByServer', { ...secret(), joinId }, call)
  }
  async listJoins(workspaceId: string) {
    return (await convex.query<McpAgentJoin[]>('mcp/agentNetwork:listJoinsByWorkspaceByServer', { ...secret(), workspaceId }, call)) ?? []
  }
  async requestJoin(args: Parameters<McpAgentNetworkRepository['requestJoin']>[0]) {
    return (await convex.mutation<{ ok: boolean; reason?: string; join?: McpAgentJoin }>('mcp/agentNetwork:requestJoinByServer', { ...secret(), ...args }, call)) ?? { ok: false, reason: 'unavailable' }
  }
  async decideJoin(args: Parameters<McpAgentNetworkRepository['decideJoin']>[0]) {
    return await convex.mutation<McpAgentJoin | null>('mcp/agentNetwork:decideJoinByServer', { ...secret(), ...args }, call)
  }
  async updateJoin(args: Parameters<McpAgentNetworkRepository['updateJoin']>[0]) {
    return await convex.mutation<McpAgentJoin | null>('mcp/agentNetwork:updateJoinByServer', { ...secret(), ...args }, call)
  }
  async removeJoinByGrant(args: { grantId: string; now: number }) {
    return await convex.mutation<McpAgentJoin | null>('mcp/agentNetwork:removeJoinByGrantByServer', { ...secret(), ...args }, call)
  }
  async touchPresence(args: { joinId: string; now: number }) {
    await convex.mutation('mcp/agentNetwork:touchPresenceByServer', { ...secret(), ...args }, call)
  }
  async presence(agentIds: string[]) {
    return (await convex.query<McpAgentPresence[]>('mcp/agentNetwork:presenceByAgentsByServer', { ...secret(), agentIds }, call)) ?? []
  }
  async enqueue(args: Parameters<McpAgentNetworkRepository['enqueue']>[0]) {
    return (await convex.mutation<{ queued: boolean; lastSeenAt?: number; paused: boolean }>('mcp/agentNetwork:enqueueInboxByServer', { ...secret(), ...args }, call)) ?? { queued: false, paused: false }
  }
  async notifyOwnerAway(args: Parameters<McpAgentNetworkRepository['notifyOwnerAway']>[0]) {
    return Boolean(await convex.mutation<boolean>('mcp/agentNetwork:notifyOwnerAwayByServer', { ...secret(), ...args }, call))
  }
  async countUnread(args: { agentId: string; now: number }) {
    return (await convex.query<number>('mcp/agentNetwork:countUnreadByServer', { ...secret(), ...args }, call)) ?? 0
  }
  async collect(args: { agentId: string; onlyNew: boolean; limit: number; now: number }) {
    return (await convex.mutation<McpInboxItem[]>('mcp/agentNetwork:collectInboxByServer', { ...secret(), ...args }, call)) ?? []
  }
  async getInboxItem(args: { agentId: string; itemId: string }) {
    return await convex.query<McpInboxItem | null>('mcp/agentNetwork:getInboxItemByServer', { ...secret(), ...args }, call)
  }
  async markReplied(args: { agentId: string; itemId: string; now: number }) {
    return Boolean(await convex.mutation<boolean>('mcp/agentNetwork:markRepliedByServer', { ...secret(), ...args }, call))
  }
  async latestDelivered(args: { agentId: string; since: number }) {
    return await convex.query<McpInboxItem | null>('mcp/agentNetwork:latestDeliveredByServer', { ...secret(), ...args }, call)
  }
  async deleteAllForUser(userId: string) {
    return (await convex.mutation<number>('mcp/agentNetwork:deleteAllByUserByServer', { ...secret(), userId }, call)) ?? 0
  }
}

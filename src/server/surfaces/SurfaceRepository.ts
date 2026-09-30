import 'server-only'

import type { SurfaceBinding, SurfaceConnection, SurfacePlatform } from '@overlay/workspace-contracts'

export interface SurfaceRepository {
  /** Insert-or-refresh keyed on (platform, externalTeamId). Never moves a connection between Overlay workspaces. */
  upsertConnection(row: SurfaceConnection): Promise<SurfaceConnection>
  getConnection(id: string): Promise<SurfaceConnection | null>
  findConnectionByTeam(platform: SurfacePlatform, externalTeamId: string): Promise<SurfaceConnection | null>
  listConnections(workspaceId: string): Promise<SurfaceConnection[]>
  updateConnection(id: string, patch: Partial<SurfaceConnection>): Promise<SurfaceConnection>
  /** One binding row per (connectionId, channelId, agentId); reactivates a removed row on re-bind. */
  createBinding(row: SurfaceBinding): Promise<SurfaceBinding>
  getBinding(id: string): Promise<SurfaceBinding | null>
  /** Every binding row in a channel, any status — several agents may share one. */
  listBindingsByChannel(connectionId: string, channelId: string): Promise<SurfaceBinding[]>
  listBindingsByAgent(agentId: string): Promise<SurfaceBinding[]>
  listBindingsByConnection(connectionId: string): Promise<SurfaceBinding[]>
  updateBinding(id: string, patch: Partial<SurfaceBinding>): Promise<SurfaceBinding>
  /**
   * Find-or-create the conversation for a surface thread. Atomic: callers can
   * race two inbound messages for the same platform thread and still get one
   * conversation. Deleted mappings stay deleted — a new live row is created.
   */
  ensureConversation(args: SurfaceConversationInput): Promise<string>
}

export type SurfaceConversationInput = {
  actModelId: string
  askModelIds: string[]
  externalChannelId: string
  externalPlatform: string
  externalThreadId: string
  surfaceBindingId: string
  title: string
  userId: string
  conversationType?: 'personal' | 'dm' | 'channel'
  createdByPrincipalId?: string
  agentPrincipalId?: string
  lastMode?: 'ask' | 'act'
  workspaceId?: string
}

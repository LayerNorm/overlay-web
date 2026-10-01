export const SURFACE_PLATFORMS = ['slack'] as const
export type SurfacePlatform = (typeof SURFACE_PLATFORMS)[number]

export const SURFACE_CONNECTION_STATUSES = ['active', 'degraded', 'uninstalled'] as const
export type SurfaceConnectionStatus = (typeof SURFACE_CONNECTION_STATUSES)[number]

export const SURFACE_BINDING_STATUSES = ['active', 'removed'] as const
export type SurfaceBindingStatus = (typeof SURFACE_BINDING_STATUSES)[number]

/**
 * One external platform installation — the Overlay Slack app installed into a
 * customer workspace. Bot tokens are resolved through the Chat SDK state
 * adapter keyed on externalTeamId; this row is metadata and ownership only.
 * (platform, externalTeamId) is globally unique: a Slack workspace maps to at
 * most one Overlay workspace so message routing stays unambiguous.
 */
export type SurfaceConnection = {
  id: string
  workspaceId: string
  platform: SurfacePlatform
  /** Platform install key — Slack team_id, or enterprise_id for org installs. */
  externalTeamId: string
  externalTeamName: string | null
  externalEnterpriseId: string | null
  botUserId: string | null
  status: SurfaceConnectionStatus
  installedByUserId: string
  createdAt: number
  updatedAt: number
}

/**
 * Binds an agent to a channel on a connected platform. Channel membership is
 * the access policy: anyone in the channel can reach the agent, and the agent
 * acts with its creator's authority.
 */
export type SurfaceBinding = {
  id: string
  connectionId: string
  agentId: string
  channelId: string
  channelName: string | null
  status: SurfaceBindingStatus
  createdByUserId: string
  createdAt: number
  updatedAt: number
}

/** One bindable channel on a connected platform (Slack conversations.list). */
export type SurfaceChannelOption = {
  id: string
  name: string
  /**
   * Whether the platform bot is already in the channel (Slack `is_member`).
   * Binding is still allowed when false — the bot must be invited before it
   * can see or answer messages there.
   */
  isMember?: boolean
}

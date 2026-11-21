import type { LocalThread } from '@overlay/desktop-bridge'

export type { LocalThread }

/** What a private thread needs from its agent: the instructions the person gave it and how it looks. */
export type WorkspaceAgentLike = {
  id: string
  name: string
  instructions?: string
  /** The agent's model in Overlay's catalog; a private thread runs it with the person's key. */
  modelId: string
  avatarColor?: string
  avatarShape?: string
  agentRole?: string
  isDefault?: boolean
}

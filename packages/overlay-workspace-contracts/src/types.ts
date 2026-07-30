export const WORKSPACE_KINDS = ['personal', 'organization'] as const
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number]

export const WORKSPACE_STATUSES = ['active', 'archived'] as const
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number]

export const WORKSPACE_PRINCIPAL_TYPES = ['human', 'agent', 'service'] as const
export type WorkspacePrincipalType = (typeof WORKSPACE_PRINCIPAL_TYPES)[number]

export const WORKSPACE_MEMBERSHIP_ROLES = ['owner', 'admin', 'member', 'guest'] as const
export type WorkspaceMembershipRole = (typeof WORKSPACE_MEMBERSHIP_ROLES)[number]

export const WORKSPACE_MEMBERSHIP_STATUSES = ['active', 'suspended'] as const
export type WorkspaceMembershipStatus = (typeof WORKSPACE_MEMBERSHIP_STATUSES)[number]

export const WORKSPACE_INVITATION_STATUSES = [
  'pending',
  'accepted',
  'expired',
  'cancelled',
  'replaced',
] as const
export type WorkspaceInvitationStatus = (typeof WORKSPACE_INVITATION_STATUSES)[number]

export const TEAM_MEMBER_PRINCIPAL_TYPES = ['human', 'agent'] as const
export type TeamMemberPrincipalType = (typeof TEAM_MEMBER_PRINCIPAL_TYPES)[number]

export type Workspace = {
  id: string
  kind: WorkspaceKind
  name: string
  slug: string
  status: WorkspaceStatus
  createdByPrincipalId?: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export type WorkspacePrincipal = {
  id: string
  workspaceId: string
  type: WorkspacePrincipalType
  /** The global account backing a human principal. */
  userId?: string
  /** Stable workspace-local identity for a reusable named agent. */
  agentId?: string
  /** Stable workspace-local identity for an integration or machine actor. */
  serviceId?: string
  displayName: string
  email?: string
  createdByPrincipalId?: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export type WorkspaceMembership = {
  workspaceId: string
  principalId: string
  role: WorkspaceMembershipRole
  status: WorkspaceMembershipStatus
  invitedByPrincipalId?: string
  joinedAt: number
  updatedAt: number
}

export type WorkspaceTeam = {
  id: string
  workspaceId: string
  name: string
  description?: string
  createdByPrincipalId: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export type WorkspaceTeamMember = {
  teamId: string
  workspaceId: string
  principalId: string
  principalType: TeamMemberPrincipalType
  addedByPrincipalId?: string
  createdAt: number
}

export type WorkspaceInvitation = {
  id: string
  workspaceId: string
  email: string
  role: Exclude<WorkspaceMembershipRole, 'owner'>
  status: WorkspaceInvitationStatus
  invitedByPrincipalId: string
  acceptedByPrincipalId?: string
  replacedByInvitationId?: string
  expiresAt: number
  createdAt: number
  updatedAt: number
  acceptedAt?: number
  cancelledAt?: number
  replacedAt?: number
}

export type WorkspaceResourceGuest = {
  id: string
  workspaceId: string
  resourceType: string
  resourceId: string
  principalId: string
  accessRole: 'viewer' | 'editor'
  status: 'pending' | 'active' | 'expired' | 'revoked'
  grantedByPrincipalId: string
  expiresAt?: number
  createdAt: number
  updatedAt: number
  revokedAt?: number
}

/**
 * Canonical workspace ownership for a resource. Resource-specific tables may
 * also carry workspaceId for efficient list queries; this registry is the
 * provider-neutral source of truth for single-resource authorization.
 */
export type WorkspaceResourceScope = {
  workspaceId: string
  resourceType: string
  resourceId: string
  createdAt: number
  updatedAt: number
}

export type WorkspaceAccess = {
  workspace: Workspace
  principal: WorkspacePrincipal
  membership: WorkspaceMembership
}

export type WorkspaceMember = {
  principal: WorkspacePrincipal
  membership: WorkspaceMembership
}

export type WorkspaceTeamWithMembers = {
  team: WorkspaceTeam
  members: WorkspaceTeamMember[]
}

export type WorkspaceSummary = {
  id: string
  name: string
  slug: string
  kind: WorkspaceKind
  status: WorkspaceStatus
  role: WorkspaceMembershipRole
  memberCount?: number
}

export type WorkspaceListResponse = {
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: string
}

export type WorkspaceCreateInput = {
  name: string
  slug?: string
}

export type WorkspaceCreateResponse = {
  workspace: WorkspaceSummary
}

export type WorkspaceActivateResponse = {
  activeWorkspaceId: string
  workspace: WorkspaceSummary
}

export type WorkspaceManagementView =
  | 'people'
  | 'teams'
  | 'guests'
  | 'roles'
  | 'chats-agents'

export type WorkspaceManagementItem = {
  id: string
  kind: 'invitation' | 'member' | 'role' | 'team'
  name: string
  description?: string
  detail?: string
  badge?: string
  principalId?: string
  principalType?: WorkspacePrincipalType
  role?: WorkspaceMembershipRole
  status?: WorkspaceMembershipStatus | WorkspaceInvitationStatus
  invitationId?: string
  teamMemberPrincipalIds?: string[]
}

export type WorkspaceManagementResponse = {
  canManage: boolean
  currentPrincipalId: string
  currentRole: WorkspaceMembershipRole
  items: WorkspaceManagementItem[]
  workspaceKind: WorkspaceKind
}

export type WorkspaceInviteInput = {
  email: string
  role: Exclude<WorkspaceMembershipRole, 'owner'>
}

export type WorkspaceInviteResponse = {
  invitation: WorkspaceInvitation
  invitePath: string
}

export type WorkspaceInvitationListResponse = {
  invitations: WorkspaceInvitation[]
}

export type WorkspaceInvitationAcceptResponse = {
  activeWorkspaceId: string
  workspace: WorkspaceSummary
}

export type WorkspaceMemberMutationInput =
  | {
    action: 'set-role'
    principalId: string
    role: WorkspaceMembershipRole
  }
  | {
    action: 'set-status'
    principalId: string
    status: WorkspaceMembershipStatus
  }
  | {
    action: 'transfer-ownership'
    principalId: string
  }

export type WorkspaceMemberMutationResponse = {
  membership: WorkspaceMembership
}

export type WorkspaceTeamCreateInput = {
  name: string
  description?: string
}

export type WorkspaceTeamCreateResponse = {
  team: WorkspaceTeam
}

export type WorkspaceTeamMemberMutationInput = {
  principalId: string
}

export type WorkspaceTeamMemberMutationResponse = {
  member: WorkspaceTeamMember
}

export type WorkspaceArchiveResponse = {
  workspace: Workspace
}

export const CONVERSATION_PARTICIPANT_ROLES = ['member', 'moderator'] as const
export type ConversationParticipantRole = (typeof CONVERSATION_PARTICIPANT_ROLES)[number]

export const CONVERSATION_NOTIFICATION_LEVELS = ['all', 'mentions', 'muted'] as const
export type ConversationNotificationLevel = (typeof CONVERSATION_NOTIFICATION_LEVELS)[number]

export type ConversationParticipant = {
  conversationId: string
  workspaceId: string
  principalId: string
  principalType: Extract<WorkspacePrincipalType, 'human' | 'agent'>
  displayName: string
  email?: string
  role: ConversationParticipantRole
  status: 'active' | 'removed'
  notificationLevel: ConversationNotificationLevel
  joinedAt: number
  updatedAt: number
  removedAt?: number
  lastReadAt?: number
  markedUnreadAt?: number
  archivedAt?: number
}

export type DirectMessageSummary = {
  conversationId: string
  workspaceId: string
  title: string
  participants: ConversationParticipant[]
  created: boolean
}

export type DirectMessageCreateInput = {
  principalIds: string[]
  title?: string
  sourceConversationId?: string
}

export type ConversationParticipantStateInput = {
  notificationLevel?: ConversationNotificationLevel
  archived?: boolean
  markUnread?: boolean
  markRead?: boolean
}

export type ConversationPresence = {
  workspaceId: string
  principalId: string
  conversationId?: string
  status: 'online' | 'away' | 'offline'
  typing: boolean
  lastSeenAt: number
  typingExpiresAt?: number
}

export type WorkspaceNotification = {
  id: string
  workspaceId: string
  recipientPrincipalId: string
  type: 'message' | 'mention' | 'invitation' | 'participant'
  conversationId?: string
  messageId?: string
  actorPrincipalId?: string
  title: string
  body?: string
  createdAt: number
  readAt?: number
}

export const CHANNEL_VISIBILITIES = ['public', 'private'] as const
export type ChannelVisibility = (typeof CHANNEL_VISIBILITIES)[number]

export type ChannelSummary = {
  conversationId: string
  workspaceId: string
  name: string
  slug: string
  topic?: string
  visibility: ChannelVisibility
  participantCount: number
  createdAt: number
  updatedAt: number
}

export type ChannelCreateInput = {
  name: string
  topic?: string
  visibility: ChannelVisibility
  principalIds?: string[]
}

export type MessageReaction = {
  conversationId: string
  messageId: string
  emoji: string
  principalIds: string[]
  count: number
  reactedByCurrentPrincipal: boolean
}

export type ConversationPin = {
  conversationId: string
  messageId: string
  pinnedByPrincipalId: string
  createdAt: number
}

export type ConversationSavedMessage = {
  conversationId: string
  messageId: string
  principalId: string
  createdAt: number
}

export type WorkspaceChatSearchResult = {
  conversationId: string
  conversationType: 'personal' | 'dm' | 'channel'
  title: string
  messageId?: string
  snippet?: string
  authorDisplayName?: string
  createdAt: number
}

export function isWorkspacePrincipalType(value: unknown): value is WorkspacePrincipalType {
  return typeof value === 'string'
    && WORKSPACE_PRINCIPAL_TYPES.includes(value as WorkspacePrincipalType)
}

export function isWorkspaceMembershipRole(value: unknown): value is WorkspaceMembershipRole {
  return typeof value === 'string'
    && WORKSPACE_MEMBERSHIP_ROLES.includes(value as WorkspaceMembershipRole)
}

export function canManageWorkspace(role: WorkspaceMembershipRole): boolean {
  return role === 'owner' || role === 'admin'
}

export function canOwnWorkspace(principal: WorkspacePrincipal): boolean {
  return principal.type === 'human'
}

export function canJoinTeam(principal: WorkspacePrincipal): principal is WorkspacePrincipal & {
  type: TeamMemberPrincipalType
} {
  return principal.type === 'human' || principal.type === 'agent'
}

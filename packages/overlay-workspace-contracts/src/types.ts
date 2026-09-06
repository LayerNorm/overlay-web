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

export type WorkspaceBillingSubscription = {
  planKind: 'free' | 'paid'
  planAmountCents: number
  status?: 'active' | 'canceled' | 'past_due' | 'trialing'
  currentPeriodEnd?: number
}

export type WorkspaceBillingSummaryResponse = {
  workspaceId: string
  canManage: boolean
  initialized: boolean
  pricingVersion: 'markup_25_v1'
  rollout: {
    stage: 'off' | 'internal' | 'selected' | 'general'
    eligible: boolean
    checkoutEnabled: boolean
  }
  credits: {
    total: number
    used: number
    remaining: number
    allowancePercentUsed: number
    topUpBalance: number
  }
  subscription: WorkspaceBillingSubscription
  observability?: {
    actualProviderCostCents: number
    costCoveragePercent: number
    meteredReservations: number
    oldestReconciliationAgeMs: number
    periodEnd: number
    periodStart: number
    realizedMarginPercent: number | null
    reconciliationReservations: number
    retailCredits: number
    staleReconciliationReservations: number
  }
}

export type WorkspaceBillingCheckoutInput = {
  acceptedLegalTerms: true
  privacyVersion: string
  termsVersion: string
  planAmountCents: number
  topUpAmountCents: number
  autoTopUpEnabled?: boolean
}

export type WorkspaceBillingTopUpInput = {
  acceptedLegalTerms: true
  privacyVersion: string
  termsVersion: string
  amountCents: number
}

export type WorkspaceBillingCheckoutResponse = { url: string | null }

export type WorkspaceBillingVerificationInput = {
  kind: 'paid_plan' | 'budget_topup'
  sessionId: string
}

export type WorkspaceBillingVerificationResponse = {
  success: true
  amountCents: number
  kind: 'paid_plan' | 'budget_topup'
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
  | 'sharing'
  | 'import'

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
  /** Durable event cursor last actually seen in this conversation. */
  lastReadSequence?: number
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

export type ConversationLifecycleScope = 'self' | 'everyone'

export type ConversationParticipantStateInput = {
  notificationLevel?: ConversationNotificationLevel
  archived?: boolean
  archiveScope?: ConversationLifecycleScope
  markUnread?: boolean
  markRead?: boolean
  /** Optional explicit event boundary; omitted markRead advances to the server's current boundary. */
  readSequence?: number
}

export type ConversationPresence = {
  workspaceId: string
  principalId: string
  /** Browser/tab identity; presence is aggregated across active sessions. */
  sessionId?: string
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
  type: 'message' | 'mention' | 'thread' | 'reaction' | 'invitation' | 'participant'
  conversationId?: string
  messageId?: string
  actorPrincipalId?: string
  threadRootMessageId?: string
  eventSequence?: number
  mentionScope?: 'direct' | 'channel' | 'here'
  title: string
  body?: string
  createdAt: number
  readAt?: number
  /** Set when the related conversation is archived for this actor or deleted. */
  conversationState?: 'archived' | 'deleted'
}

export type WorkspaceNotificationFilter = 'all' | 'unread' | 'mentions' | 'threads' | 'reactions'

export type WorkspaceNotificationPreferenceMode = 'activity' | 'banner' | 'off'

export type WorkspaceNotificationPreferences = {
  dmMessages: WorkspaceNotificationPreferenceMode
  mentions: WorkspaceNotificationPreferenceMode
  threadReplies: WorkspaceNotificationPreferenceMode
  reactions: WorkspaceNotificationPreferenceMode
  channelMessages: WorkspaceNotificationPreferenceMode
}

export type ConversationThreadFollow = {
  conversationId: string
  threadRootMessageId: string
  principalId: string
  followedAt: number
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

export const WORKSPACE_AGENT_HARNESSES = ['overlay', 'claude-code'] as const
export type WorkspaceAgentHarness = (typeof WORKSPACE_AGENT_HARNESSES)[number]

export const WORKSPACE_AGENT_VISIBILITIES = ['creator', 'workspace'] as const
export type WorkspaceAgentVisibility = (typeof WORKSPACE_AGENT_VISIBILITIES)[number]

export type WorkspaceAgentDefinition = {
  id: string
  workspaceId: string
  principalId: string
  name: string
  description?: string
  instructions: string
  harness: WorkspaceAgentHarness
  modelId: string
  avatarColor?: string
  allowedToolIds: string[]
  invocationPolicy: 'mention'
  visibility: WorkspaceAgentVisibility
  createdByPrincipalId: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
  isDefault?: boolean
}

export type WorkspaceAgentCreateInput = {
  name: string
  description?: string
  instructions: string
  harness?: WorkspaceAgentHarness
  modelId: string
  avatarColor?: string
  allowedToolIds?: string[]
  teamIds?: string[]
  isDefault?: boolean
  visibility?: WorkspaceAgentVisibility
}

export type WorkspaceAgentUpdateInput = Partial<WorkspaceAgentCreateInput>

export type WorkspaceAgentDirectoryItem = WorkspaceAgentDefinition & {
  teamIds: string[]
  roomCount: number
  /** Creator display name for directory attribution; resolved server-side, absent when unknown. */
  createdByDisplayName?: string
}

export type WorkspaceAgentListResponse = {
  agents: WorkspaceAgentDirectoryItem[]
  canCreate: boolean
}

export const WORKSPACE_SHARE_RESOURCE_TYPES = [
  'conversation',
  'file',
  'project',
  'knowledge_base',
  'automation',
  'agent',
] as const
export type WorkspaceShareResourceType = (typeof WORKSPACE_SHARE_RESOURCE_TYPES)[number]

export const WORKSPACE_SHARE_TARGET_TYPES = ['principal', 'team', 'room'] as const
export type WorkspaceShareTargetType = (typeof WORKSPACE_SHARE_TARGET_TYPES)[number]

export const WORKSPACE_SHARE_ACCESS_ROLES = ['viewer', 'operator', 'editor'] as const
export type WorkspaceShareAccessRole = (typeof WORKSPACE_SHARE_ACCESS_ROLES)[number]

export type WorkspaceResourceGrant = {
  id: string
  workspaceId: string
  resourceType: WorkspaceShareResourceType
  resourceId: string
  targetType: WorkspaceShareTargetType
  targetId: string
  accessRole: WorkspaceShareAccessRole
  grantedByPrincipalId: string
  createdAt: number
  updatedAt: number
}

export type WorkspaceShareDirectoryEntry = {
  id: string
  name: string
  description?: string
  kind: 'human' | 'agent' | 'team' | 'dm' | 'channel'
  targetType: WorkspaceShareTargetType
}

export type WorkspaceShareDirectory = {
  principals: WorkspaceShareDirectoryEntry[]
  teams: WorkspaceShareDirectoryEntry[]
  rooms: WorkspaceShareDirectoryEntry[]
  canInvite: boolean
}

export type WorkspaceResourceShareResponse = {
  grants: WorkspaceResourceGrant[]
  directory: WorkspaceShareDirectory
  canManage: boolean
  /** Workspace policy for General access. Public links are separate from grants. */
  publicLinksEnabled: boolean
}

/**
 * Workspace-level sharing policy. Phase 6 governs public links; later phases
 * extend this record with guest expiry, retention, and agent budget policy.
 */
export const WORKSPACE_ROLLOUT_STAGES = ['dogfood', 'invited', 'general'] as const
export type WorkspaceRolloutStage = (typeof WORKSPACE_ROLLOUT_STAGES)[number]

export type WorkspaceSharingPolicy = {
  workspaceId: string
  publicLinksEnabled: boolean
  /** Members may create channels; owners and admins always may. */
  memberCanCreateChannels: boolean
  /** Members may create named agents; owners and admins always may. */
  memberCanCreateAgents: boolean
  /** Members may invite people; owners and admins always may. */
  memberCanInvite: boolean
  /** Resource guests expire after this many days when set. */
  guestExpirationDays?: number
  /** When set, only these agent harnesses may run in this workspace. */
  allowedAgentHarnesses?: WorkspaceAgentHarness[]
  /** Per-agent spend ceiling in cents; absent means the deployment default. */
  agentRunBudgetCents?: number
  /** Channel messages older than this are swept unless legal hold is on. */
  channelRetentionDays?: number
  /** Legal hold suspends retention deletion for the whole workspace. */
  legalHold: boolean
  /** Recorded residency requirement, surfaced to operators. */
  dataResidency?: string
  rolloutStage: WorkspaceRolloutStage
  updatedAt: number
  updatedByPrincipalId?: string
}

export type WorkspaceSharingPolicyPatch = Partial<Omit<
  WorkspaceSharingPolicy,
  'workspaceId' | 'updatedAt' | 'updatedByPrincipalId'
>>

export const DEFAULT_WORKSPACE_PUBLIC_LINKS_ENABLED = true

export const DEFAULT_WORKSPACE_POLICY: Omit<
  WorkspaceSharingPolicy,
  'workspaceId' | 'updatedAt' | 'updatedByPrincipalId'
> = {
  publicLinksEnabled: DEFAULT_WORKSPACE_PUBLIC_LINKS_ENABLED,
  memberCanCreateChannels: true,
  memberCanCreateAgents: true,
  memberCanInvite: false,
  legalHold: false,
  rolloutStage: 'general',
}

/** SSO/SCIM identity mapped to a workspace principal, never to authorization. */
export type WorkspaceIdentityMapping = {
  id: string
  workspaceId: string
  principalId: string
  directory: string
  externalId: string
  externalGroupIds: string[]
  status: 'active' | 'deprovisioned'
  createdAt: number
  updatedAt: number
  deprovisionedAt?: number
}

export type WorkspaceAuditExportRecord = {
  id: string
  workspaceId: string
  requestedByPrincipalId: string
  fromRecordedAt?: number
  toRecordedAt: number
  eventCount: number
  createdAt: number
}

/** Operational signals for the workspace collaboration dashboard. */
export type WorkspaceOperationalMetrics = {
  workspaceId: string
  collectedAt: number
  outboxPendingEvents: number
  outboxOldestPendingAgeMs: number
  failedDeliveries: number
  agentRunsQueued: number
  agentRunsFailed: number
  authorizationDenials: number
  invitationFailures: number
  unreadDriftConversations: number
  providerParity: { provider: string; requiresConvexClient: boolean }
}

export type WorkspaceSharingPolicyResponse = {
  policy: WorkspaceSharingPolicy
  canManage: boolean
}

/**
 * Who is affected before a room grant is created, and who loses access when a
 * grant is revoked. Both are disclosures, never authorization decisions.
 */
export type WorkspaceShareImpactPrincipal = {
  principalId: string
  name: string
  kind: 'human' | 'agent'
  /** Populated when access arrives through a team or room rather than directly. */
  via?: string
}

export type WorkspaceShareImpact = {
  targetName: string
  targetType: WorkspaceShareTargetType
  dynamic: boolean
  gaining: WorkspaceShareImpactPrincipal[]
  losing: WorkspaceShareImpactPrincipal[]
  retaining: WorkspaceShareImpactPrincipal[]
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

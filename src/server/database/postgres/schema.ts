import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  unique,
  vector,
} from 'drizzle-orm/pg-core'
import type { AutomationGraph, AutomationSchedule } from '@overlay/app-core'

export const overlayAppDataMetadata = pgTable('overlay_app_data_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const authProvider = pgEnum('overlay_auth_provider', [
  'workos',
  'better-auth',
  'oidc',
  'none',
])

export const chatMode = pgEnum('overlay_chat_mode', [
  'ask',
  'act',
])

export const messageRole = pgEnum('overlay_message_role', [
  'user',
  'assistant',
])

export const messageContentType = pgEnum('overlay_message_content_type', [
  'text',
  'image',
  'video',
])

export const messageStatus = pgEnum('overlay_message_status', [
  'generating',
  'completed',
  'error',
])

export const shareVisibility = pgEnum('overlay_share_visibility', [
  'private',
  'public',
])

export const conversationType = pgEnum('overlay_conversation_type', [
  'personal',
  'dm',
  'channel',
])

export const messageAuthorKind = pgEnum('overlay_message_author_kind', [
  'human',
  'agent',
  'model',
  'system',
])

export const fileType = pgEnum('overlay_file_type', [
  'file',
  'folder',
])

export const fileKind = pgEnum('overlay_file_kind', [
  'folder',
  'note',
  'upload',
  'output',
])

export const fileIndexStatus = pgEnum('overlay_file_index_status', [
  'pending',
  'indexed',
  'skipped',
  'failed',
])

export const memorySource = pgEnum('overlay_memory_source', [
  'chat',
  'note',
  'manual',
])

export const memoryType = pgEnum('overlay_memory_type', [
  'preference',
  'fact',
  'project',
  'decision',
  'agent',
])

export const memoryActor = pgEnum('overlay_memory_actor', [
  'user',
  'agent',
])

export const knowledgeSourceKind = pgEnum('overlay_knowledge_source_kind', [
  'file',
  'memory',
])

export const knowledgeBaseKind = pgEnum('overlay_knowledge_base_kind', [
  'personal',
  'organization',
])

export const knowledgeBaseStatus = pgEnum('overlay_knowledge_base_status', [
  'active',
  'archived',
])

export const canonicalKnowledgeSourceKind = pgEnum('overlay_canonical_knowledge_source_kind', [
  'file',
  'note',
  'memory',
  'text',
  'url',
  'connector',
  'drive',
])

export const canonicalKnowledgeSourceStatus = pgEnum('overlay_knowledge_source_status', [
  'pending',
  'extracting',
  'indexing',
  'ready',
  'failed',
  'deleting',
])

export const memoryExtractionStatus = pgEnum('overlay_memory_extraction_status', [
  'running',
  'succeeded',
  'failed',
  'skipped',
])

export const outputStatus = pgEnum('overlay_output_status', [
  'pending',
  'completed',
  'failed',
])

export const outputSource = pgEnum('overlay_output_source', [
  'image_generation',
  'video_generation',
  'browser',
  'sandbox',
])

export const uploadIntentStatus = pgEnum('overlay_upload_intent_status', [
  'pending',
  'finalized',
  'expired',
])

export const idempotencyStatus = pgEnum('overlay_idempotency_status', [
  'processing',
  'completed',
])

export const durableJobStatus = pgEnum('overlay_durable_job_status', [
  'queued',
  'running',
  'succeeded',
  'dead_letter',
])

export const outboxEventStatus = pgEnum('overlay_outbox_event_status', [
  'pending',
  'publishing',
  'published',
  'dead_letter',
])

export const automationConcurrencyPolicy = pgEnum('overlay_automation_concurrency_policy', [
  'skip',
  'queue',
])

export const automationTriggerKind = pgEnum('overlay_automation_trigger_kind', [
  'manual',
  'schedule',
  'event',
])

export const automationRunStatus = pgEnum('overlay_automation_run_status', [
  'queued',
  'running',
  'completed',
  'succeeded',
  'failed',
  'cancel_requested',
  'cancelled',
  'skipped',
  'dead_letter',
])

export const webhookDeliveryStatus = pgEnum('overlay_webhook_delivery_status', [
  'pending',
  'delivering',
  'delivered',
  'dead_letter',
])

export const usageBudgetMode = pgEnum('overlay_usage_budget_mode', [
  'unlimited',
  'budgeted',
])

export const usageReservationStatus = pgEnum('overlay_usage_reservation_status', [
  'reserved',
  'finalized',
  'released',
  'reconcile_required',
  'expired',
])

export const usageTransactionType = pgEnum('overlay_usage_transaction_type', [
  'reserve',
  'finalize',
  'release',
  'adjustment',
])

export const billingSubscriptionStatus = pgEnum('overlay_billing_subscription_status', [
  'active',
  'canceled',
  'past_due',
  'trialing',
])

export const billingTopUpSource = pgEnum('overlay_billing_top_up_source', [
  'manual',
  'auto',
])

export const billingTopUpStatus = pgEnum('overlay_billing_top_up_status', [
  'pending',
  'succeeded',
  'failed',
  'canceled',
])

export const billingProviderEventStatus = pgEnum('overlay_billing_provider_event_status', [
  'processing',
  'processed',
  'failed',
])

export const administrativeRole = pgEnum('overlay_administrative_role', [
  'admin',
  'auditor',
  'billing_admin',
  'support',
])

export const auditActorType = pgEnum('overlay_audit_actor_type', [
  'user',
  'api_key',
  'service',
  'system',
])

export const auditOutcome = pgEnum('overlay_audit_outcome', [
  'success',
  'denied',
  'failure',
])

export const workspaceKind = pgEnum('overlay_workspace_kind', [
  'personal',
  'organization',
])

export const workspaceStatus = pgEnum('overlay_workspace_status', [
  'active',
  'archived',
])

export const workspacePrincipalType = pgEnum('overlay_workspace_principal_type', [
  'human',
  'agent',
  'service',
])

export const workspaceMembershipRole = pgEnum('overlay_workspace_membership_role', [
  'owner',
  'admin',
  'member',
  'guest',
])

export const workspaceMembershipStatus = pgEnum('overlay_workspace_membership_status', [
  'active',
  'suspended',
])

export const workspaceInvitationStatus = pgEnum('overlay_workspace_invitation_status', [
  'pending',
  'accepted',
  'expired',
  'cancelled',
  'replaced',
])

export const workspaceResourceGuestStatus = pgEnum('overlay_workspace_resource_guest_status', [
  'pending',
  'active',
  'expired',
  'revoked',
])

export const workspaceResourceGuestAccessRole = pgEnum(
  'overlay_workspace_resource_guest_access_role',
  ['viewer', 'editor'],
)

export const workspaceShareTargetType = pgEnum('overlay_workspace_share_target_type', [
  'principal',
  'team',
  'room',
])

export const workspaceShareAccessRole = pgEnum('overlay_workspace_share_access_role', [
  'viewer',
  'operator',
  'editor',
])

export const conversationParticipantRole = pgEnum('overlay_conversation_participant_role', [
  'member',
  'moderator',
])

export const conversationParticipantStatus = pgEnum('overlay_conversation_participant_status', [
  'active',
  'removed',
])

export const conversationNotificationLevel = pgEnum('overlay_conversation_notification_level', [
  'all',
  'mentions',
  'muted',
])

export const workspacePresenceStatus = pgEnum('overlay_workspace_presence_status', [
  'online',
  'away',
  'offline',
])

export const workspaceNotificationType = pgEnum('overlay_workspace_notification_type', [
  'message',
  'mention',
  'thread',
  'reaction',
  'invitation',
  'participant',
])

export const workspaceNotificationPreferenceMode = pgEnum('overlay_workspace_notification_preference_mode', [
  'activity',
  'banner',
  'off',
])

export const channelVisibility = pgEnum('overlay_channel_visibility', [
  'public',
  'private',
])

export const mcpTransport = pgEnum('overlay_mcp_transport', [
  'sse',
  'streamable-http',
])

export const mcpAuthType = pgEnum('overlay_mcp_auth_type', [
  'none',
  'bearer',
  'header',
  'oauth',
])

export const mcpOAuthStatus = pgEnum('overlay_mcp_oauth_status', [
  'pending',
  'connected',
  'needs_reauth',
])

export const mcpOAuthSurface = pgEnum('overlay_mcp_oauth_surface', [
  'web',
  'desktop',
])

export const mcpToolPolicy = pgEnum('overlay_mcp_tool_policy', [
  'allow',
  'approval_required',
  'deny',
])

export const mcpExecutionStatus = pgEnum('overlay_mcp_execution_status', [
  'succeeded',
  'failed',
  'denied',
])

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  profilePictureUrl: text('profile_picture_url'),
  emailVerified: boolean('email_verified').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (table) => [
  index('users_email_idx').on(table.email),
  index('users_updated_at_idx').on(table.updatedAt),
])

export const authIdentities = pgTable('auth_identities', {
  provider: authProvider('provider').notNull(),
  subject: text('subject').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.provider, table.subject] }),
  index('auth_identities_user_id_idx').on(table.userId),
  index('auth_identities_email_idx').on(table.email),
])

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  kind: workspaceKind('kind').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: workspaceStatus('status').default('active').notNull(),
  personalOwnerUserId: text('personal_owner_user_id')
    .references(() => users.id, { onDelete: 'restrict' }),
  createdByPrincipalId: text('created_by_principal_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('workspaces_slug_idx').on(sql`lower(${table.slug})`),
  uniqueIndex('workspaces_personal_owner_idx')
    .on(table.personalOwnerUserId)
    .where(sql`${table.kind} = 'personal'`),
  index('workspaces_status_updated_idx').on(table.status, table.updatedAt),
  check(
    'workspaces_personal_owner_check',
    sql`(${table.kind} = 'personal' AND ${table.personalOwnerUserId} IS NOT NULL)
      OR (${table.kind} = 'organization' AND ${table.personalOwnerUserId} IS NULL)`,
  ),
  check(
    'workspaces_archive_state_check',
    sql`(${table.status} = 'archived') = (${table.archivedAt} IS NOT NULL)`,
  ),
])

export const workspacePrincipals = pgTable('workspace_principals', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  type: workspacePrincipalType('type').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  agentId: text('agent_id'),
  serviceId: text('service_id'),
  displayName: text('display_name').notNull(),
  email: text('email'),
  createdByPrincipalId: text('created_by_principal_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  unique('workspace_principals_workspace_id_id_unique').on(table.workspaceId, table.id),
  uniqueIndex('workspace_principals_human_idx')
    .on(table.workspaceId, table.userId)
    .where(sql`${table.type} = 'human'`),
  uniqueIndex('workspace_principals_agent_idx')
    .on(table.workspaceId, table.agentId)
    .where(sql`${table.type} = 'agent'`),
  uniqueIndex('workspace_principals_service_idx')
    .on(table.workspaceId, table.serviceId)
    .where(sql`${table.type} = 'service'`),
  index('workspace_principals_workspace_type_idx').on(table.workspaceId, table.type, table.archivedAt),
  check(
    'workspace_principals_identity_check',
    sql`(${table.type} = 'human'
          AND ${table.agentId} IS NULL AND ${table.serviceId} IS NULL
          AND (${table.userId} IS NOT NULL OR ${table.archivedAt} IS NOT NULL))
      OR (${table.type} = 'agent' AND ${table.userId} IS NULL
          AND ${table.agentId} IS NOT NULL AND ${table.serviceId} IS NULL)
      OR (${table.type} = 'service' AND ${table.userId} IS NULL
          AND ${table.agentId} IS NULL AND ${table.serviceId} IS NOT NULL)`,
  ),
])

export const workspaceMemberships = pgTable('workspace_memberships', {
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  role: workspaceMembershipRole('role').notNull(),
  status: workspaceMembershipStatus('status').default('active').notNull(),
  invitedByPrincipalId: text('invited_by_principal_id'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.principalId] }),
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'workspace_memberships_principal_fk',
  }).onDelete('cascade'),
  index('workspace_memberships_principal_idx').on(table.principalId),
  index('workspace_memberships_workspace_role_status_idx').on(
    table.workspaceId,
    table.role,
    table.status,
  ),
])

export const userWorkspacePreferences = pgTable('user_workspace_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  activeWorkspaceId: text('active_workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('user_workspace_preferences_workspace_idx').on(table.activeWorkspaceId),
])

export const workspaceTeams = pgTable('workspace_teams', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdByPrincipalId: text('created_by_principal_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  unique('workspace_teams_workspace_id_id_unique').on(table.workspaceId, table.id),
  uniqueIndex('workspace_teams_active_name_idx')
    .on(table.workspaceId, sql`lower(${table.name})`)
    .where(sql`${table.archivedAt} IS NULL`),
  index('workspace_teams_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
])

export const workspaceTeamMembers = pgTable('workspace_team_members', {
  teamId: text('team_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  principalId: text('principal_id').notNull(),
  principalType: workspacePrincipalType('principal_type').notNull(),
  addedByPrincipalId: text('added_by_principal_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.teamId, table.principalId] }),
  foreignKey({
    columns: [table.workspaceId, table.teamId],
    foreignColumns: [workspaceTeams.workspaceId, workspaceTeams.id],
    name: 'workspace_team_members_team_fk',
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'workspace_team_members_principal_fk',
  }).onDelete('cascade'),
  index('workspace_team_members_principal_idx').on(table.workspaceId, table.principalId),
  check(
    'workspace_team_members_principal_type_check',
    sql`${table.principalType} IN ('human', 'agent')`,
  ),
])

export const workspaceInvitations = pgTable('workspace_invitations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: workspaceMembershipRole('role').notNull(),
  status: workspaceInvitationStatus('status').default('pending').notNull(),
  invitedByPrincipalId: text('invited_by_principal_id').notNull(),
  acceptedByPrincipalId: text('accepted_by_principal_id'),
  replacedByInvitationId: text('replaced_by_invitation_id')
    .references((): AnyPgColumn => workspaceInvitations.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  replacedAt: timestamp('replaced_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('workspace_invitations_pending_email_idx')
    .on(table.workspaceId, sql`lower(${table.email})`)
    .where(sql`${table.status} = 'pending'`),
  index('workspace_invitations_workspace_status_idx').on(
    table.workspaceId,
    table.status,
    table.createdAt,
  ),
  index('workspace_invitations_expiry_idx').on(table.status, table.expiresAt),
  check('workspace_invitations_role_check', sql`${table.role} <> 'owner'`),
])

export const workspaceResourceGuests = pgTable('workspace_resource_guests', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  principalId: text('principal_id').notNull(),
  accessRole: workspaceResourceGuestAccessRole('access_role').notNull(),
  status: workspaceResourceGuestStatus('status').default('pending').notNull(),
  grantedByPrincipalId: text('granted_by_principal_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'workspace_resource_guests_principal_fk',
  }).onDelete('cascade'),
  uniqueIndex('workspace_resource_guests_active_idx')
    .on(table.workspaceId, table.resourceType, table.resourceId, table.principalId)
    .where(sql`${table.status} IN ('pending', 'active')`),
  index('workspace_resource_guests_resource_idx').on(
    table.workspaceId,
    table.resourceType,
    table.resourceId,
    table.status,
  ),
  index('workspace_resource_guests_principal_idx').on(
    table.workspaceId,
    table.principalId,
    table.status,
  ),
])

export const workspaceResourceScopes = pgTable('workspace_resource_scopes', {
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({
    columns: [table.resourceType, table.resourceId],
    name: 'workspace_resource_scopes_pk',
  }),
  index('workspace_resource_scopes_workspace_idx').on(
    table.workspaceId,
    table.resourceType,
    table.resourceId,
  ),
  // Referenced by workspace_resource_grants so a grant can never claim a
  // different workspace than the resource is bound to.
  unique('workspace_resource_scopes_workspace_resource_unique').on(
    table.workspaceId,
    table.resourceType,
    table.resourceId,
  ),
])

export const workspaceResourceGrants = pgTable('workspace_resource_grants', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  targetType: workspaceShareTargetType('target_type').notNull(),
  targetId: text('target_id').notNull(),
  accessRole: workspaceShareAccessRole('access_role').notNull(),
  grantedByPrincipalId: text('granted_by_principal_id')
    .notNull()
    .references(() => workspacePrincipals.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.resourceType, table.resourceId],
    foreignColumns: [
      workspaceResourceScopes.workspaceId,
      workspaceResourceScopes.resourceType,
      workspaceResourceScopes.resourceId,
    ],
    name: 'workspace_resource_grants_scope_fk',
  }).onDelete('cascade'),
  unique('workspace_resource_grants_target_unique').on(
    table.workspaceId,
    table.resourceType,
    table.resourceId,
    table.targetType,
    table.targetId,
  ),
  index('workspace_resource_grants_resource_idx').on(
    table.workspaceId,
    table.resourceType,
    table.resourceId,
  ),
  index('workspace_resource_grants_target_idx').on(
    table.workspaceId,
    table.targetType,
    table.targetId,
    table.resourceType,
  ),
  check(
    'workspace_resource_grants_type_check',
    sql`${table.resourceType} IN ('conversation', 'file', 'project', 'knowledge_base', 'automation', 'agent')`,
  ),
])

export const workspaceSharingPolicies = pgTable('workspace_sharing_policies', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  publicLinksEnabled: boolean('public_links_enabled').default(true).notNull(),
  memberCanCreateChannels: boolean('member_can_create_channels').default(true).notNull(),
  memberCanCreateAgents: boolean('member_can_create_agents').default(true).notNull(),
  memberCanInvite: boolean('member_can_invite').default(false).notNull(),
  guestExpirationDays: integer('guest_expiration_days'),
  allowedAgentHarnesses: text('allowed_agent_harnesses').array(),
  agentRunBudgetCents: integer('agent_run_budget_cents'),
  channelRetentionDays: integer('channel_retention_days'),
  legalHold: boolean('legal_hold').default(false).notNull(),
  dataResidency: text('data_residency'),
  rolloutStage: text('rollout_stage').default('general').notNull(),
  updatedByPrincipalId: text('updated_by_principal_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check(
    'workspace_sharing_policies_rollout_stage_check',
    sql`${table.rolloutStage} IN ('dogfood', 'invited', 'general')`,
  ),
  foreignKey({
    columns: [table.workspaceId, table.updatedByPrincipalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'workspace_sharing_policies_principal_fk',
  }).onDelete('set null'),
])

export const workspaceIdentityMappings = pgTable('workspace_identity_mappings', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  directory: text('directory').notNull(),
  externalId: text('external_id').notNull(),
  externalGroupIds: text('external_group_ids').array().default(sql`'{}'::text[]`).notNull(),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deprovisionedAt: timestamp('deprovisioned_at', { withTimezone: true }),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'workspace_identity_mappings_principal_fk',
  }).onDelete('cascade'),
  uniqueIndex('workspace_identity_mappings_external_idx')
    .on(table.workspaceId, table.directory, table.externalId),
  index('workspace_identity_mappings_principal_idx').on(table.workspaceId, table.principalId),
  check('workspace_identity_mappings_status_check', sql`${table.status} IN ('active', 'deprovisioned')`),
])

export const workspaceAuditExports = pgTable('workspace_audit_exports', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  requestedByPrincipalId: text('requested_by_principal_id').notNull(),
  fromRecordedAt: timestamp('from_recorded_at', { withTimezone: true }),
  toRecordedAt: timestamp('to_recorded_at', { withTimezone: true }).notNull(),
  eventCount: integer('event_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.requestedByPrincipalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'workspace_audit_exports_principal_fk',
  }).onDelete('cascade'),
  index('workspace_audit_exports_workspace_idx').on(table.workspaceId, table.createdAt),
])

export const knowledgeBases = pgTable('knowledge_bases', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  kind: knowledgeBaseKind('kind').default('personal').notNull(),
  status: knowledgeBaseStatus('status').default('active').notNull(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  index('knowledge_bases_owner_status_updated_idx').on(table.ownerUserId, table.status, table.updatedAt),
  index('knowledge_bases_kind_status_idx').on(table.kind, table.status),
])

export const knowledgeSources = pgTable('knowledge_sources', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: canonicalKnowledgeSourceKind('kind').notNull(),
  sourceRef: text('source_ref'),
  title: text('title').notNull(),
  mimeType: text('mime_type'),
  contentHash: text('content_hash'),
  status: canonicalKnowledgeSourceStatus('status').default('pending').notNull(),
  statusMessage: text('status_message'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('knowledge_sources_owner_status_updated_idx').on(table.ownerUserId, table.status, table.updatedAt),
  uniqueIndex('knowledge_sources_owner_ref_active_idx')
    .on(table.ownerUserId, table.kind, table.sourceRef)
    .where(sql`${table.sourceRef} IS NOT NULL AND ${table.deletedAt} IS NULL`),
])

export const knowledgeSourceVersions = pgTable('knowledge_source_versions', {
  id: text('id').primaryKey(),
  sourceId: text('source_id')
    .notNull()
    .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  contentHash: text('content_hash').notNull(),
  status: canonicalKnowledgeSourceStatus('status').default('pending').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('knowledge_source_versions_source_version_idx').on(table.sourceId, table.version),
  uniqueIndex('knowledge_source_versions_source_hash_idx').on(table.sourceId, table.contentHash),
])

export const knowledgeBaseSources = pgTable('knowledge_base_sources', {
  knowledgeBaseId: text('knowledge_base_id')
    .notNull()
    .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  sourceId: text('source_id')
    .notNull()
    .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
  addedBy: text('added_by').references(() => users.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.knowledgeBaseId, table.sourceId] }),
  index('knowledge_base_sources_source_idx').on(table.sourceId, table.knowledgeBaseId),
])

export const authorizationRoles = pgTable('authorization_roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  capabilities: text('capabilities').array().default(sql`'{}'::text[]`).notNull(),
  isSystem: boolean('is_system').default(false).notNull(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('authorization_roles_name_idx').on(sql`lower(${table.name})`),
  index('authorization_roles_archived_at_idx').on(table.archivedAt),
])

export const authorizationGroups = pgTable('authorization_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  source: text('source').default('local').notNull(),
  externalId: text('external_id'),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('authorization_groups_name_idx').on(sql`lower(${table.name})`),
  uniqueIndex('authorization_groups_external_idx').on(table.source, table.externalId),
  index('authorization_groups_archived_at_idx').on(table.archivedAt),
  check('authorization_groups_source_check', sql`${table.source} IN ('local', 'external')`),
])

export const authorizationGroupMemberships = pgTable('authorization_group_memberships', {
  groupId: text('group_id')
    .notNull()
    .references(() => authorizationGroups.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  source: text('source').default('local').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.userId] }),
  index('authorization_group_memberships_user_idx').on(table.userId),
  check('authorization_group_memberships_source_check', sql`${table.source} IN ('local', 'external')`),
])

export const authorizationUserRoles = pgTable('authorization_user_roles', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id')
    .notNull()
    .references(() => authorizationRoles.id, { onDelete: 'cascade' }),
  assignedBy: text('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.roleId] }),
  index('authorization_user_roles_role_idx').on(table.roleId),
])

export const authorizationGroupRoles = pgTable('authorization_group_roles', {
  groupId: text('group_id')
    .notNull()
    .references(() => authorizationGroups.id, { onDelete: 'cascade' }),
  roleId: text('role_id')
    .notNull()
    .references(() => authorizationRoles.id, { onDelete: 'cascade' }),
  assignedBy: text('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.roleId] }),
  index('authorization_group_roles_role_idx').on(table.roleId),
])

export const authorizationResourceGrants = pgTable('authorization_resource_grants', {
  id: text('id').primaryKey(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  principalType: text('principal_type').notNull(),
  principalId: text('principal_id').notNull(),
  accessRole: text('access_role').notNull(),
  grantedBy: text('granted_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('authorization_resource_grants_principal_idx').on(
    table.resourceType,
    table.resourceId,
    table.principalType,
    table.principalId,
  ),
  index('authorization_resource_grants_resource_idx').on(table.resourceType, table.resourceId),
  index('authorization_resource_grants_principal_lookup_idx').on(
    table.principalType,
    table.principalId,
    table.resourceType,
  ),
  check(
    'authorization_resource_grants_principal_type_check',
    sql`${table.principalType} IN ('user', 'group', 'role')`,
  ),
  check(
    'authorization_resource_grants_access_role_check',
    sql`${table.accessRole} IN ('viewer', 'editor', 'owner')`,
  ),
])

export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: text('theme').default('dark').notNull(),
  lightThemePreset: text('light_theme_preset'),
  darkThemePreset: text('dark_theme_preset'),
  useSecondarySidebar: boolean('use_secondary_sidebar').default(false).notNull(),
  chatStreamingMode: text('chat_streaming_mode'),
  autoContinue: boolean('auto_continue'),
  defaultChatMode: chatMode('default_chat_mode'),
  modelPreference: text('model_preference'),
  defaultAskModelIds: jsonb('default_ask_model_ids').$type<string[]>(),
  defaultActModelId: text('default_act_model_id'),
  defaultImageModelId: text('default_image_model_id'),
  defaultVideoModelId: text('default_video_model_id'),
  defaultImageAspectRatio: text('default_image_aspect_ratio'),
  defaultVideoAspectRatio: text('default_video_aspect_ratio'),
  sendWithEnter: boolean('send_with_enter'),
  attachFilesToKnowledgeByDefault: boolean('attach_files_to_knowledge_by_default'),
  onlyAllowZdrModels: boolean('only_allow_zdr_models'),
  dismissedZdrWarningGlobally: boolean('dismissed_zdr_warning_globally'),
  dismissedZdrWarningModelIds: jsonb('dismissed_zdr_warning_model_ids').$type<string[]>(),
  enabledChatModelIds: jsonb('enabled_chat_model_ids').$type<string[]>(),
  chatSuggestions: jsonb('chat_suggestions').$type<string[]>(),
  chatSuggestionDay: text('chat_suggestion_day'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const onboardingState = pgTable('onboarding_state', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  hasSeenOnboarding: boolean('has_seen_onboarding').default(false).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  resetAt: timestamp('reset_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id'),
  name: text('name').notNull(),
  instructions: text('instructions'),
  knowledgeBaseId: text('knowledge_base_id')
    .references((): AnyPgColumn => knowledgeBases.id, { onDelete: 'set null' }),
  parentId: text('parent_id').references((): AnyPgColumn => projects.id, { onDelete: 'set null' }),
  settings: jsonb('settings').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('projects_user_id_idx').on(table.userId),
  uniqueIndex('projects_user_id_client_id_idx').on(table.userId, table.clientId),
  index('projects_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('projects_knowledge_base_id_idx').on(table.knowledgeBaseId),
  index('projects_user_id_archived_at_idx').on(table.userId, table.archivedAt),
  index('projects_parent_id_idx').on(table.parentId),
  check('projects_parent_not_self_check', sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
])

export const skills = pgTable('skills', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  instructions: text('instructions').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  version: integer('version').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('skills_user_updated_idx').on(table.userId, table.updatedAt),
  index('skills_project_updated_idx').on(table.projectId, table.updatedAt),
])

export const mcpServers = pgTable('mcp_servers', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  transport: mcpTransport('transport').notNull(),
  url: text('url').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  authType: mcpAuthType('auth_type').default('none').notNull(),
  encryptedAuthConfig: text('encrypted_auth_config'),
  // OAuth: only non-secret columns are surfaced by list APIs. Tokens and the client secret
  // stay sealed with McpCredentialCipher and never leave the server.
  oauthStatus: mcpOAuthStatus('oauth_status'),
  encryptedOauthTokens: text('encrypted_oauth_tokens'),
  encryptedOauthClient: text('encrypted_oauth_client'),
  oauthClientId: text('oauth_client_id'),
  oauthIssuer: text('oauth_issuer'),
  oauthScope: text('oauth_scope'),
  oauthResource: text('oauth_resource'),
  oauthConnectedAt: timestamp('oauth_connected_at', { withTimezone: true }),
  oauthError: text('oauth_error'),
  /** Bumped on every token write so concurrent refreshes can compare-and-set. */
  oauthTokenVersion: integer('oauth_token_version').default(0).notNull(),
  timeoutMs: integer('timeout_ms'),
  defaultToolPolicy: mcpToolPolicy('default_tool_policy').default('allow').notNull(),
  toolPolicies: jsonb('tool_policies')
    .$type<Record<string, 'allow' | 'approval_required' | 'deny'>>()
    .default(sql`'{}'::jsonb`)
    .notNull(),
  toolCatalog: jsonb('tool_catalog')
    .$type<Array<{ name: string; description?: string; inputSchema?: unknown }>>()
    .default(sql`'[]'::jsonb`)
    .notNull(),
  toolCatalogUpdatedAt: timestamp('tool_catalog_updated_at', { withTimezone: true }),
  toolCatalogError: text('tool_catalog_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('mcp_servers_user_updated_idx').on(table.userId, table.updatedAt),
  index('mcp_servers_user_enabled_idx').on(table.userId, table.enabled),
  index('mcp_servers_project_updated_idx').on(table.projectId, table.updatedAt),
])

/**
 * Pending MCP OAuth authorizations. One row per in-flight Connect, consumed exactly once by the
 * callback and bound to (user_id, mcp_server_id) so a stolen `state` cannot land tokens in another
 * account. The PKCE verifier is encrypted at rest like every other MCP secret.
 */
export const mcpOAuthSessions = pgTable('mcp_oauth_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mcpServerId: text('mcp_server_id')
    .notNull()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  encryptedCodeVerifier: text('encrypted_code_verifier').notNull(),
  surface: mcpOAuthSurface('surface').default('web').notNull(),
  returnTo: text('return_to'),
  /** Hash of the web session cookie, when the flow started from an authenticated browser. */
  sessionBindingHash: text('session_binding_hash'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('mcp_oauth_sessions_user_idx').on(table.userId),
  index('mcp_oauth_sessions_server_idx').on(table.mcpServerId),
  index('mcp_oauth_sessions_expires_idx').on(table.expiresAt),
])

export const mcpToolExecutions = pgTable('mcp_tool_executions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  mcpServerId: text('mcp_server_id')
    .notNull()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  argumentsHash: text('arguments_hash').notNull(),
  policyDecision: mcpToolPolicy('policy_decision').notNull(),
  status: mcpExecutionStatus('status').notNull(),
  conversationId: text('conversation_id'),
  turnId: text('turn_id'),
  modelId: text('model_id'),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('mcp_tool_executions_user_created_idx').on(table.userId, table.createdAt),
  index('mcp_tool_executions_server_created_idx').on(table.mcpServerId, table.createdAt),
])

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationType: conversationType('conversation_type').default('personal').notNull(),
  createdByPrincipalId: text('created_by_principal_id')
    .notNull()
    .references(() => workspacePrincipals.id, { onDelete: 'restrict' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id'),
  title: text('title').notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  lastModified: timestamp('last_modified', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastMode: chatMode('last_mode').notNull(),
  askModelIds: jsonb('ask_model_ids').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  actModelId: text('act_model_id').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  shareToken: text('share_token'),
  shareVisibility: shareVisibility('share_visibility'),
  sharedAt: timestamp('shared_at', { withTimezone: true }),
  isAutomation: boolean('is_automation'),
  dmIdentityKey: text('dm_identity_key'),
  channelSlug: text('channel_slug'),
  channelVisibility: channelVisibility('channel_visibility'),
  channelTopic: text('channel_topic'),
}, (table) => [
  index('conversations_user_id_idx').on(table.userId),
  uniqueIndex('conversations_workspace_id_client_id_idx').on(table.workspaceId, table.clientId),
  index('conversations_workspace_type_last_modified_idx').on(
    table.workspaceId,
    table.conversationType,
    table.lastModified,
  ),
  index('conversations_user_id_last_modified_idx').on(table.userId, table.lastModified),
  index('conversations_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('conversations_deleted_at_created_at_idx').on(table.deletedAt, table.createdAt),
  index('conversations_project_id_idx').on(table.projectId),
  uniqueIndex('conversations_share_token_idx').on(table.shareToken),
  uniqueIndex('conversations_workspace_dm_identity_idx')
    .on(table.workspaceId, table.dmIdentityKey)
    .where(sql`${table.dmIdentityKey} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  uniqueIndex('conversations_workspace_channel_slug_idx')
    .on(table.workspaceId, table.channelSlug)
    .where(sql`${table.conversationType} = 'channel' AND ${table.deletedAt} IS NULL`),
  check(
    'conversations_channel_shape_check',
    sql`(${table.conversationType} <> 'channel' AND ${table.channelSlug} IS NULL AND ${table.channelVisibility} IS NULL)
      OR (${table.conversationType} = 'channel' AND ${table.channelSlug} IS NOT NULL AND ${table.channelVisibility} IS NOT NULL)`,
  ),
])

export const knowledgeBaseConversations = pgTable('knowledge_base_conversations', {
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  knowledgeBaseId: text('knowledge_base_id')
    .notNull()
    .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.knowledgeBaseId] }),
  index('knowledge_base_conversations_base_created_idx').on(table.knowledgeBaseId, table.createdAt),
  index('knowledge_base_conversations_conversation_created_idx')
    .on(table.conversationId, table.createdAt),
])

export const projectKnowledgeBases = pgTable('project_knowledge_bases', {
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  knowledgeBaseId: text('knowledge_base_id')
    .notNull()
    .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  attachedBy: text('attached_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.knowledgeBaseId] }),
  index('project_knowledge_bases_base_created_idx').on(table.knowledgeBaseId, table.createdAt),
  index('project_knowledge_bases_project_created_idx').on(table.projectId, table.createdAt),
])

export const knowledgeBaseGroupDefaults = pgTable('knowledge_base_group_defaults', {
  groupId: text('group_id')
    .notNull()
    .references(() => authorizationGroups.id, { onDelete: 'cascade' }),
  knowledgeBaseId: text('knowledge_base_id')
    .notNull()
    .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.knowledgeBaseId] }),
  index('knowledge_base_group_defaults_base_idx').on(table.knowledgeBaseId, table.createdAt),
  index('knowledge_base_group_defaults_group_idx').on(table.groupId, table.createdAt),
])

export const conversationMessages = pgTable('conversation_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  authorKind: messageAuthorKind('author_kind').notNull(),
  authorPrincipalId: text('author_principal_id')
    .references(() => workspacePrincipals.id, { onDelete: 'cascade' }),
  turnId: text('turn_id').notNull(),
  role: messageRole('role').notNull(),
  mode: chatMode('mode').notNull(),
  content: text('content').notNull(),
  contentType: messageContentType('content_type').notNull(),
  parts: jsonb('parts').$type<unknown[]>(),
  modelId: text('model_id'),
  variantIndex: integer('variant_index'),
  tokens: jsonb('tokens').$type<{ input: number; output: number }>(),
  replyToTurnId: text('reply_to_turn_id'),
  replySnippet: text('reply_snippet'),
  routedModelId: text('routed_model_id'),
  status: messageStatus('status'),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  clientNonce: text('client_nonce'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  threadRootMessageId: text('thread_root_message_id')
    .references((): AnyPgColumn => conversationMessages.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('conversation_messages_conversation_id_idx').on(table.conversationId),
  index('conversation_messages_user_id_idx').on(table.userId),
  index('conversation_messages_conversation_created_at_idx').on(table.conversationId, table.createdAt),
  index('conversation_messages_conversation_status_updated_at_idx').on(table.conversationId, table.status, table.updatedAt),
  index('conversation_messages_status_updated_at_idx').on(table.status, table.updatedAt),
  index('conversation_messages_turn_id_idx').on(table.turnId),
  index('conversation_messages_thread_root_created_idx').on(table.threadRootMessageId, table.createdAt),
  uniqueIndex('conversation_messages_conversation_client_nonce_idx')
    .on(table.conversationId, table.clientNonce)
    .where(sql`${table.clientNonce} IS NOT NULL`),
  check(
    'conversation_messages_author_identity_check',
    sql`(${table.authorKind} IN ('human', 'agent') AND ${table.authorPrincipalId} IS NOT NULL)
      OR (${table.authorKind} IN ('model', 'system'))`,
  ),
])

export const conversationMessageReactions = pgTable('conversation_message_reactions', {
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .notNull()
    .references(() => conversationMessages.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.principalId, table.emoji] }),
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'conversation_message_reactions_principal_fk',
  }).onDelete('cascade'),
  index('conversation_message_reactions_conversation_idx').on(table.conversationId, table.createdAt),
  check('conversation_message_reactions_emoji_check', sql`char_length(${table.emoji}) BETWEEN 1 AND 32`),
])

export const conversationPins = pgTable('conversation_pins', {
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .notNull()
    .references(() => conversationMessages.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  pinnedByPrincipalId: text('pinned_by_principal_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.messageId] }),
  foreignKey({
    columns: [table.workspaceId, table.pinnedByPrincipalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'conversation_pins_principal_fk',
  }).onDelete('cascade'),
])

export const conversationSavedMessages = pgTable('conversation_saved_messages', {
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .notNull()
    .references(() => conversationMessages.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.principalId] }),
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'conversation_saved_messages_principal_fk',
  }).onDelete('cascade'),
  index('conversation_saved_messages_principal_idx').on(
    table.workspaceId,
    table.principalId,
    table.createdAt,
  ),
])

export const conversationParticipants = pgTable('conversation_participants', {
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  principalType: workspacePrincipalType('principal_type').notNull(),
  role: conversationParticipantRole('role').default('member').notNull(),
  status: conversationParticipantStatus('status').default('active').notNull(),
  notificationLevel: conversationNotificationLevel('notification_level').default('all').notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  lastReadSequence: bigint('last_read_sequence', { mode: 'number' }),
  markedUnreadAt: timestamp('marked_unread_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.principalId] }),
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'conversation_participants_principal_fk',
  }).onDelete('cascade'),
  index('conversation_participants_principal_status_idx').on(
    table.workspaceId,
    table.principalId,
    table.status,
  ),
  index('conversation_participants_conversation_status_idx').on(
    table.conversationId,
    table.status,
  ),
  check(
    'conversation_participants_principal_type_check',
    sql`${table.principalType} IN ('human', 'agent')`,
  ),
  check(
    'conversation_participants_state_check',
    sql`(${table.status} = 'active' AND ${table.removedAt} IS NULL)
      OR (${table.status} = 'removed' AND ${table.removedAt} IS NOT NULL)`,
  ),
])

export const workspacePresence = pgTable('workspace_presence', {
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  sessionId: text('session_id').notNull().default('legacy'),
  conversationId: text('conversation_id')
    .references(() => conversations.id, { onDelete: 'set null' }),
  status: workspacePresenceStatus('status').default('online').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  typingExpiresAt: timestamp('typing_expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.principalId, table.sessionId] }),
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'workspace_presence_principal_fk',
  }).onDelete('cascade'),
  index('workspace_presence_conversation_idx').on(table.conversationId, table.updatedAt),
  index('workspace_presence_principal_idx').on(table.workspaceId, table.principalId, table.updatedAt),
])

export const workspaceNotifications = pgTable('workspace_notifications', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  recipientPrincipalId: text('recipient_principal_id').notNull(),
  type: workspaceNotificationType('type').notNull(),
  conversationId: text('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .references(() => conversationMessages.id, { onDelete: 'cascade' }),
  actorPrincipalId: text('actor_principal_id'),
  threadRootMessageId: text('thread_root_message_id')
    .references(() => conversationMessages.id, { onDelete: 'cascade' }),
  eventSequence: bigint('event_sequence', { mode: 'number' }),
  mentionScope: text('mention_scope'),
  title: text('title').notNull(),
  body: text('body'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (table) => [
  foreignKey({
    columns: [table.workspaceId, table.recipientPrincipalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'workspace_notifications_recipient_fk',
  }).onDelete('cascade'),
  index('workspace_notifications_recipient_unread_idx').on(
    table.workspaceId,
    table.recipientPrincipalId,
    table.readAt,
    table.createdAt,
  ),
  index('workspace_notifications_conversation_idx').on(table.conversationId, table.createdAt),
])

export const conversationThreadFollows = pgTable('conversation_thread_follows', {
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  threadRootMessageId: text('thread_root_message_id')
    .notNull()
    .references(() => conversationMessages.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  followedAt: timestamp('followed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.threadRootMessageId, table.principalId] }),
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'conversation_thread_follows_principal_fk',
  }).onDelete('cascade'),
  index('conversation_thread_follows_principal_idx').on(table.workspaceId, table.principalId, table.followedAt),
  index('conversation_thread_follows_thread_idx').on(table.conversationId, table.threadRootMessageId),
])

export const workspaceNotificationPreferences = pgTable('workspace_notification_preferences', {
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  dmMessages: workspaceNotificationPreferenceMode('dm_messages').default('activity').notNull(),
  mentions: workspaceNotificationPreferenceMode('mentions').default('banner').notNull(),
  threadReplies: workspaceNotificationPreferenceMode('thread_replies').default('activity').notNull(),
  reactions: workspaceNotificationPreferenceMode('reactions').default('activity').notNull(),
  channelMessages: workspaceNotificationPreferenceMode('channel_messages').default('activity').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.principalId] }),
  foreignKey({
    columns: [table.workspaceId, table.principalId],
    foreignColumns: [workspacePrincipals.workspaceId, workspacePrincipals.id],
    name: 'workspace_notification_preferences_principal_fk',
  }).onDelete('cascade'),
])

export const conversationMessageDeltas = pgTable('conversation_message_deltas', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .notNull()
    .references(() => conversationMessages.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  textDelta: text('text_delta'),
  newParts: jsonb('new_parts').$type<unknown[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('conversation_message_deltas_conversation_id_idx').on(table.conversationId),
  index('conversation_message_deltas_message_id_idx').on(table.messageId),
  index('conversation_message_deltas_user_id_idx').on(table.userId),
  index('conversation_message_deltas_created_at_idx').on(table.createdAt),
])

export const conversationEvents = pgTable('conversation_events', {
  sequence: bigint('sequence', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  messageId: text('message_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('conversation_events_user_sequence_idx').on(table.userId, table.sequence),
  index('conversation_events_conversation_sequence_idx').on(table.conversationId, table.sequence),
  index('conversation_events_created_at_idx').on(table.createdAt),
])

export const conversationContextSummaries = pgTable('conversation_context_summaries', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  scope: text('scope').notNull(),
  summary: text('summary').notNull(),
  summarizedThroughMessageId: text('summarized_through_message_id'),
  summarizedThroughCreatedAt: timestamp('summarized_through_created_at', { withTimezone: true }),
  sourceMessageCount: integer('source_message_count').notNull(),
  sourceEstimatedTokens: integer('source_estimated_tokens').notNull(),
  summaryEstimatedTokens: integer('summary_estimated_tokens').notNull(),
  contextWindow: integer('context_window').notNull(),
  targetModelId: text('target_model_id').notNull(),
  summarizerModelId: text('summarizer_model_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('conversation_context_summaries_conversation_scope_idx').on(table.conversationId, table.scope),
  index('conversation_context_summaries_user_id_updated_at_idx').on(table.userId, table.updatedAt),
])

export const notes = pgTable('notes', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id'),
  title: text('title').notNull(),
  icon: text('icon'),
  content: text('content').default('').notNull(),
  tags: jsonb('tags').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('notes_user_id_idx').on(table.userId),
  uniqueIndex('notes_user_id_client_id_idx').on(table.userId, table.clientId),
  index('notes_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('notes_project_id_idx').on(table.projectId),
])

export const memories = pgTable('memories', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id'),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  source: memorySource('source').notNull(),
  type: memoryType('type'),
  importance: integer('importance'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  noteId: text('note_id').references(() => notes.id, { onDelete: 'set null' }),
  messageId: text('message_id'),
  turnId: text('turn_id'),
  tags: jsonb('tags').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  actor: memoryActor('actor'),
  indexStatus: fileIndexStatus('index_status').default('pending').notNull(),
  indexedAt: timestamp('indexed_at', { withTimezone: true }),
  indexError: text('index_error'),
  embeddingModelVersion: text('embedding_model_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('memories_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  uniqueIndex('memories_user_id_client_id_idx').on(table.userId, table.clientId),
  uniqueIndex('memories_user_id_content_hash_active_idx')
    .on(table.userId, table.contentHash)
    .where(sql`${table.deletedAt} IS NULL`),
  index('memories_project_id_idx').on(table.projectId),
  index('memories_conversation_id_idx').on(table.conversationId),
  index('memories_note_id_idx').on(table.noteId),
  index('memories_index_status_idx').on(table.indexStatus, table.updatedAt),
])

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  sourceKind: knowledgeSourceKind('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  knowledgeSourceId: text('knowledge_source_id')
    .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
  knowledgeSourceVersionId: text('knowledge_source_version_id')
    .references(() => knowledgeSourceVersions.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  startOffset: integer('start_offset').notNull(),
  text: text('text').notNull(),
  title: text('title'),
  contentHash: text('content_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('knowledge_chunks_source_chunk_idx').on(table.sourceKind, table.sourceId, table.chunkIndex),
  index('knowledge_chunks_user_source_idx').on(table.userId, table.sourceKind),
  index('knowledge_chunks_user_project_idx').on(table.userId, table.projectId),
  index('knowledge_chunks_source_idx').on(table.sourceKind, table.sourceId),
  index('knowledge_chunks_canonical_source_idx').on(table.knowledgeSourceId, table.chunkIndex),
  index('knowledge_chunks_source_version_idx').on(table.knowledgeSourceVersionId),
])

export const knowledgeChunkEmbeddings = pgTable('knowledge_chunk_embeddings', {
  chunkId: text('chunk_id')
    .primaryKey()
    .references(() => knowledgeChunks.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sourceKind: knowledgeSourceKind('source_kind').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  provider: text('provider').notNull(),
  modelId: text('model_id').notNull(),
  modelVersion: text('model_version').notNull(),
  dimensions: integer('dimensions').notNull(),
  contentHash: text('content_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('knowledge_chunk_embeddings_user_model_idx').on(
    table.userId,
    table.provider,
    table.modelId,
    table.modelVersion,
  ),
  index('knowledge_chunk_embeddings_source_idx').on(table.sourceKind),
  index('knowledge_chunk_embeddings_hnsw_idx')
    .using('hnsw', table.embedding.op('vector_cosine_ops')),
])

export const memoryExtractionRuns = pgTable('memory_extraction_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .notNull()
    .references(() => conversationMessages.id, { onDelete: 'cascade' }),
  turnId: text('turn_id').notNull(),
  status: memoryExtractionStatus('status').notNull(),
  modelId: text('model_id'),
  attempts: integer('attempts').default(1).notNull(),
  extractedCount: integer('extracted_count').default(0).notNull(),
  insertedCount: integer('inserted_count').default(0).notNull(),
  duplicateCount: integer('duplicate_count').default(0).notNull(),
  reason: text('reason'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('memory_extraction_runs_user_conversation_turn_idx').on(
    table.userId,
    table.conversationId,
    table.turnId,
  ),
  index('memory_extraction_runs_status_updated_idx').on(table.status, table.updatedAt),
  index('memory_extraction_runs_user_created_idx').on(table.userId, table.createdAt),
])

export const files = pgTable('files', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: fileType('type').notNull(),
  kind: fileKind('kind'),
  parentId: text('parent_id').references((): AnyPgColumn => files.id, { onDelete: 'set null' }),
  content: text('content'),
  textContent: text('text_content'),
  storageId: text('storage_id'),
  r2Key: text('r2_key'),
  mimeType: text('mime_type'),
  extension: text('extension'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  contentHash: text('content_hash'),
  duplicateOfFileId: text('duplicate_of_file_id').references((): AnyPgColumn => files.id, { onDelete: 'set null' }),
  indexable: boolean('indexable'),
  indexStatus: fileIndexStatus('index_status'),
  indexedAt: timestamp('indexed_at', { withTimezone: true }),
  indexError: text('index_error'),
  embeddingModelVersion: text('embedding_model_version'),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  turnId: text('turn_id'),
  modelId: text('model_id'),
  prompt: text('prompt'),
  outputType: text('output_type'),
  outputSource: outputSource('output_source'),
  outputStatus: outputStatus('output_status'),
  outputUrl: text('output_url'),
  outputMetadata: jsonb('output_metadata').$type<Record<string, unknown>>(),
  outputErrorMessage: text('output_error_message'),
  outputCompletedAt: timestamp('output_completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  legacyNoteId: text('legacy_note_id'),
  legacyOutputId: text('legacy_output_id'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  shareToken: text('share_token'),
  shareVisibility: shareVisibility('share_visibility'),
  sharedAt: timestamp('shared_at', { withTimezone: true }),
}, (table) => [
  index('files_user_id_idx').on(table.userId),
  index('files_user_id_content_hash_idx').on(table.userId, table.contentHash),
  index('files_duplicate_of_file_id_idx').on(table.duplicateOfFileId),
  index('files_project_id_idx').on(table.projectId),
  index('files_parent_id_idx').on(table.parentId),
  index('files_legacy_note_id_idx').on(table.legacyNoteId),
  index('files_legacy_output_id_idx').on(table.legacyOutputId),
  index('files_conversation_id_idx').on(table.conversationId),
  index('files_r2_key_idx').on(table.r2Key),
  index('files_output_expiry_idx').on(table.kind, table.outputStatus, table.expiresAt),
  uniqueIndex('files_share_token_idx').on(table.shareToken),
  check('files_parent_not_self_check', sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
  check('files_duplicate_not_self_check', sql`${table.duplicateOfFileId} IS NULL OR ${table.duplicateOfFileId} <> ${table.id}`),
])

export const r2UploadIntents = pgTable('r2_upload_intents', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull(),
  declaredSizeBytes: bigint('declared_size_bytes', { mode: 'number' }).notNull(),
  actualSizeBytes: bigint('actual_size_bytes', { mode: 'number' }),
  mimeType: text('mime_type'),
  status: uploadIntentStatus('status').notNull(),
  fileId: text('file_id').references(() => files.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('r2_upload_intents_r2_key_idx').on(table.r2Key),
  index('r2_upload_intents_user_id_status_expires_at_idx').on(table.userId, table.status, table.expiresAt),
  index('r2_upload_intents_file_id_idx').on(table.fileId),
])

export const daytonaWorkspaces = pgTable('daytona_workspaces', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  sandboxId: text('sandbox_id').notNull(),
  sandboxName: text('sandbox_name').notNull(),
  volumeId: text('volume_id').notNull(),
  volumeName: text('volume_name').notNull(),
  tier: text('tier').notNull(),
  state: text('state').notNull(),
  resourceProfile: text('resource_profile').notNull(),
  mountPath: text('mount_path').notNull(),
  lastMeteredAt: timestamp('last_metered_at', { withTimezone: true }),
  lastKnownStartedAt: timestamp('last_known_started_at', { withTimezone: true }),
  lastKnownStoppedAt: timestamp('last_known_stopped_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('daytona_workspaces_sandbox_id_idx').on(table.sandboxId),
  index('daytona_workspaces_state_updated_at_idx').on(table.state, table.updatedAt),
])

export const automations = pgTable('automations', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  instructions: text('instructions').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  schedule: jsonb('schedule').$type<AutomationSchedule>().notNull(),
  timezone: text('timezone').default('UTC').notNull(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: text('last_run_status'),
  lastError: text('last_error'),
  modelId: text('model_id'),
  graphSource: text('graph_source'),
  graph: jsonb('graph').$type<AutomationGraph>(),
  sourceConversationId: text('source_conversation_id')
    .references(() => conversations.id, { onDelete: 'set null' }),
  conversationId: text('conversation_id')
    .references(() => conversations.id, { onDelete: 'set null' }),
  concurrencyPolicy: automationConcurrencyPolicy('concurrency_policy').default('skip').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('automations_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('automations_user_id_enabled_idx').on(table.userId, table.enabled),
  index('automations_project_id_idx').on(table.projectId),
  index('automations_due_idx').on(table.enabled, table.nextRunAt),
])

export const automationTriggers = pgTable('automation_triggers', {
  id: text('id').primaryKey(),
  automationId: text('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  kind: automationTriggerKind('kind').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  nextFireAt: timestamp('next_fire_at', { withTimezone: true }),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('automation_triggers_automation_id_kind_idx').on(table.automationId, table.kind),
  index('automation_triggers_due_idx').on(table.kind, table.enabled, table.nextFireAt),
])

export const automationRuns = pgTable('automation_runs', {
  id: text('id').primaryKey(),
  automationId: text('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  triggerId: text('trigger_id').references(() => automationTriggers.id, { onDelete: 'set null' }),
  triggerSource: automationTriggerKind('trigger_source').notNull(),
  status: automationRunStatus('status').default('queued').notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  jobId: text('job_id'),
  workflowRunId: text('workflow_run_id'),
  conversationId: text('conversation_id')
    .references(() => conversations.id, { onDelete: 'set null' }),
  turnId: text('turn_id'),
  attemptCount: integer('attempt_count').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(5).notNull(),
  cancellationRequestedAt: timestamp('cancellation_requested_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  result: jsonb('result').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('automation_runs_idempotency_key_idx').on(table.idempotencyKey),
  index('automation_runs_automation_id_created_at_idx').on(table.automationId, table.createdAt),
  index('automation_runs_automation_id_status_idx').on(table.automationId, table.status),
  index('automation_runs_user_id_created_at_idx').on(table.userId, table.createdAt),
  index('automation_runs_status_scheduled_for_idx').on(table.status, table.scheduledFor),
])

export const automationRunAttempts = pgTable('automation_run_attempts', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => automationRuns.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  jobId: text('job_id'),
  workerId: text('worker_id'),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  result: jsonb('result').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('automation_run_attempts_run_id_attempt_idx').on(table.runId, table.attemptNumber),
  index('automation_run_attempts_job_id_idx').on(table.jobId),
])

export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: jsonb('events').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('webhook_subscriptions_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('webhook_subscriptions_user_id_enabled_idx').on(table.userId, table.enabled),
])

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscription_id')
    .notNull()
    .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  payloadJson: text('payload_json').notNull(),
  status: webhookDeliveryStatus('status').default('pending').notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  lastStatusCode: integer('last_status_code'),
  lastError: text('last_error'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('webhook_deliveries_subscription_event_idx').on(table.subscriptionId, table.eventId),
  index('webhook_deliveries_user_id_created_at_idx').on(table.userId, table.createdAt),
  index('webhook_deliveries_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
])

export const webhookDeliveryAttempts = pgTable('webhook_delivery_attempts', {
  id: text('id').primaryKey(),
  deliveryId: text('delivery_id')
    .notNull()
    .references(() => webhookDeliveries.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  jobId: text('job_id'),
  status: text('status').notNull(),
  statusCode: integer('status_code'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('webhook_delivery_attempts_delivery_attempt_idx').on(table.deliveryId, table.attemptNumber),
  index('webhook_delivery_attempts_job_id_idx').on(table.jobId),
])

export const apiIdempotencyKeys = pgTable('api_idempotency_keys', {
  keyHash: text('key_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  requestHash: text('request_hash').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  status: idempotencyStatus('status').notNull(),
  responseStatus: integer('response_status'),
  responseHeaders: jsonb('response_headers').$type<Array<{ name: string; value: string }>>(),
  responseBody: text('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => [
  index('api_idempotency_keys_user_id_idx').on(table.userId),
  index('api_idempotency_keys_expires_at_idx').on(table.expiresAt),
  index('api_idempotency_keys_status_updated_at_idx').on(table.status, table.updatedAt),
])

export const serviceAuthReplayNonces = pgTable('service_auth_replay_nonces', {
  jti: text('jti').primaryKey(),
  subject: text('subject').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('service_auth_replay_nonces_expires_at_idx').on(table.expiresAt),
  index('service_auth_replay_nonces_subject_consumed_at_idx').on(table.subject, table.consumedAt),
])

export const durableJobs = pgTable('durable_jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  status: durableJobStatus('status').default('queued').notNull(),
  priority: integer('priority').default(0).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(5).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  dedupeKey: text('dedupe_key'),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  lastError: text('last_error'),
  result: jsonb('result').$type<unknown>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
}, (table) => [
  index('durable_jobs_claim_idx').on(table.status, table.availableAt, table.priority, table.createdAt),
  index('durable_jobs_lease_idx').on(table.status, table.leaseExpiresAt),
  index('durable_jobs_type_status_idx').on(table.type, table.status),
  uniqueIndex('durable_jobs_dedupe_key_idx').on(table.dedupeKey),
])

export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  status: outboxEventStatus('status').default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(10).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
  dedupeKey: text('dedupe_key'),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
}, (table) => [
  index('outbox_events_claim_idx').on(table.status, table.availableAt, table.createdAt),
  index('outbox_events_lease_idx').on(table.status, table.leaseExpiresAt),
  index('outbox_events_topic_status_idx').on(table.topic, table.status),
  uniqueIndex('outbox_events_dedupe_key_idx').on(table.dedupeKey),
])

export const scheduledTasks = pgTable('scheduled_tasks', {
  id: text('id').primaryKey(),
  jobType: text('job_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  intervalMs: integer('interval_ms').notNull(),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  lastEnqueuedAt: timestamp('last_enqueued_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('scheduled_tasks_due_idx').on(table.enabled, table.nextRunAt),
  index('scheduled_tasks_job_type_idx').on(table.jobType),
])

export const modelCatalogSnapshots = pgTable('model_catalog_snapshots', {
  source: text('source').primaryKey(),
  modelsJson: jsonb('models_json').$type<unknown[]>().notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('model_catalog_snapshots_fetched_at_idx').on(table.fetchedAt),
])

export const usageBudgetAccounts = pgTable('usage_budget_accounts', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  mode: usageBudgetMode('mode').default('unlimited').notNull(),
  includedMicros: bigint('included_micros', { mode: 'number' }).default(0).notNull(),
  grantedMicros: bigint('granted_micros', { mode: 'number' }).default(0).notNull(),
  usedMicros: bigint('used_micros', { mode: 'number' }).default(0).notNull(),
  reservedMicros: bigint('reserved_micros', { mode: 'number' }).default(0).notNull(),
  version: integer('version').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('usage_budget_accounts_non_negative_check', sql`
    ${table.includedMicros} >= 0 AND
    ${table.grantedMicros} >= 0 AND
    ${table.usedMicros} >= 0 AND
    ${table.reservedMicros} >= 0
  `),
  index('usage_budget_accounts_mode_idx').on(table.mode),
])

export const usageReservations = pgTable('usage_reservations', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  modelId: text('model_id'),
  reservedMicros: bigint('reserved_micros', { mode: 'number' }).notNull(),
  actualMicros: bigint('actual_micros', { mode: 'number' }),
  status: usageReservationStatus('status').default('reserved').notNull(),
  providerWorkStarted: boolean('provider_work_started').default(false).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  reason: text('reason'),
  error: text('error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('usage_reservations_user_created_idx').on(table.userId, table.createdAt),
  index('usage_reservations_status_expires_idx').on(table.status, table.expiresAt),
])

export const usageEvents = pgTable('usage_events', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reservationId: text('reservation_id')
    .references(() => usageReservations.id, { onDelete: 'set null' }),
  operationId: text('operation_id').notNull(),
  kind: text('kind').notNull(),
  modelId: text('model_id'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cachedTokens: integer('cached_tokens'),
  providerCostMicros: bigint('provider_cost_micros', { mode: 'number' }),
  billableCostMicros: bigint('billable_cost_micros', { mode: 'number' }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('usage_events_user_occurred_idx').on(table.userId, table.occurredAt),
  index('usage_events_operation_idx').on(table.operationId),
  index('usage_events_reservation_idx').on(table.reservationId),
])

export const usageBudgetTransactions = pgTable('usage_budget_transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reservationId: text('reservation_id')
    .references(() => usageReservations.id, { onDelete: 'set null' }),
  eventId: text('event_id')
    .references(() => usageEvents.id, { onDelete: 'set null' }),
  type: usageTransactionType('type').notNull(),
  amountMicros: bigint('amount_micros', { mode: 'number' }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('usage_budget_transactions_user_created_idx').on(table.userId, table.createdAt),
  index('usage_budget_transactions_reservation_idx').on(table.reservationId),
])

export const billingSubscriptions = pgTable('billing_subscriptions', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  email: text('email'),
  name: text('name'),
  provider: text('provider').default('stripe').notNull(),
  providerCustomerId: text('provider_customer_id'),
  providerSubscriptionId: text('provider_subscription_id'),
  providerPriceId: text('provider_price_id'),
  providerQuantity: integer('provider_quantity'),
  tier: text('tier').default('free').notNull(),
  planKind: text('plan_kind').default('free').notNull(),
  planVersion: text('plan_version'),
  planAmountCents: integer('plan_amount_cents').default(0).notNull(),
  markupBasisPoints: integer('markup_basis_points'),
  status: billingSubscriptionStatus('status').default('active').notNull(),
  autoTopUpEnabled: boolean('auto_top_up_enabled').default(false).notNull(),
  autoTopUpAmountCents: integer('auto_top_up_amount_cents').default(0).notNull(),
  offSessionConsentAt: timestamp('off_session_consent_at', { withTimezone: true }),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  providerEventCreatedAt: timestamp('provider_event_created_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('billing_subscriptions_provider_customer_idx').on(table.provider, table.providerCustomerId),
  uniqueIndex('billing_subscriptions_provider_subscription_idx').on(table.provider, table.providerSubscriptionId),
  index('billing_subscriptions_status_idx').on(table.status),
])

export const billingTopUps = pgTable('billing_top_ups', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  source: billingTopUpSource('source').notNull(),
  status: billingTopUpStatus('status').notNull(),
  provider: text('provider').default('stripe').notNull(),
  providerCheckoutSessionId: text('provider_checkout_session_id'),
  providerCustomerId: text('provider_customer_id'),
  providerPaymentIntentId: text('provider_payment_intent_id'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('billing_top_ups_positive_amount_check', sql`${table.amountCents} > 0`),
  index('billing_top_ups_user_created_idx').on(table.userId, table.createdAt),
  uniqueIndex('billing_top_ups_checkout_session_idx').on(table.provider, table.providerCheckoutSessionId),
  uniqueIndex('billing_top_ups_payment_intent_idx').on(table.provider, table.providerPaymentIntentId),
])

export const billingProviderEvents = pgTable('billing_provider_events', {
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  payloadHash: text('payload_hash').notNull(),
  status: billingProviderEventStatus('status').default('processing').notNull(),
  attempts: integer('attempts').default(1).notNull(),
  lastError: text('last_error'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.provider, table.eventId] }),
  index('billing_provider_events_status_updated_idx').on(table.status, table.updatedAt),
])

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull(),
  name: text('name'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').array().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: text('created_by'),
  createdFromIp: text('created_from_ip'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastUsedIp: text('last_used_ip'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
}, (table) => [
  uniqueIndex('api_keys_key_hash_idx').on(table.keyHash),
  index('api_keys_user_created_idx').on(table.userId, table.createdAt),
  index('api_keys_expires_at_idx').on(table.expiresAt),
  index('api_keys_revoked_at_idx').on(table.revokedAt),
])

export const administrativePrincipals = pgTable('administrative_principals', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: administrativeRole('role').notNull(),
  grantedBy: text('granted_by'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: text('revoked_by'),
}, (table) => [
  index('administrative_principals_role_idx').on(table.role),
  index('administrative_principals_active_idx').on(table.revokedAt),
])

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  actorType: auditActorType('actor_type').notNull(),
  actorUserId: text('actor_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  actorApiKeyId: text('actor_api_key_id')
    .references(() => apiKeys.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  outcome: auditOutcome('outcome').notNull(),
  requestId: text('request_id'),
  ipAddress: text('ip_address'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('audit_events_created_idx').on(table.createdAt),
  index('audit_events_actor_created_idx').on(table.actorUserId, table.createdAt),
  index('audit_events_action_created_idx').on(table.action, table.createdAt),
  index('audit_events_resource_idx').on(table.resourceType, table.resourceId, table.createdAt),
])

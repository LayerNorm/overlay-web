import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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

export const messageAuthorKind = pgEnum('overlay_message_author_kind', [
  'human',
  'agent',
  'model',
  'system',
])

export const shareVisibility = pgEnum('overlay_share_visibility', [
  'private',
  'public',
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

export const billingAccountScope = pgEnum('overlay_billing_account_scope', [
  'personal',
  'workspace',
])

export const billingAccountStatus = pgEnum('overlay_billing_account_status', [
  'active',
  'suspended',
  'closed',
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

export const canonicalKnowledgeSourceKind = pgEnum('overlay_canonical_knowledge_source_kind', [
  'file',
  'note',
  'memory',
  'text',
  'url',
  'connector',
  'drive',
])

export const knowledgeSourceStatus = pgEnum('overlay_knowledge_source_status', [
  'pending',
  'extracting',
  'indexing',
  'ready',
  'failed',
  'deleting',
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
  'invitation',
  'participant',
  'thread',
  'reaction',
])

export const workspaceNotificationPreferenceMode = pgEnum('overlay_workspace_notification_preference_mode', [
  'activity',
  'banner',
  'off',
])

export const conversationType = pgEnum('overlay_conversation_type', [
  'personal',
  'dm',
  'channel',
])

export const conversationEventType = pgEnum('overlay_conversation_event_type', [
  'message',
  'mention',
  'thread',
  'reaction',
  'participant',
  'pin.changed',
  'reaction.changed',
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
  parentId: text('parent_id').references((): AnyPgColumn => projects.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  workspaceId: text('workspace_id'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('projects_user_id_idx').on(table.userId),
  uniqueIndex('projects_user_id_client_id_idx').on(table.userId, table.clientId),
  index('projects_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('projects_parent_id_idx').on(table.parentId),
  index('projects_workspace_id_idx').on(table.workspaceId),
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
  workspaceId: text('workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('skills_user_updated_idx').on(table.userId, table.updatedAt),
  index('skills_project_updated_idx').on(table.projectId, table.updatedAt),
  index('skills_workspace_id_idx').on(table.workspaceId),
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
  workspaceId: text('workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('mcp_servers_user_updated_idx').on(table.userId, table.updatedAt),
  index('mcp_servers_user_enabled_idx').on(table.userId, table.enabled),
  index('mcp_servers_project_updated_idx').on(table.projectId, table.updatedAt),
  index('mcp_servers_workspace_id_idx').on(table.workspaceId),
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
  conversationType: conversationType('conversation_type').default('personal').notNull(),
  workspaceId: text('workspace_id'),
  createdByPrincipalId: text('created_by_principal_id'),
  dmIdentityKey: text('dm_identity_key'),
  channelSlug: text('channel_slug'),
  channelVisibility: text('channel_visibility'),
  channelTopic: text('channel_topic'),
}, (table) => [
  index('conversations_user_id_idx').on(table.userId),
  uniqueIndex('conversations_user_id_client_id_idx').on(table.userId, table.clientId),
  index('conversations_user_id_last_modified_idx').on(table.userId, table.lastModified),
  index('conversations_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('conversations_deleted_at_created_at_idx').on(table.deletedAt, table.createdAt),
  index('conversations_project_id_idx').on(table.projectId),
  uniqueIndex('conversations_share_token_idx').on(table.shareToken),
  index('conversations_workspace_id_idx').on(table.workspaceId),
  index('conversations_workspace_type_last_modified_idx').on(table.workspaceId, table.conversationType, table.lastModified),
  uniqueIndex('conversations_workspace_dm_identity_key_idx').on(table.workspaceId, table.dmIdentityKey),
  uniqueIndex('conversations_workspace_channel_slug_idx').on(table.workspaceId, table.channelSlug),
])

export const conversationMessages = pgTable('conversation_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
  authorKind: messageAuthorKind('author_kind').notNull(),
  authorPrincipalId: text('author_principal_id'),
  clientNonce: text('client_nonce'),
  threadRootMessageId: text('thread_root_message_id'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  editHistory: jsonb('edit_history').$type<Array<{ content: string; editedAt: number }>>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('conversation_messages_conversation_id_idx').on(table.conversationId),
  index('conversation_messages_user_id_idx').on(table.userId),
  index('conversation_messages_conversation_created_at_idx').on(table.conversationId, table.createdAt),
  index('conversation_messages_conversation_status_updated_at_idx').on(table.conversationId, table.status, table.updatedAt),
  index('conversation_messages_status_updated_at_idx').on(table.status, table.updatedAt),
  index('conversation_messages_turn_id_idx').on(table.turnId),
  index('conversation_messages_author_principal_id_idx').on(table.authorPrincipalId),
  uniqueIndex('conversation_messages_conversation_client_nonce_idx')
    .on(table.conversationId, table.clientNonce),
  index('conversation_messages_thread_root_created_at_idx')
    .on(table.threadRootMessageId, table.createdAt),
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
  workspaceId: text('workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('notes_user_id_idx').on(table.userId),
  uniqueIndex('notes_user_id_client_id_idx').on(table.userId, table.clientId),
  index('notes_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('notes_project_id_idx').on(table.projectId),
  index('notes_workspace_id_idx').on(table.workspaceId),
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
  workspaceId: text('workspace_id'),
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
  index('memories_workspace_id_idx').on(table.workspaceId),
])

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  sourceKind: knowledgeSourceKind('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  knowledgeSourceId: text('knowledge_source_id'),
  knowledgeSourceVersionId: text('knowledge_source_version_id'),
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
  index('knowledge_chunks_knowledge_source_id_idx').on(table.knowledgeSourceId),
  index('knowledge_chunks_workspace_id_idx').on(table.workspaceId),
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
  workspaceId: text('workspace_id'),
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
  index('files_workspace_id_idx').on(table.workspaceId),
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
  schedulerWorkflowRunId: text('scheduler_workflow_run_id'),
  workspaceId: text('workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('automations_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('automations_user_id_enabled_idx').on(table.userId, table.enabled),
  index('automations_project_id_idx').on(table.projectId),
  index('automations_due_idx').on(table.enabled, table.nextRunAt),
  index('automations_workspace_id_idx').on(table.workspaceId),
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
  workspaceId: text('workspace_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('webhook_subscriptions_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('webhook_subscriptions_user_id_enabled_idx').on(table.userId, table.enabled),
  index('webhook_subscriptions_workspace_id_idx').on(table.workspaceId),
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

export const emailSuppressions = pgTable('email_suppressions', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason')
    .$type<'bounce' | 'complaint' | 'manual' | 'provider_suppression'>()
    .notNull(),
  source: text('source').$type<'admin' | 'provider'>().notNull(),
  suppressedAt: timestamp('suppressed_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('email_suppressions_suppressed_at_idx').on(table.suppressedAt),
  check(
    'email_suppressions_reason_check',
    sql`${table.reason} IN ('bounce', 'complaint', 'manual', 'provider_suppression')`,
  ),
  check('email_suppressions_source_check', sql`${table.source} IN ('admin', 'provider')`),
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

export const billingAccounts = pgTable('billing_accounts', {
  id: text('id').primaryKey(),
  scope: billingAccountScope('scope').notNull(),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references((): AnyPgColumn => workspaces.id, { onDelete: 'cascade' }),
  status: billingAccountStatus('status').default('active').notNull(),
  primaryBillingContactUserId: text('primary_billing_contact_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  pricingVersion: text('pricing_version').default('markup_25_v1').notNull(),
  markupBasisPoints: integer('markup_basis_points').default(2_500).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (table) => [
  check('billing_accounts_owner_check', sql`
    (${table.scope} = 'personal' AND ${table.ownerUserId} IS NOT NULL AND ${table.workspaceId} IS NULL) OR
    (${table.scope} = 'workspace' AND ${table.workspaceId} IS NOT NULL AND ${table.ownerUserId} IS NULL)
  `),
  check('billing_accounts_markup_non_negative_check', sql`${table.markupBasisPoints} >= 0`),
  check('billing_accounts_pricing_version_check', sql`${table.pricingVersion} = 'markup_25_v1'`),
  uniqueIndex('billing_accounts_personal_owner_idx')
    .on(table.ownerUserId)
    .where(sql`${table.scope} = 'personal'`),
  uniqueIndex('billing_accounts_workspace_idx')
    .on(table.workspaceId)
    .where(sql`${table.scope} = 'workspace'`),
  index('billing_accounts_status_updated_idx').on(table.status, table.updatedAt),
])

export const billingAccountSubscriptions = pgTable('billing_account_subscriptions', {
  billingAccountId: text('billing_account_id')
    .primaryKey()
    .references(() => billingAccounts.id, { onDelete: 'cascade' }),
  provider: text('provider').default('stripe').notNull(),
  providerCustomerId: text('provider_customer_id'),
  providerSubscriptionId: text('provider_subscription_id'),
  providerPriceId: text('provider_price_id'),
  providerQuantity: integer('provider_quantity'),
  planKind: text('plan_kind').default('free').notNull(),
  planVersion: text('plan_version').default('variable_v2').notNull(),
  planAmountCents: integer('plan_amount_cents').default(0).notNull(),
  markupBasisPoints: integer('markup_basis_points').default(2_500).notNull(),
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
  check('billing_account_subscriptions_plan_kind_check', sql`${table.planKind} IN ('free', 'paid')`),
  check('billing_account_subscriptions_plan_version_check', sql`${table.planVersion} = 'variable_v2'`),
  check('billing_account_subscriptions_amount_check', sql`${table.planAmountCents} >= 0`),
  check('billing_account_subscriptions_markup_check', sql`${table.markupBasisPoints} >= 0`),
  uniqueIndex('billing_account_subscriptions_provider_customer_idx')
    .on(table.provider, table.providerCustomerId),
  uniqueIndex('billing_account_subscriptions_provider_subscription_idx')
    .on(table.provider, table.providerSubscriptionId),
  index('billing_account_subscriptions_status_updated_idx').on(table.status, table.updatedAt),
])

export const billingAccountBalances = pgTable('billing_account_balances', {
  billingAccountId: text('billing_account_id')
    .primaryKey()
    .references(() => billingAccounts.id, { onDelete: 'cascade' }),
  mode: usageBudgetMode('mode').default('budgeted').notNull(),
  includedMicros: bigint('included_micros', { mode: 'number' }).default(0).notNull(),
  institutionalGrantMicros: bigint('institutional_grant_micros', { mode: 'number' }).default(0).notNull(),
  allowanceUsedMicros: bigint('allowance_used_micros', { mode: 'number' }).default(0).notNull(),
  topUpPurchasedMicros: bigint('top_up_purchased_micros', { mode: 'number' }).default(0).notNull(),
  topUpBalanceMicros: bigint('top_up_balance_micros', { mode: 'number' }).default(0).notNull(),
  usedMicros: bigint('used_micros', { mode: 'number' }).default(0).notNull(),
  reservedMicros: bigint('reserved_micros', { mode: 'number' }).default(0).notNull(),
  version: integer('version').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('billing_account_balances_non_negative_check', sql`
    ${table.includedMicros} >= 0 AND
    ${table.institutionalGrantMicros} >= 0 AND
    ${table.allowanceUsedMicros} >= 0 AND
    ${table.topUpPurchasedMicros} >= 0 AND
    ${table.topUpBalanceMicros} >= 0 AND
    ${table.topUpBalanceMicros} <= ${table.topUpPurchasedMicros} AND
    ${table.usedMicros} >= 0 AND
    ${table.reservedMicros} >= 0
  `),
  index('billing_account_balances_mode_updated_idx').on(table.mode, table.updatedAt),
])

export const billingAccountSpendLimits = pgTable('billing_account_spend_limits', {
  billingAccountId: text('billing_account_id')
    .notNull()
    .references(() => billingAccounts.id, { onDelete: 'cascade' }),
  subjectKind: text('subject_kind').notNull(),
  subjectId: text('subject_id').notNull(),
  limitMicros: bigint('limit_micros', { mode: 'number' }).notNull(),
  usedMicros: bigint('used_micros', { mode: 'number' }).default(0).notNull(),
  reservedMicros: bigint('reserved_micros', { mode: 'number' }).default(0).notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  version: integer('version').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.billingAccountId, table.subjectKind, table.subjectId], name: 'billing_account_spend_limits_pk' }),
  check('billing_account_spend_limits_subject_kind_check', sql`${table.subjectKind} IN ('member', 'programmatic')`),
  check('billing_account_spend_limits_non_negative_check', sql`
    ${table.limitMicros} >= 0 AND ${table.usedMicros} >= 0 AND ${table.reservedMicros} >= 0 AND
    ${table.usedMicros} + ${table.reservedMicros} <= ${table.limitMicros}
  `),
  check('billing_account_spend_limits_period_check', sql`${table.periodEnd} > ${table.periodStart}`),
  index('billing_account_spend_limits_account_updated_idx').on(table.billingAccountId, table.updatedAt),
])

export const usageBudgetAccounts = pgTable('usage_budget_accounts', {
  billingAccountId: text('billing_account_id')
    .references(() => billingAccounts.id, { onDelete: 'set null' }),
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  mode: usageBudgetMode('mode').default('unlimited').notNull(),
  includedMicros: bigint('included_micros', { mode: 'number' }).default(0).notNull(),
  institutionalGrantMicros: bigint('institutional_grant_micros', { mode: 'number' }).default(0).notNull(),
  allowanceUsedMicros: bigint('allowance_used_micros', { mode: 'number' }).default(0).notNull(),
  topUpPurchasedMicros: bigint('top_up_purchased_micros', { mode: 'number' }).default(0).notNull(),
  topUpBalanceMicros: bigint('top_up_balance_micros', { mode: 'number' }).default(0).notNull(),
  // Legacy combined grant total. Retained until every client has migrated.
  grantedMicros: bigint('granted_micros', { mode: 'number' }).default(0).notNull(),
  usedMicros: bigint('used_micros', { mode: 'number' }).default(0).notNull(),
  reservedMicros: bigint('reserved_micros', { mode: 'number' }).default(0).notNull(),
  version: integer('version').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('usage_budget_accounts_non_negative_check', sql`
    ${table.includedMicros} >= 0 AND
    ${table.institutionalGrantMicros} >= 0 AND
    ${table.allowanceUsedMicros} >= 0 AND
    ${table.topUpPurchasedMicros} >= 0 AND
    ${table.topUpBalanceMicros} >= 0 AND
    ${table.topUpBalanceMicros} <= ${table.topUpPurchasedMicros} AND
    ${table.grantedMicros} >= 0 AND
    ${table.usedMicros} >= 0 AND
    ${table.reservedMicros} >= 0
  `),
  index('usage_budget_accounts_mode_idx').on(table.mode),
  uniqueIndex('usage_budget_accounts_billing_account_idx')
    .on(table.billingAccountId)
    .where(sql`${table.billingAccountId} IS NOT NULL`),
])

export const usageReservations = pgTable('usage_reservations', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  billingAccountId: text('billing_account_id')
    .references(() => billingAccounts.id, { onDelete: 'set null' }),
  spendSubjectKind: text('spend_subject_kind'),
  spendSubjectId: text('spend_subject_id'),
  kind: text('kind').notNull(),
  modelId: text('model_id'),
  reservedMicros: bigint('reserved_micros', { mode: 'number' }).notNull(),
  actualMicros: bigint('actual_micros', { mode: 'number' }),
  status: usageReservationStatus('status').default('reserved').notNull(),
  providerWorkStarted: boolean('provider_work_started').default(false).notNull(),
  providerWorkCompleted: boolean('provider_work_completed').default(false).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  reason: text('reason'),
  error: text('error'),
  reconciliationAttempts: integer('reconciliation_attempts').default(0).notNull(),
  reconciliationLastAttemptAt: timestamp('reconciliation_last_attempt_at', { withTimezone: true }),
  reconciliationResolvedAt: timestamp('reconciliation_resolved_at', { withTimezone: true }),
  reconciliationResolution: text('reconciliation_resolution'),
  reconciliationEvidenceSource: text('reconciliation_evidence_source'),
  reconciliationEvidenceReference: text('reconciliation_evidence_reference'),
  reconciliationReason: text('reconciliation_reason'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('usage_reservations_user_created_idx').on(table.userId, table.createdAt),
  index('usage_reservations_status_expires_idx').on(table.status, table.expiresAt),
  index('usage_reservations_status_updated_idx').on(table.status, table.updatedAt),
  index('usage_reservations_billing_account_created_idx').on(table.billingAccountId, table.createdAt),
  index('usage_reservations_billing_account_status_created_idx')
    .on(table.billingAccountId, table.status, table.createdAt),
  check('usage_reservations_spend_subject_check', sql`
    (${table.spendSubjectKind} IS NULL AND ${table.spendSubjectId} IS NULL) OR
    (${table.spendSubjectKind} IN ('member', 'programmatic') AND ${table.spendSubjectId} IS NOT NULL)
  `),
  check('usage_reservations_reconciliation_resolution_check', sql`
    ${table.reconciliationResolution} IS NULL OR
    ${table.reconciliationResolution} IN ('finalized', 'released')
  `),
])

export const usageEvents = pgTable('usage_events', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  billingAccountId: text('billing_account_id')
    .references(() => billingAccounts.id, { onDelete: 'set null' }),
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
  index('usage_events_billing_account_occurred_idx').on(table.billingAccountId, table.occurredAt),
])

export const usageBudgetTransactions = pgTable('usage_budget_transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  billingAccountId: text('billing_account_id')
    .references(() => billingAccounts.id, { onDelete: 'set null' }),
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
  index('usage_budget_transactions_billing_account_created_idx').on(table.billingAccountId, table.createdAt),
])

export const billingSubscriptions = pgTable('billing_subscriptions', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  billingAccountId: text('billing_account_id')
    .references(() => billingAccounts.id, { onDelete: 'set null' }),
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
  uniqueIndex('billing_subscriptions_billing_account_idx')
    .on(table.billingAccountId)
    .where(sql`${table.billingAccountId} IS NOT NULL`),
])

export const billingTopUps = pgTable('billing_top_ups', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  billingAccountId: text('billing_account_id')
    .references(() => billingAccounts.id, { onDelete: 'set null' }),
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
  index('billing_top_ups_billing_account_created_idx').on(table.billingAccountId, table.createdAt),
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

// ────────────────────────────────────────────────────────────────────────────
// Knowledge source tables
// ────────────────────────────────────────────────────────────────────────────

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
  status: knowledgeSourceStatus('status').default('pending').notNull(),
  statusMessage: text('status_message'),
  metadata: jsonb('metadata').$type<{ content?: string }>().default(sql`'{}'::jsonb`).notNull(),
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
  status: knowledgeSourceStatus('status').default('pending').notNull(),
  metadata: jsonb('metadata').$type<{ content?: string }>().default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('knowledge_source_versions_source_version_idx').on(table.sourceId, table.version),
  uniqueIndex('knowledge_source_versions_source_hash_idx').on(table.sourceId, table.contentHash),
])

// ────────────────────────────────────────────────────────────────────────────
// Workspace tables
// ────────────────────────────────────────────────────────────────────────────

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  kind: workspaceKind('kind').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: workspaceStatus('status').default('active').notNull(),
  personalOwnerUserId: text('personal_owner_user_id').references(() => users.id, { onDelete: 'restrict' }),
  createdByPrincipalId: text('created_by_principal_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('workspaces_slug_idx').on(sql`lower("slug")`),
  uniqueIndex('workspaces_personal_owner_idx').on(table.personalOwnerUserId).where(sql`"kind" = 'personal'`),
  index('workspaces_status_updated_idx').on(table.status, table.updatedAt),
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
  uniqueIndex('workspace_principals_human_idx').on(table.workspaceId, table.userId).where(sql`"type" = 'human'`),
  uniqueIndex('workspace_principals_agent_idx').on(table.workspaceId, table.agentId).where(sql`"type" = 'agent'`),
  uniqueIndex('workspace_principals_service_idx').on(table.workspaceId, table.serviceId).where(sql`"type" = 'service'`),
  index('workspace_principals_workspace_type_idx').on(table.workspaceId, table.type, table.archivedAt),
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
  index('workspace_memberships_principal_idx').on(table.principalId),
  index('workspace_memberships_workspace_role_status_idx').on(table.workspaceId, table.role, table.status),
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
  primaryKey({ columns: [table.resourceType, table.resourceId] }),
  index('workspace_resource_scopes_workspace_idx').on(table.workspaceId, table.resourceType, table.resourceId),
])

// ────────────────────────────────────────────────────────────────────────────
// Conversation collaboration tables
// ────────────────────────────────────────────────────────────────────────────

export const conversationParticipants = pgTable('conversation_participants', {
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  principalType: workspacePrincipalType('principal_type').notNull(),
  role: conversationParticipantRole('role').notNull().default('member'),
  status: conversationParticipantStatus('status').notNull().default('active'),
  notificationLevel: conversationNotificationLevel('notification_level').notNull().default('all'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  lastReadSequence: integer('last_read_sequence'),
  markedUnreadAt: timestamp('marked_unread_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.principalId] }),
  index('conversation_participants_principal_status_idx').on(table.workspaceId, table.principalId, table.status),
  index('conversation_participants_conversation_status_idx').on(table.conversationId, table.status),
])

export const workspacePresence = pgTable('workspace_presence', {
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  status: workspacePresenceStatus('status').notNull().default('online'),
  sessionId: text('session_id'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  typingExpiresAt: timestamp('typing_expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.principalId] }),
  index('workspace_presence_conversation_idx').on(table.conversationId, table.updatedAt),
  index('workspace_presence_session_id_idx').on(table.sessionId),
])

export const workspaceNotifications = pgTable('workspace_notifications', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  recipientPrincipalId: text('recipient_principal_id').notNull(),
  type: workspaceNotificationType('type').notNull(),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => conversationMessages.id, { onDelete: 'cascade' }),
  threadRootMessageId: text('thread_root_message_id').references(() => conversationMessages.id, { onDelete: 'cascade' }),
  actorPrincipalId: text('actor_principal_id'),
  title: text('title').notNull(),
  body: text('body'),
  eventSequence: bigint('event_sequence', { mode: 'number' }),
  mentionScope: text('mention_scope'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (table) => [
  index('workspace_notifications_recipient_unread_idx').on(table.workspaceId, table.recipientPrincipalId, table.readAt),
  index('workspace_notifications_conversation_idx').on(table.conversationId),
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
  index('conversation_thread_follows_principal_idx').on(table.workspaceId, table.principalId, table.followedAt),
  index('conversation_thread_follows_thread_idx').on(table.conversationId, table.threadRootMessageId),
])

export const conversationMessageReactions = pgTable('conversation_message_reactions', {
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.principalId, table.emoji] }),
  index('conversation_message_reactions_conversation_idx').on(table.conversationId),
  index('conversation_message_reactions_workspace_idx').on(table.workspaceId),
  index('conversation_message_reactions_message_idx').on(table.messageId),
])

export const conversationPins = pgTable('conversation_pins', {
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  pinnedByPrincipalId: text('pinned_by_principal_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.messageId] }),
  index('conversation_pins_conversation_idx').on(table.conversationId),
  index('conversation_pins_workspace_idx').on(table.workspaceId),
])

export const conversationSavedMessages = pgTable('conversation_saved_messages', {
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  principalId: text('principal_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.principalId] }),
  index('conversation_saved_messages_workspace_principal_idx').on(table.workspaceId, table.principalId),
])

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

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

export const uploadIntentStatus = pgEnum('overlay_upload_intent_status', [
  'pending',
  'finalized',
  'expired',
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
  parentId: text('parent_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('projects_user_id_idx').on(table.userId),
  uniqueIndex('projects_user_id_client_id_idx').on(table.userId, table.clientId),
  index('projects_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('projects_parent_id_idx').on(table.parentId),
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
}, (table) => [
  index('conversations_user_id_idx').on(table.userId),
  uniqueIndex('conversations_user_id_client_id_idx').on(table.userId, table.clientId),
  index('conversations_user_id_last_modified_idx').on(table.userId, table.lastModified),
  index('conversations_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('conversations_deleted_at_created_at_idx').on(table.deletedAt, table.createdAt),
  index('conversations_project_id_idx').on(table.projectId),
  uniqueIndex('conversations_share_token_idx').on(table.shareToken),
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
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('conversation_messages_conversation_id_idx').on(table.conversationId),
  index('conversation_messages_user_id_idx').on(table.userId),
  index('conversation_messages_conversation_created_at_idx').on(table.conversationId, table.createdAt),
  index('conversation_messages_conversation_status_updated_at_idx').on(table.conversationId, table.status, table.updatedAt),
  index('conversation_messages_status_updated_at_idx').on(table.status, table.updatedAt),
  index('conversation_messages_turn_id_idx').on(table.turnId),
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

export const files = pgTable('files', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: fileType('type').notNull(),
  kind: fileKind('kind'),
  parentId: text('parent_id'),
  content: text('content'),
  textContent: text('text_content'),
  storageId: text('storage_id'),
  r2Key: text('r2_key'),
  mimeType: text('mime_type'),
  extension: text('extension'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  contentHash: text('content_hash'),
  duplicateOfFileId: text('duplicate_of_file_id'),
  indexable: boolean('indexable'),
  indexStatus: fileIndexStatus('index_status'),
  indexedAt: timestamp('indexed_at', { withTimezone: true }),
  indexError: text('index_error'),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  turnId: text('turn_id'),
  modelId: text('model_id'),
  prompt: text('prompt'),
  outputType: text('output_type'),
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
  uniqueIndex('files_share_token_idx').on(table.shareToken),
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
  index('r2_upload_intents_r2_key_idx').on(table.r2Key),
  index('r2_upload_intents_user_id_status_expires_at_idx').on(table.userId, table.status, table.expiresAt),
  index('r2_upload_intents_file_id_idx').on(table.fileId),
])

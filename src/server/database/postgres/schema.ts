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
  parentId: text('parent_id').references((): AnyPgColumn => projects.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('projects_user_id_idx').on(table.userId),
  uniqueIndex('projects_user_id_client_id_idx').on(table.userId, table.clientId),
  index('projects_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  index('projects_parent_id_idx').on(table.parentId),
  check('projects_parent_not_self_check', sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
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

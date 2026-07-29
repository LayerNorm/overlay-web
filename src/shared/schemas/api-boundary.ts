import { z, type ZodTypeAny } from 'zod'
import {
  CreateWebhookSubscriptionRequest,
  DeleteWebhookSubscriptionRequest,
  UpdateWebhookSubscriptionRequest,
  WebhookSubscriptionListQuery,
} from './webhooks'
import {
  ActConversationRequest,
  AddConversationMessageRequest,
  AdminAuditListQuery,
  AdminAuthorizationAssignmentQuery,
  AdminAuthorizationAssignmentRequest,
  AdminAuthorizationEmptyQuery,
  AdminAuthorizationGrantCreateRequest,
  AdminAuthorizationGrantDeleteRequest,
  AdminAuthorizationGrantQuery,
  AdminAuthorizationGroupCreateRequest,
  AdminAuthorizationGroupDeleteRequest,
  AdminAuthorizationGroupListQuery,
  AdminAuthorizationGroupUpdateRequest,
  AdminAuthorizationMembershipQuery,
  AdminAuthorizationMembershipRequest,
  AdminAuthorizationRoleCreateRequest,
  AdminAuthorizationRoleDeleteRequest,
  AdminAuthorizationRoleListQuery,
  AdminAuthorizationRoleUpdateRequest,
  AdminPrincipalDeleteRequest,
  AdminPrincipalListQuery,
  AdminPrincipalRequest,
  AdminUsageAdjustRequest,
  AdminUsageListQuery,
  AutomationListQuery,
  BrowserTaskRequest,
  BootstrapQuery,
  ChatSuggestionQuery,
  ConversationListQuery,
  ConversationEventsQuery,
  CreateAutomationRequest,
  CreateConversationRequest,
  CreateFileRequest,
  CreateMemoryRequest,
  CreateNoteRequest,
  CreateProjectRequest,
  DaytonaRunRequest,
  DeleteAutomationRequest,
  DeleteConversationMessageRequest,
  DeleteConversationRequest,
  DeleteFileRequest,
  DeleteMemoryRequest,
  DeleteNoteRequest,
  DeleteOutputRequest,
  DeleteProjectRequest,
  EntityDeleteRequest,
  EntityListQuery,
  EntityMutationRequest,
  FileContentQuery,
  FileListQuery,
  GenerateImageRequest,
  GenerateTabGroupLabelRequest,
  GenerateTitleRequest,
  GenerateVideoRequest,
  GovernanceAccessReviewListQuery,
  GovernanceComplianceExportQuery,
  GovernancePolicyListQuery,
  CreateGovernanceAccessReviewRequest,
  CreateGovernancePolicyRequest,
  DecideGovernancePolicyRequest,
  CompleteGovernanceAccessReviewRequest,
  IngestDocumentForm,
  IntegrationConnectRequest,
  IntegrationListQuery,
  KnowledgeSearchRequest,
  EnsurePersonalKnowledgeBaseRequest,
  KnowledgeBaseDiagnosticsQuery,
  KnowledgeBaseEmptyQuery,
  KnowledgeBaseSourceUploadForm,
  KnowledgeBaseListQuery,
  KnowledgeBaseShareDirectoryQuery,
  AdminKnowledgeBaseListQuery,
  CreateKnowledgeBaseRequest,
  UpdateKnowledgeBaseRequest,
  DeleteKnowledgeBaseRequest,
  CreateKnowledgeBaseSourceRequest,
  UpdateKnowledgeBaseSourceRequest,
  DeleteKnowledgeBaseSourceRequest,
  ReindexKnowledgeBaseRequest,
  SearchKnowledgeBaseRequest,
  CreateKnowledgeBaseGrantRequest,
  DeleteKnowledgeBaseGrantRequest,
  McpTestRequest,
  MemoryListQuery,
  NoteListQuery,
  NotebookAgentRequest,
  OnboardingMutationRequest,
  OnboardingStatusQuery,
  OutputContentQuery,
  OutputListQuery,
  PresignFileQuery,
  AttachProjectKnowledgeBaseRequest,
  DetachProjectKnowledgeBaseRequest,
  ProjectKnowledgeBaseListQuery,
  DuplicateProjectRequest,
  ProjectKnowledgeTransferRequest,
  ProjectTemplateListQuery,
  ProjectListQuery,
  SearchFileTextRequest,
  BillingSettingsQuery,
  SettingsQuery,
  ShareConversationRequest,
  ShareFileRequest,
  StopConversationRequest,
  StreamAuthRequest,
  SubscriptionQuery,
  TestAutomationRequest,
  TranscribeRequest,
  UpdateAutomationRequest,
  UpdateConversationRequest,
  UpdateFileRequest,
  UpdateMemoryRequest,
  UpdateNoteRequest,
  UpdateBillingSettingsRequest,
  UpdateProjectRequest,
  UpdateSettingsRequest,
  UploadUrlRequest,
  RunAutomationRequest,
  EmptyQuery,
  EmptyRequest,
  UnknownResponse,
} from './index'

export type ApiBoundarySchema = {
  query?: ZodTypeAny
  json?: ZodTypeAny
  formData?: ZodTypeAny
  response?: ZodTypeAny
}

export type WebApiBoundaryDefinition = {
  method: string
  path: string
  schema: ApiBoundarySchema
  summary: string
  description?: string
  tag: string
  routePath?: string
  pattern?: RegExp
  publicReference?: boolean
}

export type WebApiExcludedRouteDefinition = {
  routePath: string
  reason: string
}

const ModelCatalogQuery = z.object({
  refresh: z.enum(['1']).optional(),
})

function knowledgeBaseDynamicBoundaries(): WebApiBoundaryDefinition[] {
  const route = (suffix: string) => `/api/v1/knowledge-bases/{knowledgeBaseId}${suffix}`
  const routePath = (suffix: string) => `/api/v1/knowledge-bases/[knowledgeBaseId]${suffix}`
  const pattern = (suffix: string) => new RegExp(`^/api/v1/knowledge-bases/[^/]+${suffix}$`)
  return [
    { method: 'GET', path: route('/sources'), routePath: routePath('/sources'), pattern: pattern('/sources'), schema: { query: KnowledgeBaseEmptyQuery }, summary: 'List knowledge-base sources', tag: 'Knowledge Bases' },
    { method: 'POST', path: route('/sources'), routePath: routePath('/sources'), pattern: pattern('/sources'), schema: { json: CreateKnowledgeBaseSourceRequest }, summary: 'Add a knowledge-base source', tag: 'Knowledge Bases' },
    { method: 'PATCH', path: route('/sources'), routePath: routePath('/sources'), pattern: pattern('/sources'), schema: { json: UpdateKnowledgeBaseSourceRequest }, summary: 'Update a knowledge-base source', tag: 'Knowledge Bases' },
    { method: 'DELETE', path: route('/sources'), routePath: routePath('/sources'), pattern: pattern('/sources'), schema: { json: DeleteKnowledgeBaseSourceRequest }, summary: 'Remove a knowledge-base source', tag: 'Knowledge Bases' },
    { method: 'POST', path: route('/sources/upload'), routePath: routePath('/sources/upload'), pattern: pattern('/sources/upload'), schema: { formData: KnowledgeBaseSourceUploadForm }, summary: 'Upload and index a knowledge-base source', tag: 'Knowledge Bases' },
    { method: 'POST', path: route('/search'), routePath: routePath('/search'), pattern: pattern('/search'), schema: { json: SearchKnowledgeBaseRequest }, summary: 'Search an authorized knowledge base', tag: 'Knowledge Bases' },
    { method: 'GET', path: route('/conversations'), routePath: routePath('/conversations'), pattern: pattern('/conversations'), schema: { query: KnowledgeBaseEmptyQuery }, summary: 'List personal conversations attached to a knowledge base', tag: 'Knowledge Bases' },
    { method: 'GET', path: route('/diagnostics'), routePath: routePath('/diagnostics'), pattern: pattern('/diagnostics'), schema: { query: KnowledgeBaseDiagnosticsQuery }, summary: 'Read knowledge-base indexing diagnostics or a source extraction preview', tag: 'Knowledge Bases' },
    { method: 'GET', path: route('/reindex'), routePath: routePath('/reindex'), pattern: pattern('/reindex'), schema: { query: KnowledgeBaseEmptyQuery }, summary: 'List knowledge-base sources with an untrustworthy index', tag: 'Knowledge Bases' },
    { method: 'POST', path: route('/reindex'), routePath: routePath('/reindex'), pattern: pattern('/reindex'), schema: { json: ReindexKnowledgeBaseRequest }, summary: 'Re-embed a knowledge-base source or the whole base', tag: 'Knowledge Bases' },
    { method: 'GET', path: route('/grants'), routePath: routePath('/grants'), pattern: pattern('/grants'), schema: { query: KnowledgeBaseEmptyQuery }, summary: 'List knowledge-base shares', tag: 'Knowledge Bases' },
    { method: 'POST', path: route('/grants'), routePath: routePath('/grants'), pattern: pattern('/grants'), schema: { json: CreateKnowledgeBaseGrantRequest }, summary: 'Share a knowledge base', tag: 'Knowledge Bases' },
    { method: 'DELETE', path: route('/grants'), routePath: routePath('/grants'), pattern: pattern('/grants'), schema: { json: DeleteKnowledgeBaseGrantRequest }, summary: 'Revoke a knowledge-base share', tag: 'Knowledge Bases' },
  ]
}

export const webApiBoundaryDefinitions = [
  {
    method: 'GET',
    path: '/api/v1/automations',
    schema: { query: AutomationListQuery },
    summary: 'List automations',
    tag: 'Automations',
  },
  {
    method: 'GET',
    path: '/api/v1/conversations/events',
    schema: { query: ConversationEventsQuery },
    summary: 'Wait for durable conversation changes after a cursor',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/automations',
    schema: { json: CreateAutomationRequest },
    summary: 'Create an automation',
    tag: 'Automations',
  },
  {
    method: 'PATCH',
    path: '/api/v1/automations',
    schema: { json: UpdateAutomationRequest },
    summary: 'Update an automation',
    tag: 'Automations',
  },
  {
    method: 'DELETE',
    path: '/api/v1/automations',
    schema: { query: DeleteAutomationRequest, json: DeleteAutomationRequest },
    summary: 'Delete an automation',
    tag: 'Automations',
  },
  {
    method: 'POST',
    path: '/api/v1/automations/run',
    schema: { json: RunAutomationRequest },
    summary: 'Run an automation',
    tag: 'Automations',
  },
  {
    method: 'POST',
    path: '/api/v1/automations/test',
    schema: { json: TestAutomationRequest },
    summary: 'Test an automation draft',
    tag: 'Automations',
  },
  {
    method: 'GET',
    path: '/api/v1/bootstrap',
    schema: { query: BootstrapQuery },
    summary: 'Load signed-in app bootstrap state',
    tag: 'Bootstrap',
  },
  {
    method: 'POST',
    path: '/api/v1/browser-task',
    schema: { json: BrowserTaskRequest },
    summary: 'Start a browser task',
    tag: 'Tools',
  },
  {
    method: 'GET',
    path: '/api/v1/chat-suggestions',
    schema: { query: ChatSuggestionQuery },
    summary: 'List chat starter suggestions',
    tag: 'Chat',
  },
  {
    method: 'GET',
    path: '/api/v1/conversations',
    schema: { query: ConversationListQuery },
    summary: 'List or read conversations',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/conversations',
    schema: { json: CreateConversationRequest },
    summary: 'Create a conversation',
    tag: 'Conversations',
  },
  {
    method: 'PATCH',
    path: '/api/v1/conversations',
    schema: { json: UpdateConversationRequest },
    summary: 'Update a conversation',
    tag: 'Conversations',
  },
  {
    method: 'DELETE',
    path: '/api/v1/conversations',
    schema: { query: DeleteConversationRequest, json: DeleteConversationRequest },
    summary: 'Delete a conversation',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/conversations/act',
    schema: { json: ActConversationRequest },
    summary: 'Run an Act turn',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/conversations/act/extension-plan',
    schema: { json: ActConversationRequest },
    summary: 'Plan extension actions for an Act turn',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/conversations/message',
    schema: { json: AddConversationMessageRequest },
    summary: 'Add a conversation message',
    tag: 'Conversations',
  },
  {
    method: 'DELETE',
    path: '/api/v1/conversations/message',
    schema: { json: DeleteConversationMessageRequest },
    summary: 'Delete a conversation message',
    tag: 'Conversations',
  },
  {
    method: 'PATCH',
    path: '/api/v1/conversations/share',
    schema: { json: ShareConversationRequest },
    summary: 'Update conversation sharing',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/conversations/stop',
    schema: { json: StopConversationRequest },
    summary: 'Stop a running conversation turn',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/conversations/stream-auth',
    schema: { json: StreamAuthRequest },
    summary: 'Create a stream auth token',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/daytona/run',
    schema: { json: DaytonaRunRequest },
    summary: 'Run code in a Daytona sandbox',
    tag: 'Tools',
  },
  { method: 'GET', path: '/api/v1/files', schema: { query: FileListQuery }, summary: 'List or read files', tag: 'Files' },
  { method: 'POST', path: '/api/v1/files', schema: { json: CreateFileRequest }, summary: 'Create a file', tag: 'Files' },
  { method: 'PATCH', path: '/api/v1/files', schema: { json: UpdateFileRequest }, summary: 'Update a file', tag: 'Files' },
  {
    method: 'DELETE',
    path: '/api/v1/files',
    schema: { query: DeleteFileRequest, json: DeleteFileRequest },
    summary: 'Delete a file',
    tag: 'Files',
  },
  {
    method: 'GET',
    path: '/api/v1/files/{fileId}/content',
    routePath: '/api/v1/files/[fileId]/content',
    pattern: /^\/api\/v1\/files\/[^/]+\/content$/,
    schema: { query: FileContentQuery },
    summary: 'Download file content',
    tag: 'Files',
  },
  {
    method: 'POST',
    path: '/api/v1/files/ingest-document',
    schema: { formData: IngestDocumentForm },
    summary: 'Ingest an uploaded document',
    tag: 'Files',
  },
  { method: 'GET', path: '/api/v1/files/presign', schema: { query: PresignFileQuery }, summary: 'Presign file access', tag: 'Files' },
  {
    method: 'POST',
    path: '/api/v1/files/search-text',
    schema: { json: SearchFileTextRequest },
    summary: 'Search file text',
    tag: 'Files',
  },
  {
    method: 'PATCH',
    path: '/api/v1/files/share',
    schema: { json: ShareFileRequest },
    summary: 'Update file sharing',
    tag: 'Files',
  },
  {
    method: 'POST',
    path: '/api/v1/files/upload-url',
    schema: { json: UploadUrlRequest },
    summary: 'Create an upload URL',
    tag: 'Files',
  },
  {
    method: 'POST',
    path: '/api/v1/generate-image',
    schema: { json: GenerateImageRequest },
    summary: 'Generate an image',
    tag: 'Media',
  },
  {
    method: 'POST',
    path: '/api/v1/generate-tab-group-label',
    schema: { json: GenerateTabGroupLabelRequest },
    summary: 'Generate a tab group label',
    tag: 'Tools',
  },
  {
    method: 'POST',
    path: '/api/v1/generate-title',
    schema: { json: GenerateTitleRequest },
    summary: 'Generate a conversation title',
    tag: 'Chat',
  },
  {
    method: 'POST',
    path: '/api/v1/generate-video',
    schema: { json: GenerateVideoRequest },
    summary: 'Generate a video',
    tag: 'Media',
  },
  {
    method: 'GET',
    path: '/api/v1/integrations',
    schema: { query: IntegrationListQuery },
    summary: 'List integrations',
    tag: 'Integrations',
  },
  {
    method: 'POST',
    path: '/api/v1/integrations',
    schema: { json: IntegrationConnectRequest },
    summary: 'Connect an integration',
    tag: 'Integrations',
  },
  {
    method: 'POST',
    path: '/api/v1/knowledge/search',
    schema: { json: KnowledgeSearchRequest },
    summary: 'Search knowledge',
    tag: 'Knowledge',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/knowledge-bases',
    schema: { query: AdminKnowledgeBaseListQuery },
    summary: 'List all knowledge bases for administration',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/knowledge-bases',
    schema: { query: KnowledgeBaseListQuery },
    summary: 'List accessible knowledge bases',
    tag: 'Knowledge Bases',
  },
  {
    method: 'GET',
    path: '/api/v1/knowledge-bases/personal',
    schema: { query: KnowledgeBaseEmptyQuery },
    summary: 'List the caller\'s personal knowledge bases',
    tag: 'Knowledge Bases',
  },
  {
    method: 'POST',
    path: '/api/v1/knowledge-bases/personal',
    schema: { json: EnsurePersonalKnowledgeBaseRequest },
    summary: 'Get or create the caller\'s default personal knowledge base',
    tag: 'Knowledge Bases',
  },
  {
    method: 'GET',
    path: '/api/v1/knowledge-bases/share-directory',
    schema: { query: KnowledgeBaseShareDirectoryQuery },
    summary: 'List users, groups, and roles available for knowledge sharing',
    tag: 'Knowledge Bases',
  },
  {
    method: 'POST',
    path: '/api/v1/knowledge-bases',
    schema: { json: CreateKnowledgeBaseRequest },
    summary: 'Create a knowledge base',
    tag: 'Knowledge Bases',
  },
  {
    method: 'PATCH',
    path: '/api/v1/knowledge-bases',
    schema: { json: UpdateKnowledgeBaseRequest },
    summary: 'Update a knowledge base',
    tag: 'Knowledge Bases',
  },
  {
    method: 'DELETE',
    path: '/api/v1/knowledge-bases',
    schema: { json: DeleteKnowledgeBaseRequest },
    summary: 'Delete a knowledge base',
    tag: 'Knowledge Bases',
  },
  ...knowledgeBaseDynamicBoundaries(),
  { method: 'GET', path: '/api/v1/mcps', schema: { query: EntityListQuery }, summary: 'List MCP servers', tag: 'MCP Servers' },
  { method: 'POST', path: '/api/v1/mcps', schema: { json: EntityMutationRequest }, summary: 'Create an MCP server', tag: 'MCP Servers' },
  { method: 'PATCH', path: '/api/v1/mcps', schema: { json: EntityMutationRequest }, summary: 'Update an MCP server', tag: 'MCP Servers' },
  {
    method: 'DELETE',
    path: '/api/v1/mcps',
    schema: { query: EntityDeleteRequest, json: EntityDeleteRequest },
    summary: 'Delete an MCP server',
    tag: 'MCP Servers',
  },
  { method: 'POST', path: '/api/v1/mcps/test', schema: { json: McpTestRequest }, summary: 'Test an MCP server', tag: 'MCP Servers' },
  { method: 'GET', path: '/api/v1/memory', schema: { query: MemoryListQuery }, summary: 'List memories', tag: 'Memory' },
  { method: 'POST', path: '/api/v1/memory', schema: { json: CreateMemoryRequest }, summary: 'Create a memory', tag: 'Memory' },
  { method: 'PATCH', path: '/api/v1/memory', schema: { json: UpdateMemoryRequest }, summary: 'Update a memory', tag: 'Memory' },
  {
    method: 'DELETE',
    path: '/api/v1/memory',
    schema: { query: DeleteMemoryRequest, json: DeleteMemoryRequest },
    summary: 'Delete a memory',
    tag: 'Memory',
  },
  {
    method: 'POST',
    path: '/api/v1/notebook-agent',
    schema: { json: NotebookAgentRequest },
    summary: 'Run the notebook agent',
    tag: 'Notes',
  },
  { method: 'GET', path: '/api/v1/notes', schema: { query: NoteListQuery }, summary: 'List notes', tag: 'Notes' },
  { method: 'POST', path: '/api/v1/notes', schema: { json: CreateNoteRequest }, summary: 'Create a note', tag: 'Notes' },
  { method: 'PATCH', path: '/api/v1/notes', schema: { json: UpdateNoteRequest }, summary: 'Update a note', tag: 'Notes' },
  {
    method: 'DELETE',
    path: '/api/v1/notes',
    schema: { query: DeleteNoteRequest, json: DeleteNoteRequest },
    summary: 'Delete a note',
    tag: 'Notes',
  },
  {
    method: 'POST',
    path: '/api/v1/onboarding/complete',
    schema: { json: OnboardingMutationRequest },
    summary: 'Complete onboarding',
    tag: 'Onboarding',
  },
  {
    method: 'POST',
    path: '/api/v1/onboarding/reset',
    schema: { json: OnboardingMutationRequest },
    summary: 'Reset onboarding',
    tag: 'Onboarding',
  },
  {
    method: 'GET',
    path: '/api/v1/onboarding/status',
    schema: { query: OnboardingStatusQuery },
    summary: 'Read onboarding status',
    tag: 'Onboarding',
  },
  { method: 'GET', path: '/api/v1/outputs', schema: { query: OutputListQuery }, summary: 'List outputs', tag: 'Outputs' },
  {
    method: 'DELETE',
    path: '/api/v1/outputs',
    schema: { query: DeleteOutputRequest, json: DeleteOutputRequest },
    summary: 'Delete an output',
    tag: 'Outputs',
  },
  {
    method: 'GET',
    path: '/api/v1/outputs/{outputId}/content',
    routePath: '/api/v1/outputs/[outputId]/content',
    pattern: /^\/api\/v1\/outputs\/[^/]+\/content$/,
    schema: { query: OutputContentQuery },
    summary: 'Download output content',
    tag: 'Outputs',
  },
  { method: 'GET', path: '/api/v1/projects', schema: { query: ProjectListQuery }, summary: 'List projects', tag: 'Projects' },
  { method: 'POST', path: '/api/v1/projects', schema: { json: CreateProjectRequest }, summary: 'Create a project', tag: 'Projects' },
  { method: 'PATCH', path: '/api/v1/projects', schema: { json: UpdateProjectRequest }, summary: 'Update a project', tag: 'Projects' },
  {
    method: 'DELETE',
    path: '/api/v1/projects',
    schema: { query: DeleteProjectRequest, json: DeleteProjectRequest },
    summary: 'Delete a project',
    tag: 'Projects',
  },
  {
    method: 'GET',
    path: '/api/v1/projects/duplicate',
    schema: { query: ProjectTemplateListQuery },
    summary: 'List projects marked as reusable templates',
    tag: 'Projects',
  },
  {
    method: 'POST',
    path: '/api/v1/projects/duplicate',
    schema: { json: DuplicateProjectRequest },
    summary: 'Create a project from an existing project or template',
    tag: 'Projects',
  },
  {
    method: 'POST',
    path: '/api/v1/projects/knowledge-transfer',
    schema: { json: ProjectKnowledgeTransferRequest },
    summary: 'Promote a project file into a knowledge base, or copy a source back',
    tag: 'Projects',
  },
  {
    method: 'GET',
    path: '/api/v1/projects/knowledge-bases',
    schema: { query: ProjectKnowledgeBaseListQuery },
    summary: 'List knowledge bases attached to a project',
    tag: 'Projects',
  },
  {
    method: 'POST',
    path: '/api/v1/projects/knowledge-bases',
    schema: { json: AttachProjectKnowledgeBaseRequest },
    summary: 'Attach a knowledge base to a project',
    tag: 'Projects',
  },
  {
    method: 'DELETE',
    path: '/api/v1/projects/knowledge-bases',
    schema: { query: DetachProjectKnowledgeBaseRequest, json: DetachProjectKnowledgeBaseRequest },
    summary: 'Detach a knowledge base from a project',
    tag: 'Projects',
  },
  { method: 'GET', path: '/api/v1/settings', schema: { query: SettingsQuery }, summary: 'Read settings', tag: 'Settings' },
  { method: 'PATCH', path: '/api/v1/settings', schema: { json: UpdateSettingsRequest }, summary: 'Update settings', tag: 'Settings' },
  { method: 'GET', path: '/api/v1/skills', schema: { query: EntityListQuery }, summary: 'List skills', tag: 'Skills' },
  { method: 'POST', path: '/api/v1/skills', schema: { json: EntityMutationRequest }, summary: 'Create a skill', tag: 'Skills' },
  { method: 'PATCH', path: '/api/v1/skills', schema: { json: EntityMutationRequest }, summary: 'Update a skill', tag: 'Skills' },
  {
    method: 'DELETE',
    path: '/api/v1/skills',
    schema: { query: EntityDeleteRequest, json: EntityDeleteRequest },
    summary: 'Delete a skill',
    tag: 'Skills',
  },
  {
    method: 'GET',
    path: '/api/v1/subscription',
    schema: { query: SubscriptionQuery },
    summary: 'Read subscription state',
    tag: 'Billing',
  },
  {
    method: 'GET',
    path: '/api/v1/subscription/settings',
    schema: { query: BillingSettingsQuery },
    summary: 'Read billing settings',
    tag: 'Billing',
  },
  {
    method: 'POST',
    path: '/api/v1/subscription/settings',
    schema: { json: UpdateBillingSettingsRequest },
    summary: 'Update billing settings',
    tag: 'Billing',
  },
  { method: 'POST', path: '/api/v1/transcribe', schema: { formData: TranscribeRequest }, summary: 'Transcribe audio', tag: 'Media' },
  {
    method: 'GET',
    path: '/api/v1/webhooks',
    schema: { query: WebhookSubscriptionListQuery },
    summary: 'List webhook subscriptions',
    tag: 'Webhooks',
  },
  {
    method: 'POST',
    path: '/api/v1/webhooks',
    schema: { json: CreateWebhookSubscriptionRequest },
    summary: 'Create a webhook subscription',
    tag: 'Webhooks',
  },
  {
    method: 'PATCH',
    path: '/api/v1/webhooks',
    schema: { json: UpdateWebhookSubscriptionRequest },
    summary: 'Update a webhook subscription',
    tag: 'Webhooks',
  },
  {
    method: 'DELETE',
    path: '/api/v1/webhooks',
    schema: { query: DeleteWebhookSubscriptionRequest, json: DeleteWebhookSubscriptionRequest },
    summary: 'Delete a webhook subscription',
    tag: 'Webhooks',
  },
  {
    method: 'GET',
    path: '/api/v1/api-keys',
    schema: { query: EmptyQuery, response: UnknownResponse },
    summary: 'API key management status',
    description: 'Returns 501 until API key management is exposed.',
    tag: 'API Keys',
    publicReference: false,
  },
  {
    method: 'POST',
    path: '/api/v1/api-keys',
    schema: { json: EmptyRequest, response: UnknownResponse },
    summary: 'Create an API key',
    description: 'Returns 501 until API key management is exposed.',
    tag: 'API Keys',
    publicReference: false,
  },
  {
    method: 'PATCH',
    path: '/api/v1/api-keys',
    schema: { json: EmptyRequest, response: UnknownResponse },
    summary: 'Update an API key',
    description: 'Returns 501 until API key management is exposed.',
    tag: 'API Keys',
    publicReference: false,
  },
  {
    method: 'DELETE',
    path: '/api/v1/api-keys',
    schema: { query: EmptyQuery, json: EmptyRequest, response: UnknownResponse },
    summary: 'Delete an API key',
    description: 'Returns 501 until API key management is exposed.',
    tag: 'API Keys',
    publicReference: false,
  },
  {
    method: 'GET',
    path: '/api/v1/capabilities',
    schema: { query: EmptyQuery, response: UnknownResponse },
    summary: 'Read web capabilities',
    tag: 'Bootstrap',
  },
  {
    method: 'GET',
    path: '/api/v1/model-catalog',
    schema: { query: ModelCatalogQuery, response: UnknownResponse },
    summary: 'Read the model catalog',
    description: 'Pass refresh=1 to force a gateway catalog refresh.',
    tag: 'Models',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/audit',
    schema: { query: AdminAuditListQuery },
    summary: 'List audit events',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/principals',
    schema: { query: AdminPrincipalListQuery },
    summary: 'List administrative principals',
    tag: 'Administration',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/principals',
    schema: { json: AdminPrincipalRequest },
    summary: 'Grant an administrative principal',
    tag: 'Administration',
  },
  {
    method: 'DELETE',
    path: '/api/v1/admin/principals',
    schema: { json: AdminPrincipalDeleteRequest },
    summary: 'Revoke an administrative principal',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/usage',
    schema: { query: AdminUsageListQuery },
    summary: 'List administrative usage',
    tag: 'Administration',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/usage',
    schema: { json: AdminUsageAdjustRequest },
    summary: 'Adjust an administrative budget',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/authorization/capabilities',
    schema: { query: AdminAuthorizationEmptyQuery },
    summary: 'List authorization capabilities',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/authorization/roles',
    schema: { query: AdminAuthorizationRoleListQuery },
    summary: 'List custom authorization roles',
    tag: 'Administration',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/authorization/roles',
    schema: { json: AdminAuthorizationRoleCreateRequest },
    summary: 'Create a custom authorization role',
    tag: 'Administration',
  },
  {
    method: 'PATCH',
    path: '/api/v1/admin/authorization/roles',
    schema: { json: AdminAuthorizationRoleUpdateRequest },
    summary: 'Update a custom authorization role',
    tag: 'Administration',
  },
  {
    method: 'DELETE',
    path: '/api/v1/admin/authorization/roles',
    schema: { json: AdminAuthorizationRoleDeleteRequest },
    summary: 'Archive a custom authorization role',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/authorization/groups',
    schema: { query: AdminAuthorizationGroupListQuery },
    summary: 'List authorization groups',
    tag: 'Administration',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/authorization/groups',
    schema: { json: AdminAuthorizationGroupCreateRequest },
    summary: 'Create an authorization group',
    tag: 'Administration',
  },
  {
    method: 'PATCH',
    path: '/api/v1/admin/authorization/groups',
    schema: { json: AdminAuthorizationGroupUpdateRequest },
    summary: 'Update an authorization group',
    tag: 'Administration',
  },
  {
    method: 'DELETE',
    path: '/api/v1/admin/authorization/groups',
    schema: { json: AdminAuthorizationGroupDeleteRequest },
    summary: 'Archive an authorization group',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/authorization/memberships',
    schema: { query: AdminAuthorizationMembershipQuery },
    summary: 'List group memberships',
    tag: 'Administration',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/authorization/memberships',
    schema: { json: AdminAuthorizationMembershipRequest },
    summary: 'Add a group membership',
    tag: 'Administration',
  },
  {
    method: 'DELETE',
    path: '/api/v1/admin/authorization/memberships',
    schema: { json: AdminAuthorizationMembershipRequest },
    summary: 'Remove a group membership',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/authorization/assignments',
    schema: { query: AdminAuthorizationAssignmentQuery },
    summary: 'List role assignments',
    tag: 'Administration',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/authorization/assignments',
    schema: { json: AdminAuthorizationAssignmentRequest },
    summary: 'Assign a role',
    tag: 'Administration',
  },
  {
    method: 'DELETE',
    path: '/api/v1/admin/authorization/assignments',
    schema: { json: AdminAuthorizationAssignmentRequest },
    summary: 'Revoke a role',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/authorization/grants',
    schema: { query: AdminAuthorizationGrantQuery },
    summary: 'List resource access grants',
    tag: 'Administration',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/authorization/grants',
    schema: { json: AdminAuthorizationGrantCreateRequest },
    summary: 'Create or update a resource access grant',
    tag: 'Administration',
  },
  {
    method: 'DELETE',
    path: '/api/v1/admin/authorization/grants',
    schema: { json: AdminAuthorizationGrantDeleteRequest },
    summary: 'Remove a resource access grant',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/governance/policies',
    schema: { query: GovernancePolicyListQuery },
    summary: 'List versioned governance policies',
    tag: 'Administration',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/governance/policies',
    schema: { json: CreateGovernancePolicyRequest },
    summary: 'Create a draft governance policy version',
    tag: 'Administration',
  },
  {
    method: 'PATCH',
    path: '/api/v1/admin/governance/policies',
    schema: { json: DecideGovernancePolicyRequest },
    summary: 'Approve or reject a draft governance policy',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/governance/reviews',
    schema: { query: GovernanceAccessReviewListQuery },
    summary: 'List governance access reviews',
    tag: 'Administration',
  },
  {
    method: 'POST',
    path: '/api/v1/admin/governance/reviews',
    schema: { json: CreateGovernanceAccessReviewRequest },
    summary: 'Open an access review with an ACL snapshot',
    tag: 'Administration',
  },
  {
    method: 'PATCH',
    path: '/api/v1/admin/governance/reviews',
    schema: { json: CompleteGovernanceAccessReviewRequest },
    summary: 'Complete an access review',
    tag: 'Administration',
  },
  {
    method: 'GET',
    path: '/api/v1/admin/governance/export',
    schema: { query: GovernanceComplianceExportQuery },
    summary: 'Export governance and audit evidence',
    tag: 'Administration',
  },
] satisfies readonly WebApiBoundaryDefinition[]

export const webApiExcludedRouteDefinitions = [
  {
    routePath: '/api/v1/extensions/[extensionId]/[...path]',
    reason: 'Extension proxy route. It is not part of the stable public web API reference.',
  },
] as const satisfies readonly WebApiExcludedRouteDefinition[]

const webApiBoundaryDefinitionList: readonly WebApiBoundaryDefinition[] = webApiBoundaryDefinitions

const exactBoundaries: Record<string, ApiBoundarySchema> = Object.fromEntries(
  webApiBoundaryDefinitionList
    .filter((definition) => !definition.pattern)
    .map((definition) => [`${definition.method.toUpperCase()} ${definition.path}`, definition.schema]),
)

const dynamicBoundaries: Array<{
  method: string
  pattern: RegExp
  schema: ApiBoundarySchema
}> = webApiBoundaryDefinitionList
  .filter((definition): definition is WebApiBoundaryDefinition & { pattern: RegExp } => Boolean(definition.pattern))
  .map((definition) => ({
    method: definition.method.toUpperCase(),
    pattern: definition.pattern,
    schema: definition.schema,
  }))

export function getApiBoundarySchema(pathname: string, method: string): ApiBoundarySchema | undefined {
  const key = `${method.toUpperCase()} ${pathname.replace(/\/+$/, '') || '/'}`
  const exact = exactBoundaries[key]
  if (exact) return exact
  return dynamicBoundaries.find((entry) => entry.method === method.toUpperCase() && entry.pattern.test(pathname))
    ?.schema
}

export function queryParamsToObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of searchParams.entries()) {
    const existing = query[key]
    if (existing === undefined) {
      query[key] = value
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      query[key] = [existing, value]
    }
  }
  return query
}

export function validateApiClientBoundary(args: {
  body?: unknown
  method?: string
  path: string
}): void {
  const url = new URL(args.path, 'https://overlay.local')
  const method = (args.method ?? 'GET').toUpperCase()
  const schema = getApiBoundarySchema(url.pathname, method)
  if (!schema) return

  if (schema.query) {
    const result = schema.query.safeParse(queryParamsToObject(url.searchParams))
    if (!result.success) {
      throw new Error(`Invalid ${method} ${url.pathname} query: ${result.error.issues[0]?.message ?? 'validation failed'}`)
    }
  }

  if (args.body !== undefined && schema.json) {
    const result = schema.json.safeParse(args.body)
    if (!result.success) {
      throw new Error(`Invalid ${method} ${url.pathname} body: ${result.error.issues[0]?.message ?? 'validation failed'}`)
    }
  }
}

import { z, type ZodTypeAny } from 'zod'
import {
  commandAcknowledgementSchema,
  enrollmentRequestSchema,
  eventBatchSchema,
  filesystemGrantSchema,
  hostCapabilitiesSchema,
  initialCredentialRequestSchema,
} from '@overlay/agent-bridge-protocol'
import {
  CreateWebhookSubscriptionRequest,
  DeleteWebhookSubscriptionRequest,
  UpdateWebhookSubscriptionRequest,
  WebhookSubscriptionListQuery,
} from './webhooks'
import {
  ActConversationRequest,
  AgentRunApprovalRequest,
  AgentRunMetricEventRequest,
  AgentRunMetricsQuery,
  AddConversationMessageRequest,
  AdminAuditListQuery,
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
  LinkPreviewQuery,
  GenerateVideoRequest,
  IngestDocumentForm,
  IntegrationConnectRequest,
  IntegrationListQuery,
  KnowledgeSearchRequest,
  McpOAuthDisconnectRequest,
  McpOAuthStartRequest,
  McpTestRequest,
  MemoryListQuery,
  NoteListQuery,
  NotebookAgentRequest,
  OnboardingMutationRequest,
  OnboardingStatusQuery,
  OutputContentQuery,
  OutputListQuery,
  PresignFileQuery,
  ProjectListQuery,
  SearchFileTextRequest,
  BillingSettingsQuery,
  SettingsQuery,
  ShareConversationRequest,
  ShareFileRequest,
  StopConversationRequest,
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

const ConversationRunQuery = z.object({
  conversationId: z.string().trim().min(1),
})

const ProviderConnectionMutationRequest = z.object({
  connectionId: z.string().optional(),
  providerId: z.string().optional(),
  endpoint: z.string().url().optional(),
  displayName: z.string().optional(),
  apiKey: z.string().optional(),
  enabledModelIds: z.array(z.string()).optional(),
  status: z.enum(['active', 'error', 'untested']).optional(),
}).passthrough()

const ProviderConnectionDeleteQuery = z.object({
  connectionId: z.string().min(1),
})

const ProviderConnectionTestRequest = z.object({
  connectionId: z.string().optional(),
  providerId: z.string().optional(),
  endpoint: z.string().url().optional(),
  apiKey: z.string().optional(),
})

export const webApiBoundaryDefinitions = [
  {
    method: 'GET', path: '/api/v1/agent-environments', schema: { query: EmptyQuery, response: UnknownResponse },
    summary: 'List connected agent environments in the active workspace', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/enrollment-sessions', schema: { json: EmptyRequest, response: UnknownResponse },
    summary: 'Create a short-lived single-use environment enrollment code', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/managed', schema: { json: EmptyRequest, response: UnknownResponse },
    summary: 'Provision an Overlay Cloud agent environment', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/enroll', schema: { json: enrollmentRequestSchema, response: UnknownResponse },
    summary: 'Redeem an enrollment code and register a device public key', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/{environmentId}/approve', routePath: '/api/v1/agent-environments/[environmentId]/approve',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/approve$/,
    schema: { json: z.object({ filesystemGrant: filesystemGrantSchema }).strict(), response: UnknownResponse },
    summary: 'Approve a pending environment with explicit filesystem roots', tag: 'Agent environments',
  },
  {
    method: 'PATCH', path: '/api/v1/agent-environments/{environmentId}/roots', routePath: '/api/v1/agent-environments/[environmentId]/roots',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/roots$/,
    schema: { json: z.object({ filesystemGrant: filesystemGrantSchema }).strict(), response: UnknownResponse },
    summary: 'Change an environment filesystem grant', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/{environmentId}/revoke', routePath: '/api/v1/agent-environments/[environmentId]/revoke',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/revoke$/,
    schema: { json: EmptyRequest, response: UnknownResponse },
    summary: 'Revoke an environment and its credentials', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/{environmentId}/credentials', routePath: '/api/v1/agent-environments/[environmentId]/credentials',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/credentials$/,
    schema: { json: initialCredentialRequestSchema, response: UnknownResponse },
    summary: 'Issue an initial short-lived environment credential after device proof', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/{environmentId}/credentials/refresh', routePath: '/api/v1/agent-environments/[environmentId]/credentials/refresh',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/credentials\/refresh$/,
    schema: { json: EmptyRequest, response: UnknownResponse },
    summary: 'Rotate a signed environment credential', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/{environmentId}/heartbeat', routePath: '/api/v1/agent-environments/[environmentId]/heartbeat',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/heartbeat$/,
    schema: { json: EmptyRequest, response: UnknownResponse },
    summary: 'Record an authenticated environment heartbeat', tag: 'Agent environments',
  },
  {
    method: 'PUT', path: '/api/v1/agent-environments/{environmentId}/capabilities', routePath: '/api/v1/agent-environments/[environmentId]/capabilities',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/capabilities$/,
    schema: { json: hostCapabilitiesSchema, response: UnknownResponse },
    summary: 'Refresh authenticated host capabilities', tag: 'Agent environments',
  },
  {
    method: 'GET', path: '/api/v1/agent-environments/{environmentId}/commands', routePath: '/api/v1/agent-environments/[environmentId]/commands',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/commands$/,
    schema: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).optional(), waitMs: z.coerce.number().int().min(0).max(30_000).optional() }), response: UnknownResponse },
    summary: 'Poll durable commands for an authenticated environment', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/{environmentId}/commands/{commandId}/ack', routePath: '/api/v1/agent-environments/[environmentId]/commands/[commandId]/ack',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/commands\/[^/]+\/ack$/,
    schema: { json: commandAcknowledgementSchema, response: UnknownResponse },
    summary: 'Acknowledge or reject a claimed environment command', tag: 'Agent environments',
  },
  {
    method: 'POST', path: '/api/v1/agent-environments/{environmentId}/events', routePath: '/api/v1/agent-environments/[environmentId]/events',
    pattern: /^\/api\/v1\/agent-environments\/[^/]+\/events$/,
    schema: { json: eventBatchSchema, response: UnknownResponse },
    summary: 'Upload a validated contiguous batch of remote agent events', tag: 'Agent environments',
  },
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
    path: '/api/v1/discovery',
    schema: { query: EmptyQuery, response: UnknownResponse },
    summary: 'Public Overlay Server discovery metadata',
    description:
      'Unauthenticated desktop/server discovery: API versions, capabilities, native auth paths, and minimum desktop version. No secrets.',
    tag: 'Discovery',
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
    method: 'GET',
    path: '/api/v1/conversations/run',
    schema: { query: ConversationRunQuery },
    summary: 'Read the authoritative AgentRun for a conversation',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/conversations/run/approval',
    schema: { json: AgentRunApprovalRequest },
    summary: 'Approve or deny a waiting AgentRun tool call',
    tag: 'Conversations',
  },
  {
    method: 'GET',
    path: '/api/v1/conversations/run/metrics',
    schema: { query: AgentRunMetricsQuery },
    summary: 'Read empirical AgentRun metrics grouped by runner',
    tag: 'Conversations',
  },
  {
    method: 'POST',
    path: '/api/v1/conversations/run/metrics-event',
    schema: { json: AgentRunMetricEventRequest },
    summary: 'Record a browser lifecycle observation for an AgentRun',
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
    method: 'GET',
    path: '/api/v1/link-preview',
    schema: { query: LinkPreviewQuery, response: UnknownResponse },
    summary: 'Check whether a URL can be framed in the link preview panel',
    tag: 'Chat',
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
  {
    method: 'POST',
    path: '/api/v1/mcps/oauth',
    schema: { json: McpOAuthStartRequest },
    summary: 'Start an OAuth authorization for an MCP server',
    tag: 'MCP Servers',
  },
  {
    method: 'DELETE',
    path: '/api/v1/mcps/oauth',
    schema: { query: McpOAuthDisconnectRequest },
    summary: 'Disconnect OAuth for an MCP server',
    tag: 'MCP Servers',
  },
  { method: 'POST', path: '/api/v1/mcps/test', schema: { json: McpTestRequest }, summary: 'Test an MCP server', tag: 'MCP Servers' },
  { method: 'GET', path: '/api/v1/providers/connections', schema: { query: EmptyQuery }, summary: 'List model provider connections', tag: 'Model Providers' },
  { method: 'POST', path: '/api/v1/providers/connections', schema: { json: ProviderConnectionMutationRequest }, summary: 'Create a model provider connection', tag: 'Model Providers' },
  { method: 'PATCH', path: '/api/v1/providers/connections', schema: { json: ProviderConnectionMutationRequest }, summary: 'Update a model provider connection', tag: 'Model Providers' },
  { method: 'DELETE', path: '/api/v1/providers/connections', schema: { query: ProviderConnectionDeleteQuery }, summary: 'Delete a model provider connection', tag: 'Model Providers' },
  { method: 'POST', path: '/api/v1/providers/connections/test', schema: { json: ProviderConnectionTestRequest }, summary: 'Test a model provider connection and discover models', tag: 'Model Providers' },
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
] satisfies readonly WebApiBoundaryDefinition[]

export const webApiExcludedRouteDefinitions = [
  {
    routePath: '/api/v1/mcps/oauth/callback',
    reason: 'Third-party OAuth redirect and desktop confirmation flow; it is protected by single-use state rather than the public API authentication scheme.',
  },
  {
    routePath: '/api/v1/extensions/[extensionId]/[...path]',
    reason: 'Extension proxy route. It is not part of the stable public web API reference.',
  },
  // Admin routes are admin-only and not part of the public web API reference.
  { routePath: '/api/v1/admin/authorization/assignments', reason: 'Admin-only authorization management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/authorization/capabilities', reason: 'Admin-only authorization management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/authorization/grants', reason: 'Admin-only authorization management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/authorization/groups', reason: 'Admin-only authorization management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/authorization/memberships', reason: 'Admin-only authorization management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/authorization/roles', reason: 'Admin-only authorization management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/catalog', reason: 'Admin-only catalog management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/governance/export', reason: 'Admin-only governance export; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/governance/policies', reason: 'Admin-only governance policy management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/governance/reviews', reason: 'Admin-only governance review management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/knowledge-bases', reason: 'Admin-only knowledge base management; not part of the public web API reference.' },
  { routePath: '/api/v1/admin/knowledge-bases/defaults', reason: 'Admin-only knowledge base defaults; not part of the public web API reference.' },
  // Agent and agent-environment routes pending full boundary definitions.
  { routePath: '/api/v1/agent-bindings', reason: 'Agent binding management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/agents', reason: 'Agent directory management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/agents/[agentId]', reason: 'Agent detail management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/agent-environments/[environmentId]/artifacts', reason: 'Connected-agent artifact upload; boundary definition pending. Protected by device-key authentication.' },
  { routePath: '/api/v1/agent-environments/[environmentId]/artifacts/[artifactId]/complete', reason: 'Connected-agent artifact completion; boundary definition pending. Protected by device-key authentication.' },
  { routePath: '/api/v1/agent-environments/artifacts/cleanup', reason: 'Internal artifact cleanup cron trigger; not part of the public web API reference.' },
  { routePath: '/api/v1/agent-environments/operations/reconcile', reason: 'Internal reconciliation cron trigger; not part of the public web API reference.' },
  // Automation action routes pending full boundary definitions.
  { routePath: '/api/v1/automations/[id]/approve', reason: 'Automation approval action; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/automations/[id]/cancel-scheduler', reason: 'Automation scheduler control; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/automations/[id]/events', reason: 'Automation event stream; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/automations/[id]/run', reason: 'Automation run trigger; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/automations/[id]/start-scheduler', reason: 'Automation scheduler control; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/automations/[id]/stream', reason: 'Automation run stream; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/automations/execute', reason: 'Automation execution; boundary definition pending. Protected by workspace authorization.' },
  // Conversation collaboration routes pending full boundary definitions.
  { routePath: '/api/v1/conversations/[conversationId]/messages/[messageId]', reason: 'Conversation message management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/[conversationId]/participants', reason: 'Conversation participant management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/[conversationId]/pins', reason: 'Conversation pin management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/[conversationId]/presence', reason: 'Conversation presence; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/[conversationId]/reactions', reason: 'Conversation reaction management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/[conversationId]/reports', reason: 'Conversation report submission; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/[conversationId]/state', reason: 'Conversation state management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/[conversationId]/threads/[threadRootMessageId]/follow', reason: 'Thread follow management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/channels', reason: 'Channel management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/direct-messages', reason: 'Direct message management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/notification-preferences', reason: 'Notification preference management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/notifications', reason: 'Notification listing; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/run/remote', reason: 'Remote agent run management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/run/remote/artifacts/[artifactId]', reason: 'Remote agent run artifact; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/run/remote/request', reason: 'Remote agent run request; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/saved-messages', reason: 'Saved message management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/conversations/search', reason: 'Conversation search; boundary definition pending. Protected by workspace authorization.' },
  // File ingestion routes pending full boundary definitions.
  { routePath: '/api/v1/files/ingest-jobs', reason: 'File ingestion job management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/files/ingest-jobs/process', reason: 'Internal ingestion job processor; not part of the public web API reference.' },
  // Import routes pending full boundary definitions.
  { routePath: '/api/v1/imports/slack', reason: 'Slack import job management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/imports/slack/process', reason: 'Internal Slack import job processor; not part of the public web API reference.' },
  // Knowledge base routes pending full boundary definitions.
  { routePath: '/api/v1/knowledge-bases', reason: 'Knowledge base management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/knowledge-bases/[knowledgeBaseId]/conversations', reason: 'Knowledge base conversation management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/knowledge-bases/[knowledgeBaseId]/diagnostics', reason: 'Knowledge base diagnostics; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/knowledge-bases/[knowledgeBaseId]/grants', reason: 'Knowledge base grant management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/knowledge-bases/[knowledgeBaseId]/reindex', reason: 'Knowledge base reindex; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/knowledge-bases/[knowledgeBaseId]/search', reason: 'Knowledge base search; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/knowledge-bases/[knowledgeBaseId]/sources', reason: 'Knowledge base source management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/knowledge-bases/[knowledgeBaseId]/sources/upload', reason: 'Knowledge base source upload; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/knowledge-bases/personal', reason: 'Personal knowledge base management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/knowledge-bases/share-directory', reason: 'Knowledge base share directory; boundary definition pending. Protected by workspace authorization.' },
  // Mention search and link preview pending full boundary definitions.
  { routePath: '/api/v1/mention-search', reason: 'Mention search endpoint; boundary definition pending. Protected by workspace authorization.' },
  // Project routes pending full boundary definitions.
  { routePath: '/api/v1/projects/duplicate', reason: 'Project duplication; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/projects/export', reason: 'Project export; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/projects/grants', reason: 'Project grant management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/projects/knowledge-bases', reason: 'Project knowledge base management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/projects/knowledge-transfer', reason: 'Project knowledge transfer; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/projects/share-directory', reason: 'Project share directory; boundary definition pending. Protected by workspace authorization.' },
  // Search and share routes pending full boundary definitions.
  { routePath: '/api/v1/search', reason: 'Workspace search; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/shares', reason: 'Resource sharing management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/shares/impact', reason: 'Share impact analysis; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/shares/shared-with-me', reason: 'Shared-with-me listing; boundary definition pending. Protected by workspace authorization.' },
  // Workspace routes pending full boundary definitions.
  { routePath: '/api/v1/workspace-invitations/[invitationId]/accept', reason: 'Workspace invitation acceptance; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces', reason: 'Workspace management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/audit-export', reason: 'Workspace audit export; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/billing', reason: 'Workspace billing management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/billing/checkout', reason: 'Workspace billing checkout; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/billing/portal', reason: 'Workspace billing portal; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/billing/top-ups', reason: 'Workspace billing top-ups; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/billing/verify', reason: 'Workspace billing verification; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/governance', reason: 'Workspace governance management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/invitations', reason: 'Workspace invitation management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/invitations/[invitationId]', reason: 'Workspace invitation detail; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/lifecycle', reason: 'Workspace lifecycle management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/management', reason: 'Workspace management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/members', reason: 'Workspace member management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/policies', reason: 'Workspace policy management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/teams', reason: 'Workspace team management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/[workspaceId]/teams/[teamId]/members', reason: 'Workspace team member management; boundary definition pending. Protected by workspace authorization.' },
  { routePath: '/api/v1/workspaces/active', reason: 'Active workspace selection; boundary definition pending. Protected by workspace authorization.' },
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

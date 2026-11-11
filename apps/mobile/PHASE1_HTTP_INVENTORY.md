# Mobile HTTP inventory — through Phase 2e

## Moved to Convex

| Mobile surface / adapter | Convex reference | Boundary |
| --- | --- | --- |
| Files browser, listKnowledgeFiles, loadNotesIndex | `files.browse.list` | Live browser subscription; compatibility helpers use native snapshots. |
| File preview, note editor, getKnowledgeFile, loadNote | `files.browse.get` | Live metadata/inline text; storage-backed text stays authenticated HTTP. |
| Folder browsing, fileChildren | `files.browse.children` | Personal/workspace child subscriptions; generated `{ files, complete }` result. |
| Rename, updateNoteTitle, updateKnowledgeFile(name) | `files.browse.rename` | Native metadata mutation; content/title CAS saves keep the web write endpoint. |
| Move, moveNoteToFolder, updateKnowledgeFile(parentId) | `files.browse.move` | Native mutation and backend folder validation. |
| conversationFiles | `files.browse.forConversation` | Native conversation-file adapter. |
| Automations, listAutomations, getAutomation | `automations.browse.list/get` | Live list/detail; compatibility helpers use native snapshots. |
| Run history, listAutomationRuns, former status polling | `automations.browse.runs` | Live rows replace mobile HTTP polling. |
| Live steps, former mobile SSE | `automations.workflowEvents.watchWorkflowStepEvents` | Native subscription; legacy token-verification caveat in PHASE2E_QA.md. |
| Activity and displayed-unread/mark all read | `collaboration.activity.notifications/markRead` | All, Unread, Mentions, Threads, Reactions; only displayed unread IDs auto-mark. |
| Workspace search and mentions | `search.browse.mentions` | Native chat/file/automation title search. Work uses `work.browse.list` with local filtering; people/agent records use native management/directory. |

Uploads, storage content/download, sharing, note writes and automation scheduling/execution/approvals retain web's HTTP ownership. Download in `components/knowledge/ResourceScreens.tsx` validates web origin/path and uses authenticated `appRequest`. `Submit a bug` opens hosted web after a public-GitHub warning: the web POST requires a browser session and same-origin checks, so this is not a native reporting API. Memories remain under Settings; the semantic knowledge-search service is retained separately from the new metadata Search screen.

Phase 2e rows below have refreshed callsites and reasons. Other rows retain the Phase 1 snapshot and deferred classification.

## Remaining HTTP callsites

Convex is authoritative for the migrated collaboration, activity, personal chat, mention/search and workspace directory surfaces. HTTP below is either server-owned orchestration or explicitly deferred Phase 2 surface data/CRUD. Phase 2 rows are remaining migration work, not an alternate authoritative backend.

This is a callsite inventory, including both direct URLs and typed api-client calls. Repeated endpoints appear separately when used by different functions. `services/appApi.ts` and `services/overlayClient.ts` are shared authenticated transport, not additional product endpoints. Presigned storage destinations are dynamic. Provider base-URL presets are configuration, not requests.

| Callsite | HTTP call / destination | Why it remains |
| --- | --- | --- |
| `services/accountExtrasService.ts:13` (getTopUpHistory) | `mobileOverlayAppClient.topUps.history` | Billing and payment history remain server-owned. |
| `services/agentsService.ts:34` (listAgents) | `mobileOverlayAppClient.agents.list` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:41` (getAgent) | `mobileOverlayAppClient.agents.get` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:49` (createAgent) | `mobileOverlayAppClient.agents.create` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:58` (updateAgent) | `mobileOverlayAppClient.agents.update` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:63` (archiveAgent) | `mobileOverlayAppClient.agents.archive` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:73` (listAgentEnvironments) | `mobileOverlayAppClient.agentEnvironments.list` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:88` (createAgentEnrollment) | `mobileOverlayAppClient.agentEnvironments.createEnrollment` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:99` (approveAgentEnvironment) | `mobileOverlayAppClient.agentEnvironments.approve` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:112` (updateEnvironmentRoots) | `mobileOverlayAppClient.agentEnvironments.updateRoots` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:124` (revokeAgentEnvironment) | `mobileOverlayAppClient.agentEnvironments.revoke` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:135` (listAgentBindings) | `mobileOverlayAppClient.agentEnvironments.listBindings` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:143` (upsertAgentBinding) | `mobileOverlayAppClient.agentEnvironments.upsertBinding` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:148` (disableAgentBindings) | `mobileOverlayAppClient.agentEnvironments.disableBindings` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:156` (listAgentComputers) | `mobileOverlayAppClient.computers.list` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:165` (provisionAgentComputer) | `mobileOverlayAppClient.computers.provision` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:175` (destroyAgentComputer) | `mobileOverlayAppClient.computers.destroy` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:192` (openAgentChat) | `mobileOverlayAppClient.conversations.createWorkspaceDirectMessage` | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/agentsService.ts:218` (sendAgentGreeting) | `appJson` → <code>'/api/v1/conversations/agent-greeting'</code> | Phase 2: agent screen data and editing; enrollment, agent greetings and computer provisioning remain server-owned orchestration. |
| `services/aiService.ts:223` (chatStream) | `appXhrStreamSse` → <code>'/api/v1/conversations/act'</code> | Run/send/stop, media, document ingestion and transcription are server-owned execution or upload orchestration. |
| `services/aiService.ts:326` (uploadDocument) | `appRequest` → <code>'/api/v1/files/ingest-document'</code> | Run/send/stop, media, document ingestion and transcription are server-owned execution or upload orchestration. |
| `services/aiService.ts:340` (stopConversation) | `appRequest` → <code>'/api/v1/conversations/stop'</code> | Run/send/stop, media, document ingestion and transcription are server-owned execution or upload orchestration. |
| `services/authService.ts:21` (fetchWithTimeout) | `fetch` → <code>url</code> | Native sign-in, exchange, refresh and PKCE handoff are server-owned authentication orchestration. |
| `services/authService.ts:213` (buildNativeAuthRequest) | `fetchWithTimeout` → <code>${AUTH_BASE_URL}/api/auth/native/authorize</code> | Native sign-in, exchange, refresh and PKCE handoff are server-owned authentication orchestration. |
| `services/authService.ts:242` (exchangeNativeAuthCode) | `fetchWithTimeout` → <code>${AUTH_BASE_URL}/api/auth/native/exchange</code> | Native sign-in, exchange, refresh and PKCE handoff are server-owned authentication orchestration. |
| `services/authService.ts:348` (consumeTransferToken) | `fetchWithTimeout` → <code>endpoint</code> | Native sign-in, exchange, refresh and PKCE handoff are server-owned authentication orchestration. |
| `services/authService.ts:398` (requestRefreshedAuthSession) | `fetchWithTimeout` → <code>${AUTH_BASE_URL}/api/auth/native/refresh</code> | Native sign-in, exchange, refresh and PKCE handoff are server-owned authentication orchestration. |
| `services/automationsService.ts:43` (createAutomation) | `appJson` → <code>'/api/v1/automations'</code> | Web configuration and Workflow SDK scheduling/rescheduling orchestration. |
| `services/automationsService.ts:62` (updateAutomation) | `appJson` → <code>'/api/v1/automations'</code> | Web configuration and Workflow SDK scheduling/rescheduling orchestration. |
| `services/automationsService.ts:69` (setAutomationEnabled) | `appJson` → <code>'/api/v1/automations'</code> | Web configuration and Workflow SDK scheduling/rescheduling orchestration. |
| `services/automationsService.ts:76` (deleteAutomation) | `appJson` → <code>'/api/v1/automations'</code> | Web configuration and Workflow SDK scheduling/rescheduling orchestration. |
| `services/automationsService.ts:115` (runAutomationNow) | `appJson` → <code>/api/v1/automations/${encodeURIComponent(automationId)}/run</code> | Server-owned Workflow SDK run, test, cancellation, retry or approval, matching web HTTP. |
| `services/automationsService.ts:129` (testAutomation) | `appJson` → <code>'/api/v1/automations/test'</code> | Server-owned Workflow SDK run, test, cancellation, retry or approval, matching web HTTP. |
| `services/automationsService.ts:136` (cancelAutomationRun) | `appJson` → <code>'/api/v1/automations'</code> | Server-owned Workflow SDK run, test, cancellation, retry or approval, matching web HTTP. |
| `services/automationsService.ts:143` (retryAutomationRun) | `appJson` → <code>'/api/v1/automations'</code> | Server-owned Workflow SDK run, test, cancellation, retry or approval, matching web HTTP. |
| `services/automationsService.ts:162` (approveAutomationRun) | `appJson` → <code>/api/v1/automations/${encodeURIComponent(automationId)}/approve</code> | Server-owned Workflow SDK run, test, cancellation, retry or approval, matching web HTTP. |
| `services/billingSettingsService.ts:15` (getBillingSettings) | `appJson` → <code>'/api/v1/subscription/settings'</code> | Billing and subscription settings remain server-owned. |
| `services/billingSettingsService.ts:23` (updateBillingSettings) | `appJson` → <code>'/api/v1/subscription/settings'</code> | Billing and subscription settings remain server-owned. |
| `services/bootstrapService.ts:28` (getAppBootstrap) | `mobileOverlayAppClient.bootstrap.get` | Phase 2: bootstrap configuration, model catalog and entitlement screen data have not migrated. |
| `services/chatStorage.ts:250` (deleteChat) | `appRequest` → <code>'/api/v1/conversations'</code> | Conversation deletion is server-owned cleanup orchestration; native personal chat has no whole-conversation delete function. |
| `services/collaborationService.ts:103` (sendRoomMessage) | `mobileOverlayAppClient.conversations.addMessage` | Room/DM creation is server-owned provisioning; message send and moderation reports are server-owned orchestration. No transcript/state/notification reads use HTTP. |
| `services/collaborationService.ts:170` (reportRoomMessage) | `mobileOverlayAppClient.conversations.reportMessage` | Room/DM creation is server-owned provisioning; message send and moderation reports are server-owned orchestration. No transcript/state/notification reads use HTTP. |
| `services/collaborationService.ts:190` (createChannel) | `mobileOverlayAppClient.conversations.createWorkspaceChannel` | Room/DM creation is server-owned provisioning; message send and moderation reports are server-owned orchestration. No transcript/state/notification reads use HTTP. |
| `services/collaborationService.ts:191` (createChannel) | `mobileOverlayAppClient.conversations.createChannel` | Room/DM creation is server-owned provisioning; message send and moderation reports are server-owned orchestration. No transcript/state/notification reads use HTTP. |
| `services/collaborationService.ts:201` (createDirectMessage) | `mobileOverlayAppClient.conversations.createWorkspaceDirectMessage` | Room/DM creation is server-owned provisioning; message send and moderation reports are server-owned orchestration. No transcript/state/notification reads use HTTP. |
| `services/collaborationService.ts:202` (createDirectMessage) | `mobileOverlayAppClient.conversations.createDirectMessage` | Room/DM creation is server-owned provisioning; message send and moderation reports are server-owned orchestration. No transcript/state/notification reads use HTTP. |
| `services/computersService.ts:25` (listComputers) | `mobileOverlayAppClient.computers.list` | Computer provisioning, lifecycle and desktop sessions are server-owned orchestration. |
| `services/computersService.ts:38` (provisionComputer) | `mobileOverlayAppClient.computers.provision` | Computer provisioning, lifecycle and desktop sessions are server-owned orchestration. |
| `services/computersService.ts:43` (startComputer) | `mobileOverlayAppClient.computers.start` | Computer provisioning, lifecycle and desktop sessions are server-owned orchestration. |
| `services/computersService.ts:48` (stopComputer) | `mobileOverlayAppClient.computers.stop` | Computer provisioning, lifecycle and desktop sessions are server-owned orchestration. |
| `services/computersService.ts:60` (openComputerDesktop) | `mobileOverlayAppClient.computers.openDesktop` | Computer provisioning, lifecycle and desktop sessions are server-owned orchestration. |
| `services/computersService.ts:64` (destroyComputer) | `mobileOverlayAppClient.computers.destroy` | Computer provisioning, lifecycle and desktop sessions are server-owned orchestration. |
| `services/conversationActionsService.ts:39` (deleteConversation) | `mobileOverlayAppClient.conversations.deleteResponse` | Conversation cleanup/sharing, current run, approvals, media generation and suggestions are server-owned orchestration. |
| `services/conversationActionsService.ts:62` (setConversationShareVisibility) | `appRequest` → <code>'/api/v1/conversations/share'</code> | Conversation cleanup/sharing, current run, approvals, media generation and suggestions are server-owned orchestration. |
| `services/conversationActionsService.ts:79` (fetchCurrentRun) | `mobileOverlayAppClient.conversations.currentRun` | Conversation cleanup/sharing, current run, approvals, media generation and suggestions are server-owned orchestration. |
| `services/conversationActionsService.ts:89` (submitRunApproval) | `mobileOverlayAppClient.conversations.submitRunApproval` | Conversation cleanup/sharing, current run, approvals, media generation and suggestions are server-owned orchestration. |
| `services/conversationActionsService.ts:97` (fetchChatSuggestions) | `appRequest` → <code>'/api/v1/chat-suggestions'</code> | Conversation cleanup/sharing, current run, approvals, media generation and suggestions are server-owned orchestration. |
| `services/conversationActionsService.ts:139` (generateImage) | `appRequest` → <code>'/api/v1/generate-image'</code> | Conversation cleanup/sharing, current run, approvals, media generation and suggestions are server-owned orchestration. |
| `services/conversationActionsService.ts:176` (generateVideo) | `appXhrStreamSse` → <code>'/api/v1/generate-video'</code> | Conversation cleanup/sharing, current run, approvals, media generation and suggestions are server-owned orchestration. |
| `services/integrationsService.ts:5` (listConnectedIntegrations) | `appJson` → <code>'/api/v1/integrations'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:12` (listIntegrationItems) | `appJson` → <code>'/api/v1/integrations'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:19` (searchIntegrations) | `appJson` → <code>'/api/v1/integrations'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:32` (listSkills) | `appJson` → <code>'/api/v1/skills'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:40` (connectIntegration) | `appJson` → <code>'/api/v1/integrations'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:47` (disconnectIntegration) | `appJson` → <code>'/api/v1/integrations'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:59` (createSkill) | `appJson` → <code>'/api/v1/skills'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:69` (updateSkill) | `appJson` → <code>'/api/v1/skills'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:76` (deleteSkill) | `appJson` → <code>'/api/v1/skills'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:83` (listMcpServers) | `appJson` → <code>'/api/v1/mcps'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:96` (createMcpServer) | `appJson` → <code>'/api/v1/mcps'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:108` (updateMcpServer) | `appJson` → <code>'/api/v1/mcps'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:115` (deleteMcpServer) | `appJson` → <code>'/api/v1/mcps'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:129` (testMcpServer) | `appJson` → <code>'/api/v1/mcps/test'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:145` (startMcpOAuth) | `appJson` → <code>'/api/v1/mcps/oauth'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/integrationsService.ts:152` (disconnectMcpOAuth) | `appJson` → <code>'/api/v1/mcps/oauth'</code> | Phase 2: Extensions screen data and editing; provider catalog, connector operations, OAuth and tests are server-owned integration orchestration. |
| `services/knowledgeService.ts:20` (searchKnowledge) | `appJson` → <code>'/api/v1/knowledge/search'</code> | Server-owned semantic chunk/vector retrieval, separate from Convex title/mention search. |
| `services/knowledgeService.ts:28` (listMemories) | `appJson` → <code>'/api/v1/memory'</code> | Deferred Memories/legacy Outputs surface, outside Phase 2e Files metadata migration; storage cleanup/sharing stays server-owned. |
| `services/knowledgeService.ts:34` (createMemory) | `appJson` → <code>'/api/v1/memory'</code> | Deferred Memories/legacy Outputs surface, outside Phase 2e Files metadata migration; storage cleanup/sharing stays server-owned. |
| `services/knowledgeService.ts:44` (updateMemory) | `appJson` → <code>'/api/v1/memory'</code> | Deferred Memories/legacy Outputs surface, outside Phase 2e Files metadata migration; storage cleanup/sharing stays server-owned. |
| `services/knowledgeService.ts:51` (deleteMemory) | `appJson` → <code>'/api/v1/memory'</code> | Deferred Memories/legacy Outputs surface, outside Phase 2e Files metadata migration; storage cleanup/sharing stays server-owned. |
| `services/knowledgeService.ts:75` (getKnowledgeFileContent) | `appRequest` → <code>/api/v1/files/${fileId}/content</code> | Authenticated object-storage text retrieval after native metadata reads. |
| `services/knowledgeService.ts:85` (createKnowledgeFile) | `appJson` → <code>'/api/v1/files'</code> | Web file creation/content-ingestion orchestration; no native create mutation. |
| `services/knowledgeService.ts:99` (createKnowledgeFolder) | `appJson` → <code>'/api/v1/files'</code> | Web folder creation endpoint; native browse exposes rename/move, not create. |
| `services/knowledgeService.ts:118` (updateKnowledgeFile) | `appJson` → <code>'/api/v1/files'</code> | Only content PATCH stays HTTP for storage/indexing; name and parent use native rename/move. |
| `services/knowledgeService.ts:126` (shareKnowledgeFile) | `appJson` → <code>'/api/v1/files/share'</code> | Web public-link visibility and sharing orchestration. |
| `services/knowledgeService.ts:146` (searchTextInFiles) | `appJson` → <code>'/api/v1/files/search-text'</code> | Server-owned object-storage text search; native title search is separate. |
| `services/knowledgeService.ts:153` (deleteKnowledgeFile) | `appJson` → <code>'/api/v1/files'</code> | Web deletion and storage cleanup orchestration. |
| `services/knowledgeService.ts:169` (getUploadUrl) | `appJson` → <code>'/api/v1/files/presign'</code> | Server-owned upload validation and presigning. |
| `services/knowledgeService.ts:181` (uploadToR2) | `fetch` → <code>presignedUrl</code> | Upload bytes to the server-issued, short-lived storage destination. |
| `services/knowledgeService.ts:194` (createFileWithStorage) | `appJson` → <code>'/api/v1/files'</code> | Server-owned storage finalization, file creation and ingestion. |
| `services/knowledgeService.ts:210` (listOutputs) | `appJson` → <code>'/api/v1/outputs'</code> | Deferred Memories/legacy Outputs surface, outside Phase 2e Files metadata migration; storage cleanup/sharing stays server-owned. |
| `services/knowledgeService.ts:219` (deleteOutput) | `appJson` → <code>'/api/v1/outputs'</code> | Deferred Memories/legacy Outputs surface, outside Phase 2e Files metadata migration; storage cleanup/sharing stays server-owned. |
| `services/knowledgeService.ts:234` (shareOutput) | `appJson` → <code>'/api/v1/outputs'</code> | Deferred Memories/legacy Outputs surface, outside Phase 2e Files metadata migration; storage cleanup/sharing stays server-owned. |
| `services/modelCatalogService.ts:55` (getGatewayModelCatalog) | `appJson` → <code>'/api/v1/model-catalog'</code> | Phase 2: model catalog screen data. |
| `services/noteStorage.ts:27` (createNote) | `appJson` → <code>'/api/v1/notes'</code> | Web note creation and content-storage orchestration. |
| `services/noteStorage.ts:49` (saveNote) | `appJson` → <code>'/api/v1/notes'</code> | Web content/title CAS write with expectedUpdatedAt, storage and indexing; returns the saved revision. |
| `services/noteStorage.ts:63` (deleteNote) | `appRequest` → <code>'/api/v1/notes'</code> | Web deletion and storage/index cleanup. |
| `services/onboardingService.ts:25` (getOnboardingStatus) | `mobileOverlayAppClient.onboarding.status` | Phase 2: onboarding state; completion/reset invoke server-owned initialization orchestration. |
| `services/onboardingService.ts:29` (completeOnboarding) | `mobileOverlayAppClient.onboarding.complete` | Phase 2: onboarding state; completion/reset invoke server-owned initialization orchestration. |
| `services/onboardingService.ts:33` (resetOnboarding) | `mobileOverlayAppClient.onboarding.resetResponse` | Phase 2: onboarding state; completion/reset invoke server-owned initialization orchestration. |
| `services/providersService.ts:176` (listProviderConnections) | `appJson` → <code>'/api/v1/providers/connections'</code> | Provider connection management and credential validation are server-owned orchestration. |
| `services/providersService.ts:187` (createProviderConnection) | `appJson` → <code>'/api/v1/providers/connections'</code> | Provider connection management and credential validation are server-owned orchestration. |
| `services/providersService.ts:214` (updateProviderConnection) | `appJson` → <code>'/api/v1/providers/connections'</code> | Provider connection management and credential validation are server-owned orchestration. |
| `services/providersService.ts:234` (deleteProviderConnection) | `appJson` → <code>'/api/v1/providers/connections'</code> | Provider connection management and credential validation are server-owned orchestration. |
| `services/providersService.ts:252` (testProviderConnection) | `appJson` → <code>'/api/v1/providers/connections/test'</code> | Provider connection management and credential validation are server-owned orchestration. |
| `services/settingsService.ts:28` (getUiSettings) | `appJson` → <code>'/api/v1/settings'</code> | Phase 2: account/workspace settings screen data and editing. |
| `services/settingsService.ts:37` (updateUiSettings) | `appJson` → <code>'/api/v1/settings'</code> | Phase 2: account/workspace settings screen data and editing. |
| `services/webhooksService.ts:55` (listWebhookSubscriptions) | `mobileOverlayAppClient.webhooks.list` | Phase 2: webhook screen data and editing; secret rotation and delivery retries are server-owned orchestration. |
| `services/webhooksService.ts:62` (listWebhookDeliveries) | `mobileOverlayAppClient.webhooks.listDeliveries` | Phase 2: webhook screen data and editing; secret rotation and delivery retries are server-owned orchestration. |
| `services/webhooksService.ts:71` (createWebhookSubscription) | `appJson` → <code>'/api/v1/webhooks'</code> | Phase 2: webhook screen data and editing; secret rotation and delivery retries are server-owned orchestration. |
| `services/webhooksService.ts:89` (updateWebhookSubscription) | `appJson` → <code>'/api/v1/webhooks'</code> | Phase 2: webhook screen data and editing; secret rotation and delivery retries are server-owned orchestration. |
| `services/webhooksService.ts:102` (rotateWebhookSecret) | `appJson` → <code>'/api/v1/webhooks'</code> | Phase 2: webhook screen data and editing; secret rotation and delivery retries are server-owned orchestration. |
| `services/webhooksService.ts:110` (redriveWebhookDelivery) | `appJson` → <code>'/api/v1/webhooks'</code> | Phase 2: webhook screen data and editing; secret rotation and delivery retries are server-owned orchestration. |
| `services/webhooksService.ts:118` (deleteWebhookSubscription) | `appJson` → <code>'/api/v1/webhooks'</code> | Phase 2: webhook screen data and editing; secret rotation and delivery retries are server-owned orchestration. |
| `services/workspaceManagementService.ts:56` (loadManagementView) | `mobileOverlayAppClient.workspaces.management` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:68` (inviteToWorkspace) | `mobileOverlayAppClient.workspaces.invite` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:75` (resendWorkspaceInvitation) | `mobileOverlayAppClient.workspaces.resendInvitation` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:82` (cancelWorkspaceInvitation) | `mobileOverlayAppClient.workspaces.cancelInvitation` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:89` (updateWorkspaceMember) | `mobileOverlayAppClient.workspaces.updateMember` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:96` (removeWorkspaceMember) | `mobileOverlayAppClient.workspaces.removeMember` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:102` (acceptWorkspaceInvitation) | `mobileOverlayAppClient.workspaces.acceptInvitation` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:114` (createWorkspaceTeam) | `mobileOverlayAppClient.workspaces.createTeam` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:121` (archiveWorkspaceTeam) | `mobileOverlayAppClient.workspaces.archiveTeam` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:131` (setTeamMembership) | `mobileOverlayAppClient.workspaces.addTeamMember` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:133` (setTeamMembership) | `mobileOverlayAppClient.workspaces.removeTeamMember` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:142` (createWorkspace) | `mobileOverlayAppClient.workspaces.create` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:147` (archiveWorkspace) | `mobileOverlayAppClient.workspaces.archive` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:157` (loadSharingPolicy) | `mobileOverlayAppClient.workspaces.sharingPolicy` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:166` (updateSharingPolicy) | `appJson` → <code>/api/v1/workspaces/${encodeURIComponent(workspaceId)}/policies</code> | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:176` (loadOperationalMetrics) | `appJson` → <code>/api/v1/workspaces/${encodeURIComponent(workspaceId)}/governance</code> | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:192` (exportWorkspaceAudit) | `appRequest` → <code>/api/v1/workspaces/${encodeURIComponent(workspaceId)}/audit-export</code> | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:216` (loadWorkspaceBilling) | `mobileOverlayAppClient.workspaces.billing` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:224` (loadSharedWithMe) | `mobileOverlayAppClient.sharing.sharedWithMe` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:237` (loadResourceShares) | `mobileOverlayAppClient.sharing.get` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:249` (grantResourceShare) | `mobileOverlayAppClient.sharing.grant` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:257` (revokeResourceShare) | `mobileOverlayAppClient.sharing.revoke` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:266` (shareImpact) | `mobileOverlayAppClient.sharing.impact` | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:310` (loadSlackImportJobs) | `appJson` → <code>'/api/v1/imports/slack'</code> | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:318` (loadSlackChannels) | `appJson` → <code>'/api/v1/imports/slack'</code> | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:325` (startSlackImport) | `appJson` → <code>'/api/v1/imports/slack'</code> | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceManagementService.ts:332` (cancelSlackImport) | `appJson` → <code>'/api/v1/imports/slack'</code> | Phase 2: workspace/membership/team/policy/sharing screen data and edits; invitations, import/export and billing are server-owned orchestration. |
| `services/workspaceService.ts:63` (activateWorkspace) | `mobileOverlayAppClient.workspaces.activate` | Phase 2: active-workspace preference persistence still uses server orchestration; workspace directory reads are native. |

## Native API portability

`services/convexApi.ts` uses the web-generated API through a type-only import, so mobile calls are checked against the actual web function arguments and results. Runtime references still use `anyApi`; generated backend modules are not bundled. Mobile TypeScript resolves `@/shared/*` to the web shared directory and skips declaration-file checking. `environment.d.ts` narrows Expo's ambient environment index signature from `any` to string values so imported web helpers retain strict inference.

## Known backend gap

There is no member-facing native notification-preferences function in the current web backend. These controls remain hidden and the old HTTP endpoint remains absent. Per-room notification level is restored through `collaboration.rooms.updateMyState`.

## QA checklist

- Set `EXPO_PUBLIC_CONVEX_URL` to an isolated development backend matching the native WorkOS client. There is no production fallback.
- Sign in, switch accounts, then sign out. Query caches and sockets must not survive an identity change.
- Open two clients in the same workspace. Check room messages, edits, reactions, pins, saves, thread follow, typing and notification read state update without polling.
- Check personal chat creation, rename, read/archive state and live transcript, plus workspace directory and @-mention search.
- Disable native access in the isolated backend. Mobile should show the calm Workspace unavailable state, not a red screen.
- Run `npm run check`, `node --test scripts/phase0.test.cjs scripts/phase1.test.cjs`, and Expo Android/iOS exports. Live native integration and visual checks still require a configured backend and a device.

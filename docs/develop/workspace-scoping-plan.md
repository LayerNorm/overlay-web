# Workspace Scoping Plan — Option A (Convex First)

## Problem

Every user-facing resource (chats, files, skills, MCPs, projects, automations, notes, memories, outputs, webhooks, connectors) is scoped by `userId` only. Switching workspaces changes a UI state variable but **no data query filters by workspace**. Everything transfers between workspaces.

The `conversations` table has a dead `workspaceId: v.optional(v.string())` field from a reverted collaboration release. The collaboration tables (`workspaces`, `workspaceMemberships`, etc.) exist in the Convex deployment but are not in `schema.ts`. The BFF collaboration routes already reference `context.workspace.workspace.id` but `AppApiRouteContext` doesn't have a `workspace` field — the workspace context resolution was never wired into the BFF boundary layer.

## Goal

Every user-facing resource is scoped to exactly one workspace. Switching workspaces shows only that workspace's resources. Personal workspace is the default. Convex first; Postgres parity later.

---

## Resource Inventory

### Resources that MUST be workspace-scoped

| # | Resource | Convex table | Current scope | Has `workspaceId`? | Notes |
|---|----------|-------------|---------------|-------------------|-------|
| 1 | **Conversations** (chats) | `conversations` | `userId` | Dead optional field | Promote to required + index |
| 2 | **Files** | `files` | `userId` | No | Add field + index |
| 3 | **Skills** | `skills` | `userId` | No | Add field + index |
| 4 | **MCP servers** | `mcpServers` | `userId` | No | Add field + index |
| 5 | **Projects** | `projects` | `userId` | No | Add field + index |
| 6 | **Automations** | `automations` | `userId` | No | Add field + index |
| 7 | **Notes** | `notes` | `userId` | No | Add field + index |
| 8 | **Memories** | `memories` | `userId` | No | Add field + index |
| 9 | **Outputs** (generated images/videos) | `outputs` | `userId` | No | Add field + index |
| 10 | **Webhook subscriptions** | `webhookSubscriptions` | `userId` | No | Add field + index |
| 11 | **Knowledge bases** | `knowledgeBases` (not in schema.ts) | `ownerUserId` | No | Add to schema + field + index |
| 12 | **Connectors** (Composio) | External (Composio API) | `userId` | No | Mapping table needed |

### Derived tables (scoped via parent — no direct `workspaceId` needed)

| Resource | Convex table | Scoped via |
|----------|-------------|------------|
| Conversation messages | `conversationMessages` | `conversationId` → `conversations.workspaceId` |
| Conversation message deltas | `conversationMessageDeltas` | `conversationId` → `conversations.workspaceId` |
| Conversation context summaries | `conversationContextSummaries` | `conversationId` → `conversations.workspaceId` |
| Automation runs | `automationRuns` | `automationId` → `automations.workspaceId` |
| MCP OAuth sessions | `mcpOAuthSessions` | `mcpServerId` → `mcpServers.workspaceId` |
| MCP tool executions | `mcpToolExecutions` | `mcpServerId` → `mcpServers.workspaceId` |
| Knowledge chunks | `knowledgeChunks` | `sourceId` → parent resource's `workspaceId` |
| Knowledge chunk embeddings | `knowledgeChunkEmbeddings` | `chunkId` → `knowledgeChunks` |
| Webhook deliveries | `webhookDeliveries` | `subscriptionId` → `webhookSubscriptions.workspaceId` |
| R2 upload intents | `r2UploadIntents` | `userId` (ephemeral, no scoping needed) |

### Resources that should NOT be workspace-scoped (account-level)

| Resource | Convex table | Why |
|----------|-------------|-----|
| User UI settings | `userUiSettings` | Personal preferences |
| Subscriptions / billing | `subscriptions` | Account-level billing |
| Budget top-ups | `budgetTopUps` | Account-level billing |
| API keys | `apiKeys` | Account-level API access |
| Token usage | `tokenUsage` | Account-level usage |
| Daily usage | `dailyUsage` | Account-level usage |
| Usage operations | `usageOperations` | Account-level usage |
| Budget reservations | `budgetReservations` | Account-level billing |
| Audit events | `auditEvents` | Account-level audit trail |
| Session transfer tokens | `sessionTransferTokens` | Auth infrastructure |
| Gateway catalog snapshots | `gatewayCatalogSnapshots` | Global cache |
| Processed webhook events | `processedWebhookEvents` | Infra dedup |
| Rate limit windows | `rateLimitWindows` | Infra |
| API idempotency keys | `apiIdempotencyKeys` | Infra |
| Service auth replay nonces | `serviceAuthReplayNonces` | Infra |
| Email outbox / suppressions | `emailOutbox`, `emailSuppressions` | Infra |
| Daytona workspaces / usage | `daytonaWorkspaces`, `daytonaUsageLedger` | Sandbox infra |
| Tool invocations | `toolInvocations` | Execution tracking |

---

## Implementation Plan

### Phase 0: BFF workspace context resolution ✅ DONE

**Problem:** Collaboration routes already use `context.workspace.workspace.id` but `AppApiRouteContext` doesn't have a `workspace` field. The workspace resolution was never wired into the BFF boundary layer.

**What to do:**
1. Add `workspace: WorkspaceAccess` to `AppApiRouteContext` in `src/server/app-api/bff-context.ts`.
2. In the BFF boundary layer (where `AppApiRouteContext` is constructed), call `WorkspaceService.resolveActiveWorkspace(userId)` to resolve the active workspace and attach it to the context.
3. For performance: cache the workspace resolution per-request (it's already per-request since the context is constructed once per request).
4. For routes that don't need workspace context (billing, settings, etc.), the workspace resolution can be lazy or skipped — but simplest to always resolve it since every user has a personal workspace.

**Files to touch:**
- `src/server/app-api/bff-context.ts` — add `workspace` field
- `src/server/app-api/boundary.ts` — resolve workspace when constructing context
- Wherever the context is assembled (likely in a route wrapper or `app/api/v1/[[...slug]]/route.ts`)

**Risk:** If workspace resolution fails for users without a personal workspace, every API call breaks. Mitigation: `resolveActiveWorkspace` already falls back to creating a personal workspace.

---

### Phase 1: Schema migration — add `workspaceId` to resource tables ✅ DONE

Added `workspaceId: v.optional(v.string())` to 10 resource tables plus `knowledgeChunks`.
Used `v.optional` so existing production rows continue to validate during the backfill window.
New writes always set the field (Phase 2); the backfill mutation (Phase 5) populates legacy rows.

**Tables migrated in `convex/schema.ts`:**

| Table | Field added | Indexes added |
|-------|------------|---------------|
| `conversations` | (already had `workspaceId`) | `by_workspaceId_clientId`, `by_workspaceId_conversationType_lastModified`, `by_workspaceId_dmIdentityKey`, `by_workspaceId_channelSlug` (restored from collaboration release) |
| `projects` | `workspaceId` | `by_workspaceId`, `by_workspaceId_userId` |
| `skills` | `workspaceId` | `by_workspaceId`, `by_workspaceId_userId` |
| `automations` | `workspaceId` | `by_workspaceId`, `by_workspaceId_userId` |
| `mcpServers` | `workspaceId` | `by_workspaceId`, `by_workspaceId_userId` |
| `notes` | `workspaceId` | `by_workspaceId`, `by_workspaceId_userId` |
| `memories` | `workspaceId` | `by_workspaceId`, `by_workspaceId_userId` |
| `outputs` | `workspaceId` | `by_workspaceId`, `by_workspaceId_userId` |
| `files` | `workspaceId` | `by_workspaceId`, `by_workspaceId_userId` |
| `webhookSubscriptions` | `workspaceId` | `by_workspaceId`, `by_workspaceId_userId` |
| `knowledgeChunks` | `workspaceId` | `by_workspaceId` + added `workspaceId` to `search_text` filterFields |

**Decisions:**
- `knowledgeBases` is not in the Convex schema — it's a Postgres/app-data layer table. Workspace scoping for knowledge bases will be handled in the app-data repository layer, not via Convex schema.
- `knowledgeChunks` got `workspaceId` directly (not just via parent) so workspace-scoped search can filter without a join.
- `knowledgeChunkEmbeddings` does NOT get `workspaceId` — it's joined via `chunkId` and inherits scoping from the chunk.
- All fields are `v.optional(v.string())` during the migration window. Phase 5 backfill will populate them, then we promote to `v.string()`.

---

### Phase 2: Write paths — thread `workspaceId` through creates ✅ DONE

Added `workspaceId: v.optional(v.string())` to all Convex create mutations and
`workspaceId: args.workspaceId` to all `ctx.db.insert` calls. Updated all BFF
route POST handlers to pass `workspaceId: context.workspace.workspace.id`.

**Convex mutations updated (10 files, 14 mutations):**

| Table | File | Mutations |
|-------|------|-----------|
| `conversations` | `convex/chat/conversations.ts` | `create` |
| `files` | `convex/files/files.ts` | `create`, `createWithStorage`, `createExtractedDocument` |
| `skills` | `convex/integrations/skills.ts` | `create` |
| `mcpServers` | `convex/integrations/mcpServers.ts` | `create` |
| `projects` | `convex/projects/projects.ts` | `create` |
| `automations` | `convex/automations/automations.ts` | `create` |
| `notes` | `convex/files/notes.ts` | `create` |
| `memories` | `convex/knowledge/memories.ts` | `add` |
| `outputs` | `convex/outputs/outputs.ts` | `create` |
| `webhookSubscriptions` | `convex/webhooks/subscriptions.ts` | `create`, `createByServer` |

**BFF routes updated (13 routes):**

| Route | File |
|-------|------|
| `POST /api/v1/conversations` | `conversations/route.ts` |
| `POST /api/v1/files` | `files/route.ts` |
| `POST /api/v1/skills` | `skills/route.ts` |
| `POST /api/v1/mcps` | `mcps/route.ts` |
| `POST /api/v1/projects` | `projects/route.ts` |
| `POST /api/v1/automations` | `automations/route.ts` |
| `POST /api/v1/notes` | `notes/route.ts` |
| `POST /api/v1/memory` | `memory/route.ts` |
| `POST /api/v1/webhooks` | `webhooks/route.ts` |
| `POST /api/v1/generate-video` | `generate-video/route.ts` (output creation) |
| `POST /api/v1/generate-image` | `generate-image/route.ts` (output creation) |
| `POST /api/v1/daytona/run` | `daytona/run/route.ts` (output creation) |
| `POST /api/v1/browser-task` | `browser-task/route.ts` (output creation) |

**Service/repository input types updated (10 files):**
- `AutomationService.createAutomation` — added `workspaceId?: string`
- `OutputService.create` — added `workspaceId?: string`
- `FileService.createFile` — added `workspaceId?: string`
- `McpServerRepository.CreateMcpServerInput` — added `workspaceId?: string`
- `MemoryService.create` + `MemoryRepository.MemoryWrite` — added `workspaceId?: string`
- `CreateNoteRequest` (in `@overlay/app-core`) — added `workspaceId?: string`
- `ProjectService.createProject` — added `workspaceId?: string`
- `SkillRepository.CreateSkillInput` — added `workspaceId?: string`
- `WebhookRepository.create` — added `workspaceId?: string`

**Pattern:** `context.workspace.workspace.id` → passed as `workspaceId` to the
service/repository call → forwarded to Convex mutation → persisted in `ctx.db.insert`.

---

### Phase 3: Read paths — filter by `workspaceId` in list queries ✅ DONE

Added `workspaceId: v.optional(v.string())` to all Convex list queries and
in-memory `.filter()` calls that filter by workspaceId when provided. Updated
all BFF route GET handlers to pass `workspaceId: context.workspace.workspace.id`.

**Strategy:** In-memory filtering after the existing `by_userId` index. This
works immediately without index changes and is fine for the current scale.
The `by_workspaceId_*` indexes added in Phase 1 are available for future
optimization of high-volume tables.

**Convex queries updated (10 files, 16 queries):**

| Table | File | Queries |
|-------|------|---------|
| `conversations` | `convex/chat/conversations.ts` | `list`, `listByProject` |
| `files` | `convex/files/files.ts` | `list` |
| `skills` | `convex/integrations/skills.ts` | `list` |
| `mcpServers` | `convex/integrations/mcpServers.ts` | `list`, `listEnabled` |
| `projects` | `convex/projects/projects.ts` | `list` |
| `automations` | `convex/automations/automations.ts` | `list` |
| `notes` | `convex/files/notes.ts` | `list`, `listByProject` |
| `memories` | `convex/knowledge/memories.ts` | `list` |
| `outputs` | `convex/outputs/outputs.ts` | `list`, `listByConversationId`, `listByTurnId` |
| `webhookSubscriptions` | `convex/webhooks/subscriptions.ts` | `list`, `listByServer` |

**BFF routes updated (10 files, 12 list calls):**
- `conversations` (2 calls), `files`, `skills`, `mcps`, `projects`,
  `automations`, `notes`, `memory`, `outputs`, `webhooks` (2 calls)

**Service/repository list method types updated (13 files, 15 methods):**
- `AutomationService.getAutomations` + `AutomationRepository.listAutomations`
- `ActConversationRepository.listConversations` + `listConversationsByProject`
- `FileService.getOrListFiles`
- `McpServerRepository.list`
- `MemoryService.list` + `MemoryRepository.list`
- `NoteService.listNotes` + `NoteRepository.listNotes`
- `OutputService.list`
- `ProjectService.listProjects` + `ProjectRepository.listProjects`
- `SkillRepository.list`
- `WebhookRepository.list` + `listDeliveries`

**Filter pattern:** `(workspaceId !== undefined ? row.workspaceId === workspaceId : true)`
— returns all rows when workspaceId is not provided (backward compatible),
filters to matching workspace when provided.

---

### Phase 4: Update/read paths — scope individual resource access ✅ DONE

Added `workspaceId: v.optional(v.string())` to all Convex get/update/delete
functions and defense-in-depth workspace checks in the authorization logic.
Updated all BFF route GET/PATCH/DELETE handlers to pass
`workspaceId: context.workspace.workspace.id`.

**Defense-in-depth pattern:**
- `get` queries: `&& (workspaceId === undefined || resource.workspaceId === workspaceId)`
  — returns null when workspace doesn't match
- `update`/`delete` mutations: `|| (workspaceId !== undefined && resource.workspaceId !== workspaceId)`
  — throws "Unauthorized" when workspace doesn't match
- Webhook update/remove (return false instead of throwing): same check added to
  the return-false condition

The check only rejects when `workspaceId` is provided AND doesn't match. When
`workspaceId` is undefined (backward compat / server-only calls), access is
allowed as before.

**Convex functions updated (10 files, 30 functions):**

| Table | File | Functions |
|-------|------|-----------|
| `conversations` | `convex/chat/conversations.ts` | `get`, `update`, `remove` |
| `files` | `convex/files/files.ts` | `get`, `update`, `remove` |
| `notes` | `convex/files/notes.ts` | `get`, `update`, `remove` |
| `skills` | `convex/integrations/skills.ts` | `get`, `update`, `remove` |
| `mcpServers` | `convex/integrations/mcpServers.ts` | `get`, `update`, `remove` |
| `projects` | `convex/projects/projects.ts` | `get`, `update`, `remove` |
| `automations` | `convex/automations/automations.ts` | `get`, `update`, `pause`, `resume`, `remove` |
| `memories` | `convex/knowledge/memories.ts` | `update`, `remove` (no `get`) |
| `outputs` | `convex/outputs/outputs.ts` | `get`, `update`, `remove` |
| `webhookSubscriptions` | `convex/webhooks/subscriptions.ts` | `update`, `remove` (no `get`) |

**BFF routes updated (10 files, 24 calls):**
- conversations (3), files (2), skills (2), mcps (2), projects (3),
  automations (2), notes (3), memory (3), outputs (2), webhooks (2)

**Service/repository types updated (13 files, 23 methods):**
- `AutomationService.updateAutomation` + `deleteAutomation`
- `ActConversationRepository.getConversationById` + `updateConversation` + `deleteConversation`
- `FileService.updateFile` + `deleteFile`
- `McpServerRepository.remove`
- `MemoryService` + `MemoryRepository`: `get`, `update`, `remove`
- `NoteService` + `NoteRepository`: `getNote`, `updateNote`, `deleteNote`
- `UpdateNoteRequest` (in `@overlay/app-core`)
- `OutputService.share` + `delete`
- `ProjectService` + `ProjectRepository`: `getProject`, `updateProject`, `deleteProjectTree`
- `SkillRepository.UpdateSkillInput` + `remove`
- `WebhookRepository.update` + `remove`

---

### Phase 5: Connectors (Composio) — workspace-scoped connection mapping ✅ DONE

Created a `workspaceConnectors` table in Convex that maps Composio connected
accounts to workspaces. A user connecting Gmail in Workspace A won't see it
in Workspace B — they'd need to reconnect.

**Schema** (`convex/schema.ts`):
```
workspaceConnectors: defineTable({
  workspaceId: v.string(),
  userId: v.string(),
  providerKey: v.string(),         // e.g. "gmail", "github"
  connectedAccountId: v.string(),  // Composio's connected account ID
  createdAt: v.number(),
  updatedAt: v.number(),
}).index('by_workspaceId', ['workspaceId'])
  .index('by_workspaceId_providerKey', ['workspaceId', 'providerKey'])
  .index('by_userId', ['userId'])
```

**Convex functions** (`convex/integrations/workspaceConnectors.ts`):
- `listByWorkspace` — query by workspaceId, filter by userId in JS
- `insert` — upsert (patch if exists, insert if new)
- `remove` — delete by workspaceId + providerKey + userId
- `removeByUser` — bulk delete for account cleanup

**Repository layer:**
- `WorkspaceConnectorRepository` interface (`src/server/integrations/`)
- `ConvexWorkspaceConnectorRepository` implementation
- Registered in `AppDataRepositories` as `workspaceConnectors`

**Updated contracts** (`src/server/integrations/contracts.ts`):
- `IntegrationConnectionContext` — added `workspaceId?: string`
- `ConnectionRepository.listConnections` — added `workspaceId?: string`
- `IntegrationCatalogQuery` — added `workspaceId?: string`
- `IntegrationCatalog.getCatalogEntry` — added `workspaceId?: string`
- `IntegrationService.listConnected` — added `workspaceId?: string`

**BFF route** (`src/server/app-api/v1/integrations/route.ts`):
- **GET (list):** Passes `workspaceId` to `listConnected`, then filters
  connections and items to only those with a `workspaceConnectors` mapping.
- **POST (connect):** Passes `workspaceId` to `connect`, then inserts a
  `workspaceConnectors` mapping with the `connectionId` from the result.
- **POST (disconnect):** Passes `workspaceId` to `disconnect`, then removes
  the `workspaceConnectors` mapping.

This mapping is currently Convex-only. Postgres mode advertises integrations as
unsupported and rejects the integration route before the domain service runs;
it must not construct the Convex repository or call Convex as a fallback. A
future Postgres parity phase must add the equivalent migration, compound
uniqueness constraint, repository, and membership contract before re-enabling
the capability.

---

### Workspace ID backfill migration ✅ DONE

One-time Convex migration that sets `workspaceId` on all existing rows that
don't have one, using each user's personal workspace.

**Convex functions** (`convex/migrations/backfillWorkspaceIds.ts`):
- `auditBackfillByServer` — paginated query that counts rows missing
  `workspaceId` per table
- `backfillBatchByServer` — paginated mutation that patches rows with
  `workspaceId` from the user's personal workspace (creates the personal
  workspace if it doesn't exist via `ensureLegacyPersonalScope`)

**Tables backfilled** (11):
- conversations, files, notes, skills, mcpServers, projects, automations,
  memories, outputs, webhookSubscriptions, knowledgeChunks

**Pattern:** Follows the existing `collaboration/conversationMigration.ts`
pattern — paginated batch processing with `paginationOptsValidator`, server
secret auth, and audit before/after.

**Runner script** (`scripts/backfill-workspace-ids.ts`):
- Audits all 11 tables (counts missing `workspaceId`)
- Migrates all 11 tables (patches rows with personal workspace ID)
- Audits again to verify zero rows missing `workspaceId`
- Fails if any rows still missing after migration

**npm script:** `npm run convex:backfill:workspace-ids`

**Important:** Run this BEFORE making `workspaceId` required in the schema.
After backfill completes, promote to `v.string()`.

---

### Phase 7: Frontend — pass workspace context to API calls ✅ DONE

**Already implemented (Phase 0):**
- BFF resolves active workspace from session via `WorkspaceService.resolveActiveWorkspace`
- BFF supports explicit `x-overlay-workspace-id` header override (falls back to session)
- `WorkspaceProvider` dispatches `WORKSPACE_CHANGED_EVENT` on workspace switch
- `WorkspaceProvider` calls `client.activate()` to set active workspace on server
- `setActiveChatListWorkspace` updates chat list cache key on workspace switch
- `x-overlay-workspace-id` header is used by proxy, workflows, agent runner, and API clients

**Added in Phase 7:**

Created `useWorkspaceChanged` hook (`src/features/workspaces/lib/use-workspace-changed.ts`)
that listens for the `overlay:workspace-changed` window event and calls a callback
with the event detail. This lets resource list components refetch on workspace switch.

Wired `useWorkspaceChanged` into 11 resource list components:

| Component | File | Fetch function |
|-----------|------|----------------|
| ChatInlinePanel | `src/features/chat/components/ChatInlinePanel.tsx` | `loadChats` |
| useChatListController | `src/features/chat/components/chat/useChatListController.ts` | `loadChats` |
| ChatActivityView | `src/features/chat/components/ChatActivityView.tsx` | `load` |
| FilesInlinePanel | `src/components/layout/AppSidebarInlinePanels.tsx` | `loadItems` |
| ProjectsView | `src/features/projects/components/ProjectsView.tsx` | `loadProjects` |
| ProjectsInlinePanel | `src/components/layout/AppSidebarInlinePanels.tsx` | `loadProjects` |
| AutomationsInlinePanel | `src/features/automations/components/AutomationsInlinePanel.tsx` | `loadAutomations` |
| SkillsView | `src/features/automations/components/SkillsView.tsx` | `loadSkills` |
| McpServersView | `src/features/integrations/components/McpServersView.tsx` | `loadServers` |
| MemoriesView | `src/features/knowledge/components/MemoriesView.tsx` | `loadMemories` |
| IntegrationsView | `src/features/integrations/components/IntegrationsView.tsx` | `loadConnected` + `loadCatalog` |

**Pattern:**
```typescript
import { useWorkspaceChanged } from '@/features/workspaces/lib/use-workspace-changed'

// After existing initial-load useEffect:
useWorkspaceChanged(loadXxx)
```

The hook listens for `WORKSPACE_CHANGED_EVENT` and calls the provided callback,
which triggers a refetch of workspace-scoped data.

---

### Phase 8: Knowledge base sources — scope via parent ✅ DONE

Knowledge bases are bound to workspaces via `workspace_resource_scopes` (the
`bindResource` call in the POST route). Knowledge base sources inherit workspace
scoping via their parent knowledge base — no direct `workspaceId` on sources.

**Changes:**

1. **List knowledge bases by workspace** — Added `listResourceIdsByWorkspace`
   to `WorkspaceRepository` interface + Postgres/Convex implementations +
   `WorkspaceService`. The BFF GET route now fetches workspace-scoped resource
   IDs first, then filters `listKnowledgeBases` to only those bound to the
   active workspace.

2. **Knowledge search workspace filtering** — Added `workspaceId` to
   `KnowledgeSearchArgs`. The BFF search route passes
   `context.workspace.workspace.id`. The Postgres search repository adds a
   `workspace_id` SQL filter to both vector and lexical queries. The Convex
   `hybridSearch` action filters lexical results via the search index
   `filterFields` and post-filters vector results by fetching the chunk doc
   (since `knowledgeChunkEmbeddings` doesn't have `workspaceId`).

3. **Postgres schema** — Added `workspace_id` column + index to
   `knowledge_chunks` table (migration `0048_knowledge_chunks_workspace_id.sql`).
   The Convex `knowledgeChunks` table already had `workspaceId` from Phase 1.

**Files changed:**
- `src/server/workspaces/WorkspaceRepository.ts` — interface method
- `src/server/workspaces/PostgresWorkspaceRepository.ts` — SQL implementation
- `src/server/workspaces/ConvexWorkspaceRepository.ts` — Convex implementation
- `src/server/workspaces/WorkspaceService.ts` — public service method
- `convex/collaboration/workspaces.ts` — `listResourceIdsByWorkspaceByServer` query
- `src/server/knowledge-bases/KnowledgeBaseService.ts` — `workspaceScopedResourceIds` filter
- `src/server/app-api/v1/knowledge-bases/route.ts` — pass workspace filter to list
- `src/server/knowledge/KnowledgeSearchRepository.ts` — `workspaceId` in args
- `src/server/knowledge/PostgresKnowledgeSearchRepository.ts` — SQL workspace filter
- `convex/knowledge/knowledge.ts` — workspace filter in hybridSearch + lexical
- `src/server/app-api/v1/knowledge/search/route.ts` — pass workspaceId
- `src/server/database/postgres/schema.ts` — `workspace_id` column + index
- `migrations/app-data/0048_knowledge_chunks_workspace_id.sql` — new migration

---

## Execution Order

1. **Phase 0** — BFF workspace context (unblock collaboration routes, make `context.workspace` available everywhere)
2. **Phase 1** — Schema migration (add optional `workspaceId` + indexes)
3. **Workspace ID backfill** — Populate `workspaceId` for existing rows
4. **Phase 1 (cont.)** — Promote `workspaceId` to required in schema
5. **Phase 2** — Write paths (thread `workspaceId` through creates)
6. **Phase 3** — Read paths (filter by `workspaceId` in list queries)
7. **Phase 4** — Update/read paths (scope individual resource access)
8. **Phase 5** — Connectors (Composio mapping table)
9. **Phase 7** — Frontend verification (refetch on workspace switch)

---

## Postgres Parity Plan

The Postgres provider is not the production default (Convex is), but the
codebase maintains full Postgres implementations for all resource repos.
The repository **interfaces** already accept `workspaceId` (from the Convex
phases), but the Postgres implementations ignore it. This plan closes that
gap so the Postgres provider is workspace-safe when enabled.

### Current state

| Layer | Status |
|-------|--------|
| Repository interfaces | ✅ `workspaceId?: string` in all 8 repos (from Convex phases) |
| Postgres schema columns | ❌ Only `knowledge_chunks` has `workspace_id` (migration 0048) |
| Postgres repo implementations | ❌ None of the 8 repos accept or filter by `workspaceId` |
| Postgres backfill | ❌ Not done |
| `PostgresConversationCollaborationRepository` | ✅ Already workspace-scoped (channels/DMs) |
| `PostgresWorkspaceRepository` | ✅ `bindResource` / `listResourceIdsByWorkspace` work |
| `PostgresKnowledgeSearchRepository` | ✅ Filters by `workspace_id` on `knowledge_chunks` |

### Phase PG-1: Schema — add `workspace_id` columns + indexes

**File:** `src/server/database/postgres/schema.ts`

Add `workspaceId: text('workspace_id')` column + `index('..._workspace_id_idx')` to these 8 tables:

| Table | schema.ts export | Current indexes to mirror |
|-------|-----------------|--------------------------|
| `files` | `files` (line 754) | Add `files_workspace_id_idx` |
| `notes` | `notes` (line 611) | Add `notes_workspace_id_idx` |
| `projects` | `projects` (line 350) | Add `projects_workspace_id_idx` |
| `automations` | `automations` (line 857) | Add `automations_workspace_id_idx` |
| `skills` | `skills` (line 370) | Add `skills_workspace_id_idx` |
| `mcp_servers` | `mcpServers` (line 388) | Add `mcp_servers_workspace_id_idx` |
| `memories` | `memories` (line 632) | Add `memories_workspace_id_idx` |
| `webhook_subscriptions` | `webhookSubscriptions` (line 963) | Add `webhook_subscriptions_workspace_id_idx` |

Also add `workspaceId: text('workspace_id')` to `conversations` table (line 484) + `conversations_workspace_id_idx`.

**Migration:** `migrations/app-data/0049_resource_tables_workspace_id.sql`

```sql
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "files_workspace_id_idx" ON "files" ("workspace_id");

ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "notes_workspace_id_idx" ON "notes" ("workspace_id");

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "projects_workspace_id_idx" ON "projects" ("workspace_id");

ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "automations_workspace_id_idx" ON "automations" ("workspace_id");

ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "skills_workspace_id_idx" ON "skills" ("workspace_id");

ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "mcp_servers_workspace_id_idx" ON "mcp_servers" ("workspace_id");

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "memories_workspace_id_idx" ON "memories" ("workspace_id");

ALTER TABLE "webhook_subscriptions" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_workspace_id_idx" ON "webhook_subscriptions" ("workspace_id");

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "workspace_id" text;
CREATE INDEX IF NOT EXISTS "conversations_workspace_id_idx" ON "conversations" ("workspace_id");
```

Register in `migrations/app-data/meta/_journal.json` as idx 49.

### Phase PG-2: Repository implementations — thread `workspaceId` through

For each of the 8 Postgres repositories, add `workspaceId?: string` to method
params (if not already in the interface) and filter/set it in queries.

**Pattern** (from `PostgresConversationCollaborationRepository`):
- List queries: add `args.workspaceId ? eq(table.workspaceId, args.workspaceId) : undefined` to `and()` filter
- Create: set `workspaceId: args.workspaceId` in the insert values
- Get/update/delete: add workspaceId to the WHERE clause, or fetch + verify

#### 2a. `PostgresFileRepository.ts`
- `getFile`: add `workspaceId` to WHERE
- `listFiles`: add `workspaceId` filter
- `createFile` / `createFileWithStorage` / `createExtractedDocument`: set `workspaceId`
- `updateFile` / `removeFile`: add `workspaceId` to WHERE
- Storage/utility methods (`getUploadIntent`, `getR2KeysForSubtree`, etc.): no change needed (not resource-list operations)

#### 2b. `PostgresNoteRepository.ts`
- `getNote`: add `workspaceId` to WHERE
- `listNotes`: add `workspaceId` filter
- `createNote`: set `workspaceId`
- `updateNote` / `deleteNote`: add `workspaceId` to WHERE

#### 2c. `PostgresProjectRepository.ts`
- `getProject`: add `workspaceId` to WHERE
- `listProjects`: add `workspaceId` filter
- `createProject`: set `workspaceId`
- `updateProject` / `deleteProjectTree`: add `workspaceId` to WHERE

#### 2d. `PostgresAutomationRepository.ts`
- `listAutomations`: add `workspaceId` filter
- `getAutomation`: add `workspaceId` to WHERE
- `createAutomation`: set `workspaceId`
- `updateAutomation` / `removeAutomation`: add `workspaceId` to WHERE

#### 2e. `PostgresSkillRepository.ts`
- `list`: add `workspaceId` filter
- `get`: add `workspaceId` to WHERE
- `create`: set `workspaceId`
- `update` / `remove`: add `workspaceId` to WHERE

#### 2f. `PostgresMcpServerRepository.ts`
- `list`: add `workspaceId` filter
- `get`: add `workspaceId` to WHERE
- `create`: set `workspaceId`
- `update` / `remove`: add `workspaceId` to WHERE

#### 2g. `PostgresMemoryRepository.ts`
- `get`: add `workspaceId` to WHERE
- `list`: add `workspaceId` filter
- `create`: set `workspaceId`
- `update` / `remove`: add `workspaceId` to WHERE

#### 2h. `PostgresWebhookRepository.ts`
- `list`: add `workspaceId` filter
- `create`: set `workspaceId`
- `update` / `remove`: add `workspaceId` to WHERE
- `listDeliveries`: add `workspaceId` filter
- `rotateSecret` / `dispatch`: no change (not workspace-scoped operations)

#### 2i. `PostgresActConversationRepository.ts`
- `listConversations`: add `workspaceId` filter
- `createConversation`: set `workspaceId`
- `getConversationById`: add `workspaceId` to WHERE
- `updateConversation` / `deleteConversation`: add `workspaceId` to WHERE

### Phase PG-3: Backfill

**Migration:** `migrations/app-data/0050_backfill_workspace_ids.sql`

Backfill existing Postgres rows with the user's personal workspace ID:

```sql
-- For each resource table, set workspace_id to the user's personal workspace
UPDATE "files" f
SET "workspace_id" = w."id"
FROM "workspaces" w
WHERE f."user_id" = w."personal_owner_user_id"
  AND w."kind" = 'personal'
  AND f."workspace_id" IS NULL;
```

Repeat for: `notes`, `projects`, `automations`, `skills`, `mcp_servers`,
`memories`, `webhook_subscriptions`, `conversations`.

For users without a personal workspace, the migration should create one first
(CTE pattern from the Convex `ensureLegacyPersonalScope`).

### Phase PG-4: Verification ✅

**Typecheck:** 1157 errors (down from 1164 baseline — 7 pre-existing errors fixed by adding `workspaceId` to conversations table + `fileRowFromRaw` mapping)

**ESLint:** Clean on all 13 changed files

**Isomorphic:** 120 shared modules pass

**Audit results:** All 9 Postgres repositories audited. Every CRUD method (list/get/create/update/delete) across all 9 repos accepts and filters by `workspaceId` using the conditional backward-compatible pattern.

**Audit fixes applied:**
- `PostgresFileRepository.getFileByLegacyOutputId` — added `workspaceId` to args + WHERE
- `PostgresAutomationRepository.updateAutomation` — added `workspaceId` filter to final UPDATE WHERE

**Intentionally not scoped (internal system operations, matching Convex parity):**
- `PostgresMcpServerRepository.updateToolCatalog` / `updateOAuthState` — operate by mcpServerId + userId (Convex also doesn't scope these)
- `PostgresWebhookRepository.rotateSecret` / `dispatch` — operate by subscriptionId + userId (internal event dispatch, not CRUD)
- `PostgresFileRepository` storage utility methods (getUploadIntent, getR2KeysForSubtree, etc.) — not resource list operations
- `PostgresProjectRepository.deleteProjectTree` cascading deletes — the initial project lookup filters by workspaceId, and all child resources with that projectId belong to the same workspace

**Migration SQL verified:**
- `0049_resource_tables_workspace_id.sql` — 9 ALTER TABLE + 9 CREATE INDEX, all using `IF NOT EXISTS`
- `0050_backfill_workspace_ids.sql` — 2-step: create personal workspaces for users without one, then backfill all 10 resource tables
- Both registered in `_journal.json` as idx 49 and 50

### Client route isolation ✅

Canonical `/app/w/:workspaceId/:surface` requests forward `x-overlay-workspace-id` into in-process initial-data loads. The app shell keeps the sidebar mounted, masks the previous page as soon as a switch begins, and remounts the route-content subtree under a workspace-specific key when navigation commits. This prevents state initialized from Workspace A (`files`, chats, projects, knowledge, automations, and integrations) from surviving into Workspace B even though both canonical URLs rewrite to the same Next.js route.

Compatibility routes without a workspace path segment (including `/app/settings` and `/app/automations`) treat the activated workspace state as the navigation commit signal. They must not wait for a workspace ID to appear in the pathname, or the route-content fallback will remain visible indefinitely.

### Legacy knowledge bases and connector ownership ✅

- The Knowledge page and its secondary sidebar load through the workspace-aware BFF and reconcile again on `overlay:workspace-changed`; neither retains an owner-only list across a workspace switch.
- Legacy personal knowledge bases without a resource binding are claimed lazily by the Personal workspace. Existing bindings are never moved.
- Legacy Composio accounts without any workspace mapping are claimed lazily by the Personal workspace. Provider keys already mapped to any workspace are never copied across workspaces.

### Participant-scoped workspace conversations ✅

- Personal chats remain owner-scoped. Direct messages and channels resolve through the collaboration repository, which authorizes active conversation participants for metadata, lists, history, sends, and durable event cursors.
- Conversation navigation derives the destination from `conversationType`; opening a DM or channel from All or Activity cannot fall through to the personal-chat renderer. Selecting Personal always starts a new personal chat. Selecting Direct Messages or Channels validates the remembered ID against that subview and otherwise opens its most recently modified room; an empty subview renders a selection prompt instead of the personal composer.
- Soft switches (`history.pushState` + `overlay:chat-route-selected`) must include `view` and be observed by `ConversationExperienceRouter` — Next `useSearchParams` alone does not update for pushState, which previously left DMs/channels stuck on the first opened room.
- Sidebar list loads send `view=personal|dms|channels|all` and receive a paginated envelope filtered **before** pagination so Load more is not shown when a view only has a handful of rooms.
- Opening a collaboration room marks participant read and clears unread workspace notifications for that conversation. `overlay:collaboration-read` refreshes room-list badges, while `overlay:collaboration-notifications-changed` refreshes Activity and chat badges immediately. Personal completion unread appears on Personal; collaboration notifications are categorized against the workspace conversation directory for Direct Messages and Channels; Activity remains their aggregate. There is no separate All navigation item.
- Room transcript UX: received messages keep their author name on every row and use Slack-style flat rows (no bubble); sent messages are only the right-aligned **gray** bubble, with no avatar, name, or time. All authored messages use the shared safe Markdown renderer, and known `@member` tokens render as distinct composer-style pills. The composer calls the people/agent directory **Members** and forwards those principals to the mention input. In Personal chat, sending a member mention stops above the composer and asks the user to create a DM or private channel; the confirmed draft is sent once in that new conversation while the original remains private. Hover actions float top-right. Thread entry shows `N replies` plus a latest-reply teaser. Rooms pin scroll to the latest message on open.
- Message edits append the replaced content to durable `editHistory` before updating the body. The clickable `edited` label lives under the message and reveals previous versions; migration `0051_conversation_message_edit_history.sql` provides Postgres parity with the Convex field.
- Workspace management refreshes the signed-in human principal from the canonical user directory, repairing legacy principals whose display name was bootstrapped from an auth user ID.
- Agent mentions invoke against the `messageId` returned by `POST /api/v1/conversations/message`; clients must not rediscover that ID from asynchronously refreshed transcript state. Invocation reads metadata and history through the participant-scoped collaboration repository, streams the agent through the regular Markdown room renderer, and persists the finished response through `addAgentMessage`, which validates that the named agent is an active room participant.
- Agent creates, edits, and archives publish an `overlay:agent-directory-changed` event scoped to their workspace; the persistent secondary Agents sidebar refetches in place so its directory never waits for a navigation.
- Personal chat transcripts render the same day dividers as rooms when exchange `user.createdAt` is present.
- Composer does not host the Chat/Automate mode switcher (nav rail only).
- Onboarding tour must not start or block clicks on `/app/invitations/*` (full-screen tour shield previously prevented Accept invitation).
- Room sends persist the acting principal and use a client nonce for retry-safe delivery. On the Convex provider, active participants subscribe to the authorized `watchRoomMessages` query, so main-room and open-thread messages update through Convex's WebSocket-backed reactive query without a page reload.
- **Convex browser auth for rooms:** browser subscriptions use HS256 tokens from `/api/auth/convex-token`, signed with `INTERNAL_API_SECRET` and verified in Convex with `crypto.subtle` only. WorkOS JWTs cannot be verified inside queries/mutations because JWKS needs `fetch()`, which Convex forbids there. Auth failures return `{ ok: false }` so the last valid transcript stays mounted.
- BFF conversation-event long-poll is the Postgres transport and a Convex fallback only before the authenticated `watchRoomMessages` subscription is ready. The two transports are mutually exclusive once Convex is connected, so an optimistic room message is reconciled exactly once. Presence heartbeats, reactions, pins, and saved state are non-critical room enrichments and must never prevent membership plus message history from rendering.
- Primary and secondary sidebar destinations render as real links, preserving Cmd/Ctrl-click and middle-click. A normal secondary-subpage transition replaces that row's icon with the same circular loading indicator used by primary navigation until the route commits.
- Collaboration response arrays are validated before entering React state. A throttled or malformed auxiliary response keeps the last valid room state instead of reaching transcript `.filter` calls or the route error boundary.
- API-client JSON helpers reject non-2xx responses before typed payload consumers can read them. For example, an unauthorized sharing response becomes an inline dialog error rather than malformed state that crashes the chat route.
- Postgres message author fields and the composite keys for reactions, pins, and saved messages must match migrations `0032`–`0034`; keep the Drizzle schema aligned with those migrations.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Backfill takes too long for large datasets | Batch the migration by user, run in chunks |
| Workspace resolution fails for edge cases | `resolveActiveWorkspace` already creates a personal workspace fallback |
| Existing API clients break | `workspaceId` is optional in API requests — server resolves from session |
| Collaboration routes already use `context.workspace` but type doesn't have it | Phase 0 fixes this — it's already "broken" today |
| Knowledge bases table not in schema.ts | Add it to schema.ts as part of Phase 1 |
| Connectors stored externally | Phase 5 creates a mapping table — no Composio schema changes needed |

---

## QA Checklist

After implementation:

- [ ] Create a chat in Workspace A → switch to Workspace B → chat should NOT appear
- [ ] Create a file in Workspace A → switch to Workspace B → file should NOT appear
- [ ] Create a skill in Workspace A → switch to Workspace B → skill should NOT appear
- [ ] Create an MCP server in Workspace A → switch to Workspace B → MCP should NOT appear
- [ ] Create a project in Workspace A → switch to Workspace B → project should NOT appear
- [ ] Create an automation in Workspace A → switch to Workspace B → automation should NOT appear
- [ ] Create a note in Workspace A → switch to Workspace B → note should NOT appear
- [ ] Create a memory in Workspace A → switch to Workspace B → memory should NOT appear
- [ ] Generate an image in Workspace A → switch to Workspace B → output should NOT appear
- [ ] Create a webhook subscription in Workspace A → switch to Workspace B → webhook should NOT appear
- [ ] Connect Gmail in Workspace A → switch to Workspace B → connector should NOT appear
- [ ] Switch back to Workspace A → all resources should reappear
- [ ] Personal workspace should contain all pre-migration resources
- [ ] API calls without explicit `workspaceId` should use the session's active workspace

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

---

### Phase 6: Backfill migration

**One-time Convex migration function** (`convex/migrations/backfillWorkspaceIds.ts`):

```typescript
// Pseudocode
export const backfillWorkspaceIds = mutation({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    
    // 1. For each user, get their personal workspace ID
    const allUsers = await ctx.db.query('subscriptions').collect()
    for (const user of allUsers) {
      const personalWorkspace = await getOrCreatePersonalWorkspace(ctx, user.userId)
      
      // 2. Backfill each resource table
      for (const table of ['conversations', 'files', 'skills', 'mcpServers', ...]) {
        const rows = await ctx.db.query(table)
          .withIndex('by_userId', q => q.eq('userId', user.userId))
          .filter(q => q.eq(q.field('workspaceId'), undefined))
          .collect()
        for (const row of rows) {
          await ctx.db.patch(row._id, { workspaceId: personalWorkspace })
        }
      }
    }
  },
})
```

**Important:** Run this BEFORE making `workspaceId` required in the schema. After backfill completes, promote to `v.string()`.

---

### Phase 7: Frontend — pass workspace context to API calls

**Current state:** The `WorkspaceProvider` already tracks `activeWorkspaceId` in React context. The `workspaceClient.activate()` call sets the active workspace on the server (via `POST /api/v1/workspaces/active`).

**What's needed:**
1. The BFF boundary layer resolves the active workspace from the session (via `WorkspaceService.resolveActiveWorkspace`), so **the frontend doesn't need to explicitly pass `workspaceId` in every API call** — the server already knows which workspace is active.
2. However, for explicitness and for API clients (not browser), the `workspaceId` can be passed as a query param or header. The BFF should prefer the explicit param if provided, otherwise fall back to the session's active workspace.
3. After workspace switch, the frontend should refetch all resource lists (conversations, files, etc.) — the `dispatchWorkspaceChanged` event already exists for this.

**Files to verify:**
- `src/features/workspaces/components/WorkspaceProvider.tsx` — already dispatches workspace change events
- `src/shared/chat/chat-list-cache.ts` — already has `setActiveChatListWorkspace`
- Resource list hooks/components — ensure they refetch on workspace change

---

### Phase 8: Knowledge base sources — scope via parent

Knowledge base sources (`knowledgeBaseSources` or similar) reference files, notes, and memories. Since those will be workspace-scoped, knowledge base sources inherit workspace scoping via their parent resource.

**Action:** No direct `workspaceId` needed on sources. When listing sources, join through the parent resource which is already workspace-scoped.

---

## Execution Order

1. **Phase 0** — BFF workspace context (unblock collaboration routes, make `context.workspace` available everywhere)
2. **Phase 1** — Schema migration (add optional `workspaceId` + indexes)
3. **Phase 6** — Backfill migration (populate `workspaceId` for existing rows)
4. **Phase 1 (cont.)** — Promote `workspaceId` to required in schema
5. **Phase 2** — Write paths (thread `workspaceId` through creates)
6. **Phase 3** — Read paths (filter by `workspaceId` in list queries)
7. **Phase 4** — Update/read paths (scope individual resource access)
8. **Phase 5** — Connectors (Composio mapping table)
9. **Phase 7** — Frontend verification (refetch on workspace switch)

---

## Postgres Parity (Later)

The Postgres repositories (`PostgresActConversationRepository.ts`, etc.) will need the same treatment:
1. Add `workspaceId` column to each Postgres table (migration).
2. Add `WHERE workspace_id = $1` to all list queries.
3. Thread `workspaceId` through all create/update/delete paths.
4. Backfill existing rows with personal workspace ID.

The repository interfaces (`ActConversationRepository.ts`, etc.) already define the contract — adding `workspaceId` to the interface params will require both Convex and Postgres implementations to update simultaneously.

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

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

### Phase 0: BFF workspace context resolution

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

### Phase 1: Schema migration — add `workspaceId` to resource tables

For each of the 11 Convex tables (12 including knowledgeBases), add:
- `workspaceId: v.string()` field (required for new rows)
- `by_workspaceId` index
- `by_userId_workspaceId` composite index (for queries that filter by both)

**Tables to migrate in `convex/schema.ts`:**

| Table | Current indexes | New indexes to add |
|-------|----------------|-------------------|
| `conversations` | `by_userId`, `by_userId_lastModified`, etc. | `by_workspaceId`, `by_workspaceId_lastModified` |
| `files` | `by_userId` | `by_workspaceId`, `by_userId_workspaceId` |
| `skills` | `by_userId`, `by_projectId` | `by_workspaceId`, `by_workspaceId_projectId` |
| `mcpServers` | `by_userId`, `by_userId_enabled` | `by_workspaceId`, `by_workspaceId_enabled` |
| `projects` | `by_userId`, `by_userId_updatedAt` | `by_workspaceId`, `by_workspaceId_updatedAt` |
| `automations` | `by_userId`, `by_userId_enabled` | `by_workspaceId`, `by_workspaceId_enabled` |
| `notes` | `by_userId`, `by_userId_updatedAt` | `by_workspaceId`, `by_workspaceId_updatedAt` |
| `memories` | `by_userId`, `by_userId_updatedAt` | `by_workspaceId`, `by_workspaceId_updatedAt` |
| `outputs` | `by_userId`, `by_userId_createdAt` | `by_workspaceId`, `by_workspaceId_createdAt` |
| `webhookSubscriptions` | `by_userId`, `by_userId_enabled` | `by_workspaceId`, `by_workspaceId_enabled` |
| `knowledgeBases` | (not in schema) | Add to schema with `by_workspaceId`, `by_ownerUserId` |

**For `conversations`:** The `workspaceId` field already exists as `v.optional(v.string())`. Promote it to `v.string()` (required). The compatibility comment can be removed.

**For `knowledgeBases`:** Add the table to `schema.ts` with `workspaceId` from the start.

**Backfill strategy:**
- Add `workspaceId` as `v.optional(v.string())` first (so existing rows validate).
- Run a one-time Convex migration function that:
  1. For each user, resolves their personal workspace ID.
  2. Updates all rows in each table where `workspaceId` is undefined to the personal workspace ID.
- After backfill, promote to `v.string()` (required).

---

### Phase 2: Write paths — thread `workspaceId` through creates

Every create mutation must accept and persist `workspaceId`.

**Convex mutations to update:**

| Table | Mutation file | Mutation function |
|-------|-------------|------------------|
| `conversations` | `convex/chat/conversations.ts` | `create`, `createByServer` |
| `files` | `convex/files/files.ts` | `create`, `createByServer` |
| `skills` | `convex/integrations/skills.ts` | `create` |
| `mcpServers` | `convex/integrations/mcpServers.ts` | `create` |
| `projects` | `convex/projects/projects.ts` (or similar) | `create` |
| `automations` | `convex/automations/automations.ts` (or similar) | `create` |
| `notes` | `convex/files/notes.ts` | `create` |
| `memories` | `convex/knowledge/memories.ts` (or similar) | `create` |
| `outputs` | `convex/outputs/outputs.ts` (or similar) | `create` |
| `webhookSubscriptions` | `convex/webhooks/subscriptions.ts` (or similar) | `create` |
| `knowledgeBases` | `convex/knowledge/bases.ts` | `createBaseByServer` |

**BFF routes to update (pass workspaceId from context to mutation):**

| Route | File |
|-------|------|
| `POST /api/v1/conversations` | `src/server/app-api/v1/conversations/route.ts` |
| `POST /api/v1/files` | `src/server/app-api/v1/files/route.ts` |
| `POST /api/v1/skills` | `src/server/app-api/v1/skills/route.ts` |
| `POST /api/v1/mcps` | `src/server/app-api/v1/mcps/route.ts` |
| `POST /api/v1/projects` | `src/server/app-api/v1/projects/route.ts` |
| `POST /api/v1/automations` | `src/server/app-api/v1/automations/route.ts` |
| `POST /api/v1/notes` | `src/server/app-api/v1/notes/route.ts` |
| `POST /api/v1/memory` | `src/server/app-api/v1/memory/route.ts` |
| `POST /api/v1/outputs` | `src/server/app-api/v1/outputs/route.ts` |
| `POST /api/v1/webhooks` | `src/server/app-api/v1/webhooks/route.ts` |
| `POST /api/v1/knowledge-bases` | `src/server/app-api/v1/knowledge-bases/route.ts` |

**Pattern:** `context.workspace.workspace.id` → pass as `workspaceId` to the repository/mutation call.

---

### Phase 3: Read paths — filter by `workspaceId` in list queries

Every list query must filter by `workspaceId` in addition to `userId`.

**Convex queries to update:**

| Table | Query file | Query function | Current filter | New filter |
|-------|-----------|---------------|----------------|------------|
| `conversations` | `convex/chat/conversations.ts` | `list` | `by_userId_lastModified` | `by_workspaceId_lastModified` (or filter after `by_userId`) |
| `files` | `convex/files/files.ts` | `list` | `by_userId` | `by_workspaceId` (or filter after `by_userId`) |
| `skills` | `convex/integrations/skills.ts` | `list` | `by_userId` | `by_workspaceId` (or filter after `by_userId`) |
| `mcpServers` | `convex/integrations/mcpServers.ts` | `list`, `listEnabled` | `by_userId`, `by_userId_enabled` | `by_workspaceId`, `by_workspaceId_enabled` |
| `projects` | `convex/projects/projects.ts` | `list` | `by_userId` | `by_workspaceId` (or filter) |
| `automations` | `convex/automations/automations.ts` | `list` | `by_userId` | `by_workspaceId` (or filter) |
| `notes` | `convex/files/notes.ts` | `list` | `by_userId` | `by_workspaceId` (or filter) |
| `memories` | `convex/knowledge/memories.ts` | `list` | `by_userId` | `by_workspaceId` (or filter) |
| `outputs` | `convex/outputs/outputs.ts` | `list` | `by_userId` | `by_workspaceId` (or filter) |
| `webhookSubscriptions` | `convex/webhooks/subscriptions.ts` | `list` | `by_userId` | `by_workspaceId` (or filter) |
| `knowledgeBases` | `convex/knowledge/bases.ts` | `listBasesByServer` | `ownerUserId` | `workspaceId` |

**BFF routes to update (pass workspaceId from context to query):**

| Route | File |
|-------|------|
| `GET /api/v1/conversations` | `src/server/app-api/v1/conversations/route.ts` |
| `GET /api/v1/files` | `src/server/app-api/v1/files/route.ts` |
| `GET /api/v1/skills` | `src/server/app-api/v1/skills/route.ts` |
| `GET /api/v1/mcps` | `src/server/app-api/v1/mcps/route.ts` |
| `GET /api/v1/projects` | `src/server/app-api/v1/projects/route.ts` |
| `GET /api/v1/automations` | `src/server/app-api/v1/automations/route.ts` |
| `GET /api/v1/notes` | `src/server/app-api/v1/notes/route.ts` |
| `GET /api/v1/memory` | `src/server/app-api/v1/memory/route.ts` |
| `GET /api/v1/outputs` | `src/server/app-api/v1/outputs/route.ts` |
| `GET /api/v1/webhooks` | `src/server/app-api/v1/webhooks/route.ts` |
| `GET /api/v1/knowledge-bases` | `src/server/app-api/v1/knowledge-bases/route.ts` |

**Repository interfaces to update:**
- `ActConversationRepository.ts` — `listConversations` and `listConversationsByProject` need `workspaceId` param
- `ConvexActConversationRepository.ts` / `PostgresActConversationRepository.ts` — implement the new param
- Similar updates for all other repository interfaces

**Convex query strategy:** Since Convex indexes can't be changed at query time, we have two options:
1. **Use the new `by_workspaceId_*` indexes** — most efficient, but requires the index to exist.
2. **Filter in memory after `by_userId`** — simpler, works immediately, but less efficient for users with many workspaces.

**Recommendation:** Use the new indexes for tables that will have many rows (conversations, files, notes, memories). For tables with few rows per user (skills, MCPs, webhooks, projects, automations), in-memory filtering after `by_userId` is fine.

---

### Phase 4: Update/read paths — scope individual resource access

When accessing a single resource (get, update, delete), verify the resource belongs to the active workspace.

**Pattern:** Before returning/modifying a resource, check `resource.workspaceId === context.workspace.workspace.id`. If mismatch, return 404 (not 403, to avoid leaking existence).

**Convex queries/mutations to update:**
- `conversations:get`, `conversations:update`, `conversations:delete`
- `files:get`, `files:update`, `files:delete`
- `skills:get`, `skills:update`, `skills:remove`
- `mcpServers:get`, `mcpServers:update`, `mcpServers:remove`
- `projects:get`, `projects:update`, `projects:delete`
- `automations:get`, `automations:update`, `automations:delete`
- `notes:get`, `notes:update`, `notes:delete`
- `memories:get`, `memories:update`, `memories:delete`
- `outputs:get`, `outputs:delete`
- `webhookSubscriptions:get`, `webhookSubscriptions:update`, `webhookSubscriptions:delete`
- `knowledgeBases:*`

**Alternative (simpler):** Since all queries already filter by `userId`, and `workspaceId` is added, we can filter by both in the query: `resource.userId === userId && resource.workspaceId === workspaceId`. This is a defense-in-depth approach.

---

### Phase 5: Connectors (Composio) — workspace-scoped connection mapping

**Problem:** Composio connections are stored externally and keyed by `userId`. There's no Convex table for them.

**Solution:** Create a `workspaceConnectors` table in Convex:

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

**Flow:**
1. **List connectors:** Query `workspaceConnectors` by `workspaceId`, then fetch details from Composio by `connectedAccountId`.
2. **Connect:** Create the Composio connection (as today), then insert a row in `workspaceConnectors` with the active `workspaceId`.
3. **Disconnect:** Delete from Composio + delete the `workspaceConnectors` row.

**Note:** This means a user connecting Gmail in Workspace A won't see it in Workspace B. They'd need to reconnect. This is the correct behavior for workspace isolation.

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

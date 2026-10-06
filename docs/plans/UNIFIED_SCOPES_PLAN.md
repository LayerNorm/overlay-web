# Unified scopes: Personal, Workspace, Archived

Status: decisions made; Phase 0 (audit) and Phase 1 (cleanup) done, 2026-10-05; Phases 2–5 not started.

## Goal

Every resource in a workspace has one of two scopes, and every page's secondary sidebar shows the same three views:

- **Personal**: mine, within the current workspace. Private to me.
- **Workspace**: shared with the workspace's members.
- **Archived**: whatever was archived from either scope. Restoring returns an item to the scope it came from.

"Personal" means *mine within this workspace*. It is not the personal workspace (the one created at sign-up). A later phase retires that special workspace entirely.

The secondary panel keeps its current anatomy: page title, the subpage rows, then the New button and search, then the list. New never sits above the subpages.

```
chats                          files
─────────────────────          ─────────────────────
▣ Personal                     ▣ Personal
▢ Workspace                        All / Notes / Files / Outputs
    ✉ Direct Messages          ▢ Workspace
    # Channels                 ▢ Archived
    🔔 Activity                ─────────────────────
▢ Archived                     [ New            ] [🔍]
─────────────────────          list…
[ New chat       ] [🔍]
list…
```

## Where things stand (from the Convex schema, 2026-10-05)

Field-level scan only; access rules were not audited line by line (see Phase 0).

| Resource | `workspaceId` | Personal vs workspace | Archive |
| --- | --- | --- | --- |
| Agents | yes | yes: `visibility` is `creator` or `workspace` | `archivedAt` |
| Chats (`conversations`) | yes | partly: `conversationType` (personal, dm, channel), `shareVisibility`, `channelVisibility` | per participant (`conversationParticipants.archivedAt`), `deletedAt` |
| Memories | yes | yes: `visibility` is `owner` or `workspace` | none |
| Files | yes | partly: `shareVisibility`, creator in `userId` | soft delete (`deletedAt`) only |
| Notes | yes | no (creator only) | soft delete only |
| Outputs | yes | no | none |
| Skills | yes | no | none |
| MCP servers | yes | no | none |
| Connectors (`workspaceConnectors`) | yes | no (one connection per person per workspace) | none |
| Automations | yes | no (listed by `userId`) | `archivedAt`, `deletedAt` |
| Knowledge bases | no (`ownerUserId` only) | no | `archivedAt` |
| Projects | yes | no | `archivedAt`, `deletedAt` |

Knowledge bases and projects are no longer features. Five knowledge-base tables have no code references, `knowledgeBases` and `projects` still hold production rows, and 21 `projectId` fields remain across other tables. They are removed in Phase 1 so the unification does not have to carry them.

## Phase 0 results (audit, 2026-10-05)

Source: production Convex (`colorful-chickadee-419`), read-only; code read in `convex/` and `src/server/`.

### How access works today

- **Creator-only, enforced in Convex by `userId` equality.** Notes, files, skills, MCP servers, automations, and their writes all check `row.userId === userId`. `workspaceId` is an *optional* filter: with it, rows are narrowed to that workspace; without it, a creator gets their rows from every workspace. There is no "readable by other members" path for these tables.
- **No membership check in Convex** for these tables (only `workspaceConnectors` calls `requireActiveWorkspaceMembership`). Membership is enforced in the BFF, which resolves the active workspace before calling Convex with the server secret.
- **Two existing extension points in the BFF** (`src/server/app-api/bff-context.ts`): `getAuthorizedResourceUserId` (today returns the caller's own id) and `getGrantedResources` (today returns `[]`, commented "until workspace sharing is fully wired"). The shared access helper in Phase 2 plugs in here.
- **Lists scan by user, then filter in memory.** Notes and automations lists read `by_userId_updatedAt`, over-fetch 3x, and filter `workspaceId`/`deletedAt` in code; skills and MCP servers read `by_userId` and filter. The scope views need real indexes (`workspaceId + scope + archivedAt`), not more in-memory filtering.
- **Skills and MCP servers also filter out rows with a `projectId`** (leftover from projects).
- **MCP server credentials** (`authType`, `oauthScope`, OAuth state and sessions) are read and written only by the creator (`server.userId === userId`). Workspace scope must share *use* without sharing these.
- **Memories** have the reference pattern: `visibility` (`owner` | `workspace`) and a `listWorkspace` query. Finding: `listWorkspace` returns every memory in the workspace (up to 100) **without** applying `visibility`; the caller filters (`convex/knowledge/knowledge.ts` skips `visibility === 'owner'` rows of other users). The shared helper should apply it, so a caller cannot forget.
- **Agents** default to `visibility: 'workspace'` on create and treat a missing value as `workspace`; `creator` hides it from others.
- **Chats**: access is by participant (`conversationParticipants`) for DMs and channels, creator for personal chats; `shareVisibility` (`private` | `public`) controls public links, `channelVisibility` controls channels. These stay separate from scope.

### Notes and outputs live in `files` now

- `files.kind` is `note` (89), `output` (52), `upload` (62), `folder` (4), and unset (13). The app reads and writes notes and outputs through `files/files:*`; **nothing calls `files/notes:*`**, and the `outputs` table is only read by a migration helper. The old `notes` (53 rows) and `outputs` (47 rows) tables are legacy.
- Consequence for scope work: **Notes, Files, and Outputs are one table (`files`)**, so they get `scope` and the archive fields once. The legacy `notes` and `outputs` tables are removed in Phase 1 instead of being migrated.
- Check before dropping: 30 of the 47 legacy outputs are linked to a `files` row (`legacyOutputId`); none of the 53 legacy notes carry a `legacyNoteId` link. Phase 1 must compare the legacy rows against `files` (by title and creator) and either confirm they were migrated or migrate the rest.
- `files.shareVisibility` is unset on all 220 rows.

### Production row counts (whole deployment)

| Table | Rows | Live (not deleted) | Rows with `projectId` | Rows without `workspaceId` |
| --- | --- | --- | --- | --- |
| `files` | 220 | 142 | 3 | 0 |
| `notes` (legacy) | 53 | 33 | 1 | 0 |
| `outputs` (legacy) | 47 | 47 | n/a | 0 |
| `skills` | 3 | 3 | 0 | 0 |
| `mcpServers` | 5 | 5 | 0 | 0 |
| `workspaceConnectors` | 12 | 12 | n/a | 0 |
| `automations` | 91 | 39 | 0 | 0 |
| `conversations` | 1,328 | 1,111 | 5 | 2 |
| `memories` | 1,726 | 1,720 | 0 | 1 |
| `projects` | 34 | 29 | n/a | 0 |
| `knowledgeBases` | 5 | 5 | n/a | 0 (no `workspaceId` column) |
| `knowledgeBaseSources` | 1 | 1 | n/a | n/a |
| `knowledgeBaseConversations`, `projectKnowledgeBases`, `knowledgeBaseGroupDefaults` | 0 | 0 | 0 | n/a |
| `knowledgeChunks` (live search chunks: memory, file, message) | 2,913 | n/a | 0 | n/a |
| `documentIngestionJobs` | 0 | 0 | 0 | n/a |
| `mcpToolExecutions` | 73 | n/a | 0 | n/a |

Of the 11 tables that carry a `projectId` column, only `files` (3), `notes` (1), and `conversations` (5) have rows that use it; the other columns can be dropped with no data work.

### Who actually shares a workspace

- 252 workspaces: 249 of kind `personal`, 3 of kind `organization` (QA Test WS, Allen Demo Workspace, Demo workspace).
- 379 principals: 253 human, 126 agent. Agents count as workspace members, so a raw "more than one member" count is misleading.
- **Only one workspace has more than one active human member: `personal-1n34zae` (the owner's own, with 2).** Every other workspace has exactly one human.
- Rows with more than one creator in a workspace exist only there (2 creators of conversations, 3 of memories).
- Consequence: the migration risk is low. Defaulting every row to `personal` changes what nobody sees, and "silent exposure" can only affect that one workspace. It also means workspace-scoped features have effectively no multi-person production data to test against, so tests must create their own.

### Findings that change the plan

1. **`files` carries Notes, Files, and Outputs**; add scope and archive fields there once, and drop the legacy `notes` and `outputs` tables in Phase 1.
2. **Phase 1 is smaller than expected**: only `files`, `notes`, and `conversations` have `projectId` data; knowledge bases hold 6 rows in total.
3. **Add indexes** for scope views; the current in-memory filtering over `by_userId` does not scale to shared lists.
4. **The helper goes in the two BFF seams** and also fixes the memories `listWorkspace` visibility gap.
5. **Conversations** (2) and **memories** (1) have rows with no `workspaceId`; Phase 2's backfill assigns them or marks them for cleanup.

## Decisions (owner, 2026-10-05)

Who may do what is a **workspace admin setting**, not a hard-coded rule. The settings live in the existing workspace policy (`/api/v1/workspaces/[workspaceId]/policies`, next to `memberCanCreateChannels`, `memberCanCreateAgents`, `memberCanInvite`) and are edited in Workspace settings.

| Setting (proposed field) | Options | Default |
| --- | --- | --- |
| **Who can create or edit workspace-scoped skills, MCP servers, and connectors** (`workspaceExtensionsEditors`) | `admins` (admins and owners only), or `members` (anyone in the workspace) | `members` |
| **Who can create or edit workspace-scoped notes, files, outputs, and automations** (`workspaceContentEditors`) | `admins` or `members` | `members` |
| **Members can move their own items between Personal and Workspace** (`memberCanMoveScope`) | yes / no. One switch for every resource: if yes, a member can move any resource they created in either direction; if no, they cannot. | yes |
| **Who can add usage to the workspace** (`usageTopUpBy`) | `admins` (admins and owners only), or `members` (anyone in the workspace) | `admins` |

Decided, not settings:

1. Scope names are `personal` and `workspace`; archive is a state, not a scope.
2. Existing rows default to `personal`, which matches how they behave today (creator-only).
3. **No admin can move someone else's workspace item back to Personal.** (Dropped.) An admin can archive it; only its creator can move it between scopes, and only when `memberCanMoveScope` allows.
4. **Archived shows both scopes**, each row tagged Personal or Workspace. Restoring returns an item to the scope it came from.
5. Backend first, then UI.
6. The first workspace a new user creates is an ordinary, named workspace (Phase 5).
7. **Billing is at the workspace level**, like Slack (below).

Assumptions to confirm (small):

- With `memberCanMoveScope` off, owners and admins can still move items they created themselves.
- The `usageTopUpBy` default is `admins` (Slack keeps billing with owners; adding usage is a smaller action, so it is a setting). Say if you want `members` as the default.
- Managing the plan and payment method is a separate, fixed permission: **owners only** (see billing).

### How Slack does billing

Slack bills at the **workspace** level. Billing is managed by the Primary Owner and workspace Owners; Admins cannot open the billing page. The person who creates a workspace becomes its Primary Owner, so in practice the creator is the first billing owner, but the role is held by owners, not by "whoever created it". Source: Slack's "Types of roles in Slack" help page (checked 2026-10-05; the page confirms the role split, not per-seat pricing, so seat pricing is not assumed here).

What we adopt:

- **The workspace is the billing unit.** Each workspace has its own plan, allowance, and top-up balance. Members draw from the workspace's balance.
- **Owners (including the first owner, who is the creator) manage the plan and payment method.** Admins do not, unless promoted to owner.
- **Who can add usage** is the `usageTopUpBy` admin setting above.
- This changes my earlier recommendation of one plan per person. It is a bigger change than that option, but the groundwork exists: `billingAccounts` already has `scope: 'personal' | 'workspace'`, `workspaceId`, and `primaryBillingContactUserId`; workspace billing routes (checkout, portal, top-ups, verify) exist under `/api/v1/workspaces/[workspaceId]/billing`; and metering already records a `workspace` payer. Phase 5 is therefore mostly making workspace billing the only mode and moving existing personal plans onto workspaces.

## Principles

- **One shape, one helper.** Every resource gets the same two fields and one shared access helper, instead of per-table rules.
- **Additive first.** New fields are optional with a read-time default so nothing breaks while the migration runs.
- **No new meaning for old data.** Backfilled rows keep exactly the visibility they have today.
- **Archive is reversible and scoped.** It records who archived and from which scope, so restore is exact.
- **Convex rule:** a field cannot be removed from the schema while rows still carry it; removals go optional, then backfill or clear, then drop.

## Data model

Fields added to each scoped table (names are proposals):

```ts
scope: v.optional(v.union(v.literal('personal'), v.literal('workspace'))), // absent = 'personal'
archivedAt: v.optional(v.number()),
archivedBy: v.optional(v.string()),       // user id
archivedFromScope: v.optional(v.union(v.literal('personal'), v.literal('workspace'))),
```

Per resource:

| Resource | Change |
| --- | --- |
| Files (kinds note, upload, output, folder) | add `scope`, archive fields **once on `files`**: this covers Notes, Files, and Outputs; keep `deletedAt` for deletion; `shareVisibility` stays about public links and is separate from scope |
| Notes, Outputs (legacy tables) | no change; removed in Phase 1 |
| Skills | add `scope`, archive fields |
| MCP servers | add `scope`, archive fields; the stored credential stays with its creator, workspace scope shares *use*, not the secret |
| Connectors | add `scope`, archive fields; a workspace-scoped connector is one shared connection that workspace agents may use |
| Automations | add `scope`; `archivedAt` exists, add `archivedBy`, `archivedFromScope` |
| Chats | map to scopes: personal chats = `personal`; DMs, channels, and chats shared to the workspace = `workspace`. Archive stays per participant, so Archived lists the viewer's archived chats. No schema change expected beyond a derived scope |
| Agents | already has `visibility` (`creator`/`workspace`) and `archivedAt`; treat as the reference implementation and expose it as `scope` in the API |
| Memories | already `owner`/`workspace`; no archive needed |

Indexes (replace today's in-memory filtering over `by_userId`): add `by_workspaceId_scope_archivedAt` (and `by_workspaceId_userId_scope_archivedAt` for Personal) on each table, so the three views are single indexed reads.

## Access rules (one helper)

A shared helper, `canReadResource` / `canWriteResource` in `src/shared` (isomorphic, used by Convex and the BFF), decides:

- **Read**: `personal` → creator only. `workspace` → any active member of the workspace. Archived rows follow their `archivedFromScope`.
- **Create / edit in `workspace` scope**: governed by the two admin settings (`workspaceExtensionsEditors` for skills, MCP servers, connectors; `workspaceContentEditors` for notes, files, outputs, automations). `members` = any active member; `admins` = admins and owners only.
- **Edit / archive an existing item**: its creator; owners and admins for workspace-scoped items (to archive or edit, never to move someone else's item to Personal).
- **Move between scopes**: the creator, only when `memberCanMoveScope` is on (owners and admins can always move items they created). Nobody moves another person's item.
- **Archive** is allowed to the same people who can edit the item.
- **Agents acting for a person**: an agent run sees what the person sees, nothing more (unchanged principle). Workspace-scoped skills, MCP servers, and connectors become available to workspace agents only through the person's access.
- Guests: read workspace-scoped items only where already shared with them; no scope changes.

## Phases

### Phase 0: audit (done 2026-10-05)

Results are in "Phase 0 results" above. Remaining item carried into Phase 1: verify the legacy `notes` and `outputs` rows against `files` before dropping them.

### Phase 1: remove knowledge bases and projects (done 2026-10-05)

Commit: `WORKSPACE SCOPING 1`. What was done, in order:

1. **Backup.** Exported the rows of every affected table (`knowledgeBases` 5, `knowledgeBaseSources` 1, `projects` 34, legacy `notes` 53, legacy `outputs` 47, plus `files` and `conversations`) to `artifacts/backups/workspace-scoping-phase1/` (gitignored, local only).
2. **Carried legacy data into `files`.** The old `notes` and `outputs` tables had data that was never copied (34 of 53 notes had no `files` row; only 30 of 47 outputs were linked). A one-off migration copied the **33 live notes** (as Markdown, with workspace, tags, dates) and **18 completed outputs** (workspace and stored object kept) into `files`; the 20 deleted notes and the 1 failed output were not copied. `files` went from 220 to 271 rows. Verified: every live legacy note and every completed output has a `files` row with the same user, workspace, and R2 key, no HTML left in migrated notes, and a rerun copies nothing. This also resurfaces those people's old notes and outputs in their Files list.
3. **Cleared and dropped.** Deleted the rows of the five knowledge-base tables, `projects`, `notes`, and `outputs`; unset `projectId` on the 3 files, 5 conversations, and 1 deleted automation that carried one (that last one held an empty string, which my first count missed and which made the first schema push fail validation, harmlessly); then pushed the schema without those eight tables, their indexes, and every `projectId` field.
4. **Code.** Removed `convex/files/notes.ts`, `backfillCanonicalFilesystem` (and its script), the legacy-table parts of account deletion, storage admin tooling, mention search, turn deletion, the workspace backfill list, and the demo-account seed (which now creates Markdown `files` notes). `legacyNoteId` and `legacyOutputId` on `files` are now plain text (so old links still resolve through `getByLegacyNoteId` and `getByLegacyOutputId`), and the admin resource lookup finds legacy ids through them.

Corrections to Phase 0: `knowledgeChunks` holds 2,913 rows and `mcpToolExecutions` 73 (an earlier read returned 0 because the CLI limit was too high); none used `projectId`.

### Phase 2: scope and archive fields (done 2026-10-05)

Commit: `WORKSPACE SCOPING 2`. What was done:

- **Rules** in `src/shared/workspaces/resource-scope.ts` (isomorphic; table-driven tests): who can read, create, edit, move, archive, and which view (personal, workspace, archived) a row is in. Convex loads the viewer's role and the workspace policy once per request (`convex/lib/resourceScope.ts`) and applies the same rules.
- **Policy** `workspaceExtensionsEditors`, `workspaceContentEditors`, `memberCanMoveScope` (and `usageTopUpBy`, stored now and enforced in Phase 4) on the workspace sharing policy: contracts, Convex, `/policies` route (admins only, as before), defaults, and four new toggles on the Workspace settings page.
- **Fields and indexes** `scope`, `archivedAt`, `archivedBy`, `archivedFromScope` plus two indexes (`by_workspaceId_scope_archivedAt`, `by_workspaceId_userId_archivedAt`) on `files`, `skills`, `mcpServers`, `workspaceConnectors`, `automations`. Existing rows have no `scope`, which reads as personal, so nothing changes for anyone until something is moved.
- **Reads and writes** for all five resources: lists take `view`, creates take `scope`, update/delete follow "creator, plus owners/admins for workspace items", and each module exports `setScope`, `archive`, `restore` (`convex/lib/scopeMutations.ts`). Archiving a folder takes its contents; archiving an automation turns it off; archiving an MCP server disables it. Another member's connector is listed without its account id, and an MCP server's credentials are never returned to anyone but the creator.
- **BFF and clients** `?view=` on the skills, MCP, automations, and files lists; `scope` on their creates; new `POST /api/v1/scope` (`{resource, id, action, to?}`) with denials as 403/404/409 and a plain message; `@overlay/api-client` `scope` client and `view` queries; route catalogs and OpenAPI regenerated. A forbidden create returns 403 (`resource_scope_forbidden`) instead of a 500. Reading a single file now works for any member when the file is workspace-scoped (the old "owner only" check in `FileService` is gone; Convex decides).
- **Memories**: `listWorkspace` now hides other people's `visibility: 'owner'` memories.
- **Tests** `convex/resourceScope.convex.test.ts` (9 tests: private until moved, shared after, archive/restore round trip, admin vs member rights, policy variants including move off, folder cascade, credential and account-id scrubbing, memory visibility).

Not done, on purpose:

- **Audit events** for moves and archives (Phase 4 adds them with the activity feed).
- **Agents using workspace-shared skills, MCP servers, and connectors**: the agent-facing lists (`listDirectory`, `listEnabled`, `listByWorkspace`) stay creator-only and skip archived rows (Phase 4).
- **Connector list route** (`/api/v1/integrations`) does not yet take `view`; the Convex side (`listScopedByWorkspace`) and `POST /api/v1/scope` already work for connectors. The connectors UI arrives with Phase 3.
- **Derived `scope` for chats and agents** and the Archived list for them: Phase 3, together with the panel that needs them.
- **Backfill** of the 2 empty "New Chat" conversations and 1 memory with no `workspaceId` (invisible and harmless) and an explicit `scope: 'personal'` on old rows (reads already default). Rows moved to Archived keep `deletedAt` semantics unchanged.
- The `resource(...)` owner check in `authorization-route-policy.ts` is not wired into the BFF at runtime today; Convex is the enforcement point. If it is ever wired, workspace-scoped rows need an exception.

Original steps, for reference:

1. Add the optional fields and indexes above (Convex push; additive, safe).
2. Add the shared access helper and its tests (`src/shared`, with a table-driven test per rule).
3. Read paths: plug the shared helper into the two BFF seams (`getAuthorizedResourceUserId`, `getGrantedResources`) and into the Convex queries; fix `memories.listWorkspace` to apply `visibility`. Every list and get for the listed resources goes through "mine plus workspace-scoped" and respects `archivedAt`. Add scope and archive filters to the list APIs (`?scope=personal|workspace|archived`).
4. Policy: add `workspaceExtensionsEditors`, `workspaceContentEditors`, `memberCanMoveScope`, and `usageTopUpBy` to the workspace policy (contracts, Convex, `/policies` route, defaults above, and the Workspace settings page).
5. Write paths: create takes a `scope` (default `personal`); move-between-scopes and archive/restore endpoints enforce the rules above and write audit events.
6. Backfill: assign or clean up the 2 conversations and 1 memory with no `workspaceId`; a migration that sets `scope: 'personal'` explicitly on existing rows in batches (reads already default, so this can run later), and copies `deletedAt` → archived only where the product wants it (decision: deleted stays deleted).
7. Update `@overlay/api-client` per-resource modules, `docs/develop/api-route-catalog.mdx`, `compact-api-route-catalog.mdx`, and `docs/openapi` (`npm run docs:generate:api`).
8. Chats: expose a derived `scope` and an Archived list for the viewer; DMs/channels/activity are workspace scope.
- Exit: every resource can be listed by scope and by archived, with tests for read, write, move, and archive on both scopes; production rows unchanged in what each person can see.

### Phase 3: unified secondary panel (done 2026-10-05; item actions come in Phase 4)

Commit: `WORKSPACE SCOPING 3`. Prototype: `artifacts/unified-secondary-panel.html` (approved). Decisions from the review: Archived has no sub-rows; the selected scope starts expanded; New is hidden for members who may not create in Workspace.

- **Shell**: `buildScopedPanelNav` + nested rows in `InlineNavChildren`; all five pages use it. The scope is `?scope=` (Personal omitted), remembered per user, and read with `usePanelScope()` (`src/hooks/use-panel-scope.ts`, rules in `src/shared/workspaces/panel-scope.ts`). Agents' old `?view=` tab is still read.
- **Pages**: Chats (scope from the subview; Workspace holds Direct Messages, Channels, Activity), Files (list, tree, notes, uploads, and new notes follow the scope; the page remounts on a scope change), Extensions (Skills and MCP servers list and create by scope; Archived is one combined list), Automations (list and new drafts follow the scope), Agents (unchanged behavior, shared shell).
- **New button** hidden in Archived, and in Workspace when the admin settings (or `memberCanCreateChannels`/`memberCanCreateAgents`) do not let a member create there.
- **Backend additions**: notes and integrations lists take `view`; notes, uploads, and document ingestion take `scope`; `createWithStorage` and `createExtractedDocument` check the create rule.
- **Not yet** (Phase 4): Move to Workspace/Personal and Archive actions on items (until then, `POST /api/v1/scope` is the only way to move or archive, so Archived is empty in practice); the connectors list in Workspace shows a placeholder until connector sharing exists; archived connectors are not in the combined Extensions list; archived chats and agents keep their own existing rows (no tag); Activity keeps its own list.

Original steps, for reference:

- One panel shell component for all five pages: title, scope rows (Personal, Workspace, Archived), selected scope opens its sub-rows, then New + search, then the list. New is absent in Archived.
- Per-page sub-rows: Chats → Workspace has Direct Messages, Channels, Activity; Files has All, Notes, Files, Outputs under each scope; Extensions has Connectors, Skills, MCPs, Apps; Automations and Agents have none.
- Scope is remembered per user across pages (one saved setting) and mirrored in the URL (`?scope=`).
- Archived rows show a Personal/Workspace tag; restore returns to the origin scope.
- Create flows default to the current scope; the new-agent dialog already follows this.
- Docs: `docs/develop/interface-design.md`, the sidebar notes in `docs/develop/architecture.mdx`. Prototype the panel in `artifacts/` first (per AGENTS.md) and get sign-off before app code.
- Exit: all five pages use the shell; visual check in production on each; the Agents page is unchanged except for the shared shell.

### Phase 4: sharing and admin controls (done 2026-10-05)

Commit: `WORKSPACE SCOPING 4`.

- **Item actions**: Move to Workspace/Personal, Archive, and Restore on hovered file/note rows, on automation rows, in the skill and MCP server dialogs, and in bulk for selected files (`ScopeItemActions`, `ScopeBulkActions`, rules in `scopeItemOptions`). A button shows only when the server would allow it, so Move disappears for members when `memberCanMoveScope` is off.
- **Audit**: every move, archive, restore, and denial is written to the audit log (`resource.move|archive|restore`).
- **Usage top-ups** follow `usageTopUpBy`: owners and admins always; members (not guests) when the setting is `members`. The billing summary has `canTopUp`; members who may top up see only the top-up card (plan changes stay with owners and admins).
- **Agents use what the workspace shares**: skills (the directory every agent gets, `getInstructions`) and MCP servers (`search_mcp_tools`/`call_mcp_tool`; the server runs with its creator's credentials server-side, the member and the model never receive them, and only the app server may ask for shared rows). Running a shared tool is recorded against whoever ran it.
- **Search and tools**: mention search finds what the workspace shares (never private or archived items); `list_notes`, `list_files`, `list_skills`, and `list_automations` take an optional `scope`. `tool-catalog.md` updated.
- **Fix**: file rows now carry `scope`, `archivedAt`, `archivedFromScope` (the Archived tag was always "Personal" for files).
- The settings page toggles and their copy were already in place from Phase 2 (disabled with an explanation for non-admins).

Not done:

- Full-text/semantic file search (`search_knowledge`, `search_in_files`) still covers only the caller's own files; shared files are found by name (mentions) and listed by `list_files`.
- Restoring an archived automation leaves it off; turn it back on by hand.

Follow-up (2026-10-05): **workspace connectors** and the missing item actions landed.

- **Workspace connectors**: Extensions → Workspace → Connectors shows the same connectors; connecting one links an account held by a workspace entity (`ovws_<workspaceId>`), not the person, so it is separate from personal accounts, shared by every member, and unaffected when someone leaves. One per connector; its creator or an owner/admin disconnects; who may connect follows `workspaceExtensionsEditors`. In a workspace, agents get a second connector tool set (`workspace_…`) acting through those accounts. Composio only. Not verified against a live OAuth link (unit and Convex tests use fakes); the first real connect should be watched. Archiving workspace connectors and the archived list for connectors are not done; removing a member's account also removes the workspace connectors they linked (the provider account is left behind).
- **Move/Archive** now also in the note editor header, the file viewer header, and card-layout files and folders.
- **Rule**: expandable rows are not indented (`interface-design.md`).

Original steps, for reference:

- Workspace settings UI for the four policy settings; clear copy for each, and disabled controls with an explanation for non-admins.
- Move-to-workspace and move-to-personal actions on items (and bulk), hidden when `memberCanMoveScope` is off.
- Connectors and MCP servers: separate "shared use" from "owner's credential"; workspace agents can use a workspace-scoped connector without ever receiving the secret.
- Search (global search, mentions, MCP tools such as `list_notes`) filters by what the caller can read, and tools gain an optional `scope` argument. Update `docs/develop/tool-catalog.md`.
- "Add usage" actions (top-up) check `usageTopUpBy`.

### Phase 5: retire the special personal workspace

Split in two because the second half moves live money. **5a is done (2026-10-05); 5b was redesigned on 2026-10-06 (below) and is not built.**

#### 5a: the workspace stops looking special (done)

- **Names.** The generated name is now "<First name>’s workspace" (fallback "My workspace"), never "Personal" (`defaultWorkspaceName`, `src/shared/workspaces/default-name.ts`). A migration (`convex/migrations/renameGenericWorkspaces.ts`, dry run first) renamed the 249 existing first workspaces that were still called "Personal" (174) or "Personal’s workspace" (75, a bug from a missing display name); names an owner chose are untouched.
- **Rename.** Owners and admins can rename any workspace (new `PATCH /api/v1/workspaces/{id}/lifecycle`, inline in Workspace settings). Before this nobody could.
- **Onboarding.** A new person is asked to name their workspace (keep the default, or type one) before the tour.
- **Look.** One avatar, one label ("N members") for every workspace; the corner icon and "Personal workspace / Organization workspace" wording are gone.
- **Still special, on purpose, until 5b:** the data field `kind: 'personal'` (it decides who pays), the rule that a first workspace cannot be archived, and the owner being bound to it. Archiving or transferring it today would strand the person with no workspace they can pay from, because organization workspaces have no wallet yet.

#### 5b: one billing pool per workspace (decided 2026-10-06, not built)

**Model.** Every workspace has the same shape: members, and one billing pool. The pool is either the workspace's **free allowance** or a **plan** (a wallet) an owner funds. Usage is charged to the workspace you are working in, whoever triggers it and whoever owns the agent, so talking to a teammate's agent draws from the same pool. There is no separate "personal" kind and no "each person pays their own" mode. The first workspace is a workspace that happens to be free and solo; people can invite others into it, and they can create more workspaces and fund those. This partly reverses 5a: the first workspace may read as personal again (a quiet "Personal · Free" label derived from its billing and member count, not a stored kind); renaming, onboarding naming and the uniform avatar stay.

Rules:

1. **Free allowance is per workspace.** The free tier is a count (15 ask, write and agent turns per week, 600 seconds of transcription), tracked per person today in `dailyUsage`. It moves to the workspace. One person means one allowance, so 251 of 252 production workspaces behave exactly as now; a free workspace with several people runs out sooner, which is the upgrade prompt.
2. **Cap free workspaces per owner (3).** Otherwise creating workspaces multiplies the free allowance. A further workspace needs a plan.
3. **A plan replaces the free allowance** for that workspace (the existing workspace wallet: `BillingPayerResolver`, `WorkspaceBillingService`, account-keyed tables). Owners manage plan, payment and top-up; `usageTopUpBy` controls who may add usage.
4. **Attribution is a tag, not a payer.** Each charge records who triggered it, which resource (agent or automation) and that resource's owner, so reports can slice by member or resource. Runs with no human trigger (schedules, webhooks) are attributed to the resource owner. Per-member spend limits already exist; **per-agent caps are deferred** (`todos.md`).
5. **Existing paid personal plans do not move.** Today's 5 paid and 1 past-due subscribers keep the current personal pipeline: the owner's own usage stays on their plan; until they convert, other people in that workspace use the workspace's free allowance. Converting a plan into a workspace pool is a billing-system project done last, on request: it needs the shadow-sync top-up bug fixed first (`todos.md`), a staging dry run with the parity checker (`accountMigration.ts`), and a per-account cutover. No Stripe object changes until the owner approves a cutover.

**Why not "link the personal account to the workspace".** A billing account is a person's or a workspace's, never both (`assertBillingAccountOwnership` throws `billing_account_owner_mismatch`), and personal payers run on the legacy per-person tables copied into the account tables by `syncPersonalBillingShadows`, while workspace payers use the account tables directly. Two writers on one balance, and the shadow sync already silently reverts canonical top-ups.

**Adaptive UI (no setting).** The sidebar follows the number of human members rather than a "workspace features" toggle:

- One human: no Personal/Workspace tabs, no person-to-person DMs section, no Channels section until one is created (it stays in the + menu, because rooms with several agents are a real solo use). Items a solo user creates **stay `personal`**: hiding the tabs must not save them as workspace-scoped, or the first invite would expose them.
- A second human joins: tabs, DMs and Channels appear; nothing becomes visible to the new member until its creator moves it.
- Several personal workspaces are just several workspaces created by the same person.
- DMs with an agent are left alone: they already carry `agentId`, nest under the agent as threads, and the stored type stays `dm`. The DMs section lists only conversations with no agent.

Evidence (production, 2026-10-06): 252 workspaces, 251 with one human and 1 with two; 6 channels (2 in solo workspaces); 92 DMs, 88 with an agent and 4 person-to-person, all in the two-person workspace. Hiding Channels and person-to-person DMs for solo workspaces affects almost nobody.

Build order:

1. **B1, adaptive UI.** Derive human member count, apply the rules above, guard solo creation scope. No billing change.
2. **B2, free allowance per workspace.** Counters keyed by workspace, usage charged to the active workspace, the 3-workspace cap, usage attribution fields. Dry run the counter migration first.
3. **B3, workspace plans.** Enable wallets, "free or plan" step when creating a workspace, billing tab for every workspace (owners: plan, payment, top-up; others: usage), then remove the first-workspace special cases (archive rule, owner binding).
4. **B4, convert an existing personal plan** into a pool (on request, per the rule above).

## Testing

- Table-driven tests for the access helper (every role × scope × action).
- Convex tests per resource: create in each scope, list by scope, archive and restore, move, and a second member who must not see someone's personal item.
- A migration test: legacy rows with no `scope` read as personal; nothing becomes visible to more people.
- API route tests and boundary schemas for the new query and body fields.
- Production check after each phase: list counts per scope for the owner's own data match what they saw before.

## Risks

- **Silent exposure**: a list query that forgets the scope filter would show other members' personal items. Mitigation: one shared helper, tests that assert the negative case on every resource.
- **Schema removal order** (Phase 1): dropping fields before clearing rows fails the Convex push.
- **Sharing semantics** for files (`shareVisibility` links versus workspace scope) and for chats (`channelVisibility`) must not be conflated; scope controls who sees the item in lists, sharing links remain separate.
- **Credentials** in MCP servers and connectors: workspace scope must share use, not secrets.
- **Archive meaning** for chats is per participant today; a workspace-wide archive of a channel is a different action and is not changed by this plan.
- **Billing move** (Phase 5): moving personal subscriptions and credits onto workspaces touches live Stripe subscriptions and customer balances; it needs a dry run on a copy, an owner-approved cutover, and no change to live Stripe objects until then.
- **Policy defaults** are permissive (`members`) for editing, so a workspace that wants tighter control must turn the setting to `admins` itself.

## Order and rough size

| Phase | Size | Depends on |
| --- | --- | --- |
| 0 audit | small | none |
| 1 remove knowledge bases and projects | small–medium | 0 |
| 2 scope and archive fields | large | 0, 1, decisions table |
| 3 unified panel | medium | 2, prototype sign-off |
| 4 sharing and admin controls | medium | 2 |
| 5 retire personal workspace, workspace billing | large | 1–4 |

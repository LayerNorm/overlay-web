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

### Phase 2: scope and archive fields

1. Add the optional fields and indexes above (Convex push; additive, safe).
2. Add the shared access helper and its tests (`src/shared`, with a table-driven test per rule).
3. Read paths: plug the shared helper into the two BFF seams (`getAuthorizedResourceUserId`, `getGrantedResources`) and into the Convex queries; fix `memories.listWorkspace` to apply `visibility`. Every list and get for the listed resources goes through "mine plus workspace-scoped" and respects `archivedAt`. Add scope and archive filters to the list APIs (`?scope=personal|workspace|archived`).
4. Policy: add `workspaceExtensionsEditors`, `workspaceContentEditors`, `memberCanMoveScope`, and `usageTopUpBy` to the workspace policy (contracts, Convex, `/policies` route, defaults above, and the Workspace settings page).
5. Write paths: create takes a `scope` (default `personal`); move-between-scopes and archive/restore endpoints enforce the rules above and write audit events.
6. Backfill: assign or clean up the 2 conversations and 1 memory with no `workspaceId`; a migration that sets `scope: 'personal'` explicitly on existing rows in batches (reads already default, so this can run later), and copies `deletedAt` → archived only where the product wants it (decision: deleted stays deleted).
7. Update `@overlay/api-client` per-resource modules, `docs/develop/api-route-catalog.mdx`, `compact-api-route-catalog.mdx`, and `docs/openapi` (`npm run docs:generate:api`).
8. Chats: expose a derived `scope` and an Archived list for the viewer; DMs/channels/activity are workspace scope.
- Exit: every resource can be listed by scope and by archived, with tests for read, write, move, and archive on both scopes; production rows unchanged in what each person can see.

### Phase 3: unified secondary panel

- One panel shell component for all five pages: title, scope rows (Personal, Workspace, Archived), selected scope opens its sub-rows, then New + search, then the list. New is absent in Archived.
- Per-page sub-rows: Chats → Workspace has Direct Messages, Channels, Activity; Files has All, Notes, Files, Outputs under each scope; Extensions has Connectors, Skills, MCPs, Apps; Automations and Agents have none.
- Scope is remembered per user across pages (one saved setting) and mirrored in the URL (`?scope=`).
- Archived rows show a Personal/Workspace tag; restore returns to the origin scope.
- Create flows default to the current scope; the new-agent dialog already follows this.
- Docs: `docs/develop/interface-design.md`, the sidebar notes in `docs/develop/architecture.mdx`. Prototype the panel in `artifacts/` first (per AGENTS.md) and get sign-off before app code.
- Exit: all five pages use the shell; visual check in production on each; the Agents page is unchanged except for the shared shell.

### Phase 4: sharing and admin controls

- Workspace settings UI for the four policy settings; clear copy for each, and disabled controls with an explanation for non-admins.
- Move-to-workspace and move-to-personal actions on items (and bulk), hidden when `memberCanMoveScope` is off.
- Connectors and MCP servers: separate "shared use" from "owner's credential"; workspace agents can use a workspace-scoped connector without ever receiving the secret.
- Search (global search, mentions, MCP tools such as `list_notes`) filters by what the caller can read, and tools gain an optional `scope` argument. Update `docs/develop/tool-catalog.md`.
- "Add usage" actions (top-up) check `usageTopUpBy`.

### Phase 5: retire the special personal workspace

Separate project, after Phases 1–4; depends on the billing decision.

- Onboarding creates the first workspace, named by the user; stop auto-creating `personal-<user>` in `WorkspaceService`.
- Existing personal workspaces become ordinary workspaces (rename to something like "<Name>'s workspace", owner-editable). Remove the `kind === 'personal'` special cases (about 20 places: switcher and avatar, workspace settings, the integrations route, `WorkspaceService`, `convex/collaboration/workspaces.ts`, the showcase client).
- Billing becomes workspace-level (decided; see "How Slack does billing"). Each existing personal workspace's current plan, allowance, and top-up balance become that workspace's, with its owner as the billing contact. A person who owns several workspaces has a plan per workspace, and the free tier is per workspace. Needs a migration of `billingAccounts` rows from `scope: 'personal'` to `scope: 'workspace'`, an update of the Account page's usage and billing UI into Workspace settings (owners see the plan, admins and members see usage), and a fallback path for the moment between sign-up and workspace creation.
- A person always has at least one workspace; leaving or deleting the last one prompts them to create another.
- User-level data stays user-level: provider keys, Agent accounts (for example a ChatGPT sign-in), billing, account settings. Settings pages split cleanly into Account and Workspace.
- Cross-workspace "all my stuff" view is out of scope; note it as a later idea.

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

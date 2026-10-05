# Unified scopes: Personal, Workspace, Archived

Status: proposed (2026-10-05). Nothing here is built yet.

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

## Decisions

Decided:

1. Scope names are `personal` and `workspace`; archive is a state, not a scope.
2. Existing rows default to `personal`, which matches how they behave today (creator-only).
3. Backend first, then UI.
4. The first workspace a new user creates is an ordinary, named workspace (Phase 5).

Needs a decision before Phase 2 (recommendations in bold):

| Question | Options |
| --- | --- |
| Who may create or edit **workspace-scoped** skills, MCP servers, and connectors | **Admins and owners only** (they hold credentials and execute code); or all members |
| Who may create or edit workspace-scoped notes, files, outputs, automations | **Any member can create; the creator and admins can edit or archive; anyone with edit rights can be added later**; or admins only |
| Can a member move their own item Personal → Workspace | **Yes for notes, files, outputs, automations; for skills, MCP servers, connectors it needs the admin rule above** |
| Can an admin move someone else's workspace item back to Personal | **No. They can archive it; the creator can move it back.** |
| Archived default view | **Both scopes, each row tagged**; or only the scope you came from |
| Billing owner once personal workspaces go away (Phase 5) | **Plan per person (owner pays, workspaces draw from the owner's balance)**; or plan per workspace |

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
| Notes | add `scope`, archive fields; keep `deletedAt` for deletion |
| Files | add `scope`, archive fields; fold `shareVisibility` into the scope rules (sharing links stay; scope is about who sees it in lists) |
| Outputs | add `scope`, archive fields |
| Skills | add `scope`, archive fields |
| MCP servers | add `scope`, archive fields; the stored credential stays with its creator, workspace scope shares *use*, not the secret |
| Connectors | add `scope`, archive fields; a workspace-scoped connector is one shared connection that workspace agents may use |
| Automations | add `scope`; `archivedAt` exists, add `archivedBy`, `archivedFromScope` |
| Chats | map to scopes: personal chats = `personal`; DMs, channels, and chats shared to the workspace = `workspace`. Archive stays per participant, so Archived lists the viewer's archived chats. No schema change expected beyond a derived scope |
| Agents | already has `visibility` (`creator`/`workspace`) and `archivedAt`; treat as the reference implementation and expose it as `scope` in the API |
| Memories | already `owner`/`workspace`; no archive needed |

Indexes: add `by_workspaceId_scope_archivedAt` (and `by_workspaceId_userId_scope_archivedAt` for Personal) on each table, so the three views are single indexed reads.

## Access rules (one helper)

A shared helper, `canReadResource` / `canWriteResource` in `src/shared` (isomorphic, used by Convex and the BFF), decides:

- **Read**: `personal` → creator only. `workspace` → any active member of the workspace. Archived rows follow their `archivedFromScope`.
- **Write / archive**: creator always; admins and owners for `workspace` scope; plus the per-resource creation rule from the decisions table.
- **Agents acting for a person**: an agent run sees what the person sees, nothing more (unchanged principle). Workspace-scoped skills, MCP servers, and connectors become available to workspace agents only through the person's access.
- Guests: read workspace-scoped items only where already shared with them; no scope changes.

## Phases

### Phase 0: audit (small, do first)

- Read the access rules for each listed resource (the Convex functions in `convex/files`, `convex/automations`, `convex/integrations`, `convex/mcp`, `convex/knowledge`, the notes and skills services) and record who can read and write today.
- Confirm how many production rows exist per table and how many have `projectId` set.
- Output: a short table appended to this plan, and any surprises (rows visible to more people than expected).

### Phase 1: remove knowledge bases and projects

1. Make `projectId` optional wherever required, in all 21 places.
2. Export the production `knowledgeBases` and `projects` rows to a file for safekeeping (ask the owner whether to keep it).
3. Clear the rows; remove their code paths: `convex/migrations/backfillWorkspaceIds.ts` project parts, `convex/auth/users.ts`, `convex/files/storageAdmin.ts`, `src/server/tools/tools/build.ts`, `src/server/account/AccountDataDeletionRepository.ts`, `MarketingOverviewPage.tsx`.
4. Drop the five knowledge-base tables, then `projects`, then the `projectId` fields and their indexes.
5. Update `docs/develop/architecture.mdx`, the on-prem Convex runtime baseline, and the account-deletion tests.
- Exit: schema has no project or knowledge-base tables; account deletion still removes everything; full tests green; Convex pushed to production after the web deploy.

### Phase 2: scope and archive fields

1. Add the optional fields and indexes above (Convex push; additive, safe).
2. Add the shared access helper and its tests (`src/shared`, with a table-driven test per rule).
3. Read paths: every list and get for the listed resources goes through "mine plus workspace-scoped" and respects `archivedAt`. Add scope and archive filters to the list APIs (`?scope=personal|workspace|archived`).
4. Write paths: create takes a `scope` (default `personal`); move-between-scopes and archive/restore endpoints with the rules above and audit events.
5. Backfill: a migration that sets `scope: 'personal'` explicitly on existing rows in batches (reads already default, so this can run later), and copies `deletedAt` → archived only where the product wants it (decision: deleted stays deleted).
6. Update `@overlay/api-client` per-resource modules, `docs/develop/api-route-catalog.mdx`, `compact-api-route-catalog.mdx`, and `docs/openapi` (`npm run docs:generate:api`).
7. Chats: expose a derived `scope` and an Archived list for the viewer; DMs/channels/activity are workspace scope.
- Exit: every resource can be listed by scope and by archived, with tests for read, write, move, and archive on both scopes; production rows unchanged in what each person can see.

### Phase 3: unified secondary panel

- One panel shell component for all five pages: title, scope rows (Personal, Workspace, Archived), selected scope opens its sub-rows, then New + search, then the list. New is absent in Archived.
- Per-page sub-rows: Chats → Workspace has Direct Messages, Channels, Activity; Files has All, Notes, Files, Outputs under each scope; Extensions has Connectors, Skills, MCPs, Apps; Automations and Agents have none.
- Scope is remembered per user across pages (one saved setting) and mirrored in the URL (`?scope=`).
- Archived rows show a Personal/Workspace tag; restore returns to the origin scope.
- Create flows default to the current scope; the new-agent dialog already follows this.
- Docs: `docs/develop/interface-design.md`, the sidebar notes in `docs/develop/architecture.mdx`. Prototype the panel in `artifacts/` first (per AGENTS.md) and get sign-off before app code.
- Exit: all five pages use the shell; visual check in production on each; the Agents page is unchanged except for the shared shell.

### Phase 4: tighten access and sharing

- Move-to-workspace UI on items and bulk actions; admin controls for who may create workspace-scoped skills, MCP servers, connectors.
- Connectors and MCP servers: separate "shared use" from "owner's credential"; workspace agents can use a workspace-scoped connector without ever receiving the secret.
- Search (global search, mentions, MCP tools such as `list_notes`) filters by what the caller can read, and tools gain an optional `scope` argument. Update `docs/develop/tool-catalog.md`.

### Phase 5: retire the special personal workspace

Separate project, after Phases 1–4; depends on the billing decision.

- Onboarding creates the first workspace, named by the user; stop auto-creating `personal-<user>` in `WorkspaceService`.
- Existing personal workspaces become ordinary workspaces (rename to something like "<Name>'s workspace", owner-editable). Remove the `kind === 'personal'` special cases (about 20 places: switcher and avatar, workspace settings, the integrations route, `WorkspaceService`, `convex/collaboration/workspaces.ts`, the showcase client).
- Billing: with the recommended plan-per-person model, the allowance and top-up balance stay on the person's billing account and workspaces draw from the owner. If plan-per-workspace is chosen instead, this phase grows to include moving subscriptions and credits.
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
- **Billing model** (Phase 5) is the one decision that can reshape the work; settle it before starting that phase.

## Order and rough size

| Phase | Size | Depends on |
| --- | --- | --- |
| 0 audit | small | none |
| 1 remove knowledge bases and projects | small–medium | 0 |
| 2 scope and archive fields | large | 0, 1, decisions table |
| 3 unified panel | medium | 2, prototype sign-off |
| 4 sharing and admin controls | medium | 2 |
| 5 retire personal workspace | large | 1–4, billing decision |

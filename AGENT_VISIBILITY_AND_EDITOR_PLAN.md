# Agent visibility + full-page agent editor — implementation plan

Status: **Phases 1–3 implemented** on `codex/agents-visibility-phase-1` (unpushed).
Only Phase 4 (bot surfaces) remains planned. Corrections from implementation are
recorded inline below (marked IMPLEMENTATION NOTE).

## 0. Goal and non-goals

**Goal:** every workspace agent gets an explicit access mode — **Only me**
(`visibility: 'creator'`) or **Everyone in workspace**
(`visibility: 'workspace'`) — enforced in the directory, the editor, DMs, and
room invocations, for both Overlay-native and BYO agents. The agent
creation/editing experience moves from the current monolithic dialog to a
dedicated full-page editor route.

**Non-goals:**
- Per-user / per-team grant scopes (future; `teamIds` stays storage-only, see §4).
- The Slack/Teams bot itself (Phase 4, separate plan). Phases 1–2 are designed
  so the bot reuses the same checks unchanged.
- Changing the mention-first invocation policy or tool-approval model.

## 1. Locked decisions

1. **Naming:** `visibility: 'creator' | 'workspace'`. UI copy "Only me" /
   "Everyone in {workspace}".
2. **Management:** workspace-visible agents → creator + owner/admin can edit and
   archive (`requireEditor` already does this — keep). Creator-only agents →
   creator edits; owner/admin get an archive-only safety valve (can remove, not
   read/edit instructions).
3. **Channels:** creator-only agents do **not** auto-join public channels on
   creation, and only the creator can invoke them anywhere, including public
   channels. Other members cannot see, DM, or @-mention them.
4. **Editor:** dedicated full-page route, not a restructured dialog.
5. **Phasing:** 1 + 2 ship first; 3 alongside; 4 after.

## 2. Current state (what we found)

- `workspaceAgentDefinitions` (`convex/schema.ts:1885`) has
  `createdByPrincipalId` and `teamIds` but **no visibility field**.
- Edit/archive ownership already exists at the service layer:
  `WorkspaceAgentService.requireEditor`
  (`src/server/agents/WorkspaceAgentService.ts:211`) enforces creator-or-manager.
  But `list()` and `get()` return **every** agent to **any** workspace member —
  no read-side filtering.
- All mutations flow BFF (`src/app/api/v1/agents/*` →
  `src/server/app-api/v1/agents/*`) → `WorkspaceAgentService` → Convex
  `*ByServer` handlers (`convex/collaboration/agents.ts`, guarded only by
  `serverSecret`). Per-actor checks live in the service layer — **that is where
  visibility enforcement goes**, following the `requireEditor` precedent.
- **Every new agent auto-joins all public channels**
  (`convex/collaboration/agents.ts:81-92`). This must be skipped for
  creator-only agents (§4).
- Invocation: `resolveMentionFirstInvocations`
  (`src/server/agents/mention-policy.ts`) is a pure function over participants;
  the filter must be applied by its caller in `workspace-agent-invocation.ts`.
  DMs go through `ConversationCollaborationRepository.createDirectMessage`
  (`src/server/app-api/v1/conversations/direct-messages/route.ts:18`).
- UI: `AgentsDirectory.tsx` (tile grid, Share dialog, `?agentId=` deep-link
  edit) and `AgentEditorDialog.tsx` (436-line single dialog for both overlay and
  BYO types, including enrollment + approval). The dialog's `teams` prop is
  accepted but never rendered, and `AgentsDirectory` passes `teams={[]}` — team
  assignment UI is effectively dead; `teamIds` is storage-only today.
- Roles: workspace membership roles are `owner | admin | member | guest`
  (`convex/schema.ts:1755`); "manager" = owner/admin; guests cannot create
  agents (`canCreateAgent`).

## 3. Phase 1 — Access-mode foundation

### 3.1 Contracts (`packages/overlay-workspace-contracts/src/types.ts`)

- Add `export const WORKSPACE_AGENT_VISIBILITIES = ['creator', 'workspace'] as const`
  and `export type WorkspaceAgentVisibility`.
- `WorkspaceAgentDefinition` gains `visibility: WorkspaceAgentVisibility`.
- `WorkspaceAgentCreateInput` gains `visibility?: WorkspaceAgentVisibility`
  (default `'workspace'` when omitted).
- `WorkspaceAgentUpdateInput` (already `Partial<CreateInput>`) picks it up
  automatically.
- `WorkspaceAgentListResponse` unchanged; filtering happens server-side so the
  response only ever contains visible agents.

### 3.2 Convex (`convex/schema.ts`, `convex/collaboration/agents.ts`)

- Schema: `visibility: v.optional(v.union(v.literal('creator'), v.literal('workspace')))`
  — optional so **existing rows need no migration**; absence means `'workspace'`.
- `agentValidator` gains the same optional field; `directoryValue` normalizes
  `undefined → 'workspace'` on the way out so every consumer sees a value.
- `createByServer`: accept `visibility`, validate enum, store (store `'creator'`
  explicitly; omit or store `'workspace'` for the default).
- `updateByServer`: accept optional `visibility` (validated; changing it is a
  management action — the service layer already gates updates via
  `requireEditor`, plus the creator-only admin rule in §3.3).
- No list-side filtering in Convex: handlers stay actor-agnostic behind
  `serverSecret`; the service layer filters (matches current architecture).

### 3.3 Server service (`src/server/agents/`)

`WorkspaceAgentRepository.ts`:
- `CreateWorkspaceAgentRecord` / `UpdateWorkspaceAgentRecord` gain `visibility`.

`WorkspaceAgentService.ts`:
- `create()`: validate `input.visibility` (default `'workspace'`), pass through
  to the repository.
- `list()`: after `resolveActiveWorkspace`, filter out rows where
  `visibility === 'creator' && createdByPrincipalId !== access.principal.id`.
  (Admins do **not** see other people's creator-only agents in the directory —
  they only get the archive safety valve via direct id access; keep the
  directory clean.)
- `get()`: same check; invisible → throw `not_found` (never `forbidden` — do
  not leak existence to non-authorized actors).
- `update()`: keep `requireEditor`, plus: if the agent is creator-only and the
  actor is an owner/admin but **not** the creator → `forbidden` (archive-only
  valve, no content edits).
  - IMPLEMENTATION NOTE: implemented as `not_found`, not `forbidden`. The
    read-side visibility gate runs first inside `requireEditor`, so a manager
    probing a creator-only agent id via update learns nothing about its
    existence (a `forbidden` would be an existence oracle inconsistent with
    `get`/directory/search all reporting `not_found`). Manager access to
    creator-only agents is archive-only through a separate `requireArchiver`
    path in `WorkspaceAgentService`.
- `archive()`: `requireEditor` semantics stay (creator + owner/admin), so the
  safety valve works through the existing path. Extend the default-agent guard
  unchanged. `ensureDefaultAgent` creates the master agent with
  `visibility: 'workspace'` explicitly.

BFF (`src/server/app-api/v1/agents/`):
- `POST /api/v1/agents`: parse/whitelist `visibility` (`'creator' |
  'workspace'`, else ignore → default).
- `GET`: no change needed (service filters). `agentErrorResponse` already maps
  `not_found` / `forbidden` — verify mapping covers the new throws.
- `[agentId]` route: no shape change; `get`/`update` semantics flow from the
  service.

### 3.4 UI (minimal, Phase 1)

- `AgentEditorDialog`: add an **Access** section — two-option segmented control,
  "Only me" / "Everyone in {workspace}", defaulting to Everyone (or the agent's
  current value when editing). Changing it on edit is allowed for anyone who
  can edit the agent (creator + managers). Copy note under "Only me": *"Only
  you can see, chat with, or @-mention this agent."*
- `AgentsDirectory` tiles: small "Only me" badge next to the name for
  creator-only agents (reuse Master-Agent chip styling).
- Showcase mode: showcase items get `visibility: 'workspace'` in their mock
  objects so types stay satisfied.

### 3.5 Tests (Phase 1)

- Service unit tests (`WorkspaceAgentService`): list hides creator-only agents
  from non-creators; get → `not_found`; admin edit of creator-only →
  `forbidden`; admin archive of creator-only → allowed; default agent is
  workspace-visible.
- Convex tests: create/update round-trip the field; `undefined` reads back as
  `'workspace'`.
- API-client/contract type tests if the repo's existing suite covers the
  contracts package.

**Phase 1 acceptance:** creator-only agent is invisible (directory, get, search
indexing inputs) to every other member; creator + admins manage workspace
agents; full suite green.
- IMPLEMENTATION NOTE: "no migration needed" holds for Convex only (optional
  schema field, `undefined` = workspace). Postgres required migration
  `migrations/app-data/0073_agent_visibility.sql` (nullable `visibility` column
  + check constraint, NULL = workspace) plus the `meta/_journal.json` entry and
  the `APP_DATA_SCHEMA_VERSION` 72 → 73 bump (enforced by
  `schema-compatibility.test.ts`).

## 4. Phase 2 — Invocation and membership enforcement

Rule of thumb: **visibility gates every path that would let a non-creator reach
the agent** — directory (Phase 1), DM creation, room mentions, channel
membership. The agent's *history* is never deleted by a visibility change;
only future invocation is gated.

### 4.1 DM creation

- In `ConversationCollaborationRepository.createDirectMessage` (or a guard
  immediately before it in the direct-messages BFF route): resolve each
  requested agent principal → its definition → if
  `visibility === 'creator'` and actor principal ≠ `createdByPrincipalId`,
  reject with `ACCESS_DENIED` (the route already maps this to 404, §direct-messages
  route:64 — existence stays hidden).
- Human-principal DMs are unaffected.
  - IMPLEMENTATION NOTE: implemented as the parenthetical option — a new
    `WorkspaceAgentService.assertDirectMessageTargets` method (reuses the
    visibility-enforced `get()`, so no new repository wiring for either
    provider) called from the direct-messages BFF route, which maps the
    `not_found` failure to 404. `createDirectMessage` has no other production
    callers, so the route guard covers every path.

### 4.2 Room mentions and runs

- In `workspace-agent-invocation.ts`, at the point where
  `resolveMentionFirstInvocations` candidates are computed: load the
  definitions for candidate agent principals and drop any creator-only agent
  whose creator ≠ message author. A mention of an invisible agent behaves as if
  the mention targeted a non-agent (no run, no error surfaced to the room —
  avoids leaking existence).
  - IMPLEMENTATION NOTE: no new definition loading was needed. Both the
    trigger (`resolveWorkspaceAgentInvocations`) and the turn executor
    (`runWorkspaceAgentTurn` via `loadRoomTurnContext`) already resolve
    candidates against the actor-scoped `WorkspaceAgentService.list`, so
    Phase-1 filtering enforces this at both layers — including the flip case,
    since the directory is read fresh on every trigger and every turn. The
    work item became explicit instead: candidates are now intersected through
    a tested `resolveInvocableAgents` helper (`mention-policy.ts`) with a
    comment locking the invariant, so a future change to directory filtering
    cannot silently reopen the hole.
- Thread the acting `principalId` through to this call site (it already has
  actor context for entitlement checks — extend, don't rebuild).
- Group-DM implicit-invocation rule (`mention-policy.ts:19-21`, 1 human + 1
  agent): the agent in a 1:1 DM could only have been created by someone
  authorized (Phase 2.1), so no extra check needed — but assert it in tests.

### 4.3 Channel membership and teams

- `createByServer`: **skip the auto-join-public-channels loop** when
  `visibility === 'creator'`. The creator can still add their own agent to
  channels/teams/DMs explicitly; nobody else can add it anywhere.
- Adding an agent to a team/room is already gated by `requireEditor` on update
  (creator + managers), so no new mutation guard is needed — but `teamIds` on a
  creator-only agent **grants nothing**: team membership does not bypass the
  visibility checks in §4.1–4.2. (Per-team grant scopes are the planned future
  step; `teamIds` remains placement metadata until then.)
- **Visibility flip semantics (locked):**
  - Only me → Everyone: does **not** retroactively join public channels or
    teams. Joins from that point on are explicit.
  - Everyone → Only me: existing rooms/DMs keep their history, but the agent
    stops responding to non-creators (mention filter + DM run guard read live
    visibility). Non-creator DMs with the agent become inert.
- Archive path unchanged.

### 4.4 Tests (Phase 2)

- Non-creator DM with creator-only agent → 404; creator DM → 201.
- Mention of creator-only agent by non-creator in a channel → no run created.
- Creator-only agent create → zero `conversationParticipants` rows.
- Flip workspace→creator with an active non-creator DM → subsequent messages
  produce no agent run; history intact.
- Flip creator→workspace → still zero auto-joined channels.

**Phase 2 acceptance:** there is no path — directory, DM, mention, team add,
channel join — by which a non-creator reaches a creator-only agent, while the
creator's own usage (including in public channels) works everywhere.

## 5. Phase 3 — Directory polish + full-page agent editor route

### 5.1 Routes (follow the existing `/app/agents` convention)

- `src/app/app/agents/new/page.tsx` → create flow.
- `src/app/app/agents/[agentId]/page.tsx` → edit flow (fetch via existing
  `agents.get`; invisible/nonexistent → not-found UI, never a leak).
- Link via `buildWorkspaceHref(workspaceId, '/app/agents/new' | '/app/agents/:id')`
  → `/app/w/:workspaceId/agents/...`.
- `AgentsDirectory`: "New agent" button and tile edit affordance navigate to
  the pages; `?agentId=` deep-link redirects to the edit page (keep global
  search working); `NEW_AGENT_EVENT` navigates instead of opening the dialog.
- **Remove `AgentEditorDialog`** once the pages ship (one editor, no
  divergence). Showcase mode renders the directory only, or a read-only variant
  — decide at implementation; do not keep the dialog alive just for showcase.
  - IMPLEMENTATION NOTE: dialog removed in the same commits. Form sections
    moved verbatim into `AgentEditorForm.tsx`; the state machine lives in
    `AgentEditorPage.tsx` (`new` + `[agentId]` routes). Showcase edit pages
    load the static `SHOWCASE_AGENTS` and discard saves back to the showcase
    directory (demo-only; no backend). The Phase-5 characterization test now
    reads the new files — which also fixed a pre-existing failure on `main`
    (`/Create connection command/` never matched the dialog copy).

### 5.2 Editor page structure (both Overlay and BYO types)

Sections, in order, single column (max-w to match `AppScreenBody` rhythm):
1. **Identity** — avatar color, name, short description.
2. **Behavior** (Overlay type) — instructions, model picker, tool-group
   toggles (extract `OverlayAgentFields` from the dialog as-is for v1).
3. **Access** — the Phase-1 segmented control ("Only me" / "Everyone in
   {workspace}") + plain-language effect note. Team assignment stays **out**
   until per-team scopes are designed (the dialog never shipped it either).
4. **Connection** (BYO type only) — harness picker, existing-environment select
   + working directory, or connect-a-machine enrollment + approval panel
   (extract `ByoAgentFields` + approval panel from the dialog as-is for v1).
5. **Danger zone** (edit only, non-default) — archive with the existing
   confirm copy.
- Sticky footer bar: Cancel / Create agent / Save changes; inline validation
  (name + instructions/model or valid binding — same `valid` rule as today).
- Post-create: redirect to the agent's edit page with a "Say hello" primary
  action that opens the DM (reuse `startChat` logic) — closes the
  create → first-interaction gap.

### 5.3 Directory polish

- "Only me" badge; owner line ("by {displayName}") on tiles where the viewer is
  not the creator — resolve via existing principal display names, no new
  endpoint.
  - IMPLEMENTATION NOTE: no client-side principal directory exists (members
    route has no GET), and the client does not know its own principal id, so
    "by you" was not distinguishable. Instead `WorkspaceAgentService.list`
    enriches each item with optional `createdByDisplayName` (best-effort
    `resolvePrincipal`, both backends, no new route) and tiles show
    "by {name}" for non-default agents when known.
- Keep runtime label (`adapter · connected` / model) and room counts as-is.
- Keep Share dialog unchanged: explicit share grants never override
  creator-only visibility (document this in the share copy later, not in this
  phase).

### 5.4 Interacting (small, deliberate)

- No new chat surfaces in this phase. The create → "Say hello" handoff plus
  the existing DM/thread invocation **is** the interaction improvement for v1.
- BYO remote-session rendering (`data-remote-agent-*` blocks) is out of scope
  — covered by the durable-runs track in `docs/develop/bring-your-own-agents.md`.

### 5.5 Tests + visual QA (Phase 3)

- Page-level tests: create happy path (overlay + byo input shapes), edit
  forbidden/invisible states, archive flow, showcase rendering.
- Visual QA before sign-off (per repo bar: simplest, cleanest pass first):
  `/app/w/:id/agents`, `/new`, `/:agentId` for both types, light + dark,
  mobile width. Loading skeletons reuse `TileSkeleton`/dialog patterns.

## 6. Phase 4 — Bot surfaces (deferred; contract only)

When the Chat SDK bot is built, it **reuses Phases 1–2 unchanged**:

- Bot resolves platform user → Overlay principal via `workspaceIdentityMappings`
  (`directory: 'slack' | 'msteams'`, `externalId` = platform user id; table
  already exists at `convex/schema.ts:1919`). Unmapped users cannot invoke
  anything.
- Every bot invocation calls the same service paths (directory list, DM
  create, mention resolution), so creator-only agents are automatically
  creator-only in Slack/Teams and workspace agents are usable by the whole
  mapped workspace.
- Prerequisite owned by Phase 4: identity-linking UX (who maps Slack user X to
  principal Y) and per-install token storage. Enforcement itself needs no new
  code.

## 7. Sequencing and worktree notes

1. Phase 1 (contracts → Convex → service/BFF → dialog control + badge + tests).
2. Phase 2 (DM guard → mention filter → auto-join skip → flip semantics →
   tests).
3. Phase 3 (editor pages → directory wiring → dialog removal → tests + visual QA).
4. Open one focused PR per phase against `staging` per
   `docs/develop/agentic-development.mdx`; each phase independently shippable.

## 8. Docs and changelog (same PRs, per repo rules)

- Phase 1–2 touch API behavior → update `docs/develop/api-route-catalog.mdx`,
  `docs/develop/compact-api-route-catalog.mdx` (agents routes + direct-messages
  404 semantics), and root `CHANGELOG.md`.
- Phase 3 touches BYO editor copy/flow → update
  `docs/develop/bring-your-own-agents.md` only if behavior copy changes.
- No new living doc needed; this plan file is removed or archived once all
  phases reach `main`.

## 9. Risks

- **Mention-filter data access:** the invocation path must load agent
  definitions per candidate — keep it to one indexed `by_agentId` lookup per
  candidate (already-indexed), not a workspace scan.
- **`get()` visibility vs. admin safety valve:** admins archive via id; ensure
  the archive BFF path does not call the visibility-filtered `get()` first or
  the valve breaks — order it as fetch-unfiltered → authorize → act inside the
  service.
- **Two editors during transition:** Phase 3 must remove the dialog in the
  same PR that ships the pages.
- **Share-dialog expectations:** users may expect sharing a creator-only agent
  to grant access — it must not; copy should say so when share-on-agents is
  next touched.

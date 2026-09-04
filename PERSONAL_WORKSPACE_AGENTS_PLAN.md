# Personal/Workspace agents + per-agent platforms — implementation plan

Status: **C1–C3 implemented** on `staging` (direct push per standing owner auth). C4 planned.

Revision note 2: the C1 header tabstrip was replaced by secondary-sidebar
subpages before QA (owner feedback — matches chats/files/extensions), and the
editor's glass sticky footer became a plain end-of-scroll row. No header-tab
code survives.

Revision note: the header toggle was replaced by Personal/Workspace/Archived
subpages (chat-surface analogy) before implementation started. No header-toggle
code was ever written.

## 0. Goal and non-goals

**Goal:** agent scope is controlled on the agent itself, never in settings.
Every agent is visibly **Personal** (creator-only) or **Workspace** (everyone),
switchable from a toggle in the agent page header. Agent creation ends with an
**"Add your agent to"** step (Slack, MS Teams later) that handles prerequisites
inline. Any member can create Workspace agents.

**Non-goals:**
- Auto-provisioning accounts, per-team grant scopes, Teams transport (B6),
  streaming/`Chat` class (B4 follow-up), AppSource/Marketplace listing.
- A universal personal/workspace split for files, projects, automations, etc.
  (see §7 — per-domain decisions, not a mandate).

## 1. Locked decisions (proposed — owner to confirm)

1. **Labels change, field does not.** UI says Personal/Workspace; the stored
   `visibility: 'creator' | 'workspace'` field, schema, and migrations stay
   untouched — a rename would buy Convex + Postgres migration churn for zero
   behavior gain.
2. **Scope lives in subpages, not a toggle.** The Agents page splits into
   Personal / Workspace / Archived tabs (`?tab=`, default Workspace),
   mirroring chat's personal/DM/channel surfaces. The editor keeps its Access
   section (relabeled) as the single place scope changes; creating from the
   Personal tab simply defaults the new agent to Personal. Archived mixes
   both scopes with Personal/Workspace labels and no actions (restore is a
   follow-up, not this phase).
3. **Creation stays as-is (verified, not built).** `memberCanCreateAgents`
   already defaults to `true`
   (`packages/overlay-workspace-contracts/src/types.ts:646`); guests are
   excluded by `canCreateAgent` + `assertMemberMayCreate`
   (`WorkspaceService.ts:836`). Managers can still lock a workspace down via
   policy. C2 only locks this in with tests + docs.
4. **Per-agent `platforms`, default-on for Workspace, default-off for
   Personal.** New agents store an explicit list (`['slack']`,
   `['slack','msteams']`, or `[]`); existing rows (`undefined`) grandfather to
   "all" so nothing currently reachable goes dark. Including `'msteams'` is
   harmless until the Teams transport reads it.
5. **Self-service linking.** Any member may link/unlink their *own* principal
   to a chat identity; linking *others* stays manager-gated and audited.
6. **Connected chat settings section is removed for now** (UI only — the
   identities/installations APIs stay and serve the editor flow). Revisit as
   an admin surface later.

## 2. Current state (verified against staging)

- Access control is the editor-body `AccessSelector` (Phase 1) with an "Only
  me" tile badge; page header holds back/title/Say-hello only.
- `linkDirectoryIdentity` / `unlinkDirectoryIdentity` are manager-gated;
  `resolvePlatformActor` + bot enforcement already treat creator-only agents
  as personal in Slack (silent for non-creators).
- No per-agent platform field exists; the bot resolves any visible agent by
  name (`resolveMentionedAgent`).
- The Teams checkbox has no transport behind it yet.

## 3. Phase C1 — Relabel + Personal/Workspace/Archived subpages

- Copy: "Only me" → **Personal**, "Everyone in {workspace}" → **Workspace**
  (editor Access section, tile badges, empty states, confirm strings).
  Effect notes keep their voice ("Only you can see, chat with, or @-mention
  this agent" / "Everyone in this workspace…").
- Directory tabs (`?tab=personal|workspace|archived`, default `workspace`):
  Personal shows the viewer's creator-only agents, Workspace shows
  workspace-visible agents, Archived shows both scopes with Personal/Workspace
  labels. One fetch (`includeArchived`) split client-side so tab switches
  need no refetch; tab labels carry counts.
- Visibility filtering stays server-side and applies to archived rows too —
  a viewer never receives another member's personal agents, archived or not.
- Archived tiles are display-only (no Chat/Share/edit affordances): archived
  agents have suspended principals and the service refuses edits, so actions
  would only dead-end. Restore is a follow-up (needs membership +
  channel re-join semantics), not this phase.
- Creation is tab-aware: "New agent" from the Personal tab opens the editor
  with scope defaulting to Personal (`?scope=creator`); elsewhere Workspace.
  The editor Access section remains the single place scope changes.
- Service/BFF/client: `list()` gains `includeArchived` (default false —
  existing callers unchanged); BFF GET parses the query flag; api-client
  passes it through. Repository layers already support the flag.
- Showcase: add one archived Personal and one archived Workspace mock so the
  labels render in previews.
- Tests: service list archived inclusion/exclusion with visibility enforced;
  update section-render copy assertions; tab-split covered by the single
  fetch shape (no new pure logic worth isolating).
- **Acceptance:** three tabs render with correct membership and counts;
  archived shows mixed labeled rows with no actions; creating from Personal
  defaults to Personal; defaults and existing callers unchanged.

## 4. Phase C2 — Creation policy lock-in (no behavior change)

- Service tests: member creates Workspace agent (default policy) allowed;
  guest create rejected; manager-restricted workspace rejects member create
  (policy path already exists — assert it, don't build it).
- Document the rule in `chat-platform-bots.mdx` (bot-relevant: any linked
  member's agents are invocable subject to scope).
- **Acceptance:** the "any user can create Workspace agents" rule is pinned
  by tests against the shipped default.

## 5. Phase C3 — Per-agent platform enablement + "Add your agent to"

- Contracts: `WORKSPACE_AGENT_PLATFORMS = ['slack', 'msteams']`,
  `WorkspaceAgentDefinition.platforms: WorkspaceAgentPlatform[]`,
  `CreateInput.platforms?` (explicit at creation per §1.4).
- Convex: optional `platforms` on the definition + create/update validators;
  `directoryValue` normalizes `undefined → ['slack', 'msteams']`
  (grandfathered). Postgres: nullable `text[]` + check constraint, migration
  `0076_agent_platforms` + journal + `APP_DATA_SCHEMA_VERSION` 76.
- Repositories + `WorkspaceAgentService` create/update passthrough (creation
  defaults by visibility; updates explicit).
- BFF: whitelist `platforms` on POST/PATCH (unknown values → 400).
- Bot enforcement (all three paths, no exceptions): filter the visible
  directory by platform before name matching (mentions, `ask`) and reject
  disabled agents silently in the manage action (same no-leak behavior as
  invisible agents). Single `isAgentOnPlatform(agent, 'slack')` helper
  (treats `undefined` as all) shared by all three call sites + unit-tested.
- Editor final section "Add your agent to": per-platform rows showing status
  and acting inline —
  - Slack: workspace installed? you linked? → checkbox enabled; else
    contextual CTA (manager: "Connect Slack workspace" via existing install
    route; member: "Ask a manager to connect Slack", plus "Link your Slack
    account" self-link input when installed).
  - Teams: visible but disabled with a "coming soon" note.
  - Copy states plainly what enabling means ("Anyone who can see this agent
    can invoke it from Slack once the workspace is connected").
- Showcase mocks gain `platforms` so types hold.
- Tests: round-trips both backends, default-by-visibility, grandfather
  normalization, bot-path filtering (mention/ask/manage), section-render
  states.
- **Acceptance:** disabling Slack on an agent makes mentions, `ask`, and
  Manage go silent for everyone including the creator; re-enabling restores;
  pre-existing agents keep working untouched.

## 6. Phase C4 — Self-service linking + settings removal

- Governance: `linkDirectoryIdentity` / `unlinkDirectoryIdentity` allow the
  actor's *own* principal without a manager role; linking/unlinking others
  stays manager-gated + audited. Tests for all four combinations.
- Editor "Add your agent to" uses self-link inline (member pastes their Slack
  user id; manager flow unchanged for others).
- Remove the `connected-chat` settings section: revert the `app-shell.ts`
  entries + `capabilities.test.ts` expectation + settings-page wiring, delete
  `ConnectedChatSettings(.test).tsx`. Identities/installations APIs stay
  untouched. Update `SLACK_TEAMS_BOT_PLAN.md` B2 notes (settings UI
  superseded by per-agent control).
- **Acceptance:** a member links/unlinks themselves with no manager involved;
  linking others still 403s; settings has no Connected chat section; editor
  flow works end to end for both roles.

## 7. On the universal personal/workspace split (opinion, not a phase)

Do not mandate it. Current reality: chats yes, agents effectively yes (this
plan finishes the framing), automations user-owned, files/projects/extensions/
knowledge mixed or workspace-centric. The binary is a UX framing that fits
some domains and fights others (shared knowledge bases, credential-bound
connectors, cross-scoped projects). Recommendation: audit each domain when it
is touched and record its scoping rule in the relevant living doc — starting
with whichever domain the user names next — rather than one migration with
multiplying edge cases.

## 8. Sequencing and conventions

- Order: C1 → C2 (independent, either first) → C4 → C3 (needs self-link for
  its inline flow). All on `staging`, direct push per standing owner auth,
  one `PLATFORM BOTS {n}` commit series per phase.
- Convex changes (C3) push dev from the staging worktree; Vercel staging
  READY; headed-Chrome QA on `staging.getoverlay.io`.
- Docs in the same commits: agents route catalog entries (`platforms`
  field), CHANGELOG, both plan statuses. No new living doc (bot doc covers
  transport; scope framing lives in this plan until it ships, then folds
  into the bot doc).

## 9. Open questions for the owner

1. Confirm the locked decisions in §1 (especially platforms defaults and
   deleting — not hiding — the settings component).
2. Default tab: Workspace (proposed) or Personal? New-agent scope default
   follows the tab (proposed) — or always Workspace?
3. Should managers be able to toggle platforms on others' Personal agents
   (proposed: no — edit-gated as today)?
4. Teams row: visible-disabled with "soon" (proposed) or hidden until B6?
5. Archived restore: wanted next, or is display-only sufficient for now?

## 10. Risks

- **Landing-tab surprise:** the directory previously showed everything; now
  it defaults to one tab — mitigate by defaulting to Workspace (the shared
  surface) and showing counts on all tabs.
- **Filter coverage:** three bot call sites must share one helper; a
  per-callsite reimplementation will drift — enforce via the shared
  `isAgentOnPlatform` unit tests.
- **Grandfather consistency:** `undefined → all` must read identically in
  Convex, Postgres, service, and bot — one normalize helper, tested at each
  layer.
- **Self-link abuse surface:** anyone can claim any Slack id as their own —
  accepted for the pilot (Slack ids are workspace-visible anyway); revisit
  with verification (bot DM challenge) if abused.

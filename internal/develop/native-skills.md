# Native skill management (CN-20)

## Ownership and authorization

Configured native browser sessions use `convex/integrations/nativeSkills.ts` for
management lists, detail, creation, editing, sharing, archive/restore and deletion.
`SkillsView` selects its native child only under an available Convex provider.
Identity, workspace and list-view changes remount that child before old drafts or
rows can appear. Native authentication failure never selects legacy HTTP.
Private installations with native authentication disabled retain the legacy UI.

Every native endpoint derives the actor from Convex identity, rechecks the active
human workspace membership, and requires `skills.use`. The shared native capability
guard supplies the master-owned deployment feature-policy lease check. Missing,
expired or disabled policy must deny, even for a role with `skills.use`.
There is no operator bypass, caller actor, server-secret argument or client policy
flag. Guests cannot use the management or availability endpoints.

Resource rules remain those in `resource-scope.ts`: creator-only personal items;
active-member read access to shared items; creator or workspace manager edits;
creator-only scope moves subject to workspace extension and move policy. Restoring
retains the archived scope. Queries select by workspace indexes and authorize rows
before returning them. Lists paginate at most 25 source rows, so a filtered page
may be empty with a remaining cursor. Continue paging rather than interpreting an
empty page as exhaustion. Instructions load only through authorized detail queries.

## Revisions, retries and optimistic changes

`skills.revision` is additive and defaults to zero for existing rows. Native updates,
scope changes and deletion require the observed revision. Native writes and retained
legacy content/scope writers increment it. This covers legacy enabled-only updates
and legacy archive/move/restore, not just instruction version changes. No backfill
is required. The editor keeps the initial snapshot and local form fields: a live
revision change displays a conflict instead of replacing a dirty draft or retrying
against a newer revision. Close and reopen to deliberately load the latest version.

Convex optimistic patches operate only on the matching entity, workspace and
revision; Convex replays remaining patches over fresh server values when a write
settles. There is no whole-list rollback snapshot. Creation reports pending through
the existing dialog, not a fabricated persisted ID. A stable request ID and a
payload hash in `skillCreationReceipts` deduplicate creation, including retries after
the skill has been deleted. Reusing a request ID with another payload is rejected.
Receipts contain no instruction text; they remain to prevent resurrection on retry.
The master account-deletion integration must delete `skillCreationReceipts` by
`by_userId_requestId` prefix alongside the existing skills sweep in
`convex/auth/users.ts`. Do not leave per-user idempotency metadata after account
erasure; this shared auth module is outside the child ownership boundary.

Native mutations enforce a verified-user budget of 600 successful writes per ten
minutes, across workspaces, matching the existing BFF default user allowance. Native
calls have no trusted BFF IP context; BFF IP limits remain for legacy callers.
Transactional success audit events contain actor, workspace, operation and skill
ID, never instructions. No model calls, execution, storage-byte transfer, provider
credentials or billing changes are introduced. Costs are bounded reactive reads,
mutation/audit writes and one compact creation receipt per native create.

## Integration seams retained for the master

`useNativeSkillAvailability(workspaceId, workspaceOnly)` is exported from
`src/features/automations/lib/use-native-skills.ts`. It returns `skills`, `loading`,
`denied`, `hasMore`, and `loadMore`. Mount it inside a native-authenticated child,
keyed by identity and workspace, under a surface-local error boundary. It returns
only ID/name/description/enabled/revision, never instructions or owner identity.
Disabled and archived skills are excluded. Workspace-only consumers never receive
personal skills. Otherwise a separate paginated stream preserves the creator's
pre-workspace skills without exposing other creators' rows.

Master integration must replace the skill-only HTTP/cache branch in
`src/features/chat/components/chat-interface/useMentionData.ts` and
`src/components/mentions/mention-search.ts` with this live projection; drain bounded
pages as needed and map IDs to `MentionItem`. The other resource branches are not
owned by CN-20. Shared composer/controller/provider files are deliberately untouched.
`src/features/chat/components/chat/useDraftReviewActions.ts` still creates skills
through HTTP: wire its skill creation branch to native `create` with one stable
request ID per accepted draft when integrating chat ownership.

Settings Archived is a cross-domain aggregation surface. Its master integration
must skip only the skills HTTP request in `archived-actions.ts` when native is
configured, mount `useNativeSkills(workspaceId, 'archived')` in a scoped child,
merge authorized rows into `ArchivedItem`, and route skill restore/delete to
`changeScope`/`remove` with the captured revision. Keep the adapter's rows and
errors local, including when authentication is denied; never fall back to HTTP.
Expose its `loadMore` alongside the existing archived pagination controls. The
native archive query and mutation interfaces exist here, but this shared settings
composition is not claimed migrated by this slice.

Legacy skills routes, scope handlers, event constants, execution-side directory
and instruction loading remain because HTTP chat/settings, external tools and
private installations still use them. Do not retire their cache/event ownership
until those consumers are migrated. No skill execution, automation run/schedule,
MCP or transport behavior changes belong here.

## Verification and rollback

After the native deployment-policy prerequisite, `npx vitest run
convex/nativeSkills.convex.test.ts` passed all 10 tests. Fixtures publish a real
policy through `platform/nativePolicy:beginRefresh` and `publish`, with the skills
feature enabled for normal authorization coverage. A focused case verifies list
and create reject a `skills.use` actor when policy is missing, expired or has
`skills: false`. Existing membership, role, scope, paging, availability,
idempotency, revision, rate-limit and audit tests remain enabled.

The native editor and optimistic tests passed with this exact loader command:

```sh
TSX_TSCONFIG_PATH=tsconfig.json NODE_OPTIONS="--require=./scripts/ci/register-style-noop.cjs" node --import tsx --test src/features/automations/lib/native-skills-optimistic.test.ts src/features/automations/components/native-skills-component.test.tsx
```

All 7 tests passed, including the native dirty-draft conflict and captured
`expectedRevision` cases. The optimistic helper is exercised with a fake store;
Convex's actual optimistic layer is not. `react-test-renderer` reports its
deprecation warning.

Targeted ESLint for all changed CN20 TypeScript/TSX source (excluding generated
API typings), `npm run check:shared-isomorphic` (215 modules),
`npm run check:tenant-boundaries` (142 tables), and `npx tsc --noEmit` passed.
`npm run typecheck` passed its boundary suites but stopped before TypeScript
checking because `.next/types/routes.d.ts` is missing. Its suggested Next type
generation was not run.

Browser acceptance was not performed. Dependent drafts have no standalone
trusted Preview. Hosted acceptance remains for the master main-targeted
exact-head isolated Preview: two authorized sessions converge on
create/edit/archive/restore, dirty edits survive a remote edit, revoked members
and direct forbidden calls fail, and the composer/archive integration updates
without refresh. No shared-development or production deploy is authorized.

Rollback browser ownership first. Retain additive schema, receipts and revision
increments while older and newer clients coexist; never delete migration data or
restore a less-authorized HTTP path for a denied native session.

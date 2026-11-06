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
before returning them. List and availability pages impose server-owned limits of
25 source rows and 2 MiB read, regardless of larger caller limits. This bounds
reads of full legacy documents even though projections omit instructions.
Cursor boundaries and Convex split metadata are preserved, so a filtered page
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
Account deletion in `convex/auth/users.ts` deletes `skillCreationReceipts` by
`by_userId_requestId` prefix immediately alongside the skills sweep, including
receipts for previously deleted skills. Other users' receipts are retained.

Native mutations enforce a verified-user budget of 600 successful writes per ten
minutes, across workspaces, matching the existing BFF default user allowance. Native
calls have no trusted BFF IP context; BFF IP limits remain for legacy callers.
Transactional success audit events contain actor, workspace, operation and skill
ID, never instructions. No model calls, execution, storage-byte transfer, provider
credentials or billing changes are introduced. Costs are bounded reactive reads,
mutation/audit writes and one compact creation receipt per native create.

## Retained consumers and follow-up migration

CN-20 can ship independently of the composer, accepted-draft and Archived
migrations. Both transports read and write the same `skills` rows. No copy,
dual-write, endpoint removal or native-auth fallback is introduced. The retained
BFF continues to derive identity/workspace from its authenticated context and
enforce its existing policy; native management always uses the stricter native
guard. Keeping these consumers on HTTP is intentional, not a fallback on native
denial.

- Composer mentions (`useMentionData.ts` and `mention-search.ts`) still fetch the
  authorized legacy list, including native-created/edited rows. Archived rows are
  excluded and disabled rows are filtered as before. Existing HTTP cache lifetime
  and refresh behavior remain; these consumers do not yet provide live convergence.
- Accepted drafts (`useDraftReviewActions.ts`) still POST through the skills BFF,
  which writes the authenticated active workspace. Native reads treat its missing
  revision as zero and receive subsequent changes reactively.
- Settings Archived still lists the legacy archived view and uses legacy
  restore/delete. Native archive writes the same archive/scope fields; legacy
  restore advances the revision, so a stale native editor cannot overwrite it.
  Legacy deletion invalidates the native detail rather than leaving a second copy.

The focused Convex interoperability test covers accepted-draft-style legacy
creation, native editing, legacy mention/directory reads, native archive, legacy
Archived restore/delete and native stale-revision rejection. It complements, not
replaces, hosted UI acceptance. No protected personal-chat modules are modified.

The following live-consumer migration is a follow-up, not a prerequisite for this
compatible management slice:

`useNativeSkillAvailability(workspaceId, workspaceOnly)` is exported from
`src/features/automations/lib/use-native-skills.ts`. It returns `skills`, `loading`,
`denied`, `hasMore`, and `loadMore`. Mount it inside a native-authenticated child,
keyed by identity and workspace, under a surface-local error boundary. It returns
only ID/name/description/enabled/revision, never instructions or owner identity.
Disabled and archived skills are excluded. Workspace-only consumers never receive
personal skills. Otherwise a separate paginated stream preserves the creator's
pre-workspace skills without exposing other creators' rows.

Follow-up integration can replace the skill-only HTTP/cache branch in
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

After the native deployment-policy prerequisite, `npx vitest run --config
vitest.config.mts convex/nativeSkills.convex.test.ts` passed all 12 tests. Fixtures
publish the real policy through `platform/nativePolicy:beginRefresh` and
`publish`; a focused case verifies list and create reject a `skills.use` actor
when policy is missing, expired or has `skills: false`. Existing membership,
role, scope, paging, availability, idempotency, revision, rate-limit and audit
tests remain enabled. The byte-cap case inserts eight 600 KiB instruction
documents, verifies an empty `SplitRequired` first page, and follows continuation
pages to recover all visible rows through both list and availability. Oversized
caller row/byte limits are capped server-side, and bounded end-cursor behavior is
covered. Account erasure deletes the user's receipts, including one for an
already-deleted skill, while retaining another user's receipt.

The native editor, pagination layout and optimistic tests passed with this exact
loader command:

```sh
TSX_TSCONFIG_PATH=tsconfig.json NODE_OPTIONS="--require=./scripts/ci/register-style-noop.cjs" node --import tsx --test src/features/automations/components/native-skills-component.test.tsx src/features/automations/lib/native-skills-optimistic.test.ts
```

All 8 tests passed. Component coverage checks the flexible panel and non-shrinking
pagination footer, `loadMore(50)`, disabled loading state, and footer absence
while exhausted or on first-page loading. The native dirty-draft conflict and
captured `expectedRevision` cases remain covered. The optimistic helper uses a
fake store; Convex's actual optimistic layer is not exercised.
`react-test-renderer` reports its deprecation warning.

Native skill saves validate shared field limits before mutation and map failures to
accurate validation, conflict, rate-limit or access feedback without exposing
internal error text.

Targeted ESLint on the changed correction source passed.
`npm run check:shared-isomorphic` passed (215 modules);
`npm run check:tenant-boundaries` passed (142 tables, 50 user-owned);
`npx tsc --noEmit -p convex/tsconfig.json` and `npx tsc --noEmit` passed.
`git diff --check` passed.

Browser acceptance remains outstanding on this main-targeted PR's current-head
isolated Preview: two authorized sessions must converge on
create/edit/archive/restore, dirty edits survive a remote edit, revoked members
and direct forbidden calls fail, and retained composer/Archived paths read the
same persisted rows using their existing HTTP refresh behavior. Native availability
is reactive; the retained HTTP consumers are not claimed realtime. No
shared-development or production deploy is authorized.

Rollback browser ownership first. Retain additive schema, receipts and revision
increments while older and newer clients coexist; never delete migration data or
restore a less-authorized HTTP path for a denied native session.

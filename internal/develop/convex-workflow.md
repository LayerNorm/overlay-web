---
title: "Convex Workflow"
description: "How to update Convex safely for Overlay Web changes."
---

Convex owns durable app state, domain mutations, scheduled work, and some webhook processing. The web app depends on Convex for conversations, files, memory, billing state, and related data.

## Native deployment-feature policy

Native domain functions enforce the same capability-to-feature map as the BFF,
in addition to identity, workspace/resource scope and persisted roles. The global
`nativeDeploymentPolicies` singleton is server-owned configuration, not customer
data. It is written only by internal Convex functions. The browser-safe status
query returns feature booleans, never source URLs or workspace rollout allowlists.

The internal policy refresh calls `/api/auth/convex-policy` at the explicitly
configured `OVERLAY_BFF_URL` (or `NEXT_PUBLIC_APP_URL`). There is no production-host
fallback. The web and Convex environments need matching `INTERNAL_API_SECRET`;
the returned backend must match Convex's own `CONVEX_CLOUD_URL`. Use HTTPS except
for explicitly identified development environments. Preview already provisions
its canonical origin and scoped hosting bypass through the trusted controller.
Never point an isolated backend at production or put the shared secret in a client.

The source resolves defaults, file, remote configuration and environment afresh.
A one-minute configuration heartbeat renews a three-minute lease. Disabled or
unavailable policy denies native access; failed refresh invalidates the latest
lease immediately, and a fenced scheduled expiry invalidates subscriptions if
refresh stops. Sequence/nonce fencing prevents delayed callbacks or a replay from
restoring superseded policy. Freshness is checked again inside publication so an
action delayed after receiving a response cannot start a new lease from stale
configuration. Configuration changes propagate on the next refresh,
not instantly when an environment variable is edited. For urgent revocation,
Integration must run the internal refresh on the explicitly verified backend and
check the browser-safe status before considering the configuration change complete.
This is not browser application-data polling. Lease updates cause bounded native
query revalidation; include that cost in later subscription measurements.

After the exact web revision is live and its matching backend is deployed under
the existing safety rules, verify `platform/nativePolicy:refresh` succeeds and
`platform/nativePolicy:status` reports readiness for an authenticated test viewer.
Until then, gated domains remain unavailable. Never silently fall back to weaker
HTTP authorization. Roll back native web consumers before removing policy helpers.
Conversation CRUD has no mapped deployment feature, so it does not require this
lease; model execution retains its existing server admission checks.
Treat matching web and Convex revisions as one release unit. Local development
uses an engineer-owned backend; feature worktrees never deploy shared environments.
PR previews deploy only their per-PR backend. Preview builds copy the shared
`OVERLAY_USAGE_MARKUP_BPS` value from Vercel to that backend. Before production
billing code is deployed, set and read back the same rate on its matching Next
and Convex environments; see [Workspace billing](workspace-billing.md#usage-markup-configuration).

Component-aware `convex codegen`, including `--dry-run`, can contact the selected
backend's `start_push` endpoint and upload packages before auth validation fails.
It is not an offline type-generation command, and a failure does not prove that
remote state is unchanged. Never run codegen, dev or deploy against ambient shared
development or customer backends from a feature worktree. Regenerate combined API
bindings only through explicitly authorized isolated Preview infrastructure.

Vercel’s native Git integration deploys main to production. Integration verifies
the exact live web SHA, synchronizes customer Convex only for backend changes from
clean current canonical main, and runs proportionate authenticated smoke.
Harness admissions require the server-owned `harnessTranscriptRevision:
settled-public-v1` marker as well as the existing recovery/artifact markers. This
keeps new admissions closed during web-first deployment until the journal and
safe-diagnostic backend contract is available. Existing run records without
`publicProgressVersion: 1` do not call the new transcript endpoints.

Complete public traces additionally require `harnessFullTranscriptRevision:
full-public-v1` before new web admissions. Keep the original markers for pinned
older executions. Each new settled step stores a gzip-compressed public payload
in Convex file storage with its SHA256 digest, separately from the bounded chat
snapshot. Expanded traces are authenticated by assistant-message and conversation
access, then streamed through the server; storage URLs never reach the browser.
Legacy journal rows remain readable, but already-truncated values cannot be
recovered. Rollback leaves the optional storage fields and existing objects in
place while older executions finish. Do not remove payloads independently of
their journal rows.

Frontend-only releases need no backend push. Use the production-scoped key through
a private key-only env file; never pass .env.local or use convex:push:all.

Sensitive changes use expanded acceptance on their isolated PR preview. The staging lane is retired.
There is no custom production deployment
workflow or Vercel deployment token requirement. See
[Preview and Production QA](./worktree-staging-qa.md) for recovery.

## Development backend

### Native browser scope

`convex/lib/nativeViewer.ts` derives the application user ID exclusively from
`ctx.auth.getUserIdentity().subject`. Native browser functions accept resource
and workspace IDs as selectors, never caller-supplied actor IDs, explicit tokens
or server secrets. `requireNativeWorkspace` reads the active workspace, human
principal and membership on every query/mutation. These database dependencies
also invalidate subscribed queries when access is revoked; do not cache them
across calls or identities.

`requireNativePersonalChat` additionally checks exact workspace, owner, live
conversation and participant state. Missing participant rows remain compatible
with older personal chats; archived participant state remains accessible for
restore. Removed participants, shared scope, rooms, agent threads, external
bindings and automation chats are outside this pilot. Public share links do not
grant native private-chat authority. Legacy workspace-less rows stay on their
existing migration path rather than being silently assigned to the selected
workspace.

`auth/viewer:workspace` and `auth/viewer:personalChat` expose minimal verified
scope projections with explicit return validators for acceptance checks; workspace
roles are restricted to the canonical owner/admin/member/guest values. They do not grant write, execution,
billing, provider, operator or workspace-management authority. Domain mutations
must preserve their own role/policy, audit, idempotency and admission rules;
run admission and provider execution remain server-owned. Existing explicit-token
and server APIs are unchanged until each consumer migrates.

For ordinary local web work against the development Convex backend, run Next.js without deploying Convex from a feature worktree:

```bash
npm run dev
```

`npm run dev:with-convex` pushes the selected dev backend before starting Next.js. Use it only for an explicitly selected engineer-owned deployment. Native Vercel production deployment does not push Convex.

## Source imports and typechecks

`convex/tsconfig.json` resolves the backend and its transitive shared imports independently
of the root web config. Keep bridge-protocol and API-client source aliases aligned with
the root paths; a clean backend build must not depend on package `dist` artifacts.
Run `npx tsc --noEmit -p convex/tsconfig.json` as well as web typechecking when those
imports change. `scripts/ci/convex-typecheck-contract.test.mjs` checks bridge source
resolution with generated package output unavailable.

## Isolated PR preview backends

### Persistent agent QA access

The owner authorized persistent team administration for QA through the
organization's secure `CONVEX_TEAM_ACCESS_TOKEN` secret. Resolve it from the
secret store at execution time, not from source files or browser storage.
Use the [Management API](https://docs.convex.dev/management-api) to list project
deployments and verify the expected project, `preview` type, PR reference,
identifier, and backend name before accessing data. Obtain deployment-scoped
credentials programmatically with only the actions needed for the check; reuse
existing suitable access and revoke temporary diagnostic keys when finished.
Keep token values out of logs, recordings, source, and PRs. Do not ask the owner
for another per-PR key while the saved access can supply it; escalate only an
actual missing, revoked, or insufficient credential after checking it.

This is operator QA access, not a replacement for the controller/build key.
Never pass the team token to PR builds or install it as
`CONVEX_PREVIEW_CONTROL_KEY`. Production deployment and release approval rules
above remain unchanged even when the token has broader permissions.

### Preview deployment and lifecycle

Add `needs-preview` when isolated hosted QA is needed; the trusted controller
requests the exact PR SHA. Unlabeled PRs create no backend or build.
`scripts/vercel-build.sh` builds requested PR previews in the `overlay-landing` Vercel project.
New PR heads use `OVERLAY_RELEASE_LANE=preview`; older open PR heads retain
the former `staging` value until those branches update. Both values are accepted
only for Vercel's Preview target. Preview builds require
`OVERLAY_DEPLOYMENT_ENV=preview`, a canonical PR app origin, and a project-scoped
`preview:<team>:<project>|…` deploy key. The script clears conflicting backend
selectors and dev URL overrides, then runs `convex deploy --preview-name
pr-<number>` with internal `dev/seed:init` fixtures. The seed refuses non-preview
deployments and requires the configured sandbox user identity. Do not use
`--preview-create` on ordinary pushes: it destroys an existing preview's data.
The temporary `--env-file` contains only the approved deploy key (mode `0600`)
and is deleted after the build. An empty file also removes Convex authentication
inputs, even when the key exists in the parent process; do not use an empty file.

The trusted PR controller also holds the project preview key as
`CONVEX_PREVIEW_CONTROL_KEY` in the main-only `release-control` environment.
Six-hour reconciliation validates the project, preview type, PR identifier and
reference before extending a labeled open PR backend to four days from now when fewer
than two days remain. This is within Starter's five-day retention entitlement
and preserves data while the PR remains labeled. On PR closure or label removal,
cleanup settles owned builds before deleting the exact `preview/pr-<number>`
backend and synthetic data through the scoped Preview key. It validates project,
Preview type, reference, PR identifier and name, then verifies absence. Unknown
ownership or failed deletion cannot report successful cleanup. Six-hour inventory
includes retained Convex backends so leftovers are retried even without Vercel
resources. Re-adding the label seeds a fresh backend. A missing or
expired backend forces a fresh web build at the same SHA, with fresh seed data;
an old READY frontend cannot be reused just because its SHA matches.

The controller rejects credentials unless their scope is exactly
`preview:divyansh-lalwani-37bb7:overlay` before making API requests. Never replace
this key with a personal/team token or another product's key. Backend ownership
must match project `1649204` and the exact PR reference and identifier; dev,
production and cross-project targets fail closed. `colorful-chickadee-419` is
also denied by name, independently of metadata. Regression tests exercise these
refusals without sending deletion requests. This protects automation, not manual
deletion by an administrator in the Convex dashboard.

Convex injects the preview URL into the web build. `deploymentEnv()` keeps
server configuration on the same captured URL as the browser; generic runtime
`process.env` lookups must not recover an old shared dashboard URL. Preview
crons register the same schedule as production on the first deployment; no
second deployment or background-job opt-in is needed. Outbound boundaries
require the isolated provider, exact PR callback configuration and hosting access.
Workflow event projection reads SDK state through the deployment-secret web bridge and persists paged events/cursors atomically; Convex must not import the web-host SDK runtime. Email and webhook delivery require exact test-recipient and HTTPS-origin lists
(`OVERLAY_PREVIEW_EMAIL_RECIPIENTS`, `OVERLAY_PREVIEW_WEBHOOK_ORIGINS`); unlisted
destinations fail delivery and retain retry diagnostics. Webhooks cannot redirect. Project preview defaults contain matching internal API/service secrets,
the sandbox client ID and seed identity; passwords stay on the web app only.

Provider credentials are configured once in `overlay-landing`'s unscoped Preview settings
and this project's **preview** defaults. New backends inherit the defaults;
the build wrapper synchronizes its approved backend settings after deployment
and before fixture repair. Existing backends need a successful rebuild after rotation;
controller reuse of an existing READY build does not synchronize settings. Update
both defaults and each still-open backend or rebuild it. Reuse verified development
credentials from `.env.local` through an explicit allowlist, mapping test
`DEV_STRIPE_*` values to the runtime names as well. Never import the file wholesale:
it also contains live Stripe, a production OpenRouter key, and shared-dev backend
selectors. Keep per-lane session/internal secrets and the build-injected backend
URL. Cloudflare bucket permissions and model budgets need separate verification.

`Preview QA Recovery` on trusted main provides a credential-free VM entry point
for `dev/qa:recover`. It checks the current READY web revision and pinned backend
ownership before obtaining that backend's existing authorization and invoking
only the named fixture recovery. It rejects production, dev, foreign/ambiguous
backends and closed/unlabeled PRs. The project Preview key stays in
`release-control`; mutation results and diagnostics never print credentials.
The backend's own Preview/synthetic-fixture guards remain authoritative.

`dev/qa:recoverRoute` is an internal Preview-only, audited route-quarantine
recovery operation. Supply the inspected reason and a unique request ID; it
preserves provider receipts, rejects unsettled leases/nonzero pricing, and
expires catalog/canary eligibility so the ordinary refresh must verify the route
again. Replaying the same request cannot clear a subsequent failure.

Pair a `none` integration, sandbox or web-search provider with its
`OVERLAY_FEATURE_*` flag set to `false`. Provider selection alone does not change
capabilities. Release builds reject the mismatch before deploying functions;
otherwise chat can try to load the disabled integration provider and fail before
calling its model. Shared defaults must enable the isolated providers accepted for Preview. Interactive browsing uses the configured Computer provider and its paid-workspace admission, not a separate browser provider.
Preview and Production variables have separate Vercel targets, and the
corresponding Convex preview defaults remain separate from customer Production.

## Expand, migrate, then contract

### Native browser authentication (CN-02)

Browser identity now uses `ConvexProviderWithAuth` and the verified provider JWT
from `/api/auth/convex-token?native=1`, not the legacy HS256 query-argument token.
The default endpoint and legacy room subscriptions remain compatible. No server
secret or refresh token reaches the browser. User IDs remain the provider subject;
the endpoint rejects a verified token whose subject differs from its session user.
Changing accounts remounts the client cache and its UI subtree. Refresh uses the
existing browser session lock; token flights cannot cross identities.

Native browser identity is mandatory for every authenticated deployment. Convex is
the only supported backend for cloud and self-hosted setups, and there is no flag
or fallback. Preview login retains real sandbox WorkOS tokens. OIDC and Better Auth
deployments must deploy `convex/auth.config.ts` with the explicit
`OVERLAY_PROVIDER_AUTH` and matching provider configuration, or personal chat is
unavailable.

Convex's auth evaluator throws on any missing environment read, including optional
fallbacks. Set `OVERLAY_PROVIDER_AUTH` explicitly before the backend upgrade:
`workos`, `oidc`, `better-auth`, or `none`. WorkOS additionally requires
`WORKOS_CLIENT_ID`. The hosted Preview build sets both WorkOS values on its claimed
PR backend before auth evaluation; Production is never touched by this preflight.

OIDC requires `OIDC_ISSUER_URL` and the effective `OIDC_AUDIENCE`, matching the JWT
exactly. Better Auth uses RS256 and requires explicit `BETTER_AUTH_URL`,
`BETTER_AUTH_JWT_ISSUER`, `BETTER_AUTH_JWT_AUDIENCE` and `BETTER_AUTH_JWKS_URL`.
Resolve defaults and aliases from the web configuration before setting these
backend values. Only selected-provider settings are read. Only the
selected provider is trusted; do not combine unrelated issuers with overlapping
subject IDs. Anonymous/no-op mode has no native identity.

Before promotion verify login, forced refresh, expiration, logout/account switch,
legacy subscriptions and desktop/mobile session handoff on the current-head
isolated Preview. Native identity is only authentication: each new query/mutation
must still enforce resource, membership and role authorization (CN-03). CN-02 does
not migrate list or transcript ownership.

The additive `auth/viewer:current` query accepts no caller identity or token
arguments and returns only the platform-verified subject, or null anonymously.
After verifying exact Preview SHA and backend ownership through the trusted
controller/team API, run `node scripts/qa/native-convex-auth.mjs` with
`CN02_PREVIEW_ORIGIN`, `CN02_PREVIEW_SHA`, `CN02_CONVEX_URL`,
`CN02_VERIFIED_BACKEND_TYPE=preview`, `CN02_VERIFIED_PREVIEW_NAME=pr-<number>`
and a mode-0600 `CN02_STORAGE_STATE` file outside the checkout. This checks the
real authenticated Next.js `preloadQuery` result against the session user, checks
an anonymous preload, and confirms no token enters the serialized preload.
Output contains booleans and revision only. This does not replace the browser
lifecycle acceptance tests. Do not reuse a preload across users or cache it
globally; resource preloads need their own authorization.

### Native personal-chat list ownership (CN-04)

Personal chat is always native: there is no readiness probe or legacy fallback, and
server-preloaded history applies only to routes outside personal chat. Native summaries validate model preferences as well as
list metadata so the transcript UI can consume one typed contract.

Canonical title projection updates only the selected runtime's title and title
display state. It must not hydrate the entire UI snapshot: doing so creates a new
model-selection array, triggers the legacy metadata autosave, and feeds that write
back into the subscribed summary. Metadata-only refreshes and remote renames must
preserve model, transcript and generation state without another metadata write.

The browser's personal-chat list, selected title, archive/restore state and basic
unread flag are owned by `chat/personal:list`, `getSummary`, `rename`,
`setArchived` and `setRead`. Every public native function has explicit argument
and return validators, including bounded pagination and minimal summary fields.
The additive indexes require no backfill. Queries
return bounded pages and apply ownership/automation filters after pagination, so
an empty page can still have a continuation cursor; keep loading while Convex
reports more pages and never invent a cursor. The selected summary is queried
independently of loaded pages and contains no transcript content.

Every native operation derives identity from Convex auth, validates workspace
membership and exact personal-chat ownership, and enforces persisted role
capabilities: list/read/archive/restore require `conversations.read`, and rename
requires `conversations.edit`. This enforcement remains active when the legacy
BFF is in observe mode; native calls accept no caller policy flags and have no
operator bypass. The app shell already provisions the ordinary member role.
There is no feature capability-disable mapping for these operations.

`useMutation.withOptimisticUpdate` owns row-level optimistic rename, archive and
restore changes, including captured minimal summary data for Undo. Convex
rebases pending operations and rolls back failed mutations without restoring a
whole stale array. Each archive/restore updater captures only its call's
minimal fallback summary, preserves an explicit null summary as a tombstone
(instead of reconstructing a deleted record), prefers current cached summary/list data, and patches
only `archivedAt`. The updater also publishes the resulting full summary in the
local query store, including when that summary has no mounted consumer. This
keeps a queued Undo on the same fresh metadata after archive removes the row
from the only loaded list. Mark-read optimism clears unread only when the observed
message is still the summary's latest message. Native writes are budgeted at
300 per verified user per 10-minute window because they have no BFF IP context.

Native personal data is used only when native auth is configured and its client
is available and authenticated. Private installations that have not opted in
retain the legacy path; configured-but-unavailable native auth does not fall back
to HTTP ownership. Browser queries are limited to chat/archive consumers, so
unrelated route IDs never enter Convex conversation-ID validation. Auth or
capability query failures expose an unavailable personal-chat context while
preserving the rest of the page. Mixed views may read legacy data only for
classified non-pilot rows. Unmigrated workspace-scoped chats, DMs, channels,
agents and other resources remain on their existing paths.

The browser reads personal transcript pages from `chat/personal:getMessages`
and the public execution/compatibility projection from
`chat/personal:getExecution`. The execution query is scoped to the verified
viewer, workspace and exact conversation; the provider subscribes directly and
does not mirror query data into a second cache. Native personal routes derive
run activity and thread safety from this projection, disable legacy run polling
and safety HTTP checks, and keep approval, input and stop mutations on their
existing BFF commands. Stop targets the durable assistant message ID. A native
authorization or query failure remains unavailable rather than switching to
legacy HTTP.

Readiness requires exact list, transcript and execution revision markers from
the existing server-owned `platform/uiSettings:getByServer` response. An absent
or older marker retains web-first legacy ownership during backend rollout or
rollback; do not remove additive fields, indexes or handlers when rolling web
ownership back. Server execution, billing admission and mutation authorization
remain authoritative. Hosted preview acceptance is separate and is not claimed
by this local implementation.

A failing native personal operation shows an error; it never falls back to HTTP.
Deploy web before its matching Convex functions, and expect personal chat to be
unavailable until both are live. Fix forward rather than adding a compatibility path.

Web and Convex deploy independently, with web first. The product has effectively no
users, so a brief gap between the two deploys is acceptable. Do not keep compatibility
paths for it. Data changes still must not lose or corrupt stored records.

Worked example: rename `files.name` to `displayName` (illustrative; this migration
does not change the current schema).

1. **Expand.** Add `displayName: v.optional(v.string())`; retain required `name`.
   Keep `name` authoritative during the overlap. Existing create/rename handlers
   accept the existing request shape and write both values. The incoming web
   keeps sending `name`, so production's previous backend still accepts it.
2. **Backfill.** Use an internal mutation that advances through bounded pages,
   copying each current `name` into missing `displayName`. Save the returned
   cursor, repeat until `isDone`, and count missing fields. Do not export customer
   data into preview fixtures. Rehearse against synthetic PR preview data first.
3. **Switch reads.** In a later compatible revision, read
   `displayName ?? name` only once every active and retained rollback backend
   dual-writes. Until then read `name`: an older backend can rename a file while
   leaving its backfilled `displayName` stale. Keep legacy request arguments. Verify
   old/new web against old/new backend and exercise web-first production
   deployment plus rollback before accepting it.
4. **Contract.** Remove `name` only after backfill is complete, old callers are
   no longer supported, and the oldest retained rollback web/backend also uses
   the new shape. Record that minimum rollback revision. Until then, retaining
   the alias is cheaper than making rollback unsafe.

The backfill pattern is bounded and restartable:

```ts
export const backfillDisplayNames = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('files').paginate({ cursor, numItems: 100 })
    for (const row of page.page) {
      if (row.displayName === undefined) await ctx.db.patch(row._id, { displayName: row.name })
    }
    return { cursor: page.continueCursor, isDone: page.isDone }
  },
})
```

The example needs the expanded schema before it can compile. Backfill only the
target deployment, verify counts/readback, and retain compatibility until the
contract gate is satisfied. For large deployments, schedule the next bounded
batch rather than running one unbounded mutation.

## Customer production backend

Use the production script only from the clean canonical `main` worktree after the matching main web deployment is live:

```bash
npm run convex:push:prod
```

For Preview and Production checks, see [Preview and Production QA](./worktree-staging-qa.md).

## Runtime inventory during release changes

`check:on-prem-convex-boundaries` compares routes, runtime imports, cron jobs,
and scheduler sites with `config/on-prem-convex-runtime-baseline.json`. Review
the reported delta before updating it. The release-preview foundation records
the new preview-login route alongside previously landed permanent-agent deletion,
workspace auto-top-up, usage/database imports, and pending top-up reconciliation.
Preview registers the production cron schedule. Outbound delivery requires the
configured test destinations; app callbacks additionally require the exact PR
origin and its existing hosting-access credential.

## Import boundary

Convex code may import browser-safe shared modules from `src/shared`. Convex must not import `src/server`, because server-only modules can break Convex bundling.

## Overlay Harness storage

The initial recovery slice keeps compaction checkpoints additive and non-blocking. Continuation stagnation is owned by the runner: after two unchanged segments it adds a trusted recovery instruction, and after six it persists an actionable `stuck` blocker through the existing authenticated input-wait path. A reply resumes the same root run and resets its stagnation counter. Do not use checkpoint or model-receipt writes as progress, and do not deploy Convex from feature worktrees while validating this path.

### Personal workflow integration

`src/server/workflows/personal-harness.ts` composes `runOverlayHarness` with personal
authorization, model billing, tool reconstruction, durable waits and transcript
delivery. Eligible personal Chat requests use this workflow when the backend
reports the Harness capability. Missing, old, unknown, or unreadable capability
state returns a truthful unavailable response instead of selecting a legacy
workflow. The personal Act route returns `410 legacy_execution_retired` for
automation execution flags; `mode: 'automate'` alone remains a configuration
chat. Automation run-backed and scheduled turns use the personal Harness adapter;
Slack surface turns use the native Harness adapter with source/workflow ownership
fences. This source cutover does not drain already-deployed legacy workers.

Native Overlay room turns always dispatch through the native Harness. There is
no environment-flag fallback to the retired workspace-agent workflow. Remote
and external turns retain their connected-agent dispatch and never fall back
to native execution. Unsupported runtime identities fail closed.
Native Harness named-agent asks/posts use H2 shared-root dispatch; the HTTP
route continues to refuse Harness callers. Delivery owners persist bounded
tool-invocation snapshots while tools run, and finalization replaces those
snapshots with the authoritative transcript parts. Anonymous child deliveries
do not write tool progress into the parent's room.
Native tool steps persist tool results before returning, allowing a
tool that finishes during Stop to retain its evidence; the workflow event hook
skips evidence already recorded by the step.
Plans are optional for every run. The model makes one when a task is long and
needs structure, and a step is done when the model marks it done. Plan changes
on a root run are copied to its delivery run (`plan`) and assistant message
(`agentPlan`), where the chat reads them. Those fields sit apart from message
`parts`, which streaming and finalization replace. Stored `requiresPlan` and
`evidenceTools` values remain for runs already in progress and are not enforced.
Personal Chat roots and descendants remain plan-optional.
When OpenRouter cost confirmation proves an interrupted free-route stream cost
zero, the Harness records a durable `route_interrupted` receipt and immediately
retries the same model. It permits two such retries per run; a third interruption
fails the run.
Tool-result evidence includes a SHA-256 digest over the tool name and
recursively key-sorted input. Personal and
native Harness runs reject an identical successful repeat of create_note,
create_task, create_automation, create_folder or create_agent and direct the
model to cite the existing evidence; failed creates and other tools are not
blocked by this guard.

The workflow claims the harness before attaching root delivery or executing model
calls. Each run registers its wake hook before launching children. Child IDs are
deterministic per delegation call, admission reserves their budget atomically,
and duplicate workflow starts cannot claim an already-owned child. Child briefs
exclude parent conversation history and limit tools to their admitted subset.

Completion persists `resultSummary` separately from the compacted `workingSummary`.
Parent settlement reads that bounded result. Root delivery uses existing assistant
transcript persistence without charging the aggregate usage again. Raw model-stream
closure produces the UI finish event through the SDK transform.

The default personal policy caps paid Overlay model and summary inference at $1 and
expires 24 hours after the stable AgentRun creation time. `harnessBudget` can set a
provider-cost cap from $0 to $100 and a duration from 30 seconds to seven days.
Free accounts and BYOK have no Overlay-funded provider spend. Each model call still
rechecks account authorization and reserves billing independently. This cap does
not include media or tool charges, or external BYOK bills.

The route resolves the stable turn ID before conversation creation. When neither a
conversation ID nor client ID is supplied, it creates a conversation using a
bounded client ID derived from the actor, workspace and turn. Personal requests
bind the root to one queued AgentRun during admission; the workflow alone claims
and attaches it. Legacy unscoped personal conversations can bind only to the
owner's active personal workspace in the same admission transaction. Scoped
conversations must match the policy workspace, and organization workspaces cannot
claim an unscoped personal conversation.

The local production build passed with the checked-in CI fixture environment:
`INTERNAL_API_SECRET=test-internal-secret`,
`NEXT_PUBLIC_CONVEX_URL=https://fixture.convex.cloud` and
`OVERLAY_DEPLOYMENT_ENV=test`. It compiled 95 steps across six workflows, passed
TypeScript checking and completed static-page generation. This does not establish
hosted Workflow/Convex execution. Exact-SHA isolated Preview smoke and browser QA
remain required, and production Context/Plan/Queue UI remains gated on mockup
approval.
The Workflow compiler regenerates `src/app/.well-known/workflow/` during builds;
its compiled route files are generated output and should not be committed.

Personal root admission binds exactly one queued personal delivery AgentRun to the
root in the same Convex transaction. Stop cancels that delivery and the bound
root in one transaction. For native Harness runs, Stop also cancels each active,
same-user local descendant deepest-first before its matched parent, preserving
active-descendant counts while leaving terminal runs and unrelated trees untouched.
The durable terminal root fences descendants that are not represented by a
conversation AgentRun. Pending model holds remain until their matching late
receipt settles them. The server may subsequently perform best-effort SDK
Workflow cancellation for every returned claimed run; that cleanup is physical
resource cleanup only and cannot promise to abort provider work already dispatched.
Admission and cancellation bindings are additive, so legacy generic harness
admissions remain unchanged. Existing in-flight Work runs and internal automation
continue on their legacy runner until that traffic is migrated.

New personal AgentRuns use canonical `mode: 'chat'`. Harness runs carry the
immutable optional `executionEngine: 'overlay_harness'` discriminator; the
older-backend personal workflow keeps its existing workflow identity without an
engine marker. Existing rows, including historical `mode: 'work'` runs and their
engine ownership, remain unchanged and readable. Replaying `startAgentRun`
returns the existing row without changing its engine, and personal Harness
admission and delivery ownership reject unmarked rows. Legacy stop and cleanup
authorization remains compatible with in-flight runs.

Canonical `AgentRun` status includes active `waiting_for_input` and
`waiting_for_children` states. Each can resume to `running` or end as failed or
cancelled; terminal states cannot reopen. The `harnessWaits` ledger retains
immutable, workflow-owned input and approval requests. A root can read its
descendants' pending requests, but a child cannot read sibling requests.

The personal wait adapter commits hook registration before publishing a request.
Children notify ancestors without directly changing the conversation projection;
the root selects pending human attention when joining its children. Notifications
only trigger authoritative state reads, never execution or settlement themselves.
`POST /api/v1/conversations/run/input` accepts bounded text from the owner of the
exact waiting personal run. It resumes existing work rather than creating a new
conversation turn. The workflow hook durably retains the full reply and the
harness stores a bounded user-input evidence summary. Model/tool authorization is
rechecked after resumption. Delivery transitions can be fenced by workflow ID.
The chat renders the persisted question in a reply control for
`waiting_for_input`; a failed submission keeps the reply editable. Approval
resumption remains a separate authenticated decision flow.

Harness tool outcomes are retained from the SDK's authenticated execution-end
callback and merged into the originating tool-call step. This includes actual
outputs and errors from approval-resumed executions, so personal and native
delivery persist the same result without inferring it from assistant text.
Denied decisions are retained only after the approval wait's decision set has
been validated; provider-supplied approval content never grants authority.

The canonical personal workflow connects this adapter with child launch,
finalization and transcript delivery for authenticated personal Chat.
Input controls and the Context/Plan/Queue presentation still require mockup approval.

Personal workflow inputs may carry an admitted ordered model candidate list, with
at most five distinct models. Every selected candidate is prepared and authorized
again, including its context capacity, cost forecast and current ZDR requirements.
BYOK never falls back to an Overlay-funded model. Only a declined account budget
before dispatch or a typed Gateway model-not-found response (404 without a
generation ID, before receiving a stream) produces a zero-usage rejection receipt.
The next candidate uses a new receipt identity, not a replayed provider dispatch.
Network timeouts, 5xx, rate limits, partial streams and unknown failures retain
their holds and fail closed instead of risking a duplicate paid call. The root
streams the existing fallback notice and retains it in the final transcript.

The canonical controller is `src/server/harness/runner.ts`. It runs inside a
surface workflow and delegates model/tool iteration to `WorkflowAgent`, using
`isLoopFinished()` with semantic suspension conditions rather than a tool-call
limit. Surface IO ports supply authorization, context preparation, receipts,
evidence, authenticated waits and child lifecycle operations, not another loop.
`state-steps.ts` binds state IO to Convex through registered durable steps.

Every run claims one immutable `workflowRunId` before dispatch. Duplicate starts
cannot create a second worker. A child-only wait has a persisted status and can
resume without recreating the children. Tool execution rechecks access after
approval; returned SDK system messages are not replayed as conversation input.
Instructions and current durable context are rebuilt on continuation instead.
An output-token limit continues the partial response instead of completing the
task. Filtered, errored or otherwise unfinished provider returns cannot be
reported as successful completion; usage is still settled.

Model dispatch holds a durable `reserve_model` authorization with the same ID as
its eventual usage receipt. Child admission cannot spend that held amount while
the SDK executes returned tools, before `onStepEnd` supplies usage. Only the
matching receipt replaces the hold with actual spend; cancellation does not
erase an unresolved liability. Ambiguous provider failures require reconciliation
before another call or child-budget release. Automatic SDK model retries are
disabled so one authorization cannot silently fund multiple uncertain attempts.
The adapter must reserve an upper bound for the dispatched prompt and output,
not an average predicted cost. These holds enforce the run budget; billing-account
reservations and settlement remain separate adapter responsibilities.

`captureHarnessModelUsage` allowlists token counts and routing references before
usage crosses a durable step boundary. `resolveHarnessModelUsage` resolves Gateway
generation receipts using the existing server credential resolver; delayed
ingestion retries the lookup, never inference. Without a generation reference,
catalog-derived costs are explicitly marked estimates. Unknown pricing requires
reconciliation. BYOK contributes no Overlay-funded inference cost but records
external cost as unknown, not zero. Known external cost and unpriced external
calls roll up separately through child joins. The run's spending authorization
bounds Overlay-funded inference, not the user's external provider account.

`admitHarnessRequestUsage` consumes the root's request allowance with a stable
operation ID before inference. Personal runs perform it inside
`admitPersonalHarnessExecution`, one step that attaches root delivery,
reauthorizes and then counts the request, after `readAndClaimHarnessState` has
read and claimed the run in a single step; the runner reuses that post-claim
snapshot rather than reading and claiming again. Keep step bodies' shared
helpers in modules without steps (`personal-delivery-attach.ts`,
`request-usage.ts`): the workflow compiler keeps plain exports of step modules
and would bundle their server imports. Child runs do not consume another request; Auto
and BYOK retain their existing exemptions. Internal model receipts set the
server-only `countAsRequest: false` while retaining all cost and token accounting.
Durable accounting binds the workspace explicitly so a tab switch cannot move
usage to another workspace. `requireRecorded: true` prevents a caller from
advancing after a failed write or a reservation that still needs reconciliation.

`personal-tools.ts` reconstructs personal Chat tools inside authorized durable
steps. `personal-access.ts` refreshes workspace membership, principal identity,
conversation and delivery-run access, API key validity, model policy, entitlements
and catalog grants at execution time. Admission grants are an upper bound, not a
cached permission decision. Each child namespaces its tool effects by harness run
ID while retaining the delivery AgentRun ID. The personal adapter requires
interactive approval policy and cannot stand in for an agent or automation
principal. Personal chat, automations and Slack entrypoints use these adapters.

Before provider dispatch, `bind_model_dispatch` associates the held model call
with its selected model and billing reservation (explicitly `null` for calls
without an account hold). That identity is immutable and survives cancellation.
It is a settlement reference, not evidence that a provider was called or finished.
Only the matching usage receipt clears the model hold; dispatch binding does not
release any budget or authorize automatic provider retries.

`settleHarnessModelUsage` orchestrates separate durable receipt-lookup, account
settlement, and harness-receipt steps. Call it from workflow orchestration, not
inside another step: replay must retain the resolved provider receipt or catalog
quote even if the account write succeeds before the harness write fails. Billing
uses the persisted dispatch binding and original workspace, accepts late usage
after cancellation, and never counts internal calls as additional requests. BYOK
writes a token audit with unknown external cost, without an Overlay charge. A
failed account write leaves the harness hold unresolved. Production entrypoints
use these settlement steps through the Harness workflows.

Personal `HarnessLanguageModel` references can carry an allowlisted dispatch
reference, without credentials or persisted entitlements. Inside the provider
step it refreshes access, checks prepared token limits and a fresh conservative
catalog forecast, reserves account funds, atomically claims dispatch, and marks
the account hold started. A replayed claim cannot redispatch even for free/BYOK
calls. Provider failures retain the hold for reconciliation. Routing fallbacks
must be selected and authorized during preparation, not hidden in provider
options. Provider-executed tools and unpriced cache configurations fail closed.
Text input estimates include byte/protocol overhead; media uses the known model
context limit. These are spending forecasts, not provider token measurements.
Personal permission refresh uses `gateModelPolicy`, which checks the current
subscription and ZDR policy without topping up or requiring unreserved funds.
A model hold must not disable authorized tools while the SDK executes them.
Each model or billable tool operation still reserves its own spend before use.

`createPersonalHarnessExecutionPorts` connects state ownership, root request
admission, tool reauthorization, model preparation and usage settlement. Surface
adapters still supply authenticated waits, child lifecycle and tool observations.
Preparation receives stable JSON function schemas and trusted instruction context,
then returns the exact instructions and settings used for the quoted prompt.
This prevents a later working-state rebuild from changing the authorized input.
The default 32k working-context policy is not reported as provider capacity:
catalog capacity remains nullable in receipts. Explicit output limits and fresh
ZDR routing are enforced during preparation and again at dispatch.

Compaction summaries use the same secure model and `WorkflowAgent`, with separate
`summary:<main-receipt>:<chunk>` holds and receipts. Each summary is settled before
checkpointing or quoting the main call, without consuming another root request.
Failed or truncated summaries preserve the original history and stop preparation;
an unresolved summary billing hold cannot be followed by another paid call.
Hosted video delivery was accepted by the owner. Multi-day reliability, deployed
legacy-worker drain and uncertain-effect reconciliation remain follow-up work.

`compactHarnessPrompt` extends the existing chat compaction policy for SDK
provider prompts. It preserves the latest user request and complete tool
transactions, carries a rolling summary, and counts caller-supplied instruction,
tool-schema and working-state overhead. Its summarizer must be authorized and
metered by the caller. A failed summary retains the original history; an
oversized prompt returns `fitsBudget: false` rather than silently losing evidence.
Persist a successful summary before dispatch and reject an unfit prompt. The
controller reloads working state after preparation and retains that summary at
continuation checkpoints.

Harness billing adapters can supply `cachedInputTokens`, `cacheWriteTokens` and
an exact, server-validated `providerCostUsd` to `recordFinishedUsage`. A receipt
takes precedence over catalog estimates, including a verified zero-cost receipt.
Without one, pricing separates uncached input, cache reads, cache writes and
output. Missing cache-write pricing remains unknown and triggers reservation
reconciliation rather than a fabricated zero-cost charge. Existing callers keep
their uncached behavior until they supply these fields; BYOK external charges
must not be inferred from Overlay's zero billing for user-owned credentials.

Personal HTTP admission requires the backend Harness capability marker and
fails closed with a truthful availability response when it is missing or stale;
it does not fall back to `personal-chat-work` or a direct tool loop. Named-room
turns dispatch through native Harness, but this slice does not add a capability
readiness check to named-room admission. Native agents additionally use native
Harness dispatch without an environment flag. Automation and Slack source
adapters refresh their bound authority before execution. Recorded retired native
threads reject new writes while preserving history and an editable new-thread
handoff. Untracked history and draining already-deployed legacy workers remain
follow-up work; resource-renewal admission stays disabled.
Its focused QA uses
the real SDK with a mock provider, including more than twenty calls, natural early
return, input suspension, approval/denial, revoked authorization, cancellation,
budget refusal and no-progress recovery:

```sh
npx vitest run --config vitest.unit.config.mts src/server/harness/runner.test.ts
npx vitest run --config vitest.unit.config.mts src/server/harness/prompt-compaction.test.ts
npx vitest run --config vitest.unit.config.mts src/server/harness/usage-billing.test.ts
node --import tsx --test src/server/ai/gateway/model-pricing.test.ts
npx vitest run --config vitest.config.mts convex/harnessRuns.convex.test.ts
npx tsx --test packages/overlay-agent-runtime/src/harness-state.test.ts
```

Hosted acceptance requires an isolated Preview with the exact PR SHA.

The standalone Overlay Harness state foundation is stored by `convex/harness/runs.ts` and
`src/server/harness/ConvexHarnessRepository.ts`. The Convex handlers require the internal
server secret and recheck the source resource's current access on every call. The BFF
authenticates the caller before using this server-only repository; these are not direct
browser APIs.

### Long-running Harness lifecycle

New Harness admissions without an explicit legacy spend override use execution policy
version 2. Its payer mode remains independent: workspace-funded paid runs reserve each
Overlay dispatch atomically, while BYOK and non-Overlay-funded runs do not route through
Overlay billing. Existing explicit spend limits and durations remain task limits;
otherwise the persisted deadline is a renewable execution lease. Lease renewal is
authority-only and must revalidate the current source, membership, model/tool scope,
delivery ownership, workflow owner, generation, and ancestors. It cannot expand access.

Workspace funding denials are persisted as `waiting_for_resources` with bounded reasons,
required and available amounts, and the reserved amount only when authoritative. Otherwise
the projection explicitly reports that the reserved amount is unavailable. These amounts
retain fractional cents from the billing ledger; they are not Stripe payment amounts.
Workspace-funded budget rejections never fall back to another model, including when
persisting the funding pause fails. Legacy routing behavior remains unchanged. The workflow
polls on a durable 60-second sleep and rechecks authority and current funding before
resuming the same task. Auto top-up remains opt-in:
enabled setting, explicit consent, valid payment method, active paid subscription, and
monthly ceiling are required. Pending claims reserve the ceiling account-wide; uncertain
Stripe outcomes remain unresolved rather than receiving a new idempotency identity.

An expired explicit `taskDeadlineAt` is distinct from the renewable lease: it persists as
`waiting_for_authorization` with the deadline and pause time. This state is nonterminal,
cancellable, and cannot be resumed by input, approval, chat, or lease renewal. Existing
ordinary wait records remain intact; new authorization requires a future explicit flow.
The passive UI text is: “The task reached its explicit deadline. Progress is saved;
further execution requires new authorization.”

Continuation checkpoints are protected server-side and are written only at settled
invocation boundaries. New checkpoint and persisted launch-input payloads are gzip
compressed into Convex File Storage; the checkpoint row and continuation outbox retain
only the storage reference and small identity metadata. Legacy inline JSON fields remain
readable during migration. An upload that succeeds before a fenced handoff fails can
leave an unreferenced blob; retries may also create orphans, and the current implementation
does not attempt destructive cleanup. The outbox starts the persisted workflow input on
the receiving trusted BFF deployment; generation and owner claims fence duplicate starts
and stale workers. Unknown provider effects and unresolved billing reservations do not
qualify for automatic replay or rollover. Current tests cover targeted state, billing and
continuation fixtures, including large storage-backed checkpoint handoff, native/personal
delivery transfer, a compiled funding wake/poll path and authorization-pause
reducer/projection checks; they do not qualify every input/approval/child wait handoff,
deployment rollover across weeks, or actual multiweek operation. Rollback disables new
version-2 admissions while retaining additive storage, server handlers, and legacy
workflows until active runs drain; do not migrate historical failures automatically.
No real-time multiweek production qualification or Preview acceptance is claimed.

### Harness web-first rollout

Before creating a personal AgentRun, the web reads the server-owned
`harnessRevision` marker from the existing authenticated
`platform/uiSettings:getByServer` query. It is deployment metadata, not a stored
or writable preference. A successful old-backend response without the marker
keeps new turns on the retained durable personal-chat workflow. Authentication, transport,
unexpected revision and other runtime failures fail closed; they never select
another engine. No failed admission, model call or tool effect is replayed.
The check is fresh per admission, so atomic publication of the matching Convex
functions switches new turns to Harness without another web deployment.
Existing turns retain their immutable engine ownership.
Harness room deliveries carry no legacy liveness lease. The legacy sweep
excludes Harness-owned rows, including older rows with a lease, and uses an
indexed positive-lease range so lease-free durable runs cannot hide expired
legacy work. Harness approval/input/child waits retain their durable deadline.
Do not infer readiness from missing-function error text: production Convex
redacts that text to a generic server error.

Release in the normal order: merge, verify matching native Git web is live,
deploy Convex from clean current canonical main, then smoke personal Chat.
Keep Harness tables/functions and legacy handlers through rollback and draining.
Stop acknowledges an already-terminal Workflow only after SDK status readback;
an active or unreadable run still reports cancellation failure for investigation.
Personal and native tool adapters recheck approval requirements at execution.
Only the controller's single-use marker from the authenticated wait authorizes
an approval-required effect; transcript parts and tool arguments cannot grant it.
WorkflowAgent approval pauses can return a model step without invoking
`onStepEnd`. The Harness settles returned steps in `onEnd` before publishing
the wait, deduplicating ordinary step callbacks. Approval resumption must not
reuse that model receipt or carry its reservation into compaction.

Harness run metadata stays compact. Plans, plan revisions, evidence, receipts, child
reservations, operations and checkpoints use separate indexed rows; receipt identity is
deduplicated in the same transaction as usage aggregation. Child runs have independent
state and usage. Unique receipts propagate through their ancestors atomically, including
late billing reconciliation; settlement does not charge that usage again. Keep these rows
additive and do not deploy a feature-worktree schema to shared or customer backends.

## Browser auth for reactive queries

Convex **queries and mutations cannot call `fetch()`**. WorkOS / Better Auth JWKS verification therefore cannot run inside `watchRoomMessages` or other browser `useQuery` handlers.

Browser→Convex subscriptions must use short-lived **HS256** tokens:

1. Next BFF `GET /api/auth/convex-token` mints a token with `INTERNAL_API_SECRET` (`mintBrowserConvexAccessToken`).
2. `ConvexAuthProvider` refreshes the token; consumers pass it explicitly as the
   `accessToken` query argument. Keep the ordinary `ConvexProvider` transport.
3. Convex `requireAccessToken` verifies HS256 with `crypto.subtle` only (`verifyBrowserConvexAccessToken`).

`INTERNAL_API_SECRET` must match between the Next app env and the Convex deployment. Do not send the raw WorkOS access token into reactive queries.

The standalone admin console (`apps/admin`) uses a separate secret, `ADMIN_API_SECRET`, plus `convex/auth.config.ts` WorkOS `customJwt` providers: `admin/console:*` functions call `requireAdminSecret` (constant-time compare, fails closed when unset) then `requireOperator` (native `ctx.auth` identity + active `administrativePrincipals` role). Set it per deployment with `npx convex env set ADMIN_API_SECRET <value>`; preview provisioning does not set it. Break-glass grants run via `npx convex run admin/breakGlass:grantFirstAdmin`. See `internal/develop/admin-console.md`.

Do not call the client's native `setAuth` with these handler tokens. Convex's
platform verifier expects a configured native identity provider; it rejects the
internal HMAC token and interrupts subscriptions. Handler authorization still
verifies signature, expiry and the requested user's identity. Release smoke must
read a real subscription for the signed-in synthetic user, deny a different user
with the same token, and fail on browser runtime or authentication errors.

Collaboration realtime is native Convex when `appDataCapabilities.provider === 'convex'`:

- `watchRoomMessages` owns room transcript updates.
- `watchConversationListVersion` provides a metadata-free invalidation signal for the sidebar.
- `watchNotifications` is the single app-level notification subscription.

Do not run `/api/v1/conversations/events` long-polls alongside those subscriptions. That endpoint is a non-realtime fallback; polling it against the Convex repository multiplies one browser connection into repeated Convex queries and authorization calls.

## Harness model step registration

`harness_read_child` returns a parent-owned `evidenceRef` for a completed child
result. It is an observed tool result, not independent verification; milestones
requiring verification still need a separate passing verification receipt.
Running, failed, cancelled or unrelated children cannot supply this completion
evidence. Original child evidence IDs remain scoped to their child run.
System-owned `ask:<toolCallId>:<agentId>` milestones settle from the joined
child's terminal status: completion marks them done, while failure or
cancellation skips them with the child's reason. Other delegated milestones
are completed by the parent.
Children need no plan. The parent still needs a plan step to delegate.

`HarnessLanguageModel` delegates to named `streamHarnessModel` and
`generateHarnessModel` steps with `maxRetries = 0`. Do not assign retry metadata
to class prototype methods marked `use step`: the Workflow compiler removes
those methods and registers proxies after module initialization, so assigning
metadata can crash the workflow before it claims its durable root. Provider
resolution and fresh dispatch authorization remain inside the named steps.
The compiler regression test evaluates the transformed adapter, not just its
untransformed TypeScript implementation.

## Bounded maintenance and list queries

Maintenance jobs and user-facing lists must advance through indexed, bounded pages. `runEmptyConversationCleanup` persists its pagination cursor in `maintenanceCursors`, and `files/files:listPage` is the cursor-based file listing source. Keep legacy list functions bounded during web/Convex deployment overlap; never restore a growing-table `.collect()` for compatibility.

## Chat-delta retirement migration

Removing `conversationMessageDeltas` requires a two-revision Convex rollout.
On the explicitly selected deployment, deploy the compatible migration revision and
run `internal.chat.conversations.collapseLegacyConversationPersistence` once.
Its scheduled batches fold every remaining delta into its assistant message and
mark generating messages without an active AgentRun as interrupted. Confirm the
scheduled chain has finished before deploying the following phase-5 cleanup
revision, which removes the table, queries, and crons. Never skip directly to
the cleanup revision on a deployment that may still contain delta rows.

### Expected errors on production-type deployments

Use `ConvexError` data for expected revision conflicts. Production-type Convex redacts ordinary developer error messages. The
server HTTP adapter preserves application `errorData`, so stale note edits return
HTTP 409 in all lanes. Generic internal failures remain redacted and fail closed.


### Interrupted preview build recovery

The installed Convex CLI executes `--preview-run` only for newly claimed preview
backends. An interrupted first build can leave a reused backend without fixtures.
After every successful preview deploy, the hosted build therefore explicitly runs
`dev/seed:init` against `preview/pr-<number>` using the preview-scoped key. This
idempotent repair preserves edited fixture data and reuses any existing personal
workspace; it does not recreate the backend or deploy shared development/production.
A failed deploy never runs the repair, and a failed repair fails the hosted build.

### Generated type output after production deploy

The Convex CLI may regenerate `convex/_generated/api.d.ts` during a production push. The accepted release added only type entries for existing preview/staging helper modules. Preserve that generated output in ignored release evidence, inspect its diff, and restore only the deploy-generated changes to the accepted tracked version before the clean-main rollback drill. Preserve all pre-existing edits separately. No second backend deployment is needed for that local type-file restoration.

After Stage 3d, legacy customer-secret operator reads/writes are removed. The web shell uses the additive fixed-member initializer deployed in Stage 2; remaining authorization reads and operational audit append do not grant operator access. Deploy the contracted backend only after the switched web revision is live.

## Operator backend cutover

The standalone admin console uses a dedicated operator secret and WorkOS identity. Customer-web default member provisioning moves to `authorization/defaults:ensureDefaultUserRoleByServer`, which accepts only a user id and creates the fixed non-operator member role. This additive endpoint must be deployed before switching the web shell caller; only after the switched web revision is live may the legacy operator mutations be removed. Ordinary authorization reads and append-only operational audit remain available to the web app.

### Preview callbacks and recovery

Every successful Preview build binds `NEXT_PUBLIC_APP_URL`, `OVERLAY_BFF_URL`,
`AUTOMATION_RUNNER_BASE_URL` and `OVERLAY_AGENT_PUBLIC_URL` to its canonical PR
origin, using an ephemeral mode-0600 file removed after success or failure. The scoped
`env set --from-file` uses `--force` only for this explicit allowlist, so rebuilds
and rotations replace stale values without touching other backend settings.
Only approved backend-owned settings are transferred; session secrets, login
passwords and deployment selectors are excluded. Per-backend Stripe webhook
secrets are deliberately excluded and belong to endpoint provisioning. Live
Stripe keys are refused.

Scheduled BFF calls use `fetchAppCallback`: Preview requires its canonical origin
and the existing `VERCEL_AUTOMATION_BYPASS_SECRET`, retains application service
authentication, refuses cross-PR/production targets and redirects, and times out.
Production callbacks do not acquire Preview hosting credentials. Missing callback
configuration fails visibly rather than sending Preview work to production.

Internal `dev/qa:recover` supports explicit configured-identity fixture recovery.
`personal` resets only recent QA free-turn/transcription counters; paid and Computer
fixtures accept a bounded synthetic available-credit target. Refill preserves
consumed spend, reservations, purchased funding and usage operations, accepts only
active `preview-fixture` subscriptions, and records an idempotent audit event.
It cannot repair real Stripe subscriptions or replenish provider account budgets.

### Isolated Stripe test endpoints

Billing-enabled Preview builds run `preview-payments-build.mjs` after synchronizing
runtime settings and before seeding. The helper requires the pinned project
Preview credential, verifies the exact PR backend, and uses only a Stripe test
key. One owned `/stripe/webhook` endpoint carries the PR, project and backend
metadata. Its signing secret and endpoint ID persist only on that backend.
Rebuilds reuse the endpoint and repair missing event subscriptions. A lost
creation/persistence response can recover the original secret by replaying the
exact idempotent request; expired recovery fails visibly and removes only its
new duplicate, preserving the original endpoint for inspection.

The trusted controller reuses the existing Preview-only Stripe credential via
its existing Vercel access. It removes and reads back the owned test endpoints
before deleting their backend. Live endpoints, foreign projects, wrong backend
URLs and unverified ownership are refused. A failed payment cleanup preserves
the backend for recovery and cannot report successful cleanup. Six-hour inventory
includes tagged Stripe endpoints; a missing backend is reported on that PR's
cleanup rather than silently deleting an ambiguous resource. No package install,
PR checkout or additional deployment credential is needed by the controller.

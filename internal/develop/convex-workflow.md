---
title: "Convex Workflow"
description: "How to update Convex safely for Overlay Web changes."
---

Convex owns durable app state, domain mutations, scheduled work, and some webhook processing. The web app depends on Convex for conversations, files, memory, billing state, and related data.

Treat matching web and Convex revisions as one release unit. Local development
uses an engineer-owned backend; feature worktrees never deploy shared environments.
PR previews deploy only their per-PR backend.

Vercel’s native Git integration deploys main to production. Integration verifies
the exact live web SHA, synchronizes customer Convex only for backend changes from
clean current canonical main, and runs proportionate authenticated smoke.
Frontend-only releases need no backend push. Use the production-scoped key through
a private key-only env file; never pass .env.local or use convex:push:all.

Staging is optional for sensitive changes explicitly requesting extra acceptance.
There is no custom production deployment
workflow or Vercel deployment token requirement. See
[Preview and Production QA](./worktree-staging-qa.md) for recovery.

## Development backend

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
crons are not registered, and email/webhook delivery actions return without
sending. Project preview defaults contain matching internal API/service secrets,
the sandbox client ID and seed identity; passwords stay on the web app only.

Provider credentials are configured once in `overlay-landing`'s unscoped Preview settings
and this project's **preview** defaults. New backends inherit the defaults;
existing backends do not synchronize automatically. A key rotation therefore
updates both defaults and each still-open backend. Reuse verified development
credentials from `.env.local` through an explicit allowlist, mapping test
`DEV_STRIPE_*` values to the runtime names as well. Never import the file wholesale:
it also contains live Stripe, a production OpenRouter key, and shared-dev backend
selectors. Keep per-lane session/internal secrets and the build-injected backend
URL. Cloudflare bucket permissions and model budgets need separate verification.

Pair a `none` integration, browser, sandbox or web-search provider with its
`OVERLAY_FEATURE_*` flag set to `false`. Provider selection alone does not change
capabilities. Release builds reject the mismatch before deploying functions;
otherwise chat can try to load the disabled integration provider and fail before
calling its model. The Preview defaults contain these four disabled flags.
Preview and Production variables have separate Vercel targets, and the
corresponding Convex preview defaults remain separate from customer Production.

## Expand, migrate, then contract

Web and Convex deploy independently. The incoming web must work with the old
backend, and the incoming backend must work with the old web, including retained
rollback revisions. Never remove an old field or require a new field in the same
release that first introduces its replacement.

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
The preview guards still disable cron registration and outbound delivery at runtime.

## Import boundary

Convex code may import browser-safe shared modules from `src/shared`. Convex must not import `src/server`, because server-only modules can break Convex bundling.

## Overlay Harness storage

### Personal workflow integration

`src/server/workflows/personal-harness.ts` composes `runOverlayHarness` with personal
authorization, model billing, tool reconstruction, durable waits and transcript
delivery. It is not yet selected by the personal conversation Act endpoint.
Keep the legacy workflows available for in-flight runs until migration and parity
acceptance are complete.

The workflow claims the harness before attaching root delivery or executing model
calls. Each run registers its wake hook before launching children. Child IDs are
deterministic per delegation call, admission reserves their budget atomically,
and duplicate workflow starts cannot claim an already-owned child. Child briefs
exclude parent conversation history and limit tools to their admitted subset.

Completion persists `resultSummary` separately from the compacted `workingSummary`.
Parent settlement reads that bounded result. Root delivery uses existing assistant
transcript persistence without charging the aggregate usage again. Raw model-stream
closure produces the UI finish event through the SDK transform.

Before switching traffic, verify model routing/fallback parity, root admission
policy, descendant cancellation, full tool-result retrieval and trusted verification.
The local production build compiles the workflow, but this does not establish hosted
Workflow/Convex execution. Exact-SHA isolated Preview smoke and browser QA remain
required, and production Context/Plan/Queue UI remains gated on mockup approval.

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

This adapter is not yet connected to the production workflow entrypoint. Child
launch/finalization, transcript delivery and app-traffic migration remain pending.
Input controls and the Context/Plan/Queue presentation still require mockup approval.

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
operation ID before inference. Child runs do not consume another request; Auto
and BYOK retain their existing exemptions. Internal model receipts set the
server-only `countAsRequest: false` while retaining all cost and token accounting.
Durable accounting binds the workspace explicitly so a tab switch cannot move
usage to another workspace. `requireRecorded: true` prevents a caller from
advancing after a failed write or a reservation that still needs reconciliation.

`personal-tools.ts` reconstructs personal Chat/Work tools inside authorized durable
steps. `personal-access.ts` refreshes workspace membership, principal identity,
conversation and delivery-run access, API key validity, model policy, entitlements
and catalog grants at execution time. Admission grants are an upper bound, not a
cached permission decision. Each child namespaces its tool effects by harness run
ID while retaining the delivery AgentRun ID. The personal adapter requires
interactive approval policy and cannot stand in for an agent or automation
principal. These adapters are not yet connected to production entrypoints.

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
failed account write leaves the harness hold unresolved. Production entrypoint
wiring remains pending.

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
The personal entrypoint and lifecycle migration is still pending.

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

The controller is not yet connected to production surfaces. Its focused QA uses
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

Hosted acceptance still requires an isolated Preview with the exact PR SHA;
there is no production Harness route to exercise yet.

The standalone Overlay Harness state foundation is stored by `convex/harness/runs.ts` and
`src/server/harness/ConvexHarnessRepository.ts`. The Convex handlers require the internal
server secret and recheck the source resource's current access on every call; a future BFF
must authenticate the caller before using this server-only repository. They are not direct
browser APIs and are not yet wired into application traffic.

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

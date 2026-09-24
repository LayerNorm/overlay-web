# Overlay agent platform: conversation surface + environment contention

> Status: Phase A + B landed on `main` and production. Phase C is a
> grounded, approved-shape design that is **not implemented**.
>
> Last reviewed: 2026-09-24.
>
> Continuation of [`OVERLAY_AGENT_PLATFORM_PLAN.md`](OVERLAY_AGENT_PLATFORM_PLAN.md)
> (Phases 0–5: box billing, boat hosts, ephemeral exec hardening,
> metaharness v1, harness grandfathering, computers consolidation — all
> landed). Completion legend: ✅ landed; 🚧 designed, not built.

## Context

Enduring product objective (owner's words):

> "we should just focus on overlay agents. and being able to create them,
> manage them on a single platform and deploy them anywhere and make the
> overlay harness the best thing on the market."

Phases 0–5 made the agent's *computer* first-class. This sequence makes
the agent's *conversation surface* first-class: threads owned by the
agent, automations nested under the agent that drafted them, and — in
Phase C — a sane answer to "two turns want the same box."

Parallel workstream not covered here: the agent-memory upgrade (M1–M4)
lives in `.devin/plans/memory-benchmark-and-upgrade-plan.md`.

## Phase A — automation conversation ownership ✅

Problem: automation execution and provenance were conflated.

- Deleting an automation sometimes navigated the page to Chats.
- Creating an automation inside an agent let the automation conversation
  take over the main agent conversation; responses rendered as "Someone".

Invariant established — **`sourceConversationId` is provenance only**
(the thread where the automation was drafted); **`conversationId` is the
automation-owned thread** and the only valid execution target. Source
threads stay normal conversations; automation-owned conversations are
hidden from Chats; deleting an automation never deletes a source or
agent thread; responses display the automation's name.

Landed: `7e2163722 fix(automations): sourceConversationId is provenance,
never a run target` (+ adjacent commits); deployed to production.

## Phase B — agent threads + nested resources ✅

Owner request: "`conversations.agentId` + expandable agent items — chat
threads and agent-created automations nested under the agent, hidden
from the standalone Automations page; standalone automations remain
page-only."

Landed on `main` at `cc77975fa` — commits `da52d4048` (feature, 45
files) + `cc77975fa` (sidebar split for the 500-LOC ratchet), plus
follow-up `c325993d5` (glm-5.3-flash default + agent/thread
double-selection fix). Deployed to prod: Vercel `cc77975fa` live, Convex
prod pushed, migration run (46 agent DMs stamped as threads, 0
automations — none pre-existed).

- `conversations.agentId` + `automations.agentId` — threads and
  agent-drafted automations bind to their agent;
  `by_workspaceId_agentId` / `by_agentId` indexes.
- `convex/chat/agentThreads.ts` — resolve-main (adopts the legacy 1:1 DM
  or creates thread 1), create-thread (always fresh), list,
  participant-scoped archive, delete with `AGENT_LAST_THREAD` guard.
  Main thread is derived (oldest survivor) — deleting main promotes the
  next.
- Sidebar — Personal/Workspace/Archived tabs above New agent; expandable
  rows lazy-load threads + automations; archived tab = archived agents ∪
  live agents with archived threads.
- Visibility — agent threads excluded from Chats/DMs/Archived lists;
  agent automations excluded from the standalone Automations page; 1:1
  agent DMs auto-bind and route to the agents surface (group DMs
  untouched).
- Archive semantics — archiving an agent preserves thread participants
  (history renderable + restorable); `POST .../restore` re-activates;
  archived agents' automations refuse to run (`skipped` runs, manual run
  → 409).
- Migration `convex/migrations/backfillAgentThreads.ts` — two
  server-secret-gated phases: `stampAgentThreadsByServer` stamps
  `conversations.agentId` on 1:1 agent DMs (two-participant rule only),
  then `stampAgentAutomationsByServer` via `sourceConversationId`.

Verified: 23/23 agent-service + 28/28 automation tests; tsc, Convex tsc,
lint, shared-isomorphic, docs health, on-prem baseline, complexity
ratchet all green. Deploy ordering is web-first safe: old Convex
functions simply don't write `agentId`.

### Known gap — dev/staging lane

Dev Convex (`different-caiman-77`) does **not** have the Phase B
functions (`agentThreads:*`, migrations). `convex codegen` uploads
component defs for typegen only — not a function deploy. The dedicated
staging worktree (`overlay-landing-staging`) holds
`staging@08e87864a`, which predates Phase B. To put Phase B on
`staging.getoverlay.io`/dev: update `staging` to include the Phase B
commits in that worktree, then `npm run convex:push:dev`, then run the
same two-phase migration against dev. This is an owner-approved
decision, not a default step.

## Phase C — environment contention prompt 🚧

Goal (owner's words): "env-box lease; on contention the turn starts
anyway and asks you — wait / browser+sandbox / temporary computer."

### What exists today (verified)

- **No contention exclusion at all.** `getActiveSandboxLease` returns
  the newest active lease per environment; a second turn on a busy agent
  just `reconnect`s to the same `providerReference` — two turns silently
  interleave commands on one box.
- **The ask infrastructure already exists.** Runs park on
  `waiting_for_approval` with an `approval` payload (`token` +
  `requests`), the room renders an approve/deny card, `createHook`
  suspends the durable workflow, `submitRunApproval` resolves it via
  `resumeHook`. This is exactly the skeleton for a 3-way contention
  card.
- **Ephemeral sandbox path exists.** `OVERLAY_EXEC_SANDBOX_PROVIDER`
  (default vercel, deny-all egress) powers `sandbox.run` — the
  "browser+sandbox" option's backend.
- **Billing exists.** `ManagedAgentSandboxBilling` reserve/settle on
  leases — a temporary computer rides the same meter.
- `askUserQuestions` is disabled for room turns ("the room cannot
  deliver input") — the approval card path is the only working
  mid-turn input channel today; reuse it.

### Design

1. **Turn hold on the lease** — `agentSandboxLeases.turnHold:
   {runId, startedAt}` (optional field, no index needed). Set on first
   machine acquire, cleared at settle/fail. Contention = live lease
   with `turnHold.runId ≠ myRunId`. Staleness guard: hold expires when
   the lease's `lastActiveAt` heartbeat goes stale (~5 min) so dead
   workflows can't wedge the box.
2. **The contention card** — extend the approval payload with
   `kind: 'environment_contention'` + `options: ['wait', 'ephemeral',
   'temp_computer']`, or a sibling `run.environmentRequest`. Room
   renders three choices instead of approve/deny:

   | Choice | Behaviour |
   |---|---|
   | **Wait** | Workflow `sleep`+polls the hold until cleared (or the incumbent's settle fires a wake hook), then acquires the shared box. Timeout → re-ask or fail with a clear card. |
   | **Browser+sandbox** | Turn's machine ops point at an ephemeral sandbox via `OVERLAY_EXEC_SANDBOX_PROVIDER`; deny-all egress; deleted at turn end. Card must say "fresh empty environment — no agent files". |
   | **Temporary computer** | Provision a fresh managed sandbox under a `temporary: true` lease, run the turn there, destroy at settle. Metered by the existing lease meter. |

3. **Where the check lands per adapter**
   - *Managed harness*: inside the slice loop before
     `ensureHarnessSandboxInstance` — can genuinely suspend mid-turn
     (approval cycles already do this).
   - *Hosted/ACP* (`workspaceAgentTurnWorkflow`): the turn is one atomic
     step — cannot suspend mid-`streamText`. Check as a step **before**
     `executeWorkspaceAgentTurn`: if busy, park on the card first, then
     proceed. Mid-turn arrival (a second turn grabbing the box while the
     first is only thinking) is covered by setting the hold at *first
     machine use*; v1 accepts that two thinking turns race since
     neither is on the box yet.
4. **Automations** — no human to ask. Policy: queue-wait with a cap
   (~60s) then mark the run `skipped` — same `markRunSkipped` path
   Phase B added for archived agents.
5. **Rollout** — flag `OVERLAY_ENV_CONTENTION_PROMPT` (off by default),
   staging QA, then prod.

### Schema/contract deltas

- `agentSandboxLeases`: `turnHold` (optional object) + `temporary` flag.
- Run payload: `approval.kind` discriminator or `run.environmentRequest`
  — pick based on how typed `run.approval` is at implementation time.
- One route: extend `submitRunApproval` to accept a `decision` union, or
  a sibling `environment-decision` route — reuse the hook-token +
  `resumeHook` mechanism either way.

### Open decisions (owner input needed before/during implementation)

1. **Wait semantics** — hard cap then what? Proposed: wait ≤10 min,
   then re-show the card.
2. **Temporary computer lifecycle** — destroy at turn end, or
   keep-alive prompt ("keep this computer")? Proposed: destroy at
   settle; keep-for-later is v2.
3. **Scope** — agent threads only, or also channel mentions +
   automations? Proposed: threads + channels get the card, automations
   get silent wait-or-skip.

## Operating rules that bind this work

- `npm run convex:push:dev` runs **only** from the dedicated
  `overlay-landing-staging` worktree (staging lane); production pushes
  only from clean canonical `main` with explicit authorization. Never
  `convex:push:all`/`convex:push:prod`/`convex:deploy` from a feature
  worktree.
- Production Vercel deploys are manual (`vercel.json` keeps
  `git.deploymentEnabled.main=false` — preserve it).
- Builder implements + opens PR against `staging`; Integration owns
  merge/staging QA/promotion — unless the owner requests the direct
  fast-forward path.
- Maintain root `CHANGELOG.md` for user-visible changes reaching main.

## Open questions

- Does contention ever warrant queue-position visibility ("you're 2nd
  in line") rather than a binary busy card? Deferred — wait-or-branch is
  enough for v1.
- Should a temporary computer snapshot the agent's box first (warm
  start) instead of cold-empty? v2; cold-empty is honest and cheap.
- Dev/staging lane alignment for Phase B functions (see known gap
  above) — awaiting owner decision.

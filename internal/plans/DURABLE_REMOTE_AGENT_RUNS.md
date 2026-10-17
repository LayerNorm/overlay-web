# Durable remote agent runs

Status: In progress; new lifecycle enrollment must remain disabled until current-head hosted acceptance and compatible host/image publication pass.

Convex owns each logical run and transcript. Workflow 4.8.9 coordinates short idempotent lifecycle operations; the host owns process execution and the SQLite outbox. No browser or Workflow stream owns room output. Never replay an external write with an unknown outcome.

## Slices

- [x] Regression fixes: preserve approval/input waits across batches, separate progress from health/deadlines, wake cloud controls, idempotent controls and precise errors.
- [x] Canonical lifecycle: typed reducer, versioned logical runs/current execution attempts, fenced ownership, transactional lifecycle/control intents and selective indexes.
- [x] Host recovery: negotiated capabilities, boot/attempt identity, durable nonsecret configuration references, truthful recovery/health, exact outbox acknowledgement.
- [x] Workflow: atomic start intent, exclusive coordinator claim, wake/dispatch, hooks registered before dispatch, canonical rereads, notification retry and terminal cleanup.
- [ ] Validation/rollout: failure injection, docs, package artifacts, isolated preview, real approval soak beyond 15 minutes, wake/recovery/deploy continuity and billing readback.

## Evidence and constraints

- Read repository AGENTS.md and Development Workflow before work.
- Workspace has no configured provider/development secrets. Use inherited authorized tools only.
- GitHub fetch succeeded with explicit shell network access; branch updated to current origin/main before implementation.
- All 18 acceptance cases in the task remain required. Local mocks/fake clocks do not establish live provider or hosted acceptance. Keep PR draft while any required evidence is missing.

## Rollout

Server compatibility first; publish compatible lockstep host/protocol and cloud image next; only then enroll internal canary runs with a persisted lifecycle version. Rollback disables enrollment while compatible runs drain. Do not restart active non-restorable work or run both supervisors. Unsupported recovery requires attention until the old writer is proven stopped or isolated.

## Local validation (not hosted acceptance)

- `npm run check:byo-agents`: passed (one live-only host suite skipped).
- `npm run test:all`: all eight inventory groups exercised. Initial TSX failures
  were fixed (optional view fields) or resolved by initializing the desktop
  submodule; `npm run test:all -- --only tsx` then passed both affected groups.
  Existing explicitly marked TODO assertions remain in the baseline.
- Expanded Convex remote lifecycle tests cover API-exit intents, competing owners,
  simulated 20-minute approval wait, overlapping permission/input delivery, duplicate decisions/Resume, stale attempts and
  boots, cancel/completion races with retained usage, hard deadlines during Workflow
  outage, funding refusal, settlement retry identity, stale holds and legacy downgrade.
- Installed Workflow 4.8.9 runtime hook/replay/timer/conflict tests pass using
  `@workflow/vitest@4.0.25` (matching core 4.8.9); no Workflow major upgrade.
- Host failure fixtures cover unknown start outcomes, orphan refusal, live
  reattachment, attempt-scoped outboxes and nonsecret model configuration.
- Route type generation, standalone TypeScript, shared-isomorphic checks, docs
  health, targeted ESLint (warnings only), package pin consistency and clean packed
  Node 24 installation/import/CLI smoke passed.
- Complexity ratchet passes without raising its baseline. The on-prem import inventory
  records the two reviewed server-only lifecycle adapters; no browser import, route
  or cron surface was added by that inventory update.
- Published head 50ac1454 passed both complete CI test shards, production compilation,
  configuration/migration and tenant checks, CodeQL, Semgrep and host compatibility.
  Its complexity and import-inventory failures are addressed locally; the next
  published head must independently pass every required gate.
- Local default production build could not resolve symlinked worktree dependencies;
  the Webpack fallback compiled the Workflow bundles but was killed at the VM memory
  limit during application compilation. Required hosted CI/build remains mandatory.

## Acceptance blockers

Do not mark ready based on these local checks. Still required: current-head isolated
PR preview/backend and browser flows, real provider soak beyond 15 minutes followed
by approval/completion, actual stopped-machine wake, native recovery and deployment
continuity with transcript/run/attempt/provider/billing readbacks. Candidate packages
are 0.3.11 and image v6; the publishing workflow is main-only. Do not bypass it from
a feature branch. Keep new enrollment disabled and the PR draft until those gates
and required CI are satisfied. Preserve the existing task's approval history when
inspecting continuation; this checkout has not resumed any incident task.

## Integration review (2026-10-15)

The c2d90984 live handoff records a real 17-minute approval wait, browser reload,
completion, recovery and redeployment continuity. Integration found additional
legacy-poll compatibility, fresh-start payload/UI, cancellation proof, sequence
release, callback fencing/health and resolved-request projection defects. Fixes
and regression tests are being validated on the updated head. The earlier
five-minute cancellation cutoff is removed: only confirmed stop/isolation can
close a cancelled execution. Keep production lifecycle-v2 enrollment disabled;
provider wake/billing, compatible package/image publication and unavailable
provider-specific recovery remain separate activation gates.

### Cloud acceptance follow-up

The earlier claim that Overlay Cloud creation was disabled was incorrect: the
Preview lacked its provider configuration. It now uses a separate `overlay-preview`
Boat environment and CI key, with `noEnv` retained and production access denied.
The owner approved Boat's mandatory one-year expiry; renew before 2027-10-15.

Head e61b61cd7 passed real OpenCode cloud completion, a provider-confirmed stop,
wake/completion, and a second unattended stop/wake/completion on host 0.3.11 with
lifecycle v2. Four sandbox holds released; stopped-machine reconciliation kept
the same seven machine ledger entries and 0.26-cent total. A protected-Preview
transport wrapper was a test fixture, not a production image modification.

Duplicate cancellation returned one operation and stop command, but live testing
found a consumed-notification gap: the first stop-proof check can precede the
grace period. The coordinator now retries proof on durable timer passes; the
actual loop has regression coverage. The PR QA handoff records the final tested
head and its cancellation/provider/settlement readback. Earlier failing acceptance
is retained as evidence and is not counted as a passing cancellation test.

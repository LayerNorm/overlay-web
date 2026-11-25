# CI speed plan

Status: phases 0, 3 and 5 (repo-only) in review; other phases not started.

Goal: faster PR feedback from `Security Checks` without checking less. The merge
queue keeps running the full suite; no retries, wider timeouts or skipped tests;
lint rules and required contexts only stay or grow.

## Audit (last 150 completed `Security Checks` runs, 2026-11-22 → 11-25)

PR wall time (first job queued → last job done, successful runs): **p50 7.4 min,
p95 24 min**. Merge group p50 6.2 min. Push to main p50 5.7 min.

Per job, seconds, successful jobs only (p50 / p95):

| Job | Waiting | Setup | Running | Total |
| --- | --- | --- | --- | --- |
| Production compilation | 43 / 565 | 53 / 89 | 121 / 210 | 174 / 278 |
| Full suite shard (×2) | 210 / 910 | 38 / 75 | 59 / 80 | 98 / 137 |
| Typecheck and boundary contracts | 117 / 727 | 44 / 82 | 12 / 17 | 56 / 94 |
| Lint and boundary checks | 53 / 611 | 32 / 77 | 18 / 98 | 50 / 146 |
| Admin Console Checks | 149 / 851 | 35 / 62 | 15 / 23 | 51 / 84 |
| Secret Scan | 140 / 759 | 10 / 13 | 7 / 10 | 17 / 21 |
| Guard Public Env Names | 146 / 791 | 10 / 12 | 3 / 4 | 12 / 15 |
| Dependency Review | 137 / 1032 | 10 / 13 | 3 / 5 | 13 / 16 |

Findings, biggest bucket first:

1. **Waiting dominates.** The slowest job runs 3 min, yet the PR takes 7.4 min
   at p50 and 24 min at p95. Jobs wait 1–3.5 min at p50 and 10–15 min at p95
   for a Namespace machine, even when fewer than 5 of our jobs are running, so
   this is runner capacity or provisioning, not our own fan-out. Each PR also
   queues CodeQL (8 vCPU, ~4 min wait) and Semgrep alongside.
2. **Setup is ~30–55 s per job.** Checkout alone is 10 s because 178 of the
   202 MB tracked at HEAD are `internal/plans` mockups (each ~15 MB). Preparing
   dependencies is 21–27 s p50 / ~57 s p95 (setup-node, npm pin, network cache
   restore). The Next cache restore adds 11 s. Admin runs its own `npm ci`.
3. **Compilation is the critical path once waiting is fixed:** `next build
   --webpack` is 114 s p50 / 204 s p95 on 8 vCPU.
4. Lint is 5 s with a warm cache but 86 s at p95 (16 of 284 runs missed).
5. Typecheck already uses TypeScript 7 through Bun (10 s). Tests are ~60 s per
   shard on 8 vCPU across 902 test files.

Job-minutes for this workflow: ~1,520 over 150 runs (~520/day). Dollar cost
needs the Namespace bill; record it before phase 1 for the before/after total.

## How the suggested tips map to this repo

Already done: merge queue runs the full suite; PR runs cancel on new commits;
lint, typecheck, build and tests run in parallel; TypeScript 7 typecheck; shard
partition is verified to run every file exactly once; affected-test selection
exists in shadow mode; no retries.

Applicable now: fix waiting (account side), fold the tiny jobs, sparse checkout,
toolchain baked into the runner image, better dependency/lint cache seeding,
faster compilation, timing-balanced shards, PR test selection with a negative
control, extending the existing pre-push hook, per-job time budgets.

Not adopted without new evidence:

- **Switch to Blacksmith.** We are already on a non-GitHub runner vendor. Fix
  Namespace capacity first; trial Blacksmith side by side only if waiting stays
  above ~5 s.
- **Replace ESLint with oxlint.** The recorded parity check shows stock oxlint
  drops our custom syntax/import/boundary rules. Re-run
  `lint-oxlint-parity.mjs` with oxlint JS plugins; switch only at full parity.
- **Replace npm with bun / tsx, node:test and Vitest with `bun test`.** Install
  is a cache restore on hits, Vercel builds use npm, and the suites mix
  node:test, tsx, native ESM and Vitest. Large migration, unmeasured gain;
  revisit after phase 5 if tests are still the slowest lane.
- **Add `bun fmt`.** There is no formatter today; adding one rewrites the repo.
  Separate decision, not a speed change.
- **Under 1 min median.** Compilation alone is ~2 min. Realistic target after
  phases 1–4: **p50 ≈ 2.5 min, p95 ≈ 4 min**.

## Phases (one small PR each, with before/after numbers from real runs)

| # | Change | Expected effect | Needs owner |
| --- | --- | --- | --- |
| 0 | Commit `scripts/ci/ci-timing-audit.mjs` (the script behind the table above) | Repeatable before/after numbers | — |
| 1 | Diagnose Namespace queueing: concurrency/vCPU cap, priority labels, warm capacity. Raise the cap or keep machines warm | Waiting p50 ~2 min → < 10 s; biggest win | Namespace account, maybe higher plan |
| 2 | Fold Secret Scan, Public Env Guard and Dependency Review into one job that reports every failure (keep check names via the aggregate) | 3 fewer queued machines per PR | Required-context change in branch protection |
| 3 | Sparse checkout excluding `internal/plans/` in every job that does not read it | ~8 s off every job | — |
| 4 | Runner image with Node 22/24, npm 11.11.0, Bun 1.4.4, gitleaks preinstalled; admin uses the shared dependency action | ~10–20 s off setup | Namespace custom image |
| 5 | Seed dependency, ESLint and `.next/cache` caches from main on every push; log hit/miss per job; target > 95% PR hits | Lint p95 86 s → ~5 s; setup p95 down | — |
| 6 | Compilation: measure 16 vCPU vs 8; separately measure Turbopack for CI **and** Vercel together (CI must keep compiling what production compiles) | Build 114 s → ~60 s | Larger profile cost; bundler decision |
| 7 | Balance shards from per-file times recorded on main; buy cores before adding shards | Even shards, ~45 s each | — |
| 8 | Turn on affected-test selection for PRs only; prove it by hiding a real change and confirming CI goes red; list the inputs that rerun everything | Typical PR tests ~60 s → ~15 s | — |
| 9 | A shared `.githooks/pre-push` already lints changed files and typechecks affected projects. Add a fast pre-commit (staged-file lint) and extend pre-push to the static guards; adopt `hk` only if it measurably beats the existing hook | Fewer red CI runs (29 of 150 failed) | — |
| 10 | Fail any job over its budget once budgets are met | Keeps it fast | — |

Ongoing: for two weeks, label each test failure fixed as a caught regression or
a change detector; delete only change-detector files, never authorization,
privacy, migration or concurrency tests.

## Progress

| Phase | State |
| --- | --- |
| 0 Audit script | In review: `scripts/ci/ci-timing-audit.mjs` |
| 3 Sparse checkout | In review: lint, typecheck, compilation and tests skip `internal/plans/**/*.html` |
| 5 Cache seeding | In review: exact Node pins, no merge-queue dependency saves, main-only `.next/cache` saves, hit/miss notices. ESLint cache unchanged (it is ~0 MB) |
| 1, 2, 4, 6–10 | Not started |

Untested until merged: whether main reseeds caches as expected and the PR hit
rate after the 10 GB cache stops thrashing. Measure after a day of main pushes.

## Owner list (accounts, secrets, bill)

1. Namespace: confirm concurrency/vCPU limit and whether warm capacity exists;
   approve the higher tier if that is the cause. Cost: unknown until checked.
2. Namespace custom base image for CI profiles.
3. Branch protection: replace the three small-check contexts with the folded one.
4. Larger compilation profile (16 vCPU) if phase 6 shows it pays.
5. Bundler decision if Turbopack is faster for both CI and Vercel.

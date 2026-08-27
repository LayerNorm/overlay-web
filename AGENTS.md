# Agent memory (continual learning)

## Learned User Preferences

- Prefer plain-language explanations for security, auth, and billing setup—not only code or env var names.
- When debugging integrations (Convex, WorkOS, Stripe), use concrete error logs or network responses early so fixes match the actual failure mode.
- Convex worktree safety: `main` + production Vercel must match production Convex; `staging` + `staging.getoverlay.io` uses the shared dev Convex deployment. A coding agent may run `npm run convex:push:dev` only from the dedicated `staging` worktree for a staging release candidate. It may run `npm run convex:push:prod` only from the clean canonical `main` worktree after main's web deployment is live. Never run `convex:push:all`, `convex:push:prod`, `convex:deploy`, or `convex:deploy:all` from a feature worktree. Do not pass `.env.local` to production Convex deploys.
- For local web work, use `npm run dev` (or `./scripts/dev-setup.sh <port>`) from feature worktrees. `npm run dev:with-convex` deploys shared dev Convex and is reserved for the dedicated `staging` worktree. Coordinate Convex changes because staging/local development share one dev backend. See `docs/develop/worktree-staging-qa.mdx` for the required workflow.
- For UI work, align new controls with the existing app chrome and design language. Dark mode should use dark gray surfaces/buttons with light text—not full-white cards or full-black CTAs. Use Lucide icons, not emoji or decorative icon sets. The user's aesthetic bar is very high — first-pass designs have been rejected repeatedly as "hideous"; default to the simplest, cleanest possible implementation and validate visually before considering it done.
- Run deploys, tests, and shell workflows in the environment when possible instead of only describing steps. After substantial implementation work (especially architecture phases), include a brief QA checklist: commands to run, routes to hit, and what should look normal.
- For billing or Stripe webhook testing, run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
- For verification, run the smallest check that covers the change. In this repo, targeted ESLint on changed files is acceptable when full `npm run lint` is blocked by unrelated generated or mobile issues.
- Model dropdowns: order by intelligence/quality (`CHAT_MODEL_QUALITY_PRIORITY`), not provider grouping or alphabetical order; keep free-tier "Auto" at the top. Capability badges are small chips (`inline-flex w-4 h-4 rounded bg-[#f0f0f0]`) with thin Lucide icons (`ScanEye` vision, `Sparkles` reasoning)—only when the model supports the capability. Reveal secondary info (e.g. cost) on row hover via `group/row` + `group-hover/row:hidden` / `hidden group-hover/row:flex`.
- Streaming text must render in complete, markdown-formatted chunks without per-character diffs that cause visible flickering. Agent loading should use bottom-placed dots, not parallel "Thinking..." text. Tool-call/action UIs should be minimal, collapsed, and sequential by default.

## Learned Workspace Facts

- This Next.js app selects Convex URL from env: development commonly uses `DEV_NEXT_PUBLIC_CONVEX_URL` for a separate dev backend from production `NEXT_PUBLIC_CONVEX_URL`.
- Session state uses httpOnly `overlay_session` with the WorkOS access token inside the signed payload. WorkOS access tokens are JWTs; Convex verifies them with JWKS and issuer/audience checks—`iss` is a claim inside the token, not a separate secret or cookie name.
- App code is layered: `src/features/<domain>/`, `src/components/{ui,layout,providers}/`, `src/server/` (server-only), and `src/shared/` (isomorphic). Reusable contracts and adapters live in workspace `packages/` (`@overlay/app-core`, `@overlay/auth-contracts`, `@overlay/storage-contracts`, `@overlay/llm-gateway`, `@overlay/agent-runtime`, `@overlay/tools-core`, `@overlay/api-client`, etc.). `@overlay/api-client` is split into per-resource modules under `packages/overlay-api-client/src/`. Legacy `src/lib/` is gone. tsconfig aliases: `@/server/*`, `@/shared/*`, `@/features/*`.
- Phased refactor scope is tracked in `.windsurf/plans/overlay-architecture-plan-6a2040.md` (chat decomposition, `@overlay/*` package extraction, API portability).
- `convex/` must import `@/shared/*`, never `@/server/*` — server modules use `server-only` and break Convex bundling. Shared modules used by Convex include `storage/storage-keys`, `ai/sandbox/daytona-pricing`, and `ai/gateway/model-pricing`.
- Convex handlers are grouped by domain folder (`convex/chat/conversations.ts` → `chat/conversations:*`, `convex/files/files.ts` → `files/files:*`, `convex/platform/usage.ts` → `platform/usage:*`, etc.). BFF routes use those string paths; typed code uses nested `api` / `internal` from `_generated/api` (e.g. `api.chat.conversations`, `internal.knowledge.memoryExtractorNode`). Do not re-export multiple modules from one `index.ts` barrel — it collides on export names and can pull `"use node"` code into the default runtime.
- `src/shared/` is isomorphic: no Node builtins, no ad-hoc `process.env` (use `@/shared/env/public-env`), no `@/server/*`, no `'use client'` modules. Verify with `npm run check:shared-isomorphic`.
- ESLint layer boundaries live in `scripts/eslint-boundary-rules.mjs` (wired from `eslint.config.mjs`); ~38 pre-existing cross-feature and components→features violations are documented tech debt.
- `src/shared/ai/gateway/model-data.ts` `AVAILABLE_MODELS` carries a `cost: 0|1|2|3` field (0 = free, 1 = cheap, 2 = mid, 3 = expensive) and boolean `supportsVision` / `supportsReasoning` flags that must be kept accurate per model. The free router model has id `openrouter/free` and display name "Auto". `getModelsByIntelligence(isFreeTier)` returns models sorted by `CHAT_MODEL_QUALITY_PRIORITY` and hoists "Auto" to the top for free-tier users.
- Mobile Safari/private browsing: probe `localStorage` before PostHog persistence (`src/instrumentation-client.ts`), wrap sidebar panels that call `useSearchParams()` in `Suspense`, and guard chat preference reads/writes—blocked storage must not crash the app shell.
- Session/crypto secrets (`SESSION_SECRET`, `SESSION_TRANSFER_KEY`, `SESSION_COOKIE_ENCRYPTION_KEY`) belong on the Next/Vercel app only. Convex deployments need `INTERNAL_API_SECRET` **and** `INTERNAL_SERVICE_AUTH_SECRET`, each matched to the app env for that deployment (dev vs prod): `convex/automations/automationRunner.ts` signs automation callbacks with `INTERNAL_SERVICE_AUTH_SECRET` and `src/server/auth/service-auth.ts` verifies them, so a mismatch fails closed with an HMAC signature error. The two secrets must differ from each other.
- The `singleplayer` branch is a stability snapshot of the last known-working production commit (`a144951f3`, Aug 19 2026). It predates the staging merge that introduced the `(shell)` route group with `AppShellLayout` and `instant = false`, which caused a client-side hydration stall on production. If production is broken and a fast rollback is needed, `singleplayer` is the branch to restore from.

## Self-Updating Documentation (MUST READ)

The `docs/develop/` directory contains living documentation that coding agents **must keep up to date** when their work touches the relevant area. These are not static reference files — they are the source of truth for decisions, patterns, and status. If you implement a change that falls under one of these docs, you **must** update the doc in the same commit/PR.

| Doc | When to update |
| --- | --- |
| `docs/develop/cache-components-design-decisions.md` | Any change to `instant = false` opt-outs, `<Suspense>` boundaries in routes, `cacheComponents`/`partialPrefetching` config, or route-level PPR status. Add the route to the converted list or update its opt-out reason. |
| `docs/develop/browser-testing-with-agent-browser.md` | Any change to the agent-browser setup, tool usage patterns, or QA workflow. Add new workflow patterns or gotchas discovered during testing. |
| `docs/develop/browser-use-with-playwright-mcp.md` | Any change to Overlay staging QA with Playwright MCP, dedicated testing Chrome setup, or staging-specific browser gotchas. |
| `docs/develop/general-purpose-browser-use-with-playwright-mcp.md` | Any change to general Playwright MCP setup, browser safety boundaries, interaction workflows, or cross-project browser use. |
| `docs/develop/worktree-staging-qa.mdx` | Any change to the worktree branching model, staging deploy workflow, or Convex deploy lanes. |
| `docs/develop/convex-workflow.mdx` | Any change to Convex deploy commands, environment selection, or boundary rules. |
| `docs/develop/architecture.mdx` | Any change to the app's layer structure (`src/features`, `src/server`, `src/shared`, `packages/`), import boundaries, or module conventions. |
| `docs/develop/feature-modules.mdx` | Any change to the feature module registry, extension system, or `@overlay/app-core` shell config. |
| `docs/develop/api-source-of-truth.mdx` | Any change to where API logic lives (Convex vs BFF vs `@overlay/api-client`), or the contract between layers. |
| `docs/develop/customization.mdx` | Any change to theming, settings panels, or workspace configuration. |
| `docs/develop/local-integrations.mdx` | Any change to local integration setup, connector configuration, or OAuth flow. |
| `docs/develop/external-imports.md` | Any change to the external import architecture, canonical import model, adapter interface, or Slack/Teams/Discord/Telegram import implementation. |
| `docs/develop/automation-durability-and-visual-editor.md` | Any change to the automation graph model, Workflow SDK integration, ReactFlow canvas, or automation run durability. |
| `docs/develop/traversing-agent-conversations.md` | Any change to how Devin CLI, Codex, or Grok Build sessions are stored/queried, or new query patterns for extracting conversation data from `sessions.db`, Codex JSONL, or Grok `chat_history.jsonl` files. |
| `docs/develop/bring-your-own-agents.md` | Any change to connected-agent contracts, host protocol, enrollment, remote execution, managed environments, or rollout policy. |

**Rules:**
1. Read the relevant doc(s) before starting work in a new area.
2. Update the doc in the same commit as your code changes — not as a follow-up.
3. If you create a new living doc in `docs/develop/`, add it to the table above.
4. Keep entries concise: decisions and their reasons, not narratives.
5. If a doc becomes stale (references deleted code, wrong patterns), fix it when you notice — even if the current task is unrelated.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

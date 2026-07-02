# Modular UI Migration Notes

Feature screens now live under `src/features/<domain>/components/` (Phase 1.1). They remain the web containers for routing, auth, uploads, browser APIs, billing, and local persistence. Shared primitives stay in `src/components/{ui,layout,providers}/`. Canonical shared APIs live in packages.

## Phase 1.2 — server/shared/features split

The legacy helper tree is removed. Imports use:

| Area | Path | Role |
| --- | --- | --- |
| Server-only domain code | `src/server/{auth,billing,storage,database,ai,agent,chat,tools,observability}/` | Node/WorkOS/Stripe/R2/Convex HTTP, agents, chat persistence |
| Isomorphic shared code | `src/shared/{chat,markdown,security,web,storage,knowledge,app,tools,auth,database,billing,ai}/` | Client-safe modules only; must not import `@/server/*` |
| Feature-local helpers | `src/features/<domain>/lib/` | Landing, integrations, auth cookie, share URLs, notebook blocks, automations drafts, file export |

Convex functions now import matching `../src/shared/*` paths for client-safe helpers and keep server-only code out of Convex bundles.

The historical one-shot phase 1.2 migration scripts were removed from the active tree after the migration completed.

## Phase 1.3 — `server-only` boundaries

Every file under `src/server/**/*.ts` starts with `import 'server-only'`. Importing `@/server/*` from a Client Component should fail at build time.

**Moved to `src/shared/` (client-safe):**

- `billing/billing-pricing.ts`
- `ai/gateway/{model-types,model-data,model-fallbacks,generated/}`
- `chat/{chat-title,chat-model-prefs,chat-list-cache,chat-suggestions-defaults,cloudflare-chat-transport}`
- `auth/session-types.ts` (`AuthUser`, `AuthSession` for UI)
- `knowledge/ask-knowledge-types.ts` (citation types for chat UI)

**Moved to `src/server/` (were incorrectly under shared):**

- `knowledge/{mention-resolver,ask-knowledge-context}`
- `security/rate-limit.ts`
- `web/web-tools.ts`
- `chat/context-compaction.ts`

The historical one-shot phase 1.3 migration scripts were removed from the active tree after the migration completed.

## Phase 1.4 — isomorphic `src/shared/`

Everything under `src/shared/` must be importable from client and server bundles: no `fs`, no ad-hoc `process.env`, no Node builtins, no `server-only` / `@/server/*`, no `'use client'` modules.

**Centralized public env:** `@/shared/env/public-env` (only `NEXT_PUBLIC_*` and build-time `NODE_ENV` for `isDevelopmentBuild()`).

**Server env:** `@/server/env/server-env` for `VERCEL_URL`, `SENTRY_DSN`, dev URL overrides.

**Splits / moves:**

| Former `src/shared/` | New location |
| --- | --- |
| `web/url.ts` (`getBaseUrl`, `getInternalApiBaseUrl`) | `@/server/web/app-url` |
| `web/url.ts` (pure URL helpers) | `@/shared/web/normalize-app-url` |
| `security/ssrf.ts` | `@/server/security/ssrf` |
| `security/security-events.ts` | `@/server/observability/security-events` |
| `storage/convex-file-content` (`hashTextContent`) | `@/server/storage/text-content-hash` |
| `database/convex-react-client.ts` | `@/components/providers/convex-react-client` (+ `@/shared/database/convex-url`) |
| `app/{async-sessions-store,navigation-progress}.tsx` | `@/components/providers/*` |
| `features/.../mention-types` (canonical) | `@/shared/knowledge/mention-types` (feature file re-exports) |

**Checks:** `npm run check:shared-isomorphic` and ESLint `no-restricted-imports` / `no-restricted-syntax` on `src/shared/**` (excluding `*.test.ts` and `env/public-env.ts`).

**Convex:** Functions must import shared modules, not `src/server/*` (those re-export or use `server-only` for Next). Convex-safe shared modules include `storage/storage-keys`, `ai/sandbox/daytona-pricing`, and `ai/gateway/model-pricing`.

## Phase 1.5 — ESLint import boundaries

Rules live in `scripts/eslint-boundary-rules.mjs` and are wired from `eslint.config.mjs` via `no-restricted-imports` (no `eslint-plugin-boundaries`).

| Layer | Enforcement |
| --- | --- |
| `src/app/**` | Error on `@/assets/*`, `@/types/*` (routes should use features, components, server, shared, hooks, contexts, packages) |
| `src/features/<domain>/**` | Error on `@/features/<other>/*` (no cross-feature imports) |
| `src/features/<domain>/**/components/**` | Also error on `@/server/*` |
| `src/components/**` | Error on `@/features/*`, `@/server/*` |
| `src/shared/**` | Error on non-`@/shared` layers (plus isomorphic rules in `eslint.config.mjs`) |
| Legacy shared helpers | Removed from the active tree; use `src/server/**` or `src/shared/**` based on runtime requirements. |
| `src/server/<domain>/**` | **Warn** on `@/server/<other>/*` (sibling domains; burn down over time) |

**Known violations:** 38 legacy component / feature-boundary violations are allowlisted as warnings in `scripts/eslint-boundary-rules.mjs` so production builds can pass while the debt is burned down. New files outside that baseline still fail as errors. Server cross-domain imports surface as warnings only.

**Verify:** `npx eslint src/app src/components src/features src/shared src/server` (full `npm run lint` may still report unrelated issues elsewhere).

## Phase 1.6 — path aliases

`tsconfig.json` adds explicit aliases (alongside `@/*` → `./src/*`):

- `@/server/*` → `./src/server/*`
- `@/shared/*` → `./src/shared/*`
- `@/features/*` → `./src/features/*`

TypeScript resolves the longer prefix first, so `@/server/foo` maps to `src/server/foo` without changing existing `@/…` imports.

## Phase 1.7 — Convex domain folders

Convex modules now live under `convex/<domain>/` with paths like `chat/conversations:list` (folder + module file). Root `convex/` keeps only `schema.ts`, `convex.config.ts`, `lib/{auth,authDebug,logging}.ts`, and `_generated/`.

| Old root file | New path |
| --- | --- |
| `conversations.ts` | `chat/conversations.ts` |
| `files.ts` | `files/files.ts` |
| `notes.ts` | `files/notes.ts` |
| `knowledge.ts` | `knowledge/knowledge.ts` |
| `memories.ts`, `memoryExtractor*.ts` | `knowledge/` |
| `subscriptions.ts`, `stripe.ts`, `stripeSync.ts` | `billing/` |
| `lib/stripeOverlaySubscription.ts` | `billing/lib/` |
| `users.ts`, `serviceAuth.ts`, `sessionTransfer.ts`, `authDebug.ts` | `auth/` |
| `automations.ts`, `automationRunner.ts` | `automations/` |
| `projects.ts` | `projects/projects.ts` |
| `outputs.ts` | `outputs/outputs.ts` |
| `skills.ts`, `mcpServers.ts` | `integrations/` |
| `daytona.ts`, `daytonaReconcile.ts` | `ai/sandbox/` |
| `usage.ts`, `rateLimits.ts`, `uiSettings.ts`, `http.ts`, `crons.ts`, `keys.ts`, `seedDemoAccount.ts` | `platform/` |
| `storageAdmin.ts` | `files/storageAdmin.ts` |
| `lib/storageQuota.ts` | `files/lib/storageQuota.ts` |

**Call sites:** BFF routes use string paths (`convex.query('files/files:get', …)`). Typed client code uses nested `api` / `internal` (e.g. `api.chat.conversations`, `internal.knowledge.memoryExtractorNode`).

**Barrels:** Per-domain `index.ts` barrels were not kept — re-exporting multiple modules (`files` + `notes`, `skills` + `mcpServers`) collides on shared export names in TypeScript and can pull `"use node"` modules into the default bundle. Each `.ts` file is its own Convex module.

The historical one-shot phase 1.7 migration script was removed from the active tree after the migration completed.

**Verify:** `npx convex codegen` (with dev deployment env), `npm run typecheck`, targeted ESLint on `convex/`, then `npm run convex:push:dev` (and prod when ready).

## Canonical Packages

- `@overlay/app-core`: app shell registries, contracts, and pure module controllers.
- `@overlay/api-client`: typed transport for `/api/v1/*`.
- `@overlay/ui`: UI primitives and shared styling.
- `@overlay/chat-core`: shared chat behavior.
- `@overlay/chat-react`: React DOM chat components.
- `@overlay/modules-react`: React DOM components for files/knowledge, notes, projects, extensions, and settings.

## Replacement Path

| Compatibility wrapper | Canonical direction |
| --- | --- |
| `src/features/knowledge/components/KnowledgeView.tsx` | Contracts and controllers in `@overlay/app-core`, transport in `@overlay/api-client`, presentation in `@overlay/modules-react/knowledge`. |
| (OutputsView — not yet in tree) | Use output contracts, output API methods, and `OutputGallery`. |
| `src/features/knowledge/components/MemoriesView.tsx` | Use memory contracts, memory API methods, and memory controller helpers. |
| `src/features/notebook/components/NotebookEditor.tsx` | Notes are canonical `kind: note` files; use notes API aliases and `NotesEditorShell`. |
| `src/features/projects/components/ProjectsView.tsx` and `ProjectsSidebar.tsx` | Use project contracts, project API methods, `buildProjectTree`, `ProjectTree`, and `ProjectDetail`. |
| `src/features/tools/components/ToolsView.tsx`, `src/features/integrations/components/*`, `src/features/automations/components/SkillsView.tsx` | Use extension contracts, typed API methods, `filterExtensionCatalog`, `ExtensionCatalog`, and `McpServerForm`. |
| `src/app/app/settings/page.tsx` | Use settings registries, settings/account API methods, and `SettingsSectionRenderer`. |
| `src/app/account/page.tsx` | Keep billing/account orchestration in web; share typed billing contracts through `@overlay/app-core` and transport through `@overlay/api-client`. |

## Migration Rule

Move one feature slice at a time. Keep URL behavior, local storage keys, rendering behavior, and endpoint behavior unchanged while replacing direct local fetches with `overlayAppClient` and moving reusable state into `@overlay/app-core/modules`.

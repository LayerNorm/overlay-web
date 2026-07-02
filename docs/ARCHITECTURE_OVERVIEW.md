# Overlay Web — Architectural Overview

> **Scope:** Web application (`overlay-landing`) only. Desktop, mobile, and Chrome extension are out of scope.

---

## 1. Executive Summary

Overlay is an **open-source AI workspace** unifying chat, voice notes, browser tasks, agents, automations, knowledge indexing, and content generation. Built on **Next.js 15** (App Router) with **React 18**, **Tailwind CSS**, backed by **Convex** (real-time DB), **WorkOS** (auth), **Stripe** (billing), and **Cloudflare R2** (storage). Structured as a **monorepo with npm workspaces** — 16+ internal packages enforce clean boundaries. Designed for **self-hosting** with swappable providers.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, RSC) |
| UI | React 18, Tailwind CSS 3, Lucide, Framer Motion |
| Rich Text | TipTap (ProseMirror) |
| Database | Convex (real-time, reactive) |
| Auth | WorkOS AuthKit (OIDC/Keycloak/NoOp alternatives) |
| Billing | Stripe (subscriptions + usage-based) |
| Object Storage | Cloudflare R2 (or S3/MinIO) |
| LLM Gateway | OpenRouter (default), OpenAI, Anthropic, Groq |
| AI SDK | Vercel AI SDK (`ai` v6) |
| Code Sandbox | Daytona SDK |
| Tool Integration | Composio, MCP |
| Streaming | Cloudflare Worker + Durable Objects |
| Observability | Sentry, PostHog, Cloudflare Insights |
| Deployment | Vercel + Cloudflare Workers |
| License | AGPL-3.0-or-later |

---

## 3. Repository Structure

```
overlay-landing/
├── src/                    # Main application source
│   ├── app/                # Next.js App Router
│   ├── components/         # Shared layout & provider components
│   ├── contexts/           # React contexts (Auth, LandingTheme)
│   ├── extensions/         # Extension registry
│   ├── features/           # Feature-domain UI components
│   ├── server/             # Server-only modules (BFF, services)
│   ├── shared/             # Isomorphic code (client + server safe)
│   ├── middleware.ts       # CSP, auth gating, route protection
│   └── overlay.config.ts   # App config (brand, nav, tools, providers)
├── convex/                 # Convex backend (schema, functions, HTTP)
├── packages/               # 16+ internal workspace packages
├── workers/                # Cloudflare Workers (chat-stream relay)
├── scripts/                # 40+ dev/ops scripts
├── docs/                   # Documentation, Mintlify site, & design assets
├── config/                 # R2 CORS config
├── public/                 # Static assets
├── examples/               # Self-hosting examples
└── fixtures/               # Test fixture configs
```

---

## 4. Source Code Layering

Strict 4-layer architecture enforced by ESLint boundary rules:

```
src/app/         → Next.js routes, layouts, pages
src/features/    → Feature-domain UI (chat, files, billing, etc.)
src/components/  → Shared presentational (sidebar, providers)
src/server/      → Server-only (BFF, services, providers)
src/shared/      → Isomorphic (types, schemas, model data)
```

**Key rules:**
- `src/shared/` — No Node builtins, no `process.env` (use `@/shared/env/public-env`), no `@/server/*`. Verified by `npm run check:shared-isomorphic`.
- `src/server/` — Imports `server-only`. Never imported by client code or `convex/`.
- `convex/` — May import `@/shared/*` but **never** `@/server/*`.
- `src/components/` — May not import from `src/features/`.

**TypeScript path aliases:** `@/*`, `@/server/*`, `@/shared/*`, `@/features/*`, `@overlay/*` (→ `packages/*/src/*`)

---

## 5. Next.js App Router

### 5.1 Marketing Routes
```
src/app/
├── page.tsx          # Landing
├── pricing/          # Pricing
├── for-business/     # Use-case pages
├── for-content/
├── for-developers/
├── for-education/
├── manifesto/        # Company manifesto
├── privacy/          # Legal pages
├── terms/
├── share/            # Shared conversation viewer
└── layout.tsx        # Root layout (metadata, theme bootstrap)
```

### 5.2 App Shell (`/app/*`)
```
src/app/app/
├── layout.tsx        # Providers, sidebar, auth gate
├── chat/             # Chat interface
├── notes/            # Notes/notebook
├── files/            # File management
├── knowledge/        # Knowledge base
├── automations/      # Automation management
├── integrations/     # Integration settings
├── memories/         # Memory viewer
├── outputs/          # Generated media
├── projects/         # Project management
├── settings/         # User settings
├── tools/            # Tool/MCP management
└── x/                # Experimental
```

### 5.3 API Routes
Two tiers: legacy BFF routes (`/api/auth`, `/api/checkout`, `/api/webhooks`, etc.) and **Public REST API v1** (`/api/v1/`) with 25+ resource endpoints covering conversations, files, automations, knowledge, notes, projects, skills, MCP servers, billing, image/video generation, transcription, browser tasks, and more.

---

## 6. Server Layer (`src/server/`)

### 6.1 Bootstrap & Provider System

`src/server/bootstrap.ts` is the dependency injection root. Creates `OverlayServerContext` with swappable providers:

| Provider | Options |
|---|---|
| `auth` | WorkOS, OIDC, Keycloak, NoOp |
| `billing` | Stripe, NoOp |
| `objectStore` | R2, S3, MinIO, NoOp |
| `vectorStore` | Convex, InMemory |
| `llmGateway` | OpenRouter, OpenAI, Anthropic, Groq, NoOp |
| `rateLimiter` | Convex, InMemory |

Provider selection driven by `OverlayRuntimeConfig` — this enables self-hosting.

### 6.2 BFF API Layer (`src/server/app-api/`)

- `boundary.ts` — Zod request validation per route
- `bff-context.ts` — Per-request context (user, config, providers)
- `idempotency.ts` — Idempotent API key handling
- `pagination-core.ts` — Cursor-based pagination
- `v1/` — Route handlers mirroring `app/api/v1/`

The `v1/conversations/act/` route is the most complex: orchestrates agent turns, tool execution, streaming, and persistence (32K LOC main route file).

### 6.3 AI/LLM Gateway (`src/server/ai/gateway/`)

- `ai-gateway.ts` — Unified gateway interface
- `gateway-catalog.ts` — Model catalog (fetched from OpenRouter)
- `openrouter-service.ts` — OpenRouter API client
- `gateway-search-tools.ts` — Web search tool integration
- `live-model-pricing.ts` / `model-pricing.ts` — Cost calculation
- `tool-schema-compat.ts` — Tool schema normalization
- `nvidia-nim-openai.ts` — NVIDIA NIM provider

### 6.4 Auth System (`src/server/auth/`)

**Auth flow:**
1. User signs in via WorkOS AuthKit → `overlay_session` httpOnly cookie
2. Cookie contains signed payload with WorkOS access token (JWT)
3. Convex verifies JWT via JWKS + issuer/audience checks
4. Client fetches Convex token from `/api/auth/convex-token` (refreshed every 4 min)
5. API routes support cookie auth (browser) + bearer token auth (native clients)

Key files: `workos-auth.ts` (27K LOC), `session.ts`, `service-auth.ts` (HMAC + replay protection), `api-keys/` (API key CRUD).

### 6.5 Billing System (`src/server/billing/`)

- Tiered subscriptions: free, pro, max
- Usage-based credits: `creditsUsed` accumulator (cents, fractional)
- Budget reservations: pre-reserve credits before LLM calls
- Daytona sandbox metering: per-second billing
- Stripe webhook handling + dedup via `processedWebhookEvents`

### 6.6 Other Server Modules

| Directory | Responsibility |
|---|---|
| `conversations/` | Conversation CRUD, agent turn persistence |
| `agent/` | System prompts, knowledge agent, notebook agent |
| `tools/` | Tool registry, MCP/Composio tools, execution, exposure policy |
| `storage/` | R2/S3 object store, upload intents, budget tracking |
| `files/` | File service (upload, parse, text extraction) |
| `knowledge/` | Knowledge indexing, vector search |
| `automations/` | Automation CRUD, scheduling, execution |
| `config/` | Runtime config loading + validation |
| `observability/` | Logging, metrics |

---

## 7. Shared Layer (`src/shared/`)

Isomorphic code safe for both client and server:

| Directory | Contents |
|---|---|
| `ai/gateway/` | Model data, types, pricing, fallbacks, ZDR flags |
| `chat/` | Chat types, model prefs, message helpers |
| `config/` | Config schema & defaults |
| `schemas/` | Zod schemas (API boundary, models) |
| `env/` | `public-env` (typed env access) |
| `auth/` | Auth type contracts |
| `billing/` | Billing pricing constants |
| `markdown/` | Markdown processing utilities |
| `storage/` | Storage keys, file text search |
| `security/` | Client-safe security utilities |

Key file: `src/shared/ai/gateway/model-data.ts` — defines `AVAILABLE_MODELS` with `cost` (0-3), `supportsVision`, `supportsReasoning`, `supportsZeroDataRetention` flags, and `getModelsByIntelligence()`.

---

## 8. Features Layer (`src/features/`)

| Feature | Key Components |
|---|---|
| `chat/` | ChatExperience (163K LOC), ChatComposer, ChatMessageList, MarkdownMessage, ChatInlinePanel |
| `files/` | File upload, browser, viewer |
| `billing/` | Plan selection, usage display |
| `knowledge/` | Knowledge base UI |
| `automations/` | Automation builder, run history |
| `notebook/` | TipTap-based editor |
| `settings/` | Settings panels |
| `auth/` | Sign-in, sign-up |
| `landing/` | Landing page components |
| `marketing/` | Marketing components |

---

## 9. Components Layer (`src/components/`)

- `layout/AppSidebar.tsx` (34K LOC) — navigation, tabs, inline panels
- `layout/GlobalSearchDialog.tsx` — ⌘K search
- `providers/ConvexProviderWithWorkOS.tsx` — Convex + WorkOS auth integration
- `providers/AppSettingsProvider.tsx` — settings state
- `providers/OnboardingProvider.tsx` — onboarding tour
- `providers/CapabilitiesProvider.tsx` — feature capability context
- `providers/GuestGateProvider.tsx` — guest access gating
- `providers/BackgroundPollManager.tsx` — session/usage polling

---

## 10. Convex Backend (`convex/`)

### 10.1 Schema (30+ tables)

| Table | Purpose |
|---|---|
| `userUiSettings` | UI preferences (theme, models, sidebar) |
| `subscriptions` | Subscription/tier/credits (billing source of truth) |
| `budgetTopUps` | Credit top-up records |
| `budgetReservations` | Pre-reserved credits for LLM calls |
| `tokenUsage` | Append-only audit log |
| `dailyUsage` | Free-tier daily counters |
| `processedWebhookEvents` | Stripe webhook dedup |
| `rateLimitWindows` | Rate limiting state |
| `apiIdempotencyKeys` | API idempotency tracking |
| `apiKeys` | User API keys (hashed, scoped) |
| `daytonaWorkspaces` | Code sandbox state |
| `daytonaUsageLedger` | Sandbox billing ledger |
| `toolInvocations` | Tool call audit log |
| `projects` / `skills` / `automations` / `automationRuns` | User entities |
| `mcpServers` | MCP server configs |
| `conversations` / `messages` | Chat data |
| `files` / `notes` / `knowledgeEntries` / `knowledgeChunks` | Content |
| `memories` | Extracted user memories |
| `outputs` | Generated media |

### 10.2 Convex Function Modules

| Module | Key File | Size |
|---|---|---|
| Chat | `chat/conversations.ts` | 53K |
| Files | `files/files.ts` | 38K |
| Knowledge | `knowledge/knowledge.ts` | 25K |
| Billing | `billing/subscriptions.ts` | 30K |
| Platform | `platform/usage.ts` | 33K |
| Platform | `platform/http.ts` | 9.5K |
| Auth | `auth/users.ts` | 20K |
| Automations | `automations/automations.ts` | — |

---

## 11. Workspace Packages (`packages/`)

### Core
| Package | Purpose |
|---|---|
| `@overlay/app-core` | App config, contracts, extensions, capabilities, modules, theme |
| `@overlay/auth-contracts` | Auth type contracts |
| `@overlay/storage-contracts` | Storage interface contracts |
| `@overlay/llm-gateway` | LLM gateway + adapters (Anthropic, Groq), model definitions |
| `@overlay/billing` | Billing contracts and pricing |

### Chat
| Package | Purpose |
|---|---|
| `@overlay/chat-core` | Chat types, messages, turns, generated UI, tool labels, markdown |
| `@overlay/chat-react` | 45+ React chat components, context, lib, styles |

### Tools & Agents
| Package | Purpose |
|---|---|
| `@overlay/tools-core` | Tool definitions, buckets, exposure policy, MCP schema conversion |
| `@overlay/agent-runtime` | Agent runtime (context builder, tool registry, turn persistence) |

### UI & Modules
| Package | Purpose |
|---|---|
| `@overlay/ui` | Design tokens, primitives, 20+ components, hooks |
| `@overlay/modules-react` | Feature module components (automations, knowledge, notes, projects, settings) |

### Client & Extensions
| Package | Purpose |
|---|---|
| `@overlay/api-client` | Typed API client (per-resource modules) |
| `@overlay/extension-sdk` | Extension SDK (config extension, component registry) |

---

## 12. Cloudflare Worker — Chat Stream Relay

```
workers/chat-stream/
├── src/index.ts        # ChatStreamDurableObject (30K LOC)
└── wrangler.jsonc      # Routes: www.getoverlay.io/api/chat-stream/*
```

- Durable Object (SQLite-backed) for per-stream state
- SSE streaming relay between Next.js BFF and browser
- Dev: Next.js rewrites `/api/chat-stream/*` to `http://127.0.0.1:8787`
- `nodejs_compat` flag enabled

---

## 13. Middleware & Security

### CSP
- Dynamically built from env vars (Convex URLs, R2 origins, PostHog, Sentry)
- Report-only in dev, enforcing in production
- WebSocket origins for Convex real-time

### Route Protection
- **Protected**: `/account`, `/api/entitlements`, `/api/convex`
- **Public**: `/`, `/auth`, `/api/auth`, `/api/security`, `/api/webhooks`
- API routes: bearer token auth (HMAC + replay protection)
- Browser routes: redirect to `/auth/sign-in`

### Security Headers (in `next.config.ts`)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Strict-Transport-Security` (production)
- HTML: `no-cache` (prevents stale CSS bundle mismatches)

---

## 14. Configuration System

### App Config (`src/overlay.config.ts`)
Static config using `@overlay/app-core`: brand, navigation, settings, feature flags, tools, integrations, model providers, policy gates, theme.

### Runtime Config
Determines active providers: `auth.provider`, `billing.provider`, `storage.provider`, `llm.gatewayProvider`, `capabilities.vectorSearch`, `app.deploymentEnvironment`.

### Extension System
`src/extensions/` — registry for custom feature modules, settings panels, navigation items, tools, integrations, and model providers.

---

## 15. Data Flow

### Chat (Ask Mode)
```
Browser → /api/v1/conversations → BFF validation → LLM Gateway
  → Stream via CF Worker (SSE) → Browser renders → Convex persists
```

### Chat (Act/Agent Mode)
```
Browser → /api/v1/conversations/act → System prompt → Tool registry
  → Agent turn (LLM + tool calls) → Execute tools → Stream results
  → Persist messages + tool invocations → Deduct credits
```

### File Upload
```
Browser → /api/v1/files (intent) → R2 presigned URL → Direct upload
  → Convex files table → Optional: knowledge indexing
```

### Billing
```
Stripe Webhook → /api/webhooks/stripe → Dedup check
  → Convex billing sync → Update tier/credits/period
```

---

## 16. Observability

| System | Purpose |
|---|---|
| Sentry | Error tracking + performance (server + client) |
| PostHog | Product analytics + session replay |
| Cloudflare Insights | Core Web Vitals |
| Vercel Analytics | Page views + speed insights |

---

## 17. Build & Quality Tooling

| Tool | Command |
|---|---|
| Bundle Analyzer | `npm run analyze` |
| ESLint (boundary rules) | `npm run lint` |
| TypeScript | `npm run typecheck` |
| Shared isomorphic check | `npm run check:shared-isomorphic` |
| Module boundaries | `npm run check:module-boundaries` |
| Web complexity | `npm run check:web-complexity` |
| Vendor boundaries | `npm run check:vendor-boundaries` |
| Domain service boundaries | `npm run check:domain-service-boundaries` |
| Tenant boundaries | `npm run check:tenant-boundaries` |
| Config validation | `npm run check:config` |
| Security audit | `npm run security:audit` |

---

## 18. Self-Hosting Support

- **Config examples**: `docs/config/` and `fixtures/config/` (onprem-minimal, onprem-s3-oidc-openai, saas-staging)
- **Provider swapping**: Auth, billing, storage, LLM all swappable
- **Enterprise customization**: `examples/enterprise-customization/`
- **Customer deployment**: `examples/customer-deployment/` (Docker Compose, Helm)
- **Documentation**: `docs/` (Mintlify) covers self-hosting, config, security

---

## 19. Key File Sizes

| File | Size | Notes |
|---|---|---|
| `src/features/chat/components/ChatExperience.tsx` | 163 KB | Main chat UI |
| `convex/chat/conversations.ts` | 53 KB | Conversation CRUD |
| `convex/platform/usage.ts` | 33 KB | Usage tracking |
| `convex/schema.ts` | 35 KB | DB schema (30+ tables) |
| `workers/chat-stream/src/index.ts` | 30 KB | Stream relay |
| `convex/billing/subscriptions.ts` | 30 KB | Subscription sync |
| `convex/files/files.ts` | 38 KB | File management |
| `src/components/layout/AppSidebar.tsx` | 34 KB | Main sidebar |
| `src/server/auth/workos-auth.ts` | 27 KB | WorkOS auth |
| `convex/knowledge/knowledge.ts` | 25 KB | Knowledge indexing |

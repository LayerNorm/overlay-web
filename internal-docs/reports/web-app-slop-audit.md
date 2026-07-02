# Web App Slop & Code-Quality Audit

A deep dive into the **web app only** (`src/` and `packages/`). Desktop, mobile, and
Chrome-extension folders were explicitly excluded.

All numbers below were measured directly against the working tree on `main`
(`a37ead201`). Where they differ from rough estimates, the measured value is used.

---

## TL;DR

The codebase is **better than typical** on the metrics that usually scream "slop":
near-zero `TODO/FIXME` (1), few `any` annotations (9), no exact-duplicate file groups, and a
clean architecture with **enforced** layer boundaries, an isomorphic-shared checker, and a
complexity budget tracked in CI tooling (`scripts/report-web-complexity.mjs`). The team is
already running phased cleanup (`docs/reports/web-dead-code-audit.md`,
`web-complexity-phase1-audit.md`).

The real slop is concentrated in a handful of high-leverage places:

| # | Theme | Severity | Headline metric |
|---|-------|----------|-----------------|
| 1 | **`ChatExperience.tsx` god component** | 🔴 Critical | 4,193 lines, 35 `useState` + 36 `useEffect` + 32 `useCallback` + 28 `useRef` in one component |
| 2 | **Swallowed errors** | 🟠 High | 201 empty `} catch {` blocks + 49 `.catch(() => {})` in `src/server` |
| 3 | **Unvalidated request bodies** | 🟠 High | Only **4 of 44** `app-api` route handlers use zod |
| 4 | **Ad-hoc `console.*` logging** | 🟡 Medium | 274 raw `console.*` calls, no logger abstraction; some log userIds + billing data |
| 5 | **Prop-drilling mega-interfaces** | 🟡 Medium | `ChatComposer` 57 props, `ChatMessageList` ~46 props |
| 6 | **Inconsistent import path** | 🟡 Medium | `getInternalApiSecret` imported via 3 different paths (45 vs 12 vs 1) |
| 7 | **Dead / stale references** | 🟢 Low | 2 broken npm scripts, 1 unused re-export file |

What is **NOT** slop (verified, no action needed): the triplicated markdown helpers
(`shim-incomplete-markdown.ts`, `markdown-table-fix.ts`, `agent-assistant-text.ts`) are a
clean single-owner + thin re-export pattern, not copy-paste. Cross-feature import violations
(~38) are already documented and `warn`-gated in `scripts/eslint-boundary-rules.mjs`.

---

## 1. `ChatExperience.tsx` — the god component 🔴 Critical

**File:** `src/features/chat/components/ChatExperience.tsx` — **4,193 lines / 177 KB**

A single client component conflates almost every chat concern. Measured hook density:

| Hook | Count |
|------|-------|
| `useState` | 35 |
| `useEffect` | 36 |
| `useCallback` | 32 |
| `useRef` | 28 |
| top-level `import` | 53 |

It is recognized as the worst offender by the repo's own tooling — it's in both the
`largeProductionFiles` allowlist and `complexFunctionCounts` of
`docs/reports/web-app-complexity-baseline.json`, and is one of the documented legacy
boundary-debt files.

### What's conflated in one file
- **State**: chat list, active/temporary chat, per-exchange modes & models, generation
  results map, billing block flags, composer input, attachments, reply context, edit state.
- **Data fetching**: chat list load, subscription load, conversation snapshot reconstruction.
- **Business logic**: model selection, ask/act mode, media-generation routing, title
  generation, budget gating, message→output reconstruction.
- **Transport/streaming**: Cloudflare resume, text streams, media batches, error reporting.
- **Rendering + events**: header, model picker, composer, panels, modals, keyboard
  shortcuts, drag-and-drop, PostHog analytics.

### Concrete slop inside it
- **Confusing naming.** The 4,193-line implementation is `ChatExperience.tsx`, while the
  exported component *inside* it is named `ChatInterface`, and there is a separate 37-line
  `ChatInterface.tsx` that is just a `<Suspense>` wrapper. Three names for one concept.
  <ref_file file="/Users/divyanshlalwani/Downloads/overlay-mono/overlay-landing/src/features/chat/components/ChatInterface.tsx" />
- **Repeated `localStorage` try/catch** (e.g. `try { localStorage.setItem(...) } catch {}`)
  inlined 4+ times instead of one `safeSetLocalStorage(key, value)` helper.
- **Repeated model-selection toggle logic** (single vs. multi select) duplicated for image,
  video, and ask models — three near-identical blocks that should be one
  `toggleModelSelection(current, id, mode)`.
- **`as any` casts** to fight the AI-SDK message types (`runtime.askChats[0].messages =
  linear as any`), each with its own `eslint-disable @typescript-eslint/no-explicit-any`.
- **`react-hooks/exhaustive-deps` disabled** in several effects — a smell that the effects own
  too much and should be hooks.

### Mitigation
Incrementally extract (the repo already has the right home: `src/features/chat/components/chat/`
already holds `useChatRuntimes`, `useChatBillingControls`, `useComposerTextState`, etc.):
1. `useChatListState()`, `useModelSelection()`, `useGenerationState()` hooks for the 35 state vars.
2. Move message↔output reconstruction into `chat-interface/chatLogic.ts` (its natural home).
3. Extract `ChatHeader`, `ModelPicker`, `GenerationModeMenu` presentational components.
4. Add `safeSetLocalStorage` + `toggleModelSelection` helpers to kill the copy-paste.
5. **Rename for clarity:** the wrapper `ChatInterface.tsx` → `ChatSuspenseBoundary.tsx`; the
   big file's exported component should match its filename.

Target: bring the file under the repo's own `maxProductionFileLoc: 500` budget over several
PRs. Treat the complexity baseline as a ratchet (only allow it to go down).

---

## 2. Swallowed errors 🟠 High

Errors are silently discarded across the server, which destroys observability.

- **201** empty `} catch {` blocks in `src` (excluding tests).
- **49** `.catch(() => {})` / `.catch(() => null/undefined)` in `src/server` alone.

Examples:
```ts
// src/server/app-api/v1/generate-image/route.ts
await deleteObject(uploadedR2Key).catch(() => {})      // R2 cleanup failure vanishes
// src/server/app-api/v1/generate-title/route.ts        (3 instances)
}).catch(() => {})
// src/server/app-api/v1/projects/route.ts
} catch {
  return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
}
```
The `projects` route pattern (catch with no logging, generic 500) is copy-pasted across
GET/POST/PATCH/DELETE — a debugging dead-end in production.

### Mitigation
- Replace `.catch(() => {})` with `.catch((err) => logger.warn('context', err))`. Reserve
  intentional ignores for an explicit `.catch(() => null /* expected: ... */)`.
- Add a shared `handleRouteError(error, context)` helper and use it in every route's catch.
- Add an ESLint rule (`no-empty` is already partly this) to flag empty/argument-less catches
  in `src/server/**`.

---

## 3. Unvalidated request bodies 🟠 High

Only **4 of 44** `src/server/app-api/**/route.ts` handlers import `zod`. Most handlers trust
`await request.json()` and either destructure an inline type or `as`-cast it:

```ts
// src/server/app-api/v1/conversations/act/route.ts  (~20 fields, no validation)
}: { messages: UIMessage[]; systemPrompt?: string; conversationId?: string; /* … */ }
  = await request.json()

// src/server/app-api/v1/projects/route.ts
const body = await request.json() as { name?: string; parentId?: string | null }
projectId: projectId as Id<'projects'>     // string → branded Id with no check
```

This means malformed input becomes a 500 (or worse, a silent bad write) instead of a clean
400, and the inline types drift from reality.

### Mitigation
- Define a zod schema per route body; `safeParse` and return 400 on failure. Start with the
  highest-traffic / highest-risk routes: `conversations/act`, `generate-image`,
  `generate-video`, `projects`.
- Replace `as Id<'projects'>` casts with validated id helpers.
- This pairs naturally with #2 (one validation+error helper covers both).

---

## 4. Ad-hoc `console.*` logging 🟡 Medium

**274** raw `console.*` calls in non-test `src`. There is no logger abstraction, so log level,
formatting, and redaction are all inconsistent. Top offenders:

| File | count |
|------|-------|
| `src/server/tools/mcp-tools.ts` | 17 |
| `src/server/app-api/v1/generate-image/route.ts` | 16 |
| `src/server/app-api/v1/conversations/act/route.ts` | 13 |
| `src/server/auth/service-auth.ts` | 12 |
| `src/server/app-api/v1/generate-video/route.ts` | 12 |
| `src/server/ai/gateway/gateway-search-tools.ts` | 12 |

Formatting is inconsistent (`[GenerateImage] 📊 …` with emoji vs. `[service-auth] …` plain),
and some logs include **userIds and billing/budget figures** in plaintext, e.g.:
```ts
console.log(`[GenerateImage] 📊 Entitlements: tier=… used=${budget.usedCents}¢ … userId=${auth.userId}`)
```
Note: a safe-logging utility already exists (`src/shared/security/safe-url.ts` /
`src/server`'s redaction helpers) but isn't used consistently.

### Mitigation
- Introduce `src/server/observability/logger.ts` (level-aware, structured, redacting) and
  migrate `console.*` to it. Reuse existing redaction helpers.
- Add an ESLint `no-console` rule for `src/server/**` (allow only the logger).
- Drop the leftover debug `console.info/warn` in `ChatExperience.tsx` and
  `chat/chatTextTransport.ts`.

---

## 5. Prop-drilling mega-interfaces 🟡 Medium

The chat components push enormous prop bags down the tree instead of using context:

- `ChatComposer` — **57** props (`src/features/chat/components/ChatComposer.tsx`), many of
  them raw state setters (`setAttachedImages`, `setReplyContext`, `setTopUpAmountDraftCents`…).
- `ChatMessageList` — ~46 props, most just forwarded to `ChatMessage`.

Setter-as-prop plus deep forwarding makes these components hard to test and re-render-heavy.

### Mitigation
- Group cohesive prop clusters into objects (`attachmentState`, `billingState`,
  `modelSelectionState`) and/or expose them via a `ChatContext` provider so intermediate
  components stop forwarding props they don't use.
- Prefer `onXChange` callbacks over passing setters directly.

---

## 6. Inconsistent `getInternalApiSecret` import path 🟡 Medium

The same helper is imported three different ways:

| Import path | usages |
|-------------|--------|
| `@/server/tools/internal-api-secret` (re-export) | 45 |
| `@/server/shared/internal-api-secret` (canonical) | 12 |
| `./internal-api-secret` (local) | 1 |

The majority route through a `tools/` re-export of a `shared/` module — pure indirection that
makes future refactors noisy.

### Mitigation
- Pick `@/server/shared/internal-api-secret` as canonical, codemod the 45+1 other imports,
  delete the `tools/` re-export, and (optionally) add a `no-restricted-imports` rule.

---

## 7. Dead / stale references 🟢 Low (quick wins)

1. **Two broken npm scripts** point at the deleted `src/lib/` tree (`AGENTS.md` confirms
   `src/lib/` is gone). Running them fails immediately:
   ```jsonc
   // package.json
   "test:automations":      "node … src/lib/automations.test.ts",       // file gone
   "test:file-text-search": "node … src/lib/file-text-search.test.ts",   // file gone
   ```
   The tests *do* still exist, just elsewhere:
   - `packages/overlay-app-core/src/automations.test.ts`
   - `src/shared/storage/file-text-search.test.ts`
   **Fix:** repoint the scripts (and prefer `tsx --test` to match the rest of the file).

2. **Unused re-export file:** `src/features/chat/components/GenerationModeToggle.tsx` re-exports
   from `@overlay/ui/chat` but nothing imports it (verified via grep). **Fix:** delete it.

3. The dead-code/complexity audits in `docs/reports/` should be regenerated periodically
   (`npm run report:web-complexity`) so the baseline keeps ratcheting down.

---

## Things that look like slop but aren't (verified)

- **Triplicated markdown/text helpers** — `shim-incomplete-markdown.ts`,
  `markdown-table-fix.ts`, `agent-assistant-text.ts`, `tool-labels.ts` each appear ~3×, but
  the implementation lives once in `@overlay/chat-core` and the others are 2-line
  `export * from '@overlay/chat-core/…'` facades. **Good pattern, keep.**
- **`shell.tsx` ×3 / `GenerationModeToggle.tsx` ×3** — distinct domain wrappers / canonical +
  extension + re-export, not duplication.
- **Cross-feature imports (~38)** — already tracked in
  `LEGACY_FEATURE_BOUNDARY_DEBT_FILES_BY_DOMAIN` and gated as `warn`, not silent.
- **Boundary hygiene** — `src/shared/**` is verified isomorphic (no `@/server` / `@/features`
  imports); Convex handlers don't import `@/server`; no circular barrels found.

---

## Mitigation plan (prioritized)

### Phase 0 — quick wins (< 1 hour, do now)
- Repoint the 2 broken `test:*` scripts in `package.json`.
- Delete unused `src/features/chat/components/GenerationModeToggle.tsx`.
- Consolidate `getInternalApiSecret` to the canonical path + remove the `tools/` re-export.

### Phase 1 — stop the bleeding (guardrails, ~1 day)
- Add `no-console` (server), no-empty-catch, and `no-restricted-imports` ESLint rules so new
  slop can't land.
- Add a shared `handleRouteError()` + a `logger` and wire the noisiest routes through them.
- Regenerate and commit the complexity baseline; make `check:web-complexity` a ratchet in CI.

### Phase 2 — high-value refactors (iterative, multiple PRs)
- Decompose `ChatExperience.tsx` into hooks + presentational components; pull reconstruction
  logic into `chatLogic.ts`; add `safeSetLocalStorage` / `toggleModelSelection`. Rename the
  `ChatInterface`/`ChatExperience` pair for clarity.
- Introduce per-route zod validation, starting with `conversations/act`, `generate-image`,
  `generate-video`, `projects`.
- Shrink `ChatComposer` / `ChatMessageList` prop bags via grouped props or a `ChatContext`.

### Phase 3 — sustain
- Keep migrating the documented boundary-debt files; only let the complexity/LOC baselines
  decrease; re-run `report:web-complexity` each release and update `docs/reports/`.

---

## Verification checklist (after fixes)
- [ ] `npm run check:web-complexity` baseline strictly ≤ previous.
- [ ] `npm run test:automations` and `npm run test:file-text-search` both run.
- [ ] No `console.*` outside the logger in `src/server/**`.
- [ ] No empty/argument-less `catch` in `src/server/**`.
- [ ] Target routes return 400 (not 500) on malformed bodies.
- [ ] Single import path for `getInternalApiSecret`.
- [ ] `ChatExperience.tsx` trending toward < 500 LOC / under the function-complexity budget.

# AI SDK v6 → v7 Migration Plan

> **Status:** Planning phase — not yet started.
> **Last updated:** 2026-01-27
> **Migration guide:** https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0
> **Blog post:** https://vercel.com/blog/ai-sdk-7

## Why migrate

AI SDK 7 standardizes reasoning control (`reasoning: 'high'`), adds tool context (`contextSchema` / `toolsContext`), runtime context for `prepareStep`, durable `WorkflowAgent`, tool approvals with HMAC signing, provider file/skill uploads, MCP Apps, and a terminal UI. Several v6 APIs we use are deprecated aliases in v7 and will be removed in v8 — migrating now keeps us ahead of the curve and unlocks the new `reasoning` option for the act agent.

## Current state

| Package | Version |
|---------|---------|
| `ai` | `^6.0.116` |
| `@ai-sdk/react` | `^3.0.118` |
| `@ai-sdk/openai` | `^3.0.41` |
| `@ai-sdk/anthropic` | `^3.0.58` |
| `@ai-sdk/google` | `^3.0.43` |
| `@ai-sdk/groq` | `^3.0.29` |
| `@ai-sdk/xai` | `^3.0.67` |
| Node.js | `>=22.0.0` (meets v7 requirement) |
| ESM | TypeScript/Next.js bundler handles ESM — no `"type": "module"` needed |

### Centralized re-exports (chokepoints)

- **Server:** `src/server/ai/sdk.ts` — re-exports `generateText`, `generateObject`, `stepCountIs`, `ToolLoopAgent`, `tool`, `convertToModelMessages`, `experimental_generateVideo`, `generateImage`, and types `StreamTextTransform`, `TextStreamPart`, `ToolSet`, `UIMessage`.
- **Client:** `src/components/providers/ai-chat-client.ts` — re-exports `Chat`, `useChat`, `UseChatHelpers` from `@ai-sdk/react`.
- **Shared:** `src/shared/chat/ai-ui-message.ts` — re-exports `isReasoningUIPart`, `isToolUIPart`, `getToolName`, `UIMessage`.

### Direct `from 'ai'` imports (not through chokepoint)

These files import directly from `'ai'` and must be updated alongside the chokepoint:

| File | What it imports |
|------|----------------|
| `src/server/agents/workspace-agent-invocation.ts` | `streamText` |
| `src/server/ai/gateway/openrouter-service.ts` | `createUIMessageStream`, `createUIMessageStreamResponse`, `generateId`, `UIMessage` |
| `src/server/ai/gateway/gateway-search-tools.ts` | `createGateway`, `generateText`, `stepCountIs`, `tool`, `ToolSet` |
| `src/server/ai/gateway/gateway-runtime.ts` | `createGateway` |
| `src/server/agent/run-act-turn.ts` | `UIMessage` (type only) |
| `src/server/tools/tools/build.ts` | `tool`, `ToolSet` |
| `src/server/tools/mcp-tools.ts` | `tool`, `ToolSet` |
| `src/server/tools/free-tier-gated-stub-tools.ts` | `tool`, `ToolSet` |
| `src/server/tools/composio-tools.ts` | `ToolSet` (type only) |
| `src/server/integrations/ComposioIntegrationProvider.ts` | `ToolSet` (type only) |
| `src/server/integrations/ExecutorIntegrationProvider.ts` | `tool`, `ToolSet` |
| `src/server/integrations/runtime.ts` | `ToolSet` (type only) |
| `src/server/integrations/contracts.ts` | `ToolSet` (type only) |
| `src/server/web/web-tools.ts` | `ToolSet` (type only) |
| `src/server/tools/tools/composio-filter.ts` | `ToolSet` (type only) |
| `src/server/ai/gateway/tool-schema-compat.ts` | `asSchema`, `ToolSet` |
| `src/shared/chat/cloudflare-chat-transport.ts` | `DefaultChatTransport`, `ChatTransport`, `HttpChatTransportInitOptions`, `UIMessage`, `UIMessageChunk` |
| `src/shared/chat/persist-assistant-turn.ts` | `StepResult`, `ToolSet` |
| `src/shared/chat/leaked-perplexity-tool-repair.ts` | `StepResult`, `ToolSet` |
| `src/shared/chat/sanitize-ui-messages-for-model.ts` | `UIMessage` (type only) |
| `src/shared/chat/reply-context-for-model.ts` | `UIMessage` (type only) |
| `src/server/conversations/ActMessagePersistenceService.ts` | `StepResult`, `ToolSet` |
| `src/server/chat/context-compaction.ts` | `UIMessage` (type only) |
| `src/server/chat/context-compaction.test.ts` | `UIMessage` (type only) |

## Breaking changes that affect us

### High risk (behavioral changes, not just renames)

| # | Change | Files affected | Risk |
|---|--------|---------------|------|
| H1 | **`system` messages in `messages` rejected by default.** AI SDK 7 rejects `{ role: 'system' }` in `messages`/`prompt` unless `allowSystemInMessages: true` is set. | `src/server/chat/context-compaction.ts` — `summarySystemMessage()` creates `{ role: 'system', ... }` UIMessages that are passed into the act agent's `messages`. | **Critical.** Context compaction will break silently — the summary message will be rejected, losing conversation history context. |
| H2 | **`onFinish`/`onEnd` event shape changes.** `event.usage` now includes all steps (was final-step-only). `event.totalUsage` is deprecated. `event.toolCalls`, `event.toolResults`, `event.content`, `event.files`, `event.sources`, `event.warnings` now accumulate across all steps. `event.reasoning`, `event.reasoningText`, `event.request`, `event.response`, `event.providerMetadata` are deprecated — use `event.finalStep.*`. | `src/server/app-api/v1/conversations/act/route.ts` (`onFinish` reads `event.totalUsage`), `src/server/conversations/ActMessagePersistenceService.ts` (reads `args.event.totalUsage`), `src/server/app-api/v1/notebook-agent/route.ts` (reads `result.totalUsage`), `src/server/ai/gateway/gateway-search-tools.ts` (reads `params.result.totalUsage`). | **High.** Token usage billing could double-count or misattribute if we don't switch `totalUsage` → `usage` correctly. |
| H3 | **`step.response.messages` no longer accumulated.** Each step's `response.messages` only contains that step's messages. | `src/shared/chat/persist-assistant-turn.ts` — iterates `steps` and reads `step.text`, `step.toolCalls`, `step.toolResults`, `step.reasoningText`, `step.reasoning`. These are per-step properties and should be fine, but any code reading `step.response.messages` expecting accumulation will break. | **Medium.** Need to audit `persist-assistant-turn.ts` and `ActMessagePersistenceService.ts` for `step.response.messages` usage. |
| H4 | **`prepareStep` instructions carry forward.** Instructions returned from `prepareStep` persist across steps until overridden. In v6 they were per-step only. | Not currently using `prepareStep` — the act agent uses top-level `instructions` only. | **Low.** No impact now, but important if we adopt `prepareStep` later. |
| H5 | **`onChunk` receives all stream parts.** In v7, `onChunk` fires for every `TextStreamPart` including lifecycle/boundary/terminal parts, not just the v6 subset. | Not currently using `onChunk` in any route. | **None.** |
| H6 | **Request/response bodies excluded by default.** `result.request.body` and `result.response.body` are no longer included unless `include: { requestBody: true, responseBody: true }` is set. | No code reads `result.request.body` or `result.response.body` (verified by grep). | **None.** |
| H7 | **MCP transport `redirect` default changed from `'follow'` to `'error'`.** | **Non-issue.** We use `@modelcontextprotocol/sdk` directly (`SSEClientTransport` / `StreamableHTTPClientTransport`), not `createMCPClient` from `ai`. The v7 redirect change only applies to `createMCPClient`. We also have `validatePublicNetworkUrl()` SSRF validation. | **None.** |
| H8 | **xAI default model now uses Responses API.** `xai(modelId)` uses Responses API by default instead of Chat Completions. | We use `createGateway()` from `ai`, not `xai(modelId)` directly. `@ai-sdk/xai` is in `package.json` but not imported in `src/`. | **Low.** Gateway handles routing. Upgrade `@ai-sdk/xai` to v4 and test on staging. |

### Medium risk (renames with deprecated aliases — won't break immediately)

| # | Change | Files affected | Migration |
|---|--------|---------------|-----------|
| M1 | `system:` → `instructions:` | `generate-title/route.ts`, `generate-tab-group-label/route.ts`, `media-tool-intent.ts`, `MemoryExtractionProvider.ts` | `system` still works as deprecated alias. Rename for forward-compat. |
| M2 | `onFinish` → `onEnd` | `act/route.ts` (line 658), `notebook-agent/route.ts` (via `onStepFinish`) | `onFinish` still works as deprecated alias. |
| M3 | `onStepFinish` → `onStepEnd` | `notebook-agent/route.ts` (line 356) | `onStepFinish` still works as deprecated alias. |
| M4 | `stepCountIs` → `isStepCount` | `act/route.ts`, `notebook-agent/route.ts`, `gateway-search-tools.ts` | `stepCountIs` removed entirely in v7 — **must** rename. |
| M5 | `experimental_onToolCallStart` → `onToolExecutionStart` | `act/route.ts` (line 598) | Old name works as deprecated alias. |
| M6 | `experimental_onToolCallFinish` → `onToolExecutionEnd` | `act/route.ts` (line 612) | Old name works as deprecated alias. |
| M7 | `fullStream` → `stream` | Not used directly in our code | No change needed. |
| M8 | `toUIMessageStreamResponse` deprecated → use `toUIMessageStream` + `createUIMessageStreamResponse` | `act/route.ts` (line 718) | Method still works, deprecated. Migrate to stateless helpers. |
| M9 | `needsApproval` on `tool()` deprecated → `toolApproval` on call/agent | `mcp-tools.ts` (lines 406, 603) | `needsApproval` still works as deprecated alias. Migrate to `toolApproval`. |
| M10 | `experimental_telemetry` → `telemetry` | Not used | No change needed. |
| M11 | `experimental_include` → `include` | Not used | No change needed. |
| M12 | `includeRawChunks` → `include.rawChunks` | Not used | No change needed. |
| M13 | `experimental_throttle` → `throttle` (stable in v7) | `useChatRuntimes.ts` (5 call sites) | **Must rename** — codemod may not cover `@ai-sdk/react` options. Done in Phase 1. |

### Low risk (removed without alias — must fix)

| # | Change | Files affected | Migration |
|---|--------|---------------|-----------|
| L1 | `experimental_customProvider` → `customProvider` | Not used (we use `createGateway`) | No change needed. |
| L2 | `experimental_generateImage` → `generateImage` | Already using `generateImage` | No change needed. |
| L3 | `experimental_output` → `output` | Not used | No change needed. |
| L4 | `experimental_prepareStep` → `prepareStep` | Not used | No change needed. |
| L5 | `experimental_activeTools` → `activeTools` | Not used | No change needed. |
| L6 | `ToolCallOptions` → `ToolExecutionOptions` | Not used | No change needed. |
| L7 | `isToolOrDynamicToolUIPart` → `isToolUIPart` | Already using `isToolUIPart` | No change needed. |
| L8 | `cachedInputTokens` / `reasoningTokens` removed from `LanguageModelUsage` | `notebook-agent/route.ts` reads `totalUsage?.inputTokenDetails?.cacheReadTokens` — already using new shape | No change needed. |

### Unknowns — resolved

| # | Question | Answer | Impact |
|---|----------|--------|--------|
| U1 | Is `experimental_generateVideo` still experimental in v7? | **Yes** — v7 docs still use `experimental_generateVideo`. | No rename needed. `src/server/ai/sdk.ts` and `generate-video/route.ts` stay as-is. |
| U2 | Is `experimental_transform` on `agent.stream()` still experimental in v7? | **Yes** — v7 docs and source still use `experimental_transform`. | No rename needed. `act/route.ts` and `chat-stream-persistence.ts` stay as-is. |
| U3 | Is `experimental_throttle` on `useChat` still experimental in v7? | **No** — renamed to stable `throttle` in v7. | **Must rename** `experimental_throttle` → `throttle` in `useChatRuntimes.ts` (5 call sites). |
| U4 | Do we use `xai(modelId)` or `xai.chat(modelId)`? | **Neither directly.** Models are created via `createGateway()` from `ai`, not via `@ai-sdk/xai` directly. The `@ai-sdk/xai` package is in `package.json` but not imported in `src/`. | H8 risk lowered — the gateway handles provider routing. xAI default API change only affects direct `xai(modelId)` usage, which we don't have. |
| U5 | Do any MCP servers we connect to issue HTTP redirects? | **To verify during Phase 2.** | Check MCP server configs at runtime. |

## Security considerations

### 1. System messages in `messages` (H1) — prompt injection risk

AI SDK 7 rejects `{ role: 'system' }` in `messages` by default. This is a **security improvement**: if users could inject system messages, they could override the system prompt. Our `context-compaction.ts` creates system messages server-side from trusted conversation summaries — this is safe, but we must explicitly opt in with `allowSystemInMessages: true` on calls that receive compacted messages.

**Decision required:** Do we:
- (a) Set `allowSystemInMessages: true` on the act route (quick, preserves current behavior), or
- (b) Refactor `summarySystemMessage()` to use a `user` role with a clear prefix (e.g., `[Context Summary]: ...`) and pass via `messages` (more aligned with v7's security model)?

**Recommendation:** (a) for the initial migration — the summary is server-generated from trusted conversation history, not user input. Add a comment explaining why. Consider (b) as a follow-up improvement.

### 2. MCP redirect default (H7) — SSRF protection

The new `redirect: 'error'` default prevents MCP servers from redirecting to unintended hosts (SSRF). This is more secure. If any MCP server relies on redirects, we must explicitly set `redirect: 'follow'` — but only for trusted servers.

**Action:** Audit MCP server URLs. If none redirect, no change needed (we get the security improvement for free).

### 3. Tool approvals with HMAC signing (new feature)

v7 adds opt-in HMAC-signed tool approvals to prevent forged approvals. Our `needsApproval` on MCP tools is currently a simple boolean/function. After migrating to `toolApproval`, we should evaluate adopting HMAC signing for high-risk MCP tools.

### 4. Reasoning configuration (new feature)

The new top-level `reasoning` option standardizes reasoning effort across providers. If we adopt it, we must **remove overlapping reasoning settings from `providerOptions`** — if both are present, `providerOptions` takes precedence and can silently bypass the top-level setting.

**Action:** Audit `providerOptions` for any reasoning-related settings before adopting `reasoning`.

### 5. Telemetry enabled by default when registered

v7 makes telemetry opt-out (enabled by default once an integration is registered). We currently don't use `experimental_telemetry` at all. If we register `@ai-sdk/otel` in the future, all AI SDK calls will emit telemetry automatically. No risk now, but be aware when adopting.

## Phased migration plan

### Phase 0: Pre-flight (no code changes) — COMPLETE

**Goal:** Verify remaining unknowns and create a safety net.

- [x] **0.1** Audit MCP server URLs for redirect behavior (U5)
  - **Finding:** We do NOT use `createMCPClient` from `ai`. MCP transports are created directly via `@modelcontextprotocol/sdk` (`SSEClientTransport` / `StreamableHTTPClientTransport`) in `src/server/tools/mcp-tools.ts`. The v7 `redirect: 'error'` default only applies to `createMCPClient` from the `ai` package — **H7 is a non-issue.**
  - Additional SSRF protection already in place: `validatePublicNetworkUrl()` validates every MCP server URL before connecting (requires HTTPS, blocks local dev unless explicitly allowed).

- [x] **0.2** Create feature branch: `codex/ai-sdk-v7` (from `codex/workspace`)

- [x] **0.3** Snapshot baseline: `npm run typecheck` and `npm run build` both pass green on `codex/workspace` before any changes.
  - Typecheck: all boundary checks + `tsc --noEmit` passed (exit 0)
  - Build: `next build` compiled successfully, 167 routes generated (exit 0)

- [x] **0.4** Document current token billing code paths (baseline for post-migration comparison):
  - **4 billing sites read `totalUsage`:**
    1. `src/server/app-api/v1/conversations/act/route.ts:659` — `event.totalUsage.{inputTokens,outputTokens}` → `actUsageBudgetService.recordFinishedUsage()`
    2. `src/server/app-api/v1/notebook-agent/route.ts:372` — `result.totalUsage.{inputTokens,outputTokens,inputTokenDetails.cacheReadTokens}` → `calculateLanguageModelTokenCostOrNull()`
    3. `src/server/ai/gateway/gateway-search-tools.ts:338` — `params.result.totalUsage.{inputTokens,outputTokens,inputTokenDetails.cacheReadTokens}` → `calculateLanguageModelTokenCostOrNull()`
    4. `src/server/conversations/ActMessagePersistenceService.ts:163` — `args.event.totalUsage.{inputTokens,outputTokens}` → persistence
  - **2 test fixtures use `totalUsage`:**
    1. `src/server/conversations/ActConversationService.test.ts:505`
    2. `src/server/conversations/chat-stream-persistence.test.ts:20`
  - **v7 mapping:** `totalUsage` → `usage` (v7 `usage` now includes all steps = same semantics as v6 `totalUsage`). All 6 sites must be migrated together in Phase 2.
  - **Staging QA verification:** Send a test conversation on staging (v6) and record token counts from logs. After migration, send the same conversation and compare. The `logger.info('[conversations/act] stream finish', ...)` log at line 677 includes `inputTokens` and `outputTokens` — use this as the comparison point.

### Phase 1: Dependency upgrade + codemod (no manual edits)

**Goal:** Get to v7 with automated transformations. Build must pass.

- [ ] **1.1** Upgrade packages and remove dead deps:
  ```bash
  # Remove dead deps (not imported anywhere in src/ or packages/):
  npm uninstall @ai-sdk/google @ai-sdk/xai
  # Upgrade to v7:
  npm install ai@^7 @ai-sdk/react@^4 @ai-sdk/openai@^4 @ai-sdk/anthropic@^4 @ai-sdk/groq@^4
  ```
  **Note:** `@ai-sdk/google` and `@ai-sdk/xai` are in `package.json` but not imported anywhere in `src/` or `packages/overlay-llm-gateway/` — they're dead dependencies. Google and xAI models are accessed through the AI Gateway (`createGateway()`). The `@overlay/llm-gateway` package has its own `package.json` with `@ai-sdk/anthropic`, `@ai-sdk/openai`, and `@ai-sdk/groq` — those must also be upgraded to v4 in the workspace package.
- [ ] **1.2** Run the v7 codemod:
  ```bash
  npx @ai-sdk/codemod v7
  ```
  This handles: `stepCountIs` → `isStepCount`, `system` → `instructions`, `onFinish` → `onEnd`, `onStepFinish` → `onStepEnd`, `experimental_onToolCallStart` → `onToolExecutionStart`, `experimental_onToolCallFinish` → `onToolExecutionEnd`, `experimental_telemetry` → `telemetry`, `fullStream` → `stream`, and other mechanical renames.
- [ ] **1.3** **Manually rename `experimental_throttle` → `throttle`** in `src/features/chat/components/chat/useChatRuntimes.ts` (5 call sites, lines 143-147). The codemod may not cover `@ai-sdk/react` options — verify after running it.
- [ ] **1.4** Run `npm run typecheck` — fix any type errors the codemod missed
- [ ] **1.5** Run `npm run build` — fix any build errors
- [ ] **1.6** Run `npm run lint:changed` — fix any lint errors
- [ ] **1.7** Commit: `chore: upgrade AI SDK v6 → v7 + run codemod`

### Phase 2: Fix high-risk behavioral changes

**Goal:** Address breaking changes that the codemod can't handle.

- [ ] **2.1** **System messages in `messages` (H1):**
  - In `src/server/app-api/v1/conversations/act/route.ts`, add `allowSystemInMessages: true` to the `agent.stream()` call (or wherever compacted messages are passed).
  - Add a comment: `// allowSystemInMessages: trusted server-generated context summary, not user input`
  - Verify `context-compaction.ts` still works end-to-end.

- [ ] **2.2** **`totalUsage` → `usage` (H2):**
  - `act/route.ts` line 659: `event.totalUsage` → `event.usage` (now includes all steps — same semantics as old `totalUsage`)
  - `ActMessagePersistenceService.ts` line 163: `args.event.totalUsage` → `args.event.usage`
  - `notebook-agent/route.ts` line 372: `result.totalUsage` → `result.usage`
  - `gateway-search-tools.ts` line 338: `params.result.totalUsage` → `params.result.usage`
  - `ActConversationService.test.ts` line 505: test fixture `totalUsage` → `usage`
  - `chat-stream-persistence.test.ts` line 20: test fixture `totalUsage` → `usage`
  - **Verify:** Token billing amounts are unchanged (usage now = total across steps, same as old `totalUsage`).

- [ ] **2.3** **`step.response.messages` accumulation (H3):**
  - Audit `persist-assistant-turn.ts` — it reads `step.text`, `step.toolCalls`, `step.toolResults`, `step.reasoningText`, `step.reasoning` — all per-step properties that are unchanged.
  - Audit `ActMessagePersistenceService.ts` — reads `args.event.steps` and `args.event.text` — `event.text` is now all-steps text (was last-step only in v6). **Verify** this doesn't change persistence behavior.
  - If any code reads `step.response.messages` expecting accumulation, switch to `result.responseMessages`.

- [ ] **2.4** **MCP redirect default (H7) — non-issue:**
  - We use `@modelcontextprotocol/sdk` directly, not `createMCPClient` from `ai`. The v7 redirect change doesn't apply.
  - No changes needed. SSRF validation already in place via `validatePublicNetworkUrl()`.

- [ ] **2.5** **xAI default API (H8) — low risk:**
  - We use `createGateway()` from `ai`, not `xai(modelId)` directly. The gateway handles provider routing.
  - The `@ai-sdk/xai` package is in `package.json` but not imported in `src/` — it's used by the gateway internally.
  - **Action:** Upgrade `@ai-sdk/xai` to v4. Test xAI models (grok-4.20-reasoning) on staging to verify the gateway still routes correctly.

- [ ] **2.6** Run `npm run typecheck && npm run build && npm run lint:changed`
- [ ] **2.7** Commit: `fix: adapt to AI SDK v7 behavioral changes`

### Phase 3: Migrate deprecated patterns to stable APIs — COMPLETE

**Goal:** Move off deprecated aliases so we're ready for v8. Each item is independent and can be done incrementally.

- [x] **3.1** **`toUIMessageStreamResponse` → stateless helpers (M8):**
  - In `act/route.ts`, replaced `result.toUIMessageStreamResponse(...)` with `toUIMessageStream({ stream: result.stream, ... })` + `createUIMessageStreamResponse({ stream: uiStream })`.
  - Added `toUIMessageStream` and `createUIMessageStreamResponse` to `src/server/ai/sdk.ts` re-exports.
  - The `_uiResp` variable (used for `.body`, `.headers`, `.status`) is now created from `createUIMessageStreamResponse` — rest of the streaming pipeline is unchanged.

- [x] **3.2** **`needsApproval` → `toolApproval` (M9):**
  - Removed `needsApproval` from both `call_mcp_tool` (meta-tool) and discovered MCP tool definitions in `mcp-tools.ts`.
  - `createMcpLazyMetaTools` now returns `{ tools: ToolSet; toolApproval?: McpToolApprovalFn }` instead of just `ToolSet`.
  - The `toolApproval` function checks `call_mcp_tool`'s input (`serverId`/`toolName`) against the MCP server's policy at call time — same behavior as the deprecated `needsApproval`, now using the v7 agent-level `toolApproval` API.
  - Threaded `toolApproval` through `tooling.ts` (`ActTooling` interface, `buildActTooling`, `prepareActTooling`) to `act/route.ts` where it's passed to the `ToolLoopAgent` constructor.
  - The eager `discoverToolsForServer` path (only used by `prewarmMcpTools` cache warmer, not the act route) had `needsApproval` removed with a comment noting approval should be set at the agent level if that path is ever used.
  - Exported `McpToolApprovalFn` type from `mcp-tools.ts` and `ToolApprovalConfiguration` type from `sdk.ts`.

- [x] **3.3** **`experimental_generateVideo` — no change needed:** Still experimental in v7. `src/server/ai/sdk.ts` and `generate-video/route.ts` stay as-is.

- [x] **3.4** **`experimental_transform` — no change needed:** Still experimental in v7. `act/route.ts` and `chat-stream-persistence.ts` stay as-is.

- [x] **3.5** **`experimental_throttle` → `throttle` — done in Phase 1:** Already renamed during Phase 1 step 1.3.

- [x] **3.6** Run `npm run typecheck && npm run build && npm run lint:changed`
  - Typecheck: pass (exit 0)
  - Build: `next build` compiled successfully, 167 routes generated (exit 0)
  - Lint: `lint:changed` hit a pre-existing `eslint-plugin-react` compatibility issue (`getFilename is not a function`); `next build`'s ESLint integration passed clean.

- [x] **3.7** Commit: `refactor: migrate to stable AI SDK v7 APIs`

### Phase 4: Adopt new v7 features (optional, post-migration)

**Goal:** Leverage v7 capabilities. Not required for the migration itself.

- [x] **4.1** **Reasoning control:** Use `reasoning: 'high'` on the act agent for reasoning-capable models instead of provider-specific `providerOptions`. Remove overlapping reasoning settings from `providerOptions`.
  - **Implemented:** Added `reasoning` field to `ChatModelPreferences` (`ReasoningLevel` type: `provider-default|none|minimal|low|medium|high|xhigh`). Persisted in localStorage via `REASONING_KEY`. UI: reasoning dropdown added as last row in model picker (only shown when selected model has `supportsReasoning: true`). Model picker hover panel made persistent (pointer-events-auto, stays open on hover). Threaded through `useChatPreferences` → `useChatSendController` → `sendTextTurn` → `buildCommonActBody` → `ActConversationRequest` schema → `ToolLoopAgent` constructor.
- [x] **4.2** **Tool context:** Migrate MCP tool API keys from ad-hoc `experimental_context` to typed `contextSchema` + `toolsContext`.
  - **Implemented:** Added `contextSchema` to `call_mcp_tool` meta-tool with `userId`, `conversationId`, `turnId`, `modelId`. `execute` receives context via `options.context`. `createMcpLazyMetaTools` returns `toolsContext` object. Threaded through `ActTooling` interface → `buildActTooling` → `prepareActTooling` → `ToolLoopAgent` constructor. Context values used in `fireAndForgetRecordToolInvocation` with closure fallback.
- [ ] **4.3** **Runtime context:** If we adopt `prepareStep`, use `runtimeContext` for shared state. *(Skipped — not needed yet)*
- [ ] **4.4** **Tool approvals with HMAC:** Evaluate HMAC-signed approvals for high-risk MCP tools. *(Skipped — not needed yet)*
- [x] **4.5** **Telemetry:** Register `@ai-sdk/otel` in `instrumentation.ts` if we want AI SDK traces.
  - **Implemented:** Installed `@ai-sdk/otel` + `@vercel/otel`. `registerTelemetry(new OpenTelemetry())` called in `instrumentation.ts` when `OVERLAY_FEATURE_TELEMETRY` is not disabled (defaults to enabled). `telemetry: { functionId: 'act:<modelId>' }` added to `ToolLoopAgent` in act route. Type assertion used for `OpenTelemetry` → `Telemetry` interface compat.
- [x] **4.6** **Provider file uploads:** Use `uploadFile` for large PDFs/images in the act agent to avoid re-sending bytes.
  - **Implemented:** `uploadFile` and `ProviderReference` re-exported from `sdk.ts`. Created `src/server/ai/file-upload.ts` with `tryUploadFileToProvider` and `uploadFilePartsForModel` helpers. Supports OpenAI, Anthropic, Google, xAI providers (requires direct API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.). Falls back to inline for small files (<100KB data: URLs), non-image media types, or when no direct API key is configured. Called in act route before `ToolLoopAgent` creation.

### Phase 5: Staging QA + production rollout

**Goal:** Verify on staging, then merge to production.

- [ ] **5.1** Merge `codex/ai-sdk-v7` to `staging` worktree
- [ ] **5.2** Push staging, wait for deploy to `staging.getoverlay.io`
- [ ] **5.3** QA checklist:
  - [ ] Send a chat message — verify streaming works, text renders without flicker
  - [ ] Send a message that triggers a tool call — verify tool execution and result display
  - [ ] Send a message with an image — verify vision model handles it
  - [ ] Test context compaction — send enough messages to trigger compaction, verify summary is included (H1 fix)
  - [ ] Test MCP tool invocation — verify approval flow works (M9)
  - [ ] Test notebook agent — verify `onStepEnd` callback fires and text is emitted
  - [ ] Test chat suggestions — verify `generateText` returns suggestions
  - [ ] Test title generation — verify `generateObject` returns a title
  - [ ] Test video generation — verify `generateVideo` works
  - [ ] Test workspace agent mentions — verify `streamText` streams correctly
  - [ ] Verify token billing — check usage amounts match pre-migration (H2 fix)
  - [ ] Check Sentry — no new errors from AI SDK
  - [ ] Check console — no deprecation warnings (all should be migrated in Phase 3)
- [ ] **5.4** Merge staging → main
- [ ] **5.5** Push main, wait for deploy to `www.getoverlay.io`
- [ ] **5.6** Monitor Sentry and PostHog for 24h post-deploy

## Rollback plan

If anything breaks in production:

1. **Revert the merge commit** on `main` — the migration is a single PR (or a small set of commits).
2. **Redeploy** — Vercel will rebuild from the reverted `main`.
3. **No data migration needed** — AI SDK v7 doesn't change persisted message formats (UIMessage shape is unchanged).
4. **No Convex changes** — this migration is web-only.

## Files to touch (summary)

| File | Phases | Changes |
|------|--------|---------|
| `package.json` | 1 | Bump `ai` and `@ai-sdk/*` versions |
| `src/server/ai/sdk.ts` | 1, 3 | Codemod renames + `experimental_generateVideo` → `generateVideo` (if stabilized) |
| `src/components/providers/ai-chat-client.ts` | 1 | Codemod (if `Chat`/`useChat` signatures change) |
| `src/shared/chat/ai-ui-message.ts` | 1 | Codemod (if any exported names change) |
| `src/server/app-api/v1/conversations/act/route.ts` | 1, 2, 3 | Codemod + `allowSystemInMessages` + `totalUsage` → `usage` + `toUIMessageStreamResponse` → stateless |
| `src/server/app-api/v1/notebook-agent/route.ts` | 1, 2 | Codemod + `totalUsage` → `usage` |
| `src/server/app-api/v1/generate-title/route.ts` | 1 | Codemod (`system` → `instructions`) |
| `src/server/app-api/v1/generate-tab-group-label/route.ts` | 1 | Codemod (`system` → `instructions`) |
| `src/server/tools/media-tool-intent.ts` | 1 | Codemod (`system` → `instructions`) |
| `src/server/memory/MemoryExtractionProvider.ts` | 1 | Codemod (`system` → `instructions`) |
| `src/server/ai/gateway/gateway-search-tools.ts` | 1, 2 | Codemod + `totalUsage` → `usage` |
| `src/server/conversations/ActMessagePersistenceService.ts` | 2 | `totalUsage` → `usage` |
| `src/server/conversations/ActConversationService.test.ts` | 2 | Test fixture `totalUsage` → `usage` |
| `src/server/conversations/chat-stream-persistence.test.ts` | 2 | Test fixture `totalUsage` → `usage` |
| `src/server/chat/context-compaction.ts` | 2 | Verify system message handling (H1) |
| `src/server/tools/mcp-tools.ts` | 3 | `needsApproval` → `toolApproval` + MCP redirect audit |
| `src/server/ai/gateway/openrouter-service.ts` | 1 | Codemod (if any names change) |
| `src/server/agents/workspace-agent-invocation.ts` | 1 | Codemod (if `streamText` signature changes) |
| `src/shared/chat/cloudflare-chat-transport.ts` | 1 | Codemod (if transport names change) |
| `src/shared/chat/persist-assistant-turn.ts` | 2 | Audit `step.response.messages` usage |
| `src/features/chat/components/chat/useChatRuntimes.ts` | 1 | `experimental_throttle` → `throttle` (5 call sites) |
| `src/server/app-api/v1/generate-video/route.ts` | 1 | Codemod (no rename needed — `experimental_generateVideo` still experimental in v7) |
| `src/server/conversations/chat-stream-persistence.ts` | 1 | Codemod (no rename needed — `experimental_transform` still experimental in v7) |
| `src/server/ai/model-runtime.ts` | 2 | xAI model creation audit (H8) |
| `src/instrumentation.ts` | 4 (optional) | Register `@ai-sdk/otel` if adopting telemetry |

## Verification gates

After each phase, these must pass before proceeding:

| Gate | Command | When |
|------|---------|------|
| Typecheck | `npm run typecheck` | After every phase |
| Build | `npm run build` | After phases 1, 2, 3 |
| Lint | `npm run lint:changed` | After phases 1, 2, 3 |
| Shared isomorphic | `npm run check:shared-isomorphic` | After phases 1, 2, 3 |
| Staging QA | Manual + browser testing | After phase 5 |
| Token billing audit | Compare usage amounts pre/post | During staging QA |
| Sentry error rate | No increase 24h post-deploy | After production deploy |

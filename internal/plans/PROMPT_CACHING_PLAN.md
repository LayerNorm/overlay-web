# Prompt caching in the harness

Status: in progress in the `codex/harness-prompt-caching` PR; not merged or deployed. Phase 1 (stable prefix), Phase 2 (Anthropic markers) and sticky Gateway routing are implemented in `src/server/harness/prompt-cache.ts`. Still open: constant tool choice for progress updates and final answers (kept as before to preserve their behaviour), the `1h` lifetime, and storing the hit rate per run (Phase 3). Main removed harness cost holds before this landed, so cache-write pricing in holds is no longer needed. The last phase's PR deletes this plan.

## Findings

`scripts/experiments/prompt-caching.mts` reproduces these against AI Gateway; the measured figures live in the PR, not here.
- **Anthropic caches nothing without `cacheControl` markers**, even with a stable prefix.
- **Changing `toolChoice` or the tool list breaks the cache** on every provider. The harness does both for final answers and progress updates.
- **The Gateway spreads open-weight models across upstreams**, and caches don't cross between them, so a run should stay on one upstream.
- **OpenAI's `promptCacheKey` adds nothing** within a single run, because its implicit caching already applies.

## Goal

Pay full price for each prompt token at most once per run. Providers charge cached input at about a tenth of the normal price, and a long agent loop resends the same prefix on every step.

## Why caching misses today

Caches match the prompt from the start, in the order tools, then system prompt, then messages. A change at any point means nothing after it is reused.

1. **The system prompt changes on every step.** `buildHarnessStepInstructions` (`src/server/harness/context.ts`) appends the live working state (plan, milestones, failed results) and continuation notes to the instructions. Every step therefore misses the cache for the system prompt and the whole conversation after it.
2. **The tool list changes between steps.** `activeModelTools` passes a different set of tools, and tools come first in the prefix.
3. **Nothing is marked for caching.** Anthropic models (including through the Gateway or OpenRouter) cache only blocks marked with `cacheControl`.
4. **Compaction rewrites history** whenever it runs. This is expected and rare, so it is acceptable.

## Changes

### Phase 1: Keep the start of the prompt stable
- The system prompt holds only the fixed `instructions`.
- The working state and the step notes move into a final message at the end of the prompt, labelled "data, not instructions". Each step replaces that message rather than adding a new one.
- Always send every tool and enforce limits with `activeTools`. The AI SDK keeps tool definitions stable and filters which tools can be called. Check that the providers we use don't drop inactive tools from the request. If one does, use a stable order and handle refusals in the tool executor instead.
- Sort tools deterministically by name.

### Phase 2: Mark breakpoints
Add one helper in `prepareModel` that sets cache markers for each provider:

| Provider | Setting |
| --- | --- |
| Anthropic (direct, Gateway or OpenRouter) | `cacheControl: { type: 'ephemeral' }` on the last tool, the system message and the last message before the working-state message (3 of the 4 allowed breakpoints). |
| OpenAI | `promptCacheKey` per harness run, plus `promptCacheOptions` with explicit breakpoints on GPT‑5.6 or later. |
| Gemini, DeepSeek, Kimi and Groq | Implicit caching only. Phase 1's stable prefix is what matters. |

- Keep `toolChoice` set to `auto` and the tool list unchanged on every step, including final answers and progress updates. Steer those steps with the trailing state message instead.
- Make Gateway routing sticky for each run: record the first upstream (`providerMetadata.gateway.routing.finalProvider`) and send `gateway.order: [that upstream]`. This keeps failover, unlike `only`.
- Use a `1h` lifetime only for automations and children that wait.

### Phase 3: Measure it
- `model-usage.ts` already records `cacheReadTokens` and `cacheWriteTokens`. Store the cache hit rate per run and show it in the operator console.
- Make sure billing charges cache reads and writes at their own rates (usage settlement already records both).

## Acceptance

- In a multi-step Preview run, most input tokens on work steps after the first are cache reads.
- Cost per run is down, with no change in run outcomes.
- Unit tests check that the prompt prefix is byte-identical between steps, apart from the trailing working-state message.

## Risks

- **Models may follow the working state less closely once it is no longer in the system prompt.** Check this with the existing harness tests and a Preview run.
- **Caching blocks below each provider's minimum length (1–4k tokens) does nothing.** It is harmless.

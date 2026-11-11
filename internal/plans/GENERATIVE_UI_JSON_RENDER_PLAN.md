# Generative UI with json-render

Status: The expressive mockup is approved and retained. Production work is local on this PR branch and not merged or production accepted. This change adds the four expressive catalog renderers, tool-argument `specStream` compilation, and bounded preview snapshots on the durable personal/native chat stream path. Focused transport and generated-UI regression suites pass locally; full merged-branch validation and exact-head Preview QA remain pending. Preserve the known personal false-recovery limitation from prior QA; Slack has not been tested. Do not report blanket flow acceptance. T12 remains open.

## Goal

Every Overlay-owned AI chat surface (personal chats, workspace agents and threads, automations) can answer with real, interactive UI built from our own component catalog, using [json-render](https://json-render.dev/docs/ai-sdk). The model composes a UI from approved components; it never writes HTML, CSS or JavaScript.

## Decisions

1. **Tool-based, never assistant-prose JSONL.** The model calls a harness tool, `render_ui`, whose input is a json-render spec or bounded JSONL `specStream` string. We do not put inline JSONL patches in assistant text, because:
   - `runOverlayHarness` (`src/server/harness/runner.ts`) streams through `WorkflowAgent.stream`, not `toUIMessageStream`, so `pipeJsonRender` has nothing to attach to.
   - `src/server/harness/public-stream-publisher.ts` deliberately strips machine-looking text from public streams. Patches in text would fight that.
   - A malformed patch in text leaks raw JSONL into the transcript, Slack and email. Tool-argument `specStream` is strictly validated at final execution and persists only as the existing spec shape.
   - Tools already have per-surface admission, durable persistence and ordered rendering, all shared by every surface.
2. **The four existing card kinds stay as they are in v1.** `draft.text`, `draft.email`, `connector.connect` and `questionnaire` keep `present_generated_ui`, their contracts and their renderers. No migration of persisted messages.
   - Later (not in this PR): wrap `TextDraft`, `EmailDraft` and `Questionnaire` as catalog components so specs can compose them.
   - `connector.connect` never joins the catalog. It is a privileged action and stays reachable only through the typed tool.
3. **Catalog is built on `@overlay/ui`.** Components map to our shadcn-based primitives so generated UI looks like the rest of the app in both themes. Missing pieces (Table, Chart) are added as official shadcn components in `@overlay/ui`, not hand-rolled.
4. **Every spec carries a plain-text `summary`.** Surfaces that cannot render React (Slack, email delivery, older clients) show the summary instead.
5. **Actions are an allowlist.** Generated UI can copy, open an `https` link, send a follow-up message, or submit form values back to the agent. No arbitrary fetches, no navigation to internal routes, no connector, billing or approval actions.

## Dependencies

- `@json-render/core` and `@json-render/react`. Latest is 0.22.0 (published 2026-11-04), which clears the `.npmrc` `min-release-age=7` cooldown on 2026-11-11. Use 0.22.0 if implementation starts on or after that date, otherwise pin 0.21.4 (2026-11-01, already past the cooldown); moving to 0.22 later is a one-line bump. Never change the cooldown.
- Peer `zod ^4`: the repo already uses `zod ^4.6.7`.
- Regenerate the lockfile with `npx -y npm@11.11.0 install --package-lock-only --ignore-scripts` and revert unrelated `dev: true` churn.

## Architecture

```
model --render_ui(spec, summary)--> harness tool execute
  -> validate against catalog (server)        -> tool error on failure, model retries
  -> success: { success, id, generatedUi: { kind: 'json_render', ... } }
  -> persist-assistant-turn builds overlay.generated_ui data part
  -> Convex message parts (all surfaces)
  -> visual-sequence -> AssistantSegmentItem -> GeneratedUiCard -> JsonRenderCard (Renderer + registry)
```

### Shared catalog package

The catalog definition (`defineCatalog`) must be importable by the server tool (validation, prompt) and by the React renderer. Put it in `packages/overlay-chat-core` (isomorphic, already shared by server and client), for example `src/generative-ui/catalog.ts`. The React registry (`defineRegistry`) lives in `packages/overlay-chat-react`. The catalog must not import React or `@/server/*`.

### v1 catalog

Layout: `Stack` (vertical/horizontal, gap), `Grid` (columns 1 to 4), `Card` (title, description, default slot), `Separator`.

Content: `Heading`, `Text` (body, muted, caption), `Badge` (variant), `Alert` (info, warning, error, success), `KeyValue` (label/value list), `Metric` (label, value, delta, format), `Progress`, `Avatar`, `Link` (https only), `CodeBlock` (language, code) reusing the chat code renderer, `Image` (https or workspace file URL only).

Data: `Table` (columns, rows, optional caption), `Chart` (bar, line, area, pie; series from props only, no data fetching). Both are new shadcn components in `@overlay/ui`.

Disclosure: `Tabs`, `Accordion`.

Input (bound to spec state with `$bindState`): `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `RadioGroup`, `Button` (emits an allowlisted action).

Exact props are finalized against the mockup. Every prop that can be optional uses `.nullable()` per json-render conventions.

### Persisted contract

New `generatedUiData` variant, added in all three places in the same commit:

- `convex/schema.ts` (message part `data` union)
- `convex/chat/conversations.ts` (`generatedUiData`, also used by `updateMessageUiPart`)
- `packages/overlay-app-core/src/contracts/conversations.ts` (public type union)

If any one is missed, `completeAgentRun` rejects the turn and the run stays `running`.

```ts
{
  version: 1,
  kind: 'json_render',
  catalogVersion: number,   // bump when the catalog changes incompatibly
  summary: string,          // plain-text fallback
  title?: string,
  specJson: string,         // serialized json-render spec
  stateJson?: string,       // user-edited form state
  submittedAt?: number,
}
```

`specJson` and `stateJson` are strings on purpose: json-render specs use `$`-prefixed keys (`$state`, `$bindState`) that Convex rejects as field names, and nested element maps can exceed Convex nesting limits.

- The server validates the spec against the catalog, serializes it and stores the single string. Convex validates field names only on stored objects, and a string has none, so `$` keys and deep nesting never reach Convex.
- The client parses `specJson` once per part id and renders it. Form edits are stored the same way in `stateJson` through `updateMessageUiPart`.
- Limits enforced at the tool boundary keep every message bounded: spec at most 64 KiB serialized, at most 200 elements, depth at most 12, strings at most 4,000 characters.
- Trade-off: Convex cannot query inside a spec. Nothing needs to; specs are display-only.

### Math and `$`

The spec's `$` never meets the LaTeX renderer:

1. Math renders only in assistant text parts (`MarkdownMessage`). The spec is a tool argument and never passes through markdown.
2. json-render expressions are object keys (`{ "$state": "/form/email" }`), not `$` inside strings. A value like `"$1,200"` stays plain text.
3. v1 catalog text components (`Text`, `Heading`, `KeyValue`, `Metric`, `Table` cells) render plain text, not markdown, so a card reading "$5 to $10" cannot trigger math.

If a later catalog component renders markdown, it reuses the chat renderer that already handles currency beside math, and gets tests for that case.

### Tool: `render_ui`

- Defined next to `present_generated_ui` in `src/server/tools/tools/build.ts`, executed in `src/server/tools/tools/overlay-executes.ts`.
- Input: `{ title?, summary, spec }`. Execute validates with the catalog (`catalog.validate` or the equivalent Zod schema in the installed version) plus the size limits, then returns `{ success: true, id, generatedUi }`. Failures return `{ success: false, code: 'tool_validation_failure', issues, hint }` in the same shape `present_generated_ui` uses. Normalize omitted fields at the execute boundary (harness reconstruction passes raw inputs, so Zod defaults may not apply).
- Description tells the model when UI beats text (comparisons, structured results, dashboards, forms that collect several values) and when not to use it (short answers, code, prose drafts, which keep `present_generated_ui`).
- Recognized everywhere `present_generated_ui` is special-cased today:
  - `src/shared/chat/persist-assistant-turn.ts` (build the data part from the tool result)
  - `packages/overlay-chat-core/src/visual-sequence.ts` and `src/messages.ts` (ordered blocks and tool-result recovery)
  - `src/shared/mcp/access.ts` `MCP_EXTERNAL_WITHHELD_TOOL_IDS` (outside MCP apps never get it)
  - `src/server/agents/agent-mcp-tools.ts`
- Simplest path: generalize those checks to a shared `GENERATED_UI_TOOL_IDS` set rather than adding a second string comparison at each site.

### Prompt

- Add the catalog prompt once, in `buildHarnessInstructions` (`src/server/harness/context.ts`), only when `render_ui` is admitted for the turn. Generate it from the catalog (`catalog.prompt()` with custom rules), not hand-written, so it cannot drift from the schema. Note it describes the `spec` argument of a tool call, not text output.
- Update the personal prose note in `src/server/app-api/v1/conversations/act/instructions.ts` so the two generated-UI tools do not contradict each other.
- Custom rules: one spec per reply unless asked; no emojis; no em or en dashes in generated copy; prefer `Table` over markdown tables for more than four columns; never put secrets or tokens in a spec.

### Admission

The tool definition is shared, but each surface still admits it:

- Personal chats: `src/server/harness/personal-access.ts` grants.
- Workspace agents and threads: `src/server/harness/native-access.ts` / `native-tools.ts`.
- Automations: `src/server/harness/automation-access.ts` intersection.

Admit `render_ui` wherever `present_generated_ui` is admitted today. Execution still enforces `allowedToolIds` through `authorized-tools.ts`.

### Rendering

- `JsonRenderCard` in `packages/overlay-chat-react/src/components/`, dispatched from `GeneratedUiCard` for `kind: 'json_render'`, lazy-loaded like the existing card bodies so json-render stays out of the initial chat bundle.
- Parses `specJson` once per part id and renders `<Renderer spec registry />` inside `ActionProvider`/`StateProvider` seeded from `stateJson`.
- Personal chats (`ChatExchange`), agent threads (`RoomMessageItem` -> `AssistantVisualBlocks`) and automation conversations all reach `GeneratedUiCard` already, so no per-surface renderer work.
- Chat rules apply: a settled message never blinks or re-renders (memoize on part id plus `specJson`), no completion tick, no extra loading text, no logos, Lucide icons only.
- Error boundary per card: a spec that fails at render time shows the `summary` as text plus a quiet "Could not display this view" line, never a crashed transcript.
- Unknown `catalogVersion` or unknown component type falls back to the summary the same way.

### Actions and state

- `copy_text { text }`, `open_link { url }` (https only, opens a new tab with `noopener`).
- `send_message { text }`: fills and sends a follow-up user message in the same conversation or thread, as if typed.
- `submit { label? }`: serializes the bound form state into a follow-up user message (readable text plus the values) and records `submittedAt`. After submit the card is read-only.
- Form state persists through `updateMessageUiPart` with the same 700 ms debounce the draft cards use (`GeneratedUiCard.tsx`). Extend authorization only as far as the existing mutation already allows (personal owner today); check room/thread message ownership rules for agent threads and allow edits by members who can post in that thread.

### Non-React surfaces

- Slack (`src/server/surfaces/slack-reply.ts`, `native-delivery-steps.ts`): send `summary` (and the title, if any) as text.
- Email delivery: same summary fallback.
- Desktop: consumes the shared web chat packages, so it renders automatically once released; verify in Preview QA if a desktop build points at the Preview.
- Mobile (`overlay-mobile`, separate repo): out of scope for this PR. Its renderer must show `summary` for `kind: 'json_render'`; a follow-up adds `@json-render/react-native` with the same catalog.

## Tasks (single PR)

- [x] T1. Approved mockup: real specs in the workspace shell, both themes, desktop and 390px. Responsive SVG chart until T5.
- [x] T2. Dependencies: json-render core/react pinned to 0.21.4; Recharts 3.10.1 (published 2026-07-25, newest stable older than seven days, Recharts 3 API used by shadcn). Lockfile regenerated with npm 11.11.0.
- [x] T3. Isomorphic `@overlay/chat-core/generative-ui` catalog, limits, validation, tool-argument prompt helper, and unit tests reusing approved mockup specs.
- [x] T4. `json_render` in all persisted/public contracts and normalizers. Existing `updateMessageUiPart` preserves fields. No tool or renderer enabled yet.
- [x] T5. Official shadcn Table/Chart and RadioGroup in `@overlay/ui`; all 26 registry components, lazy memoized `JsonRenderCard`, validated rendering, summary fallback and optional action/state hooks. Real-card harness checked in both themes at desktop and 390px; no action persistence yet.
- [x] T6. `render_ui`, raw-input validation and shared `GENERATED_UI_TOOL_IDS` for persistence, ordering, recovery, labels and MCP withholding; success/failure tests.
- [x] T7. Admission-gated catalog prompt appended after the stable harness prefix; personal instructions distinguish prose from structured UI.
- [x] T8. Same conversation-local builder admission for personal, native agent and automation surfaces; generic authorization unchanged, both generated-UI tools withheld from outside and connected-agent MCP clients.
- [x] T9. Conversation/thread follow-ups, debounced state with unmount flush, guarded persisted submissions and json-render-only member authorization. Draft permissions unchanged.
- [x] T10. Slack and automation reply projections use bold title and summary. No assistant-reply email transport exists; lifecycle notifications remain unchanged and the shared delivery helper is available for future reply email.
- [x] T11. Tool catalog, persistence docs and consolidated CHANGELOG entry.
- [ ] T12. Preview QA (below), then hand the PR to Integration.

## QA checklist

Local:

- `node scripts/ci/run-all-tests.mjs --only vitest:unit` (register new test paths and confirm file counts), targeted `npx eslint` on changed files, `npx tsc --noEmit`, `npm run check:shared-isomorphic`.
- Renderer check without auth: `renderToStaticMarkup` of `JsonRenderCard` for a spec per component, screenshot both themes and 390px.

Preview (`pr-<number>.preview.getoverlay.io`, `needs-preview` label):

- Personal chat: "Compare these three plans in a table", "Show a small dashboard of my last week", "Make a form to collect a bug report". UI renders in order with surrounding text, survives reload, and does not re-render after settling.
- Form: edit fields, reload (state persisted), submit (follow-up message posted, card read-only).
- Agent thread: same prompts to a workspace agent; teammate sees the same UI.
- Automation: a run that produces UI; the run view shows it.
- Slack-delivered agent reply shows the summary text.
- Invalid spec path: force a bad component name; the tool error is visible in the trace and the model retries successfully.
- Short factual question still answers in plain text with no UI.
- Existing draft, email, connector and questionnaire cards unchanged.

## Later

- `TextDraft`, `EmailDraft`, `Questionnaire` as catalog components.
- Mobile renderer with `@json-render/react-native`.

## Approved follow-up: expressive visuals and progressive diagrams

The approved workspace mockup in `mockups/generative-ui-expressive.html` is retained. This PR implements general bounded Timeline, Comparison, Diagram and Vector catalog components, the `render_ui` JSONL `specStream` argument and provider-driven preview transport. Focused transport/unit regression coverage passes locally; full merged-branch validation and exact-head Preview QA remain pending.

**Simulation disclaimer:** the standalone mockup's replay controls and local node/label/edge data remain simulated. Production previews use provider tool-input deltas and validated, persisted snapshots; they do not use mockup timers. The mockup's failure preview is illustrative only.

The final `render_ui` call remains authoritative for persistence and interaction. Preview cards are read-only, and non-React surfaces continue to use title and summary text. T12 and browser QA remain open; prior personal false-recovery limitations are still known, and Slack has not been tested.

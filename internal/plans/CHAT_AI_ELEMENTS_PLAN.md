# Chat experience on shadcn AI Elements

_Started 2026-10-19. Base branch: `devin/1792329363-unified-sidebar` ([#260](https://github.com/LayerNorm/overlay-web/pull/260)).
Every slice below is a PR into that branch; #260 then lands on main as one merge commit._

Goal: rebuild every surface of the chat transcript and composer (messages, reasoning,
tool calls, sources, citations, code, approvals, attachments, prompt input) as
compositions of the shadcn/ui components that the
[AI Elements](https://ui.shadcn.com/docs/ai-elements) patterns are built from, so
the whole chat has one shape, one set of primitives and one performance model.

Why now:

- **Consistency.** Today each step type has its own markup: `ReasoningBlock`,
  `ToolCallRowWithReasoning`, `ToolCallsCollapsedGroup`, `WorkedForGroup`,
  `WebSearchToolBlock`, `MemoryToolBlock`, `BrowserToolBlock`, `GatedPaidFeatureCallout`,
  plus a hand-built orb rail (`ToolLogoColumn`). AI Elements puts all of them on
  [Trace](https://ui.shadcn.com/docs/components/radix/trace), so every step is a
  `TraceLine` with the same icon, title, status and collapsible body.
- **Performance.** [Message Scroller](https://ui.shadcn.com/docs/components/radix/message-scroller)
  keeps scroll state outside React and gives rows `content-visibility: auto`.
  [Code Block](https://ui.shadcn.com/docs/components/radix/code-block) streams a
  string child as one text node and tokenizes only new lines with Shiki's
  JavaScript engine. Both replace hot paths we maintain by hand today
  (`TranscriptScroll.ts`, `LazySyntaxHighlighter.tsx` on `react-syntax-highlighter`).
- **Fit.** We already stream through the AI SDK (`ai@7`, `@ai-sdk/react`, `useChat`
  in `useChatRuntimes.ts`), and the patterns are documented directly against
  `UIMessage` parts (`reasoning`, `tool-*`, `source-url`, approvals).

Scope is the **web app** (`packages/overlay-chat-react`, `packages/overlay-ui`, and
the `src/features/chat` hosts). `overlay-desktop` (forked copy) and `overlay-mobile`
stay out of scope, same as `SHADCN_MIGRATION_PLAN.md`. Server streaming, the
`@overlay/chat-core` view model and persistence do not change shape unless a slice
says so.

## Upstream model (what we are adopting)

AI Elements is no longer a package. Each pattern is a composition of shadcn/ui
components that we copy into the repo and own. The pieces:

| Layer | Upstream component | Install | New deps |
|---|---|---|---|
| Thread | Message Scroller (`MessageScrollerProvider`, `MessageScroller`, `Viewport`, `Content`, `Item`, `Button`, visibility hooks) | `message-scroller` | `@shadcn/react` (headless scroll behavior) |
| Turn | Message (`Message`, `MessageAvatar`, `MessageContent`, `MessageHeader`, `MessageFooter`, `MessageGroup`) and Bubble (`Bubble`, `BubbleContent`, variants `default/secondary/muted/ghost/...`) | `message bubble` | none |
| Steps | Trace (`Trace`, `TraceLine status=running/error/pending`, `TraceIcon`, `TraceTitle`, `TraceDescription`, `TraceCollapsible*`) | `trace` | none (uses Collapsible) |
| Code | Code Block (`CodeBlock variant/size`, `Header`, `Title`, `Actions`, `CopyButton`, `Content wrap/lineNumbers/startLine`, `Line variant=added/removed/highlighted`, `Footer`) + `useHighlightedCode`, `highlightCode`, `lib/highlighter.tsx` | `code-block` | `shiki` |
| Citations | Hover Card + Button | `hover-card` | none |
| Questions | Item + Button (Confirmation), Questionnaire | `item`, `questionnaire` | none |
| Composer | Input Group + Attachment + Dropdown Menu | `input-group attachment` | none |
| Fixtures | `@shadcn/helpers/ai-sdk` `createChat()` scripted conversations through the real `useChat` lifecycle | npm | `@shadcn/helpers` (dev only) |

Patterns on top: Chat, Message, Reasoning, Tool, Sources, Inline Citation,
Chain of Thought, Confirmation, Context, Model Selector, Prompt Input, Suggestion,
Plan, Queue, Task, Subagent, Terminal, Stack Trace, File Tree, Test Results,
Checkpoint. The Message pattern renders replies with
[Streamdown](https://streamdown.ai) and routes fenced code to `CodeBlock`.

Constraint from the shadcn skill: AI Elements use Radix APIs (`asChild`,
`openDelay`), so we stay on the Radix base. We already are (`radix-ui@^1.8.1`,
`components.json` style `new-york`). Upstream docs render with the `radix-rhea`
style; slice 1 confirms `npx shadcn add` resolves our style and diffs the output.

## Where things live

Same layering as the shadcn migration (packages cannot import `@/`):

- **Primitives** go in `packages/overlay-ui/src/components/ui/` (shadcn aliases in
  `components.json` already point there): `collapsible`, `hover-card`, `item`,
  `input-group`, `spinner`, `message`, `bubble`, `message-scroller`, `trace`,
  `code-block`, `attachment`. Shiki helpers go in `packages/overlay-ui/src/lib/highlighter.tsx`
  and `packages/overlay-ui/src/hooks/use-highlighted-code.ts`. Export through a new
  `@overlay/ui/ai` entry (keeps Shiki out of the main `@overlay/ui` barrel).
- **AI Elements compositions** go in a new `packages/overlay-chat-react/src/components/ai-elements/`
  (`message.tsx`, `reasoning.tsx`, `tool.tsx`, `sources.tsx`, `inline-citation.tsx`,
  `chain-of-thought.tsx`, `confirmation.tsx`, `prompt-input.tsx`, `context.tsx`,
  `suggestion.tsx`, `terminal.tsx`, `subagent.tsx`, `plan.tsx`). These know about
  `@overlay/chat-core` view types; primitives do not.
- **Hosts** (`src/features/chat/...`) keep wiring only: runtimes, transport, actions.

Adaptation rules for every copied file (from `SHADCN_MIGRATION_PLAN.md` and AGENTS.md):

- Use Overlay CSS variables directly, not upstream semantic aliases (`--muted` is
  text color, `--accent` is brand). Must render correctly in light, dark and all
  39 `data-theme-preset` presets.
- Portals adopt the existing z-index scale (`floating-surface.ts`).
- Interactive controls use `@overlay/ui` `Button`/`Input`/`Textarea`; raw-control
  exceptions need the `overlay:raw-control: <reason>` annotation.
- Lucide icons only. Reduced-motion variants for every animation (spinners,
  shimmer, collapsible height).
- No file over 500 LOC (`check:web-complexity`); shared helpers live in a package
  from the first PR (exact-duplicate gate).

## Inventory: current component to target

### Thread and turns

| Today | Target | Notes |
|---|---|---|
| `ChatTranscript.tsx` + `TranscriptScroll.ts` (custom near-bottom math, submitted-turn top inset, reserved spacer) | **Chat** pattern: `MessageScrollerProvider` + `MessageScroller`, `scrollAnchor` on the user turn, `autoScroll` while at the live edge, `defaultScrollPosition="end"` (owner decision: a thread always opens at the very bottom), `MessageScrollerButton` for "Jump to latest" | Upstream behavior matches our approved Class B differences (`intent-preserving-autoscroll`). Day separators become rows. Remove `TranscriptScroll.ts` and `useConversationScroll.ts` once parity tests pass. |
| `ChatExchange.tsx` (645 LOC) / `ExchangeUserMessage` / `UserMessageBubble` | **Message**: user turn is `Message align="end"` + `Bubble variant="muted"`; assistant turn is `Message` + `MessageContent` | Split `ChatExchange` into `UserTurn` and `AssistantTurn`; reply-context and attached-file chips move to `MessageHeader` + Attachment. |
| `ExchangeActions.tsx`, `UserMessageActions.tsx` | `MessageFooter` with ghost `icon-sm` Buttons in Tooltips (Copy with check swap, Good/Bad as `aria-pressed` toggles, Retry, Edit) | Keeps the hover toolbar under the message (owner rule: message-level controls live there). Stop and Retry-after-failure stay in this toolbar. |
| `ExchangeModelTabs` (multi-model Ask) | `MessageHeader` with existing `@overlay/ui` Tabs | No upstream pattern; keep ours. |
| `ExchangeLoadingState.tsx` (bottom dots) | Keep the bottom-placed dots as the empty assistant turn; `TraceLine status="running"` once the first step arrives | AGENTS.md: agent loading uses bottom dots, not parallel "Thinking..." text. |
| `ExchangeErrorNotice`, `UsageExhaustedNotice`, `ExchangeSettledNotices` | `Item` / `Alert` inside `MessageContent` | |
| `MediaExchange.tsx`, `MediaSlotOutput.tsx`, `GeneratedUiCard.tsx` | Wrap in `Message`; internals unchanged | Generated UI is our own; only the frame changes. |

### Steps inside a turn (all on Trace)

| Today | Target pattern | Status mapping |
|---|---|---|
| `ReasoningBlock` (auto-expands while streaming, 304px scroll box, markdown) | **Reasoning**: plain `TraceLine` until text arrives, then `TraceCollapsible` open while thinking, closed after, user choice wins. Title "Thinking" then "Thought for Ns" | Duration measured on the server and sent as message metadata (the AI SDK does not time reasoning). |
| `ToolCallRowWithReasoning`, `SingleToolCallRow` | **Tool**: `TraceLine` while running, `TraceCollapsible` once output exists, body is `CodeBlock size="sm"` (input + output, `variant="destructive"` on error) | `input-streaming`/`input-available` = running ("Running ..."); after stream stops = error, except client tools, which wait; `output-available` = none ("Ran ..."); `output-error` = error ("Failed to ..."); `output-denied` = none ("Denied ..."). Titles keep coming from `getDescriptiveToolLabel` phases. |
| `ToolCallsCollapsedGroup` ("3 tools called") | Nested `Trace` inside a `TraceCollapsible` group line | Default collapsed, sequential (AGENTS.md: tool UIs minimal, collapsed, sequential). |
| `WorkedForGroup` ("Worked for 12s, called 3 tools") | **Chain of Thought**: a summary line that expands into the steps | Keeps the current mode-toggle behavior: settled turns fold all work behind one line. |
| `ToolLogoColumn` / `ToolLineLogo` (orb rail + connector line) | `TraceIcon` slot holds the Orb on every step (owner decision) | Running/error/denied state shows through `TraceLine status` styling and the title, not by swapping the orb for a status icon. The connector line goes away (Trace owns spacing). |
| `WebSearchToolBlock`, `SourcesPanel`, `ChatSourcesPanel` | **Sources**: "Used N sources" line that opens into one link row per source (deduped by URL, hostname fallback, favicon in `TraceIcon`) | The side panel stays for "view all"; the in-turn list becomes Sources. |
| `WebSourceTooltip` + inline `[n]` chips in `MarkdownMessage` | **Inline Citation**: Hover Card on a `secondary` `xs` Button | Knowledge citations (`knowledgeChipLabel`) use the same component. |
| `MemoryToolBlock` | Tool line with a `TraceDescription` of what was saved | |
| `BrowserToolBlock` | Tool line; screenshot/live view in the collapsible body or a Sheet ("Output in a Sheet") | |
| `DraftSuggestionCard`, `DraftReviewModal` | `Item` with actions; modal stays a Dialog | |
| `GatedPaidFeatureCallout` | `Item` (muted) with Upgrade link | |
| Approvals (`awaiting-approval` status; server already uses AI SDK v7 `toolApproval`) | **Confirmation**: `Item` outside `Trace` with Deny / Approve; after answer it becomes a Tool line. `useChat({ sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses })` | Slice 6 audits how approvals reach the client today before changing transport. |
| Sandbox / computer command tools | **Terminal** (command + streamed output in `CodeBlock`, ANSI via `useHighlightedCode(code, "ansi")`) | |
| Agent delegation / connected-agent runs inside a chat | **Subagent** | Only where the run already streams its steps. |
| Todo / plan tool output (if present) | **Plan** / **Queue** / **Task** | Inventory in slice 6; skip patterns with no data source. |
| Failed tool with stack | **Stack Trace** | Optional. |

### Content

| Today | Target | Notes |
|---|---|---|
| `MarkdownMessage.tsx` on `react-markdown` + `remark-gfm` + `remark-math`/`rehype-katex` + our `splitStreamingMarkdown`, `shimIncompleteMarkdown`, `useSmoothStreamedText`, mention plugin, citation chips | **Streamdown** (recommended, decision 2): the current renderer flickers while streaming. Streamdown closes unterminated markdown and memoizes finished blocks. Fenced code routes to `CodeBlock` via `components.code` | Hard requirement (AGENTS.md): streaming renders in complete, formatted chunks with no per-character flicker. Our `rehypeWrapStreamChars` per-character spans and `useSmoothStreamedText` drip are the likely flicker sources and are dropped with the switch. Mentions and citation chips port as `components` overrides. |
| `markdown/renderers.tsx` custom code block (header, lang label, copy, HTML render toggle) + `LazySyntaxHighlighter.tsx` (Prism, 24 lazy languages, one-dark/one-light) | `CodeBlock` + `CodeBlockHeader` (title = language), `CodeBlockCopyButton` (disabled until the fence closes: `useIsCodeFenceIncomplete` if Streamdown), HTML render toggle as an extra `CodeBlockActions` button. `useHighlightedCode` with Shiki JS engine, languages loaded on first use | Remove `react-syntax-highlighter` from root and `overlay-chat-react` deps. Shiki `github-light` / `github-dark-default` on Overlay surface colors; theme presets do not tint code (owner decision). |
| Math: `remark-math` (single `$` on by default) + `rehype-katex` (`strict: 'ignore'`, `throwOnError: false`) | `@streamdown/math` via `createMathPlugin({ singleDollarTextMath: true })` | Same libraries (`remark-math`, `rehype-katex`, `katex`), so LaTeX keeps rendering. Streamdown defaults to `$$` only; the flag keeps today's `$...$` inline math. It also closes an unterminated `$$` while streaming. Parity tests: inline `$`, block `$$`, currency text, a broken equation. |

### Composer

| Today | Target | Notes |
|---|---|---|
| `packages/overlay-chat-react/src/components/ChatComposer.tsx` (450) and `src/features/chat/components/ChatComposer.tsx` (520) + `MentionInput` | **Prompt Input**: `InputGroup` with the textarea, attach button (`icon-sm`, outline, rounded), model menus in the `block-end` addon, submit (`ArrowUp` idle, spinner, stop) | `MentionInput` is a contenteditable editor (`mention-input-editor.ts`); it goes inside the group as the field, not replaced. Owner decision: merge both into one Prompt Input in `@overlay/chat-react`; both hosts render it. |
| `AttachmentTray`, `ChatComposerAttachments`, `AttachmentPreviewShell` chips | **Attachment** `size="sm"` in the `block-start` addon with remove button | Previews keep using `AttachmentPreviewShell`. |
| `ComprehensiveModelPicker`, `GenerationModeToggle` | **Model Selector**: a `Popover` + `Command` from the model button. Top to bottom: a **Text / Image / Video** segmented toggle (inside the dropdown, not in the composer), a filled search field, then a left rail (Favorites star, then one logo per provider; click to jump, current group highlighted on scroll) beside a list grouped by provider with section headers and a provider logo on every row. Row order: logo, name, favorite star, selected check, then capability chips (or the short description for image and video models). Typing collapses to one flat filtered list with no rail. The mode swaps the model list and placeholder; the effort menu shows only for text models that reason. Composer bottom row: attach (+), mention (@), spacer, model button, effort menu, send | Owner decision 6. This replaces the AGENTS.md "no provider grouping" rule (update it in slice 6). Providers are ordered by their best model and models within a provider by `CHAT_MODEL_QUALITY_PRIORITY`; free-tier Auto stays pinned on top; capability chips stay. Favorites are per user, stored in chat preferences (hover a row to star it). Provider logos: vendor the needed SVGs from `@lobehub/icons-static-svg` (MIT) as inline `currentColor` components in `@overlay/ui`, no runtime dependency. The @ button inserts `@` at the caret and opens the existing mention menu. |
| Budget / usage | **Context** (Hover Card + Progress, from `messageMetadata` usage on finish) | New, small. Optional. |
| Empty-state starters | **Suggestion** | Only if we keep starters. |

### Other consumers (must move with the primitives)

`RoomMessageItem.tsx` and `DirectMessageExperience.parts.tsx` (rooms, DMs),
`SharedChatView.tsx` (public share), `overlay-modules-react/src/notes/agent-panel.tsx`,
`WorkPeekSections.tsx`, `ChatToolSurface.tsx`, `ChatInlinePanel.tsx`, and the dev
`ChatParityHarness.tsx`. Rooms and DMs use `Message` + `Bubble` (with avatars via
`MessageAvatar`, grouping via `MessageGroup`) and `MessageScroller`; they get the
same Trace steps when an agent replies inside them.

## Performance plan

Measure before and after each slice; the numbers go in the slice PR.

- **Fixture:** a 300-turn transcript with long markdown, 40 code fences, 200 tool
  calls and reasoning, built with `createChat()` from `@shadcn/helpers/ai-sdk` so
  it streams through the real `useChat` lifecycle. Lives in `ChatParityHarness`
  and Storybook.
- **Metrics:** row re-render counts during streaming (`perf-debug.ts`
  `recordRender`), long tasks over 50ms while streaming, INP for opening a tool
  row and copying code, scroll FPS, time to open a saved thread at the last
  anchor, JS shipped for `/app/chat` (Prism bundles out, Shiki JS engine in).
- **Expected wins:** no transcript row re-renders on scroll; offscreen rows
  skipped via `content-visibility`; code blocks stream as text nodes and highlight
  incrementally; one collapsible implementation instead of five; ~780 lines of
  `chat-surface.css` shrinking as components move to utilities.
- **Budget:** no regression in streaming throttle (`STREAM_THROTTLE_MS = 66`),
  bundle for the chat route not larger than baseline, zero layout jumps when a
  code block or image settles (Message Scroller keeps place on layout change).
- Virtualization stays out (upstream: real DOM rows are fine into the thousands).

## Slices

Each slice is one reviewable PR into `devin/1792329363-unified-sidebar`, with
targeted tests, `npm --prefix packages/overlay-ui run test`, `npm run check:chat-transcript-boundaries`,
lint/typecheck, and authenticated QA on the PR preview (light, dark, a few
presets, mobile width). Keep the branch merged with its base as #260 moves.

| # | Slice | Contents | Done when |
|---|---|---|---|
| 0 | Plan + mockup | This doc; a standalone HTML mockup (`internal/plans/mockups/chat-ai-elements-mockup.html`) of one turn with reasoning, 3 tools, sources, code, citation, approval, and the composer | Owner approves the look |
| 1 | Primitives | Add and adapt `collapsible`, `hover-card`, `item`, `input-group`, `spinner`, `message`, `bubble`, `trace`, `code-block` (+ Shiki hook/lib), `message-scroller` (+ `@shadcn/react`), `attachment` in `@overlay/ui`; `@overlay/ui/ai` entry; Storybook stories; unit tests. No consumer changes | Stories render in all themes; package tests green |
| 2 | Code Block everywhere | Markdown fences, tool input/output, HTML render toggle; delete `LazySyntaxHighlighter` and `react-syntax-highlighter` | Bundle and highlight-latency numbers recorded; copy excludes line numbers |
| 3 | Trace steps | `ai-elements/reasoning`, `tool`, `chain-of-thought`, `sources`; port web search, memory, browser, gated callout; delete `tool-rail.tsx`, `ToolCallsCollapsedGroup`, `WorkedForGroup` internals; update `tool-call-rows.test.tsx`, `tool-rail.test.tsx` | Every step type in the fixture renders as a Trace line with correct status |
| 4 | Message + thread | `ai-elements/message` (user Bubble, assistant content, footer actions), `ChatTranscript` on Message Scroller, jump-to-latest button, reopen at the very bottom; split `ChatExchange`; delete `TranscriptScroll.ts` | `ChatTranscript.test.tsx`, `TranscriptScroll` behaviors re-expressed as Message Scroller tests; no row re-render on scroll |
| 5 | Markdown + citations | Streamdown with `@streamdown/math` (decision 2), `ai-elements/inline-citation` for web and knowledge chips, mentions preserved | `MarkdownMessage.streaming.test.ts` and math parity tests green; no flicker in recorded streaming |
| 6 | Composer + approvals | `ai-elements/prompt-input` (one composer for both hosts), Attachment chips, Model Selector layout, Confirmation for approvals, Context meter, Terminal/Subagent/Plan where data exists | Send, stop, attach, mention, model switch, approve/deny all pass preview QA |
| 7 | Other surfaces + cleanup | Rooms, DMs, shared chat, notes agent panel, work peek; prune `chat-surface.css`; lint guardrail that bans the removed components and direct `react-syntax-highlighter` imports | No legacy chat markup left; guardrail has bypass tests |

Slices 2 and 3 can run in parallel after 1. Slice 4 depends on 3. Slice 6 only
depends on 1.

## Testing

- Unit: each primitive and composition (status mapping table, open-state rules,
  dedupe of sources, copy button disabled while a fence streams).
- Deterministic streaming: `createChat()` scripts for reasoning + tools + sources
  + approval, asserted in node tests and used for screenshots, so CI never calls a
  model.
- Existing suites to update rather than delete: `ChatTranscript.test.tsx`,
  `TranscriptScroll.test.tsx`, `ExchangeLoadingState.test.tsx`, `tool-call-rows.test.tsx`,
  `tool-rail.test.tsx`, `MarkdownMessage.streaming.test.ts`, chat-core
  `parity-fixtures`, `toChatTranscriptView.test.ts`, `RoomMessageItem.test.tsx`.
- Preview QA per slice with the test account: new chat, long reply with code,
  Act mode with tools, web search with citations, reopen a long thread, mobile
  width, light/dark/presets, keyboard only, reduced motion.

## Visual rules (all components)

Owner requirement, applied to every component in this migration and recorded in `internal/develop/interface-design.md` in slice 1:

1. **Flat and borderless.** No borders on cards, code blocks, composer, chips, buttons, approval items, popovers or sidebars. Surfaces are told apart by fill only: `background` (page), `sidebar`, `muted` (bubbles, composer, code, items, chips), `muted-2` (controls sitting on a `muted` surface, selected rows), `popover` (floating layers, which keep a soft shadow and no ring). Focus rings stay for keyboard focus. Destructive states tint the fill rather than the border.
2. **Blurred headers.** The page header and the sidebar header float over their scroll areas. Content scrolls under them and blurs progressively toward the top: a stack of masked `backdrop-filter` layers (1, 3, 6, 12px) plus a surface tint, both easing to fully transparent about 40px below the header, so there is no visible edge or divider line. Scroll areas get top padding equal to the header height so nothing starts hidden. Wrap the blur in a shared `ScrollHeader` primitive in `@overlay/ui` so every page, the sidebar and settings use the same one.

## Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Step icon | The Orb in `TraceIcon` on every step. Status reads from `TraceLine status` and the title. |
| 2 | Markdown renderer | Approved: Streamdown, because the current renderer flickers. LaTeX is kept through `@streamdown/math` with `singleDollarTextMath: true` (same KaTeX stack as today). |
| 3 | Code theme | Shiki `github-light` / `github-dark-default` on Overlay surface colors. Theme presets do not tint code. |
| 4 | Scroll position | A thread opens at the very bottom (`defaultScrollPosition="end"`). Follow the live edge while at the bottom, jump-to-latest button when scrolled up. |
| 5 | Composer | One Prompt Input in `@overlay/chat-react`, used by both hosts. |
| 6 | Model selector | Text / Image / Video toggle at the top of the dropdown, search, provider rail with Favorites, models grouped by provider with logos; star and check sit left of the capability chips. Composer row: +, @, model, effort, send. |
| 7 | Visual rules | Flat, borderless surfaces told apart by fill color, and progressively blurred page and sidebar headers (see Visual rules). |

## Risks

- **Base branch churn.** #260 is still moving; stacked PRs need frequent merges
  from it. If #260 lands first, retarget open slices to main.
- **Upstream is new.** AI Elements was rebuilt on these components recently;
  pin `@shadcn/react` and `shiki` to versions older than the `.npmrc`
  `min-release-age=7` cooldown, and keep the copied code ours.
- **Streaming regressions.** The flicker rule and the bottom-dots rule are owner
  requirements; slices 3 to 5 each record a streaming video on the preview.
- **CSS cascade surprises.** Earlier sweeps found base-class leaks and
  `tailwind-merge` resolving conflicts differently from the old CSS; compare
  computed styles against a main-baseline preview, not just per-PR screenshots.

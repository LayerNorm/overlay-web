# Connector return and automations as threads

Status: Section 2 phases (a) and (b) implemented on `codex/automation-threads` (draft PR #524, preview QA done for Run now, not merged, not deployed). Section 1 is being built separately. Phase (c) not started.
Mockups, both using production UI and fixture data:

- Automation thread: `internal/plans/mockups/overlay-app.html#/app/agents?agent=agent_chief&id=k17convinboxtriage00000000000000`. It is the real Agents thread view. Each scheduled run appears as an ordinary user message, and the sidebar shows the thread's Needs you status. Nothing new is drawn.
- Connector callback: `internal/plans/mockups/connector-callback.html`, the proposed static page the provider tab lands on. The original Connectors and onboarding screens keep their production look; only their state updates.

## 1. Connector return

**Problem.** Connect opens a second tab. After the provider signs the user in, Composio redirects that tab to `/auth/composio/callback`, which boots inside the Next app (auth `loading.tsx`, a `useSearchParams` Suspense boundary, the full client bundle). Users see a page that keeps loading, while the original tab only catches up when it regains focus. Two likely causes, to confirm against a real Preview run first: the callback route stalls on the app shell, and `window.close()` is refused after providers that set COOP (Google does) swap the tab's browsing context group, so the tab is no longer "opened by script".

**Plan.**

1. Replace the callback page with a plain route handler (`src/app/auth/composio/callback/route.ts`) that returns a tiny static HTML document with an inline, CSP-nonced script. No React, no providers, no loading boundary, so it renders instantly.
2. That script broadcasts `{ type: 'connected', providerKey, status }` on the `overlay-integrations` BroadcastChannel, writes a `localStorage` ping as a fallback for browsers that partition BroadcastChannel, then calls `window.close()`. If the browser keeps the tab open it shows "Gmail connected. You can close this tab."
3. The original tab owns the result. `IntegrationsView` and `OnboardingTools` share one hook, `useConnectorConnect`, that opens the tab, marks the row Waiting, listens on the channel and storage event, refetches on `visibilitychange`, polls status every 3 seconds while a connection is pending (2 minute cap), and then shows Connected plus a toast. Onboarding currently listens only to focus and same-window events, which is why it lags.
4. A Reopen action re-opens the provider URL if the user closed the tab early. Errors from the callback show inline on the row.

**Acceptance.** On the PR Preview, connect Gmail and Slack from Connectors and from onboarding in Chrome and Safari. The provider tab closes or shows the static notice within a second, and the original tab flips to Connected without a reload.

## 2. Automations as threads

**Today.** Convex's minute cron claims due runs and calls `POST /api/v1/automations/run`. That starts `automationRunWorkflow`, which has its own approval hook and turn workflow (`automation-agent-turn.ts`, `automation-harness-steps.ts`) and an 818-line `automation-turn-runner.ts` that rebuilds model selection, tooling, prompts, billing and summaries in parallel with the chat and agent harness. It also keeps `automationRuns`, workflow events, project events, graphs and a stream endpoint.

**Target.** An automation is a schedule attached to one thread.

1. Creation binds the automation to a thread. Created from an agent: an agent thread owned by that agent, using the agent's persona, instructions, tools and memory. Created from chat or the Automations page: an ordinary chat thread with the standard system prompt. Store `conversationId` and, for agents, `agentId`.
2. At each due time, the scheduler appends the saved instructions to that thread as a user message (marked `source: 'automation'` so the UI shows "Scheduled · 9:00 AM") and calls the same entry point the composer uses for that thread type. No automation-specific prompt beyond one short line saying the message was scheduled.
3. Status comes from the existing thread lifecycle: Working, Ready to review, Needs you. Questions and approvals use the harness's existing wait and approval tools, so the user answers in the thread and the turn resumes. Chat threads gain the same status row as agent threads.
4. Keep `automationRuns` only as a thin ledger (due time, message id, outcome) for skip-if-running, history and billing. Delete the separate turn runner, run workflow, approval hook, stream route and graph fields once nothing reads them.

**Phases.** (a) Thread binding plus the message-injection runner behind a flag, with existing automations migrated to a bound thread. (b) Chat thread status parity. (c) Remove the old runner, routes and fields, and update `internal/develop/tool-catalog.md` and the API route catalogs.

**Decided (2026-11-15).** Each automation has exactly one thread. Every run is appended to it, and the existing context compaction keeps it within the model's window. The sidebar lists that thread, not a separate automation entry.

**Progress (section 2).**

| Phase | State | Notes |
| --- | --- | --- |
| (a) Thread binding and message-injection runner | Implemented on draft PR #524; Run now accepted on its preview; not merged or deployed | No flag: the new path replaces the workflow start outright so there is one execution path. Creation binds the thread; older automations bind lazily on their next run (a still-valid owned thread is reused and unhidden; the source chat is never reused, and agent automations whose old thread was a personal chat get a new agent thread). Agent threads post through `collaboration.addMessage` + `startWorkspaceAgentTurns`; chats call the act entry point in-process under the existing automation harness authority, fenced by the ledger owner token. The ledger stores `messageId` and settles from that message's agent run on the minute tick; a run waiting for input stays open, so skip-if-running holds until the owner answers. |
| (b) Chat status parity | Implemented on draft PR #524; Working and Ready seen on its preview; not merged or deployed | Chat summaries carry `activity` (Working, Needs you, Ready while unread, Failed) and the Chats sidebar shows the same indicator as agent threads. Agent sidebars list an automation as its thread. |
| (c) Remove old runner, routes and fields | Not started | `automation-run.ts`, `automation-agent-turn.ts`, `automation-harness-steps.ts`, the automation branch of `automation-turn-runner.ts`, the approve, stream and events routes, graph/run-visualization fields, and workflow event projection are now unreachable from runs but still present. Update `tool-catalog.md` and both route catalogs when they go. |

Not done in (a): the "Scheduled · 9:00 AM" label on the injected message (no message marker yet; the message is plain user text), and the one-line "this message was scheduled" note reaches only chat turns (through the existing `automationExecution` instruction), not agent threads.

Preview QA (PR #524, head `0b5ce559`): Run now on an agent automation and a chat automation each posted the instructions as a user message in the bound thread, the turn replied, and the minute tick settled the ledger run (completed; an earlier run that failed authorization settled as failed). The agent sidebar lists the automation as a thread under its agent, and the Chats sidebar showed Working, then Ready with an unread count.

Open question: editing an automation still posts an "Automation updated: …" assistant note into `automations.conversationId`. That is now the visible thread, and in a chat each note renders under an "Original message unavailable" placeholder, because the chat transcript has no assistant-only notes. Decide whether to drop these notes or render them as a status line.

Untested so far: a run that waits for approval or input (Needs you), skip-if-running while waiting, and a scheduled (cron) tick rather than Run now.

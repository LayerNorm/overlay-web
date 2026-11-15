# Connector return and automations as threads

Status: Proposed. Nothing implemented yet.
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

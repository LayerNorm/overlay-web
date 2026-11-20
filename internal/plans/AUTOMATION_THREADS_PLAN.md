# Automation threads

Status: fixes 2–4 implemented on PR #560 (`codex/automation-thread-composer`) and browser-tested on its Preview; not
merged, deployed or accepted yet. Fix 1 is implemented on the same PR.

## Goal

An automation is an ordinary thread (a chat, or an agent thread) that receives a message on a schedule. A new
automation is the normal new-chat view: the prompt is the instructions, and the chat composer gains a schedule picker and
an agent picker beside its model picker. An automation's thread is the normal chat thread; each run posts the
instructions again and gets a reply. Everything configurable (name, schedule, time zone, agent, model, on/off, Run now,
recent runs, delete) lives in a right details panel like an agent thread's. There is no edit page. Mockup:
`internal/plans/mockups/automation-threads.html`.

## Diagnosis

Before this work, scheduled and Run-now chat and agent automations ran and replied normally. The problems below are what
remained; the dated test results live in the PR #560 QA handoff comments.

## Problems found

1. **A waiting run silently stops the schedule.** A run is `running` until its thread turn ends. A turn that asks
   a question or needs an approval never ends without the owner, and with the default `skip` concurrency policy
   every later tick is skipped. Nothing tells the owner beyond `lastError: "Skipped because a previous run is still
   queued or running."`. Running runs have no timeout (`convex/automations/automations.ts`, `threadRunOutcome`
   treats every non-terminal agent-run status as pending). From the outside the automation looks dead.
2. **Times drift with daylight saving.** Schedules are stored as UTC hour and minute (`hourUTC`, `dayOfWeekUTC`),
   converted once from the chosen time zone when saved (`packages/overlay-app-core/src/automations.ts`).
   `computeNextRunAt` (`src/shared/automations/schedule.ts`) ignores the stored `timezone`. A 9:00 AM Pacific
   automation saved in summer runs at 8:00 AM after the switch to standard time, and an evening weekly run can land
   on the wrong day. The agent's `create_automation` tool asks the model for UTC fields directly.
3. **No way to pick an agent from the Automations page.** An automation belongs to an agent only when it is drafted
   inside that agent's thread (`sourceConversationId`); the editor has no agent control.
4. **Creating one is a form, not a prompt.** Name, description, instructions and schedule are all required, and
   "every weekday" is not a schedule kind.
5. **Chat drafts replace the user's words.** `draft_automation_from_chat` (`src/features/automations/lib/automation-drafts.ts`)
   rewrites the request into generic steps such as "Interpret the user request: …" and defaults to 14:00 UTC.
6. **Turns need the default role first.** A user whose default authorization role was never created (it is created
   when the app shell loads) gets `authorization_denied models.use` on every run. Ordinary web users load the shell,
   so this mostly affects API-only accounts.

## Proposed fixes

1. Stop skipping because of a run that waits for the owner: let the next tick start a new run in the same thread
   (or queue it), and mark the automation "Waiting for you" in the list and sidebar.
2. Store local time plus an IANA time zone and compute the next run in that zone; add an "every weekday" kind.
3. Automations page composer with schedule and agent pickers; the automation's thread is the only detail view.
   Instructions change by editing the first message.
4. Keep the user's words as the instructions; derive the name from the first line.

## Progress

| Fix | State |
| --- | --- |
| 1. Waiting runs keep the schedule | Implemented: a running run whose thread turn waits for the owner's answer or approval no longer holds the schedule, so the next tick starts a new run in the same thread. The waiting run settles once the owner answers. The details panel shows it as "Waiting for you". Covered by Convex tests. Browser-tested on the PR Preview. |
| 2. Local time and IANA zone, every weekday | Implemented (bd641f1b, e0a4b100). A scheduled local-time tick was browser-tested on the PR Preview. A time that does not exist on the spring-forward day runs at the same minute one hour later; a repeated fall-back time runs at its first occurrence. DST transitions are covered by unit tests only. |
| 3. Composer pickers, thread as the detail view | Implemented: Schedule and Agent pickers, create then Run now on send, Automation details panel, Chat/Edit tabs and the editor removed. The agent picker lists only the current scope's agents, and an agent automation's thread opens in the agent thread view. Browser-tested on the PR Preview. |
| 4. Keep the user's words as instructions | The new composer sends the typed text as the instructions; the server names it from the first line. Chat drafting (`draft_automation_from_chat`) is unchanged. |

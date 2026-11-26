# Runs that never stop

Status: proposed, written 2026-11-26. Nothing built yet.

## Goal

A run ends only when it finishes or the person cancels it. It pauses only for budget or for the person's input.
Timeouts, dropped connections, provider errors, deploys and crashes never end a run. "Never stop" means never
abandoned: if a provider is down for hours, the run waits and resumes on its own.

## Why runs stop today

- Retries are counted per run (3 interrupted model calls, 2 internal faults); then the run ends with an error.
- Retries resend the identical request, so a deterministic failure (a tool call too large to stream in time) fails
  the same way every attempt.
- A model call lives inside one workflow step, capped at 800 s by the function limit. Silent streams were cut at
  300 s (raised to 780 s for BYOK and subscriptions).
- Long commands block a step (`computer_exec`, 5 min) or rely on the model polling, and the computer idle-stops
  when tool calls pause.
- Nothing resumes a run whose step died without recording a failure.

## Prior art

- **eve** (Vercel, Workflow SDK like us): errors classified by their cause chain; retries that change the request;
  a recovery note after an interrupted step; commands that yield into durable task workflows; sandbox lifetime
  tied to session busyness; budget as an approval question; a fresh workflow run after compaction; step-fault
  injection tests. It parks a failed turn until the next message; it never resumes on its own and cannot carry a
  model call past the function limit.
- **opencomputer**: the agent loop runs in long-lived processes (VM runners, Cloudflare Durable Objects), so no
  step limit; no idle timeout on model streams; turn leases renewed by every stream frame, with an alarm that
  settles lapsed turns; commands as idempotent operations keyed by tool call id with long-poll status; the
  computer's idle clock tied to turns, with a snapshot on idle; eviction tests.

## Phases

### N1. Failures pause, never end

- One classifier over the full cause chain: transient (timeouts, resets, "terminated", 408/429/5xx, GOAWAY,
  stalls), needs input (reconnect a subscription, model removed, approval), budget, and cancel. A request the
  provider rejects becomes needs input with the reason, not a failure.
- Transient: retry indefinitely per call with backoff capped at 5 minutes, honouring `Retry-After`, every attempt
  logged. The run shows "Waiting for Claude, retrying" with Stop.
- `MAX_INTERRUPTED_MODEL_RETRIES` and `MAX_INTERNAL_FAULT_RESUMES` stop being run-ending limits.
- Exit: no harness path marks a run failed except cancel.

### N2. Lease and sweeper (ships with N1)

- Each active step holds a Convex lease: 60 s, renewed every 15 s and on stream chunks.
- A Convex cron finds lapsed leases and running runs without progress, settles the step as interrupted and
  re-enqueues the run.
- Exit: killing a function mid-step resumes the run within two minutes.

### N3. Retries that change the request

- The same failure twice on one step escalates in order: lower max output tokens; tell the model the last attempt
  was too large and to write in parts or use the computer; compact on context overflow; lower reasoning effort and
  nudge after an empty reply; fall back to another model.
- An interrupted step re-runs with a note listing each started tool call and whether it completed ("check before
  redoing"). Tool calls are keyed by tool call id, so a replay returns the stored result.

### N4. Commands as durable jobs; the computer follows the run

- `computer_exec` waits up to 120 s, then hands the process to a job: a small workflow that polls in short steps
  with durable sleeps, persists output and delivers the result as a message. A turn cannot end while jobs run;
  `job_wait` and `job_cancel` tools.
- Status is a long poll with a cursor; an uncertain outcome replaces the computer before it runs anything else.
- The computer counts as busy while a turn is open, a job runs or a message is queued; it idle-stops only after
  the run is idle, with a filesystem snapshot.

### N5. No silent streams

- The subscription bridge passes Anthropic tool-input deltas through instead of buffering them, and sends an SSE
  comment every 15 s.
- Model transports bound connecting and headers only; 10 minutes of silence is a retryable stall.

### N6. Model calls outside the step limit

- A runner interface (start, wait, cancel) with an inline implementation: no behaviour change.
- A one-day spike, one scenario on Rivet Actors, Cloudflare Durable Objects and a plain Node service beside the
  bridge: a 20-minute stream, killed and redeployed mid-way. Pass: the run completes and the reply is written
  once. Check whether Rivet actors sleep during long outbound streams.
- The winner is keyed by run and receipt, streams chunks to Convex and fires a workflow hook on completion. It
  runs model calls only; tools stay in the workflow. Subscription and BYOK models move first.

### N7. Long-run health

- Hitting a budget limit asks to approve another window instead of ending.
- Compaction runs between turns on a forked copy; a one-hour prompt cache; a fresh workflow run after compaction
  keeps history bounded.

## Proof

- A CI fault-injection suite: at every step boundary inject a lost completion, a killed function, a deploy, a
  dropped stream, 15 minutes of silence, 429/503, GOAWAY and a tool timeout. It passes only if every run ends
  done, cancelled, paused for budget or paused for input.
- A production alarm on any run that ends otherwise. Each hit is a bug, fixed the same day.

## Order

N1 with N2, then N3, N4, N5, and N6. N7 can run alongside.

# Runs that never stop

Status: proposed, written 2026-11-26. Nothing built yet.

## Goal

A run ends only when it finishes or the person cancels it, and pauses only for budget or the person's input.
Timeouts, dropped connections, provider errors, deploys and crashes never end a run. If a provider is down for
hours, the run waits and resumes on its own.

## Why runs stop today

- Retries are counted per run (3 interrupted model calls, 2 internal faults), then the run ends with an error.
- Retries resend the identical request, so a deterministic failure (a tool call too large to stream in time)
  repeats.
- A model call lives in one workflow step, capped at 800 s by the function limit.
- Long commands block a step (`computer_exec`, 5 min) or rely on the model polling; the computer idle-stops when
  tool calls pause.
- Nothing resumes a run whose step died without recording a failure.

## Prior art

- **eve** (Vercel, Workflow SDK like us): cause-chain error classification; retries that change the request; a
  recovery note after an interrupted step; commands that yield into durable task workflows; sandbox lifetime tied
  to session busyness; budget as an approval; a fresh run after compaction; step-fault tests. It waits for the
  next message after a failure and cannot carry a model call past the function limit.
- **opencomputer**: the agent loop runs in long-lived processes (VMs, Cloudflare Durable Objects), so no step
  limit; no idle timeout on model streams; turn leases renewed by every stream frame, with an alarm for lapsed
  turns; commands keyed by tool call id with long-poll status; the computer's idle clock tied to turns.

## Phases

### N1. Failures pause, never end

- One classifier over the cause chain: transient (timeouts, resets, 408/429/5xx, GOAWAY, stalls), needs input
  (reconnect a subscription, model removed, approval, a rejected request), budget, cancel.
- Transient errors retry indefinitely per call, backoff capped at 5 minutes, honouring `Retry-After`. The run
  shows "Waiting for Claude, retrying" with Stop.
- Retry counts stop ending runs. Exit: no path marks a run failed except cancel.

### N2. Lease and sweeper (ships with N1)

- Each active step holds a Convex lease: 60 s, renewed every 15 s and on stream chunks.
- A Convex cron finds lapsed leases and stalled runs, settles the step as interrupted and re-enqueues the run.
- Exit: killing a function mid-step resumes the run within two minutes.

### N3. Retries that change the request

- The same failure twice on one step escalates: lower max output; tell the model to write in parts or use the
  computer; compact on overflow; lower reasoning effort and nudge after an empty reply; fall back to another
  model.
- An interrupted step re-runs with a note listing each started tool call and whether it completed. Tool calls are
  keyed by tool call id, so a replay returns the stored result.

### N4. Commands as durable jobs; the computer follows the run

- `computer_exec` waits up to 120 s, then hands the process to a job workflow that polls in short steps with
  durable sleeps and delivers the result as a message. A turn cannot end while jobs run.
- An uncertain command outcome replaces the computer before it runs anything else.
- The computer stays up while a turn is open, a job runs or a message is queued, and snapshots its disk when it
  idle-stops.

### N5. No silent streams

- The subscription bridge passes tool-input deltas through instead of buffering, and sends an SSE comment every
  15 s.
- Transports bound connecting and headers only; 10 minutes of silence is a retryable stall.

### N6. Model calls outside the step limit

- A runner interface (start, wait, cancel) with an inline implementation and no behaviour change.
- A one-day spike on Rivet Actors, Cloudflare Durable Objects and a plain Node service beside the bridge: a
  20-minute stream, killed and redeployed mid-way. Pass: the run completes and the reply is written once.
- The winner streams chunks to Convex and fires a workflow hook on completion. Model calls only; tools stay in the
  workflow. Subscription and BYOK models first.

### N7. Long-run health

- Hitting a budget limit asks to approve another window.
- Compaction between turns on a forked copy, a one-hour prompt cache, and a fresh workflow run after compaction.

## Proof

- CI fault injection at every step boundary: lost completion, killed function, deploy, dropped stream, 15 minutes
  of silence, 429/503, GOAWAY, tool timeout. Every run must end done, cancelled or paused.
- A production alarm on any other ending; each hit is fixed the same day.

## Order

N1 with N2, then N3, N4, N5 and N6. N7 can run alongside.

# Runs that never stop

Status: proposed, written 2026-11-26; N4 revised the same day to jobs that call back. Nothing built yet.

## Goal

A run ends only when it finishes or the person cancels it, and pauses only for budget or the person's input.
Timeouts, dropped connections, provider errors, deploys and crashes never end a run. If a provider is down for
hours, the run waits and resumes on its own.

## Why runs stop today

- Retries are counted per run (3 interrupted model calls, 2 internal faults), then the run ends with an error.
- Retries resend the identical request, so a deterministic failure repeats.
- A model call lives in one workflow step, capped at 800 s by the function limit.
- Long commands block a step (`computer_exec`, 5 min) or rely on the model polling; the computer idle-stops
  between tool calls.
- Nothing resumes a run whose step died without recording a failure.

## Prior art

- **eve** (Vercel, Workflow SDK like us): cause-chain error classification; retries that change the request; a
  recovery note after an interrupted step; budget as an approval; step-fault tests. After a failure it waits for
  the next message.
- **opencomputer**: the agent loop runs in long-lived processes; no idle timeout on model streams; leases renewed
  by every stream frame; the computer's idle clock tied to turns.

## Phases

### N1. Failures pause, never end

- One classifier over the cause chain: transient (timeouts, resets, 408/429/5xx, stalls), needs input
  (reconnect, model removed, approval, a rejected request), budget, cancel.
- Transient errors retry indefinitely per call, backoff capped at 5 minutes, honouring `Retry-After`. The run
  shows "Waiting for Claude, retrying" with Stop.
- Retry counts stop ending runs. Exit: no path marks a run failed except cancel.

### N2. Lease and sweeper (ships with N1)

- Each active step holds a 60 s Convex lease, renewed every 15 s and on stream chunks.
- A Convex cron finds lapsed leases and stalled runs, settles the step as interrupted and re-enqueues the run.
- Exit: killing a function mid-step resumes the run within two minutes.

### N3. Retries that change the request

- The same failure twice on one step escalates: lower max output; tell the model to write in parts; compact on
  overflow; nudge after an empty reply; fall back to another model.
- An interrupted step re-runs with a note listing which started tool calls completed. Tool calls are keyed by id,
  so a replay returns the stored result.

### N4. Jobs that call back; the computer follows the run

- A job supervisor on each computer (the Agent Host on a Mac, a process in the cloud image) starts commands
  detached and returns a job id at once. `computer_exec` becomes a job once it runs past 60 s.
- The computer calls back with a one-time job token: done (exit code, output tail, log path), needs input (an
  `overlay ask` command or an agent CLI's permission hook), or progress. The endpoint writes the reply to Convex
  and calls `resumeHook`, reusing the harness's durable waits; repeats are ignored by job id.
- The agent keeps working; with nothing left, the run parks on the job's wait, using no compute.
- Backstop: a heartbeat every minute. If it stops, the job is marked lost and the run wakes, replacing the
  computer if it died. A long-silent job shows as "looks stuck".
- The computer stays up while a turn is open, a job runs or a message is queued, and snapshots its disk when it
  idle-stops.

### N5. No silent streams

- The subscription bridge passes tool-input deltas through instead of buffering, and sends an SSE comment every
  15 s.
- Transports bound connecting and headers only; 10 minutes of silence is a retryable stall.

### N6. Model calls outside the step limit

- A runner interface (start, wait, cancel), first with an inline implementation.
- A one-day spike on Rivet Actors, Cloudflare Durable Objects and a Node service beside the bridge: a 20-minute
  stream, killed and redeployed mid-way, must complete with the reply written once.
- The winner streams chunks to Convex and fires a workflow hook when done. Model calls only; subscription and BYOK
  first.

### N7. Long-run health

- Hitting a budget limit asks to approve another window.
- Compaction between turns on a fork, a one-hour prompt cache, and a fresh workflow run after compaction.

## Proof

- CI fault injection at every step boundary (lost completion, killed function, deploy, dropped stream, long
  silence, 429/503, lost job callback): every run must end done, cancelled or paused.
- A production alarm on any other ending, each hit fixed the same day.

## Order

N1 with N2, then N3, N4, N5 and N6. N7 can run alongside.

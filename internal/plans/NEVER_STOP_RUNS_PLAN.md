# Runs that never stop

Status: in progress. The first slice (N1 for faults inside a model invocation, the N2 sweep as detection, the
production alarm, the repeated-failure note and the computer staying up for terminal sessions) is deployed on web
and Convex. The sweep was run in production and reported the existing orphaned runs once; unlimited retries and
replays are covered by tests but not yet seen in a production run. Everything else waits for evidence from the
alarm.

## Goal

A run ends only when it finishes or the person cancels it, and pauses only for budget or the person's input.
Timeouts, dropped connections, provider errors, deploys and crashes never end a run. If a provider is down for
hours, the run waits and resumes on its own.

## What production showed

Most runs that ended as failed died inside a model invocation from a temporary cause: an Overlay fault, a dropped
model call, a provider outage or rate limit, or a tool whose outcome was lost. Budget exhaustion also ended runs
as failed instead of pausing them, and some failures needed the person (a model removed, a rejected request).
Orphans, runs whose workflow died while they stayed "running", exist but are rare.

## Done (first slice)

- **Temporary faults never end a run.** Model calls that drop, time out or hit an outage retry until they succeed,
  backing off from 5 s to 5 min (`model-ports.ts`). Faults inside an invocation replay from the last boundary with
  no limit (`settleInternalFault` in `runner.ts`). A replay after tools had started tells the model which ones may
  have run, so it checks before repeating them (eve's interrupted-step note).
- **Same step fails twice:** the replay tells the model to split large output and run long commands in
  `computer_terminal`.
- **Alarm:** a run that still ends any other way, and a run on its 5th, 10th… retry, is reported to Sentry
  (`harness_run_stopped`, `harness_run_retrying`, `src/server/harness/harness-alerts.ts`).
- **Stalled-run sweep (detection):** every 10 minutes, runs still marked running and quiet for 20 minutes are
  checked with the Workflow SDK; a run whose workflow ended is reported once (`harness_run_orphaned`,
  `convex/harness/stalledRuns.ts`, `POST /api/v1/harness/stalled`).
- **Computer stays up for terminal sessions:** the idle check asks the machine and keeps it running while a
  session runs (`hasRunningTerminalSessions`).
- Earlier: subscription and BYOK model streams may be silent for 780 s.

## Next

- **Budget pauses instead of failing**, and a budget limit asks to approve another window (eve).
- **Needs-input failures pause** with the action to take (reconnect, pick another model) instead of ending.
- **Errors outside an invocation** (in the workflow's own steps) still end the run; route the temporary ones
  through the same replay.

## Deferred, with what triggers them

- **Resume orphans automatically.** Needs the runner checkpoint persisted after every step. Trigger: the orphan
  alert fires more than rarely.
- **Jobs that call back.** A wrapper on each terminal session posts done, needs-input and a heartbeat to a callback
  that answers the run's durable wait (`resumeHook`); installed lazily like the desktop driver, and through an
  Agent Host release on Macs. Trigger: a real long job fails, or agents poll jobs wastefully.
- **No silent streams.** The subscription bridge passes tool-input deltas through and pings every 15 s. Trigger:
  stream timeouts in the alarm.
- **Model calls outside the step limit.** A runner service (Rivet Actors, Cloudflare Durable Objects or a Node
  service beside the bridge, chosen by a one-day spike). Trigger: model calls hitting 780 s after the
  repeated-failure note.
- **Long-run health.** Compaction between turns on a fork, a one-hour prompt cache, a fresh workflow run after
  compaction. Trigger: runs regularly lasting days.

## Prior art

- **eve** (Vercel): cause-chain classification, retries that change the request, the interrupted-step note,
  budget as an approval, step-fault tests.
- **opencomputer**: long-lived agent loops, no stream idle timeout, leases with an alarm, the computer's idle
  clock tied to turns.

## Proof

- Tests cover unlimited retries and replays, the notes, the alerts, the sweep and the terminal idle check.
- The alarm is the ongoing proof: every `harness_run_stopped` or `harness_run_orphaned` event is a bug, fixed the
  same day. Grow the fault-injection tests from each new cause.

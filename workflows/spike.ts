/**
 * Workflow SDK spike — proves the SDK is viable in our Next.js 16 + Sentry +
 * cacheComponents stack.
 *
 * This workflow:
 *   1. Runs a step that records a start timestamp
 *   2. Sleeps for 30 seconds (suspending the workflow — zero compute cost)
 *   3. Runs a step that records an end timestamp and computes the elapsed time
 *
 * The workflow survives a dev server restart during the sleep — on resume,
 * step 1's result is replayed from the event log (not re-executed), and only
 * step 2 runs.
 *
 * Trigger via: POST /api/v1/workflows/spike
 * Inspect via: npx workflow web
 */

import { sleep } from "workflow"

export async function spikeWorkflow() {
  "use workflow"

  const startResult = await recordStart()

  // Sleep for 30 seconds — the workflow suspends here with zero resource usage.
  // On Vercel, this can sleep for days. Locally, it suspends until the dev
  // server is running again (survives restarts).
  await sleep("30s")

  const endResult = await recordEnd()

  return {
    startedAt: startResult.startedAt,
    endedAt: endResult.endedAt,
    elapsedMs:
      new Date(endResult.endedAt).getTime() -
      new Date(startResult.startedAt).getTime(),
  }
}

async function recordStart() {
  "use step"
  return { startedAt: new Date().toISOString() }
}

async function recordEnd() {
  "use step"
  return { endedAt: new Date().toISOString() }
}

/**
 * API route to trigger the Workflow SDK spike workflow.
 * POST /api/v1/workflows/spike
 *
 * Returns the workflow run ID so you can inspect it with `npx workflow web`.
 */

import { start } from "workflow/api"
import { spikeWorkflow } from "@/workflows/spike"

export const maxDuration = 60

export async function POST() {
  try {
    const runId = await start(spikeWorkflow, [])
    return Response.json({ ok: true, runId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}

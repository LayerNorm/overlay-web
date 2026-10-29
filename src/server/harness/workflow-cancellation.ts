import 'server-only'

import { getRun } from 'workflow/api'

/** Cancellation can race finalization or a previous Stop cleanup. */
export async function cancelHarnessWorkflow(workflowRunId: string): Promise<void> {
  const run = getRun(workflowRunId)
  try {
    await run.cancel()
  } catch (error) {
    // Verify terminal state rather than swallowing an SDK or transport failure.
    const status = await run.status.catch((_error) => undefined)
    if (status === 'cancelled' || status === 'completed' || status === 'failed') return
    throw error
  }
}

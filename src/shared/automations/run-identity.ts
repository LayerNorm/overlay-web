/**
 * Identity of an automation run. Every writer (Convex, the thread dispatch,
 * admission) derives these from the run, so they can never disagree.
 */

export const AUTOMATION_THREAD_RUN_OWNER_PREFIX = 'automation-thread:'

/** The one turn ID an automation run may use. */
export function automationRunTurnId(runId: string): string {
  return `automation-run:${runId}`
}

/**
 * Owner token stamped on a run that posts into its automation's thread. It
 * fences the ledger row the way a workflow run ID used to: only the dispatch
 * that stamped it may link the message or settle the row.
 */
export function automationThreadRunOwner(runId: string): string {
  return `${AUTOMATION_THREAD_RUN_OWNER_PREFIX}${runId}`
}

/**
 * Deterministic approval token for a run that waits for approval: the run
 * workflow's hook suspends on it and the approve route resumes it.
 */
export function automationApprovalToken(automationId: string, runTimestamp: number): string {
  return `automation-approval:${automationId}:${runTimestamp}`
}

/**
 * Identity of an automation run. Every writer (Convex, the run workflow,
 * admission) derives these from the run, so they can never disagree.
 */

/** The one turn ID an automation run may use. */
export function automationRunTurnId(runId: string): string {
  return `automation-run:${runId}`
}

/**
 * Deterministic approval token for a run that waits for approval: the run
 * workflow's hook suspends on it and the approve route resumes it.
 */
export function automationApprovalToken(automationId: string, runTimestamp: number): string {
  return `automation-approval:${automationId}:${runTimestamp}`
}

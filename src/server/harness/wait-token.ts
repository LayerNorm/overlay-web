export function harnessWakeToken(workflowRunId: string) {
  return `harness:wake:${workflowRunId}`
}

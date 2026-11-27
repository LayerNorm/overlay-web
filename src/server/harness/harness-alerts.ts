/**
 * Alerts for runs that end or keep failing without finishing (internal/plans/NEVER_STOP_RUNS_PLAN.md). A run should end
 * only when it finishes or is cancelled; every other ending, and a fault that keeps repeating, is a bug to fix the same
 * day. These are workflow steps because the runner and workflows run in the workflow sandbox, where Sentry cannot load.
 * Each carries ids and codes only, never prompt, output or provider text.
 */

type HarnessAlert = {
  runId: string
  code: string
  stage?: string
  diagnosticId?: string
}

export async function captureHarnessAlert(name: string, alert: HarnessAlert & Record<string, string | number | undefined>) {
  try {
    const Sentry = await import('@sentry/nextjs')
    Sentry.captureMessage(name, {
      level: 'error',
      tags: { harness_alert: name, harness_code: alert.code, ...(alert.stage ? { harness_stage: alert.stage } : {}) },
      // One issue per kind and cause, so a new cause opens a new issue.
      fingerprint: [name, alert.code],
      extra: alert,
    })
  } catch (_error) {
    // An alert must never change what happens to the run.
  }
}

/** A run ended other than by finishing or a cancel. */
export async function reportHarnessStopped(alert: HarnessAlert): Promise<void> {
  'use step'
  await captureHarnessAlert('harness_run_stopped', alert)
}

/** A run keeps retrying the same step: it has not stopped, but something keeps failing. */
export async function reportHarnessRetrying(alert: HarnessAlert & { attempts: number; kind: 'fault' | 'model' }): Promise<void> {
  'use step'
  await captureHarnessAlert('harness_run_retrying', alert)
}
reportHarnessStopped.maxRetries = 2
reportHarnessRetrying.maxRetries = 2

import type { WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'

export function onboardingTaskMessage(summary: Pick<WorkspaceBillingSummaryResponse, 'canManage' | 'executionAccess'>, workspaceName: string): string {
  if (summary.executionAccess?.canExecute) return `Saved. ${workspaceName}'s budget covers this, so you can start now.`
  if (!summary.canManage && summary.executionAccess?.state === 'subscription_required') return `Saved as a draft. ${workspaceName} needs an active plan before tasks can run, and only owners and admins can set that up.`
  return "I've saved your first task. We'll check your workspace budget before we start."
}

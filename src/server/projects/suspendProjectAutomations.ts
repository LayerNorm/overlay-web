import 'server-only'

import type { AutomationRepository } from '@/server/automations/AutomationRepository'

type ProjectAutomationRepository = Pick<
  AutomationRepository,
  'listAutomations' | 'listRuns' | 'pauseAutomation' | 'requestRunCancellation'
> & Pick<AutomationRepository, 'requestActiveRunCancellation'>

export async function suspendProjectAutomations(args: {
  projectId: string
  repository: ProjectAutomationRepository
  userId: string
}): Promise<{ cancelledRuns: number; pausedAutomations: number }> {
  const automations = await args.repository.listAutomations({
    projectId: args.projectId,
    userId: args.userId,
  })

  const results = await Promise.all(automations.map(async (automation) => {
    let pausedAutomations = 0
    if (automation.enabled !== false) {
      await args.repository.pauseAutomation({
        automationId: automation._id,
        userId: args.userId,
      })
      pausedAutomations = 1
    }
    if (args.repository.requestActiveRunCancellation) {
      const cancelledRuns = await args.repository.requestActiveRunCancellation({
        automationId: automation._id,
        userId: args.userId,
      })
      return { cancelledRuns, pausedAutomations }
    }
    const runs = await args.repository.listRuns({
      automationId: automation._id,
      userId: args.userId,
    })
    const results = await Promise.all(runs
      .filter(({ status }) => status === 'queued' || status === 'running')
      .map(({ _id }) => args.repository.requestRunCancellation({
        runId: _id,
        userId: args.userId,
      })))
    return {
      cancelledRuns: results.filter(Boolean).length,
      pausedAutomations,
    }
  }))

  return results.reduce((total, result) => ({
    cancelledRuns: total.cancelledRuns + result.cancelledRuns,
    pausedAutomations: total.pausedAutomations + result.pausedAutomations,
  }), {
    cancelledRuns: 0,
    pausedAutomations: 0,
  })
}

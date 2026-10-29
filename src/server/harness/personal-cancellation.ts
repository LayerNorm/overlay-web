import 'server-only'

import { logger } from '@/server/observability/logger'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { cancelHarnessWorkflow } from './workflow-cancellation'

export type PersonalHarnessCancellation = {
  actorUserId: string
  agentRunId: string
  rootRunId: string
}

export async function cancelPersonalHarnessWorkflows(
  input: PersonalHarnessCancellation,
  dependencies?: {
    list: ConvexHarnessRepository['listDeliveryWorkflowRuns']
    cancel: (workflowRunId: string) => Promise<void>
  },
): Promise<void> {
  const repository = dependencies ? undefined : new ConvexHarnessRepository()
  const list = dependencies?.list ?? repository!.listDeliveryWorkflowRuns.bind(repository)
  const cancel = dependencies?.cancel ?? cancelHarnessWorkflow
  let cursor: string | null = null
  let isDone = false
  while (!isDone) {
    const page = await list({
      actorUserId: input.actorUserId,
      agentRunId: input.agentRunId,
      rootRunId: input.rootRunId,
      cursor,
    })
    for (const workflowRunId of page.workflowRunIds) {
      try {
        await cancel(workflowRunId)
      } catch (error) {
        logger.warn('[personal harness cancellation] Failed to cancel workflow run', { workflowRunId, error })
      }
    }
    cursor = page.cursor
    isDone = page.isDone
  }
}

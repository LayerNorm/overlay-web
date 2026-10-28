import 'server-only'

import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export async function canReadAutomationWorkflow(args: {
  workflowRunId: string
  userId: string
  workspaceId: string
}): Promise<boolean> {
  return await lazyConvex.query<boolean>('automations/workflowAccess:canReadByServer', {
    ...args, serverSecret: getInternalApiSecret(),
  }, { throwOnError: true }) === true
}

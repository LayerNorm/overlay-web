import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  DaytonaUsageAccrual,
  DaytonaWorkspaceRecord,
  DaytonaWorkspaceRepository,
  DaytonaWorkspaceUpsert,
} from './DaytonaWorkspaceRepository'

export class ConvexDaytonaWorkspaceRepository implements DaytonaWorkspaceRepository {
  async getByUserId(args: { userId: string }): Promise<DaytonaWorkspaceRecord | null> {
    return await convex.query<DaytonaWorkspaceRecord | null>('ai/sandbox/daytona:getWorkspaceByUserId', {
      ...args,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })
  }

  async listAll(): Promise<DaytonaWorkspaceRecord[]> {
    throw new Error('Workspace reconciliation is owned by the Convex scheduler')
  }

  async upsert(args: DaytonaWorkspaceUpsert): Promise<DaytonaWorkspaceRecord> {
    const workspace = await convex.mutation<DaytonaWorkspaceRecord | null>('ai/sandbox/daytona:upsertWorkspace', {
      ...args,
      serverSecret: getInternalApiSecret(),
    }, { throwOnError: true })
    if (!workspace) throw new Error('Failed to upsert Daytona workspace record.')
    return workspace
  }

  async reconcile(): Promise<never> {
    throw new Error('Workspace reconciliation is owned by the Convex scheduler')
  }

  async accrueUsage(args: DaytonaUsageAccrual) {
    return await convex.mutation<Awaited<ReturnType<DaytonaWorkspaceRepository['accrueUsage']>>>(
      'ai/sandbox/daytona:accrueUsageByServer',
      { ...args, serverSecret: getInternalApiSecret() },
      { throwOnError: true },
    )
  }
}

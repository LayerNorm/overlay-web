import 'server-only'

import type { WorkspaceResourceGrant } from '@overlay/workspace-contracts'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { UpsertWorkspaceResourceGrant, WorkspaceSharingRepository } from './WorkspaceSharingRepository'

const FUNCTION_PREFIX = 'collaboration/sharing'

export class ConvexWorkspaceSharingRepository implements WorkspaceSharingRepository {
  async upsert(input: UpsertWorkspaceResourceGrant) {
    return await requiredMutation<WorkspaceResourceGrant>('upsertByServer', input)
  }

  async remove(args: { grantId: string; workspaceId: string }) {
    return await mutation<boolean>('removeByServer', args) ?? false
  }

  async listForResource(args: Parameters<WorkspaceSharingRepository['listForResource']>[0]) {
    return await query<WorkspaceResourceGrant[]>('listForResourceByServer', args) ?? []
  }

  async listForTargets(args: Parameters<WorkspaceSharingRepository['listForTargets']>[0]) {
    return await query<WorkspaceResourceGrant[]>('listForTargetsByServer', args) ?? []
  }
}

function query<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.query<T>(
    `${FUNCTION_PREFIX}:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

function mutation<T>(operation: string, args: Record<string, unknown>): Promise<T | null> {
  return convex.mutation<T>(
    `${FUNCTION_PREFIX}:${operation}`,
    { ...stripUndefined(args), serverSecret: getInternalApiSecret() },
    { throwOnError: true },
  )
}

async function requiredMutation<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  const result = await mutation<T>(operation, args)
  if (!result) throw new Error(`Convex sharing operation ${operation} returned no result`)
  return result
}

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

import 'server-only'

import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  CreateWorkspaceAgentRecord,
  UpdateWorkspaceAgentRecord,
  WorkspaceAgentRepository,
} from './WorkspaceAgentRepository'

const FUNCTION_PREFIX = 'collaboration/agents'
type ConvexAgent = Omit<WorkspaceAgentDirectoryItem, 'id'> & { agentId: string }

export class ConvexWorkspaceAgentRepository implements WorkspaceAgentRepository {
  async create(input: CreateWorkspaceAgentRecord) {
    return agent(await requiredMutation<ConvexAgent>('createByServer', input))
  }

  async get(args: { agentId: string; workspaceId: string }) {
    const row = await query<ConvexAgent | null>('getByServer', args)
    return row ? agent(row) : null
  }

  async list(args: { workspaceId: string; includeArchived?: boolean }) {
    return (await query<ConvexAgent[]>('listByServer', args) ?? []).map(agent)
  }

  async update(input: UpdateWorkspaceAgentRecord) {
    const row = await mutation<ConvexAgent | null>('updateByServer', input)
    return row ? agent(row) : null
  }

  async archive(args: { agentId: string; workspaceId: string; now: number }) {
    return await mutation<boolean>('archiveByServer', args) ?? false
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
  if (!result) throw new Error(`Convex agent operation ${operation} returned no result`)
  return result
}

function agent(row: ConvexAgent): WorkspaceAgentDirectoryItem {
  const { agentId, ...value } = clean(row)
  // Older Convex deployments predate the access-mode feature and return rows
  // without `visibility`; treat absence as workspace-visible.
  return { ...value, visibility: value.visibility ?? 'workspace', id: agentId }
}

function clean<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row }
  delete copy._id
  delete copy._creationTime
  return copy
}

function stripUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

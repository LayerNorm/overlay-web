import type { CreateWorkItemRequest, UpdateWorkItemRequest, WorkItem } from '@overlay/app-core'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { api, mutateConvex, subscribeConvex } from './convexClient'
import { appJson } from './appApi'

export type WorkContext = NonNullable<FunctionReturnType<typeof api.work.browse.context>>
export type WorkThread = FunctionReturnType<typeof api.work.browse.linkedThread>
export type WorkEvents = FunctionReturnType<typeof api.work.browse.events>
export type WorkView = 'personal' | 'workspace'
export type WorkPolicy = FunctionReturnType<typeof api.collaboration.directory.policy>

export function subscribeWorkList(
  workspaceId: string,
  view: WorkView,
  onItems: (items: WorkItem[] | null) => void,
  onContext: (context: WorkContext | null) => void,
  onError: (error: unknown) => void,
  onPolicy: (policy: WorkPolicy) => void = () => undefined,
) {
  const stops: Array<() => void> = []
  try {
    stops.push(subscribeConvex(api.work.browse.list, { workspaceId, view }, onItems, onError))
    stops.push(subscribeConvex(api.work.browse.context, { workspaceId }, onContext, onError))
    stops.push(
      subscribeConvex(api.collaboration.directory.policy, { workspaceId }, onPolicy, onError),
    )
  } catch (error) {
    stops.forEach((stop) => stop())
    throw error
  }
  return () => stops.forEach((stop) => stop())
}

export function subscribeWorkTask(
  workspaceId: string,
  id: string,
  onItem: (item: WorkItem | null) => void,
  onEvents: (events: WorkEvents) => void,
  onThread: (thread: WorkThread) => void,
  onError: (error: unknown) => void,
) {
  const stops: Array<() => void> = []
  try {
    stops.push(subscribeConvex(api.work.browse.get, { workspaceId, id }, onItem, onError))
    stops.push(
      subscribeConvex(api.work.browse.events, { workspaceId, workItemId: id }, onEvents, onError),
    )
    stops.push(
      subscribeConvex(api.work.browse.linkedThread, { workspaceId, id }, onThread, onError),
    )
  } catch (error) {
    stops.forEach((stop) => stop())
    throw error
  }
  return () => stops.forEach((stop) => stop())
}

function requireItem(item: WorkItem | null): WorkItem {
  if (!item) throw new Error('This task is no longer available.')
  return item
}

export async function createWork(
  workspaceId: string,
  input: CreateWorkItemRequest,
): Promise<WorkItem> {
  if (input.assigneePrincipalId)
    return requireItem(
      (
        await appJson<{ item: WorkItem }>('/api/v1/work', {
          method: 'POST',
          workspaceId,
          json: { ...input },
        })
      ).item,
    )
  const fields = { ...input }
  delete fields.assigneePrincipalId
  return requireItem(await mutateConvex(api.work.browse.create, { ...fields, workspaceId }))
}

export async function updateWork(
  workspaceId: string,
  id: string,
  patch: UpdateWorkItemRequest,
): Promise<WorkItem> {
  if (patch.assigneePrincipalId !== undefined || patch.scope !== undefined)
    return requireItem(
      (
        await appJson<{ item: WorkItem }>('/api/v1/work/' + encodeURIComponent(id), {
          method: 'PATCH',
          workspaceId,
          json: { ...patch },
        })
      ).item,
    )
  const fields = { ...patch }
  delete fields.assigneePrincipalId
  delete fields.scope
  return requireItem(await mutateConvex(api.work.browse.update, { ...fields, id, workspaceId }))
}

export async function moveWork(
  workspaceId: string,
  input: Omit<FunctionArgs<typeof api.work.browse.move>, 'workspaceId'>,
) {
  return requireItem(await mutateConvex(api.work.browse.move, { ...input, workspaceId }))
}

export async function commentWork(workspaceId: string, workItemId: string, body: string) {
  if (!body.trim()) throw new Error('Write a comment first.')
  return mutateConvex(api.work.browse.addComment, { workspaceId, workItemId, body: body.trim() })
}

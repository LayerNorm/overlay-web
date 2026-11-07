'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQueries } from 'convex/react'
import { toast } from '@overlay/ui/primitives'
import type {
  CreateWorkItemRequest,
  MoveWorkItemRequest,
  UpdateWorkItemRequest,
  WorkContext,
  WorkItem,
  WorkPerson,
} from '@overlay/app-core'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useWorkspaceCreateAccess } from '@/hooks/use-workspace-create-access'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { canWorkOnItem } from '@/shared/work/permissions'
import { parseWorkErrorReason, workErrorMessage } from '@/shared/work/errors'
import { WORK_LIMITS } from '@/shared/work/status'
import { newItemScope } from '@/shared/workspaces/panel-scope'
import type { WorkViewer } from '@/shared/work/query'
import { api } from '../../../../convex/_generated/api'
import { useWorkRoute } from '../lib/use-work-route'
import { useLiveWork, useWorkCommands } from '../lib/use-live-work'

export type WorkLoadState = 'loading' | 'ready' | 'error'

export interface WorkData {
  state: WorkLoadState
  items: WorkItem[]
  byId: ReadonlyMap<string, WorkItem>
  /** People and agents a task can be given to, and who is asking. Null until loaded. */
  context: WorkContext | null
  people: readonly WorkPerson[]
  personByPrincipal: ReadonlyMap<string, WorkPerson>
  viewer: WorkViewer | null
  /** The server returned as many tasks as it ever sends (`WORK_LIMITS.listCap`), so there may be more than are shown. */
  truncated: boolean
  /** Whether the viewer may edit this task (status, fields, comments). The server decides again on every change. */
  canWork: (item: WorkItem) => boolean
  createTask: (input: Omit<CreateWorkItemRequest, 'scope'>) => Promise<WorkItem | null>
  updateTask: (id: string, patch: UpdateWorkItemRequest) => Promise<WorkItem | null>
  moveTask: (id: string, input: MoveWorkItemRequest) => Promise<WorkItem | null>
  /** Keeps a task the list does not hold (another scope, archived, past the list window) live and editable. */
  adoptTask: (id: string) => void
}

const WorkDataContext = createContext<WorkData | null>(null)

export function useWorkData(): WorkData {
  const value = useContext(WorkDataContext)
  if (!value) throw new Error('useWorkData must be used inside WorkDataProvider')
  return value
}

function messageOf(error: unknown, fallback: string): string {
  const reason = parseWorkErrorReason(error)
  if (reason) return workErrorMessage(reason)
  return error instanceof Error && error.message && !error.message.includes('[CONVEX') ? error.message : fallback
}

/** Runs a change, saying what went wrong if the server refuses it. The live lists show the outcome either way. */
async function reported<T>(run: () => Promise<T>, fallback: string): Promise<T | null> {
  try {
    return await run()
  } catch (caught) {
    toast.error(messageOf(caught, fallback))
    return null
  }
}

/**
 * The tasks for the page's scope, live from Convex. Every change appears at once through an optimistic update, the
 * server's answer replaces it, and a refused change rolls back by itself without touching later changes.
 */
export function WorkDataProvider({ children }: { children: ReactNode }) {
  const { listView, scope } = useWorkRoute()
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const { access, viewer: accessViewer } = useWorkspaceCreateAccess()
  const { items: liveItems, context } = useLiveWork(listView)
  const commands = useWorkCommands()

  // Tasks opened by link that the list does not hold, each its own live query.
  const [adopted, setAdopted] = useState<{ workspaceId: string | null; ids: readonly string[] }>({ workspaceId: null, ids: [] })
  const adoptedIds = adopted.workspaceId === activeWorkspaceId ? adopted.ids : []
  const adoptedResults = useQueries(useMemo(() => Object.fromEntries(adoptedIds.map(id => [id, {
    query: api.work.browse.get,
    args: activeWorkspaceId ? { workspaceId: activeWorkspaceId, id } : 'skip',
  }])), [activeWorkspaceId, adoptedIds]) as never) as Record<string, WorkItem | null | undefined | Error>
  const adoptTask = useCallback((id: string) => {
    setAdopted(current => {
      const ids = current.workspaceId === activeWorkspaceId ? current.ids : []
      return ids.includes(id) ? current : { workspaceId: activeWorkspaceId, ids: [...ids, id] }
    })
  }, [activeWorkspaceId])

  const items = useMemo(() => liveItems ?? [], [liveItems])
  const state: WorkLoadState = liveItems === undefined ? 'loading' : liveItems === null ? 'error' : 'ready'

  const createTask = useCallback<WorkData['createTask']>(async (input) => {
    const scopeToSend = newItemScope(scope)
    const withScope = { ...input, ...(scopeToSend ? { scope: scopeToSend } : {}) }
    // Giving a new task to an agent starts that agent's turn, which only the server can do.
    if (input.assigneePrincipalId) {
      return reported(async () => (await overlayAppClient.work.create(withScope)).item, 'Could not add the task.')
    }
    return reported(() => commands.create(withScope), 'Could not add the task.')
  }, [commands, scope])

  const updateTask = useCallback<WorkData['updateTask']>((id, patch) => {
    const { assigneePrincipalId, scope: nextScope, ...fields } = patch
    // Assignment starts an agent's turn and scope moves re-check access; both stay on the server.
    if (assigneePrincipalId !== undefined || nextScope !== undefined) {
      return reported(async () => (await overlayAppClient.work.update(id, patch)).item, 'Could not save that change.')
    }
    return reported(() => commands.update({ id, ...fields }), 'Could not save that change.')
  }, [commands])

  const moveTask = useCallback<WorkData['moveTask']>((id, input) => (
    reported(async () => (await overlayAppClient.work.move(id, input)).item, 'Could not move the task.')
  ), [])

  const viewer = useMemo<WorkViewer | null>(
    () => (user?.id && context ? { userId: user.id, principalId: context.principalId } : null),
    [context, user?.id],
  )
  const people = useMemo(() => context?.people ?? [], [context])
  const personByPrincipal = useMemo(() => new Map(people.map((person) => [person.principalId, person])), [people])
  const byId = useMemo(() => {
    const all = new Map(items.map((item) => [item.id, item]))
    for (const result of Object.values(adoptedResults)) {
      if (result && !(result instanceof Error) && !all.has(result.id)) all.set(result.id, result)
    }
    return all as ReadonlyMap<string, WorkItem>
  }, [adoptedResults, items])

  const canWork = useCallback((item: WorkItem) => {
    if (!viewer || !context) return false
    return canWorkOnItem(
      { userId: item.createdBy, scope: item.scope, archivedAt: item.archivedAt ?? undefined, archivedFromScope: item.archivedFromScope ?? undefined, assigneePrincipalId: item.assigneePrincipalId },
      { userId: viewer.userId, role: accessViewer?.role ?? context.role },
      viewer.principalId,
      access.scope,
    )
  }, [access.scope, accessViewer?.role, context, viewer])

  const value = useMemo<WorkData>(() => ({
    state, items, byId, context, people, personByPrincipal, viewer,
    truncated: items.length >= WORK_LIMITS.listCap,
    canWork, createTask, updateTask, moveTask, adoptTask,
  }), [adoptTask, byId, canWork, context, createTask, items, moveTask, people, personByPrincipal, state, updateTask, viewer])

  return <WorkDataContext.Provider value={value}>{children}</WorkDataContext.Provider>
}

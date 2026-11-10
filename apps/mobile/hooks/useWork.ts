import { useEffect, useState } from 'react'
import type { WorkItem } from '@overlay/app-core'
import {
  subscribeWorkList,
  subscribeWorkTask,
  type WorkContext,
  type WorkEvents,
  type WorkThread,
  type WorkView,
  type WorkPolicy,
} from '../services/workService'

export function useWork(workspaceId: string | null, view: WorkView, id?: string) {
  const key = JSON.stringify([workspaceId, view, id])
  const [attempt, retry] = useState(0)
  const [state, set] = useState<{
    key: string
    items?: WorkItem[] | null
    context?: WorkContext | null
    item?: WorkItem | null
    events?: WorkEvents
    thread?: WorkThread
    policy?: WorkPolicy
    error?: string
  }>({ key: '' })
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    const write = (patch: Partial<typeof state>) => {
      if (active) set((old) => ({ ...(old.key === key ? old : { key }), ...patch }))
    }
    const fail = (error: unknown) =>
      write({ error: error instanceof Error ? error.message : 'Unable to load Work.' })
    const stops: Array<() => void> = []
    try {
      stops.push(
        subscribeWorkList(
          workspaceId,
          view,
          (items) => write({ items }),
          (context) => write({ context }),
          fail,
          (policy) => write({ policy }),
        ),
      )
      if (id)
        stops.push(
          subscribeWorkTask(
            workspaceId,
            id,
            (item) => write({ item }),
            (events) => write({ events }),
            (thread) => write({ thread }),
            fail,
          ),
        )
    } catch (error) {
      fail(error)
    }
    return () => {
      active = false
      stops.forEach((stop) => stop())
    }
  }, [workspaceId, view, id, key, attempt])
  return {
    ...(state.key === key ? state : { key }),
    retry: () => {
      set({ key })
      retry((value) => value + 1)
    },
  }
}

import { useEffect, useState } from 'react'
import { api, subscribeConvex } from '../services/convexClient'
import type { FunctionReturnType } from 'convex/server'

export type DirectoryAgent = NonNullable<FunctionReturnType<typeof api.agents.directory.list>>['agents'][number]

/**
 * Live workspace agent directory. `agents` is undefined while loading and
 * null when agents are unavailable in the workspace.
 */
export function useAgentDirectory(workspaceId: string | null, attempt = 0) {
  const [state, setState] = useState<{
    key: string
    agents: DirectoryAgent[] | null | undefined
    canCreate: boolean
    error: string
  }>({ key: '', agents: undefined, canCreate: false, error: '' })
  const key = `${workspaceId}:${attempt}`
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    let stop: () => void = () => undefined
    try {
      stop = subscribeConvex(
        api.agents.directory.list,
        { workspaceId },
        (value) => {
          if (active) setState({ key, agents: value?.agents ?? null, canCreate: value?.canCreate ?? false, error: '' })
        },
        (reason) => {
          if (active) setState((previous) => ({ ...previous, key, error: String(reason) }))
        },
      )
    } catch (reason) {
      void Promise.resolve().then(() => {
        if (active) setState((previous) => ({ ...previous, key, error: String(reason) }))
      })
    }
    return () => {
      active = false
      stop()
    }
  }, [workspaceId, key])
  return state.key === key ? state : { key, agents: undefined, canCreate: false, error: '' }
}

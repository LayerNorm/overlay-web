import { useEffect, useMemo, useState } from 'react'
import { api, subscribeConvex } from '../services/convexClient'
import type { FunctionReturnType } from 'convex/server'
import { agentsForMode } from '../../src/shared/agents/last-agent-by-workspace'
import { pinChiefs } from '../../src/shared/agents/chief-identity'
import type { AppMode } from '../contexts/ModeContext'

export type DirectoryAgent = NonNullable<FunctionReturnType<typeof api.agents.directory.list>>['agents'][number]

type DirectoryState = {
  key: string
  agents: DirectoryAgent[] | null | undefined
  canCreate: boolean
  viewerPrincipalId: string | null
  error: string
}

/**
 * Live workspace agent directory. `agents` is undefined while loading and
 * null when agents are unavailable in the workspace. With a `mode`, only that
 * mode's agents are listed (Overlay and shared agents in Workspace; your own
 * chief and only-me agents in Personal), chiefs first, as on the web.
 */
export function useAgentDirectory(workspaceId: string | null, attempt = 0, mode?: AppMode) {
  const [state, setState] = useState<DirectoryState>({
    key: '',
    agents: undefined,
    canCreate: false,
    viewerPrincipalId: null,
    error: '',
  })
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
          if (active)
            setState({
              key,
              agents: value?.agents ?? null,
              canCreate: value?.canCreate ?? false,
              viewerPrincipalId: value?.viewerPrincipalId ?? null,
              error: '',
            })
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
  const current: DirectoryState =
    state.key === key ? state : { key, agents: undefined, canCreate: false, viewerPrincipalId: null, error: '' }
  const agents = useMemo(
    () =>
      mode && current.agents
        ? pinChiefs(agentsForMode(current.agents, current.viewerPrincipalId, mode), current.viewerPrincipalId)
        : current.agents,
    [mode, current.agents, current.viewerPrincipalId],
  )
  return { ...current, agents }
}

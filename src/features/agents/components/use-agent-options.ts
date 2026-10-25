'use client'

import { useEffect, useState } from 'react'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

/** Read only the environment bound to this agent; catalogs never bleed across machines. */
export function useAgentOptions(workspaceId: string | null, agentId: string) {
  const [loaded, setLoaded] = useState<{
    workspaceId: string; agentId: string; environment: AgentEnvironmentResource | null; error: string | null
  } | null>(null)
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      try {
        const [bindings, environments] = await Promise.all([
          overlayAppClient.agentEnvironments.listBindings(workspaceId, agentId),
          overlayAppClient.agentEnvironments.list(workspaceId),
        ])
        const binding = bindings.bindings.find(value => value.agentId === agentId && value.enabled)
        const bound = environments.environments.find(value => value.id === binding?.environmentId) ?? null
        if (!cancelled) setLoaded({ workspaceId, agentId, environment: bound, error: null })
      } catch (error) {
        if (!cancelled) setLoaded(previous => ({ workspaceId, agentId,
          environment: previous?.workspaceId === workspaceId && previous.agentId === agentId ? previous.environment : null,
          error: error instanceof Error ? error.message : 'Could not load agent options.' }))
      } finally { pending = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [workspaceId, agentId])
  return loaded?.workspaceId === workspaceId && loaded.agentId === agentId
    ? { environment: loaded.environment, error: loaded.error, loading: false }
    : { environment: null, error: null, loading: Boolean(workspaceId) }
}

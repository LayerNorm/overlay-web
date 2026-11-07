'use client'

import { useMemo } from 'react'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import { useLiveAgentBindings, useLiveAgentEnvironments } from '@/hooks/use-connections'

/** Read only the environment bound to this agent; catalogs never bleed across machines. Live, with no polling. */
export function useAgentOptions(workspaceId: string | null, agentId: string) {
  const environments = useLiveAgentEnvironments()
  const bindings = useLiveAgentBindings(agentId)
  return useMemo(() => {
    if (!workspaceId || environments === undefined || bindings === undefined) {
      return { environment: null as AgentEnvironmentResource | null, error: null as string | null, loading: Boolean(workspaceId) }
    }
    if (environments === null || bindings === null) {
      return { environment: null, error: 'Could not load agent options.', loading: false }
    }
    const binding = bindings.find((value) => value.agentId === agentId && value.enabled)
    return { environment: environments.find((value) => value.id === binding?.environmentId) ?? null, error: null, loading: false }
  }, [agentId, bindings, environments, workspaceId])
}

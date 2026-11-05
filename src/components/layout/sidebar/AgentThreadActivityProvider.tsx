'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQueries } from '@/components/providers/convex-hooks'
import { useConvexAuthToken } from '@/components/providers/ConvexAuthProvider'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAuth } from '@/contexts/AuthContext'
import type { ThreadActivity } from '@/shared/agents/thread-activity'
import { api } from '../../../../convex/_generated/api'

const ActivityContext = createContext<Record<string, ThreadActivity[]>>({})

export function useAgentThreadActivity(agentId: string) {
  return useContext(ActivityContext)[agentId]
}

type Props = { workspaceId: string | null; agentIds: string[]; children: ReactNode }

function ConvexThreadActivity({ workspaceId, agentIds, children }: Props) {
  const accessToken = useConvexAuthToken()
  const { user } = useAuth()
  const userId = user?.id
  const queries = useMemo(() => Object.fromEntries(
    accessToken && userId && workspaceId ? agentIds.map(agentId => [agentId, {
      query: api.agents.agentThreads.watchThreadActivity,
      args: { accessToken, userId, workspaceId, agentId },
    }]) : [],
  ), [accessToken, userId, workspaceId, agentIds])
  // Unlike useQuery, useQueries returns errors. Old backends can omit this
  // additive projection during web-first rollout without breaking navigation.
  const results = useQueries(queries)
  const activity = Object.fromEntries(Object.entries(results).filter(([, value]) => Array.isArray(value)))
  return <ActivityContext.Provider value={activity}>{children}</ActivityContext.Provider>
}

export function AgentThreadActivityProvider(props: Props) {
  const { appDataCapabilities } = useOverlayCapabilities()
  if (appDataCapabilities.provider !== 'convex' || !appDataCapabilities.supportsRealtime
    || !appDataCapabilities.requiresConvexClient) return <ActivityContext.Provider value={{}}>{props.children}</ActivityContext.Provider>
  return <ConvexThreadActivity key={props.workspaceId} {...props} />
}

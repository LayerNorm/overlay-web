'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useConvexAuth, useQueries } from '@/components/providers/convex-hooks'
import { useHasConvexClient } from '@/components/providers/ConvexAuthProvider'
import type { ThreadActivity } from '@/shared/agents/thread-activity'
import { api } from '../../../../convex/_generated/api'

const ActivityContext = createContext<Record<string, ThreadActivity[]>>({})

export function useAgentThreadActivity(agentId: string) {
  return useContext(ActivityContext)[agentId]
}

type Props = { workspaceId: string | null; agentIds: string[]; children: ReactNode }

function ConvexThreadActivity({ workspaceId, agentIds, children }: Props) {
  const { isAuthenticated } = useConvexAuth()
  const queries = useMemo(() => Object.fromEntries(
    isAuthenticated && workspaceId ? agentIds.map(agentId => [agentId, {
      query: api.agents.agentThreads.watchThreadActivity,
      args: { workspaceId, agentId },
    }]) : [],
  ), [isAuthenticated, workspaceId, agentIds])
  // Unlike useQuery, useQueries returns errors. Old backends can omit this
  // additive projection during web-first rollout without breaking navigation.
  const results = useQueries(queries)
  const activity = Object.fromEntries(Object.entries(results).filter(([, value]) => Array.isArray(value)))
  return <ActivityContext.Provider value={activity}>{children}</ActivityContext.Provider>
}

export function AgentThreadActivityProvider(props: Props) {
  const hasConvexClient = useHasConvexClient()
  if (!hasConvexClient) return <ActivityContext.Provider value={{}}>{props.children}</ActivityContext.Provider>
  return <ConvexThreadActivity key={props.workspaceId} {...props} />
}

'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useConvexAuth, useQueries } from 'convex/react'
import type { ThreadActivity } from '@/shared/agents/thread-activity'
import { api } from '../../../../convex/_generated/api'

const ActivityContext = createContext<Record<string, ThreadActivity[]>>({})

export function useAgentThreadActivity(agentId: string) {
  return useContext(ActivityContext)[agentId]
}

type Props = { workspaceId: string | null; agentIds: string[]; children: ReactNode }

export function AgentThreadActivityProvider({ workspaceId, agentIds, children }: Props) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const queries = useMemo(() => Object.fromEntries(
    isAuthenticated && !isLoading && workspaceId ? agentIds.map(agentId => [agentId, {
      query: api.agents.threads.activity,
      args: { workspaceId, agentId },
    }]) : [],
  ), [isAuthenticated, isLoading, workspaceId, agentIds])
  const results = useQueries(queries)
  const activity: Record<string, ThreadActivity[]> = {}
  for (const agentId of Object.keys(queries)) {
    const result = results[agentId]
    if (result instanceof Error) throw result
    if (result) activity[agentId] = result
  }
  return <ActivityContext.Provider value={activity}>{children}</ActivityContext.Provider>
}

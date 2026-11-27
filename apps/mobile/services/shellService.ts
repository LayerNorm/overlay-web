import type { FunctionReturnType } from 'convex/server'
import { api, mutateConvex, subscribeConvex } from './convexClient'

export type ShellAgent = NonNullable<
  FunctionReturnType<typeof api.agents.directory.list>
>['agents'][number]
export type AgentThreads = NonNullable<
  FunctionReturnType<typeof api.agents.threads.bundle>
>['threads']
export type AgentActivity = NonNullable<FunctionReturnType<typeof api.agents.threads.activity>>

export function subscribeAgents(
  workspaceId: string,
  onValue: (agents: ShellAgent[], viewerPrincipalId: string | null) => void,
  onError: (error: unknown) => void,
) {
  return subscribeConvex(
    api.agents.directory.list,
    { workspaceId },
    (value) => onValue(value?.agents ?? [], value?.viewerPrincipalId ?? null),
    onError,
  )
}

export function subscribeAgentThreads(
  workspaceId: string,
  agentId: string,
  onThreads: (threads: AgentThreads) => void,
  onActivity: (activity: AgentActivity) => void,
  onError: (error: unknown) => void,
) {
  const args = { workspaceId, agentId }
  const stopThreads = subscribeConvex(
    api.agents.threads.bundle,
    args,
    (value) => onThreads(value?.threads.filter((thread) => !thread.archivedAt) ?? []),
    onError,
  )
  const stopActivity = subscribeConvex(
    api.agents.threads.activity,
    args,
    (value) => onActivity(value ?? []),
    onError,
  )
  return () => {
    stopThreads()
    stopActivity()
  }
}

export function openAgentThread(workspaceId: string, agentId: string, create = false) {
  return create
    ? mutateConvex(api.agents.threads.create, { workspaceId, agentId })
    : mutateConvex(api.agents.threads.resolveMain, { workspaceId, agentId })
}

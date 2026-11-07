'use client'

import { useEffect, useMemo, useState } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'
import type { McpServerSummary } from '@overlay/app-core'
import type { AgentEnvironmentResource, McpConnectionResource } from '@overlay/api-client'
import { effectiveAgentEnvironmentStatus } from '@/shared/agents/environment-status'
import type { AgentBinding, Computer } from '@overlay/workspace-contracts'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { api } from '../../convex/_generated/api'

/** The workspace live connection queries run in, once the session can read it. */
function useConnectionWorkspace(): string | null {
  const { activeWorkspaceId, status } = useWorkspace()
  const { isAuthenticated, isLoading } = useConvexAuth()
  return status === 'ready' && activeWorkspaceId && isAuthenticated && !isLoading ? activeWorkspaceId : null
}

function useSignedIn(): boolean {
  const { isAuthenticated, isLoading } = useConvexAuth()
  return isAuthenticated && !isLoading
}

/** MCP servers of a view, live (OAuth finished in another tab included). Undefined while loading, null without access. */
export function useLiveMcpServers(view: PanelScope | undefined): Array<McpServerSummary & { canEdit: boolean }> | null | undefined {
  const workspaceId = useConnectionWorkspace()
  return useQuery(api.integrations.mcpBrowse.servers, workspaceId ? { workspaceId, ...(view ? { view } : {}) } : 'skip') as
    Array<McpServerSummary & { canEdit: boolean }> | null | undefined
}

/** Apps and tokens connected to Overlay's MCP server, live; a revoke anywhere removes them at once. */
export function useLiveMcpConnections(): McpConnectionResource[] | null | undefined {
  const signedIn = useSignedIn()
  return useQuery(api.integrations.mcpBrowse.connections, signedIn ? {} : 'skip') as McpConnectionResource[] | null | undefined
}

/** Computers visible in the workspace, live through provisioning, start, stop and control. Undefined while loading. */
export function useLiveComputers(): Computer[] | null | undefined {
  const workspaceId = useConnectionWorkspace()
  return useQuery(api.computers.browse.list, workspaceId ? { workspaceId } : 'skip') as Computer[] | null | undefined
}

/** Re-renders on an interval, for statuses that depend on how long ago something happened. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * Connected-agent environments, live, with each status adjusted for heartbeat age on a local clock (no requests).
 * Undefined while loading, null without access.
 */
export function useLiveAgentEnvironments(): AgentEnvironmentResource[] | null | undefined {
  const workspaceId = useConnectionWorkspace()
  const rows = useQuery(api.agents.environmentsBrowse.list, workspaceId ? { workspaceId } : 'skip') as AgentEnvironmentResource[] | null | undefined
  const now = useNow(15_000)
  return useMemo(() => rows?.map((row) => ({ ...row, status: effectiveAgentEnvironmentStatus(row, now) as AgentEnvironmentResource['status'] })) ?? rows, [now, rows])
}

/** Agent bindings, live, for workspace owners and admins; null for other members. */
export function useLiveAgentBindings(agentId?: string): AgentBinding[] | null | undefined {
  const workspaceId = useConnectionWorkspace()
  return useQuery(api.agents.environmentsBrowse.bindings, workspaceId ? { workspaceId, ...(agentId ? { agentId } : {}) } : 'skip') as
    AgentBinding[] | null | undefined
}

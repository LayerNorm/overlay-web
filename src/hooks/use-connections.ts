'use client'

import { useConvexAuth, useQuery } from 'convex/react'
import type { McpServerSummary } from '@overlay/app-core'
import type { McpConnectionResource } from '@overlay/api-client'
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

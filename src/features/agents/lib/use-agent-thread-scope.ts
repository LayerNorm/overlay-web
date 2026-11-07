'use client'

import { useConvexAuth, useQuery } from 'convex/react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { api } from '../../../../convex/_generated/api'

/**
 * Whether this conversation is one of the signed-in member's threads with this agent. Reads the
 * same live thread list as the sidebar, so a warm open needs no request and another member's
 * thread never verifies.
 */
export function useAgentThreadScope({ workspaceId, agentId, conversationId, directory }: {
  workspaceId: string | null
  agentId: string | null
  conversationId: string | null
  directory: WorkspaceAgentDirectoryItem[] | null
}) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const allowedAgent = Boolean(agentId && directory?.some((agent) => agent.id === agentId))
  const bundle = useQuery(
    api.agents.threads.bundle,
    workspaceId && agentId && conversationId && allowedAgent && isAuthenticated && !isLoading
      ? { workspaceId, agentId }
      : 'skip',
  )

  return agentThreadScopeState({ agentId, conversationId, directory, bundle })
}

/** The scope decision, kept pure so it can be tested without a Convex client. */
export function agentThreadScopeState({ agentId, conversationId, directory, bundle }: {
  agentId: string | null
  conversationId: string | null
  directory: WorkspaceAgentDirectoryItem[] | null
  bundle: { threads: Array<{ conversationId: string }> } | null | undefined
}) {
  if (!conversationId) return { allowed: false, pending: false, error: null }
  const allowedAgent = Boolean(agentId && directory?.some((agent) => agent.id === agentId))
  if (!agentId || (directory !== null && !allowedAgent)) {
    return { allowed: false, pending: false, error: 'This agent is not available in this scope.' }
  }
  if (directory === null || bundle === undefined) return { allowed: false, pending: true, error: null }
  const allowed = Boolean(bundle?.threads.some((thread) => thread.conversationId === conversationId))
  return { allowed, pending: false, error: allowed ? null : 'This thread is not available for this agent.' }
}

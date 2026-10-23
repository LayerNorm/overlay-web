'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export function useAgentThreadScope({ workspaceId, agentId, conversationId, directory, retryCount }: {
  workspaceId: string | null
  agentId: string | null
  conversationId: string | null
  directory: WorkspaceAgentDirectoryItem[] | null
  retryCount: number
}) {
  const allowedAgent = Boolean(agentId && directory?.some((agent) => agent.id === agentId))
  const key = JSON.stringify([workspaceId, agentId, conversationId, retryCount])
  const [result, setResult] = useState<{ key: string; allowed: boolean; error: string | null } | null>(null)

  useEffect(() => {
    if (!workspaceId || !agentId || !conversationId || !allowedAgent) return
    let cancelled = false
    overlayAppClient.agents.listThreads(workspaceId, agentId).then(({ threads }) => {
      if (cancelled) return
      const allowed = threads.some((thread) => thread.conversationId === conversationId)
      setResult({ key, allowed, error: allowed ? null : 'This thread is not available for this agent.' })
    }).catch(() => {
      if (!cancelled) setResult({ key, allowed: false, error: 'Could not verify this agent thread. Retry to continue.' })
    })
    return () => { cancelled = true }
  }, [workspaceId, agentId, conversationId, allowedAgent, key])

  if (!conversationId) return { allowed: false, pending: false, error: null }
  if (!agentId || (directory !== null && !allowedAgent)) {
    return { allowed: false, pending: false, error: 'This agent is not available in this scope.' }
  }
  if (directory === null || result?.key !== key) return { allowed: false, pending: true, error: null }
  return { allowed: result.allowed, pending: false, error: result.error }
}

'use client'

import { useCallback } from 'react'
import { useNativeCollaboration } from '@/components/providers/native-collaboration-context'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export function useAgentBundleLoader(workspaceId: string | null) {
  const native = useNativeCollaboration()
  const enabled = native.status !== 'disabled'
  return useCallback(async (agentId: string) => {
    if (!workspaceId) throw new Error('Workspace required')
    if (!enabled) return overlayAppClient.agents.bundle(workspaceId, agentId)
    const { automations } = await overlayAppClient.agents.listAgentAutomations(workspaceId, agentId)
    return { threads: [], automations }
  }, [enabled, workspaceId])
}

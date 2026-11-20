'use client'

import { useEffect, useRef } from 'react'
import type { WorkspaceAgentBundle } from '@overlay/workspace-contracts'
import type { ThreadActivity } from '@/shared/agents/thread-activity'

type Props = {
  agentId: string
  expanded: boolean
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  activity: ThreadActivity[] | undefined
  refresh(agentId: string): Promise<void>
}

export function useLiveAgentBundle({ agentId, expanded, bundle, activity, refresh }: Props) {
  const membership = activity === undefined ? undefined
    : JSON.stringify(activity.map(thread => thread.conversationId).sort())
  const refreshed = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!expanded || membership === undefined || bundle === 'loading') return
    const revision = `${agentId}:${membership}`
    if (refreshed.current === revision) return
    refreshed.current = revision
    const cached = typeof bundle === 'object'
      ? JSON.stringify(bundle.threads.filter(thread => !thread.archivedAt).map(thread => thread.conversationId).sort())
      : undefined
    if (cached !== membership) void refresh(agentId)
  }, [agentId, expanded, bundle, membership, refresh])
}

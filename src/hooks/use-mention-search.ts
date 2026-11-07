'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useConvex } from 'convex/react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { searchMentions } from '@/components/mentions/mention-search'
import type { MentionCategory } from '@/shared/knowledge/mention-types'

/**
 * A stable mention search for the active workspace, safe to hand to editors built once (the notebook's TipTap
 * suggestion): it always searches the workspace the page currently shows.
 */
export function useMentionSearch(): (query: string) => Promise<MentionCategory[]> {
  const convex = useConvex()
  const { activeWorkspaceId } = useWorkspace()
  const current = useRef({ convex, activeWorkspaceId })
  useEffect(() => { current.current = { convex, activeWorkspaceId } }, [activeWorkspaceId, convex])
  return useCallback(async (query: string) => {
    const { convex: client, activeWorkspaceId: workspaceId } = current.current
    return workspaceId ? await searchMentions(client, workspaceId, query) : []
  }, [])
}

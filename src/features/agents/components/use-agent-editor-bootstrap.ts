'use client'

import { useState } from 'react'
import { useAgent, useAgentDirectory } from '@/hooks/use-agent-directory'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import type { getInitialEditorState } from '../lib/agent-editor-state'

export function useAgentEditorBootstrap({

  mode,
  agentId,
  activeWorkspaceId,
  initial,
}: {

  mode: 'new' | 'edit'
  agentId: string | undefined
  activeWorkspaceId: string | null
  initial: ReturnType<typeof getInitialEditorState>
}) {
  const live = useAgent(mode === 'edit' && activeWorkspaceId ? agentId ?? null : null)
  const directory = useAgentDirectory({ enabled: mode === 'new' })
  // A save answers before the live query does; prefer whichever copy is newer.
  const [saved, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(initial.agent)
  const agent = mode === 'edit'
    ? newerAgent(live, saved?.id === agentId ? saved : null)
    : saved
  const loading = mode === 'edit' ? live === undefined && !agent : directory.status === 'loading'
  const loadFailed = mode === 'edit' ? live === null && !agent : directory.status === 'unavailable'
  const canCreate = mode === 'edit' ? initial.canCreate : directory.canCreate

  return { agent, setAgent, loading, loadFailed, canCreate }
}

function newerAgent(
  live: WorkspaceAgentDirectoryItem | null | undefined,
  saved: WorkspaceAgentDirectoryItem | null,
): WorkspaceAgentDirectoryItem | null {
  if (!live) return live === null ? null : saved
  return saved && saved.updatedAt > live.updatedAt ? saved : live
}

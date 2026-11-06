'use client'

import { useEffect, useRef } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import type { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { agentsForCreatorScope, pickAgentToOpen, rememberAgentOpened } from '@/shared/agents/last-agent-by-workspace'
import { useNativeThreadClient, useNativeThreadPending } from '@/components/providers/native-agent-threads'
import { useStartAgentChat } from '../lib/agent-chat'

/** Opens the picked agent's conversation. Own budget, kept out of the component. */
export function useAgentAutoOpen(args: {
  conversationId: string | null
  activeWorkspaceId: string | null
  agentId: string | null
  directory: WorkspaceAgentDirectoryItem[] | null
  viewerPrincipalId: string | null
  scope: PanelScope
  buildHref: ReturnType<typeof useWorkspaceHref>
  retryCount: number
  router: { replace(href: string): void }
  onResolvingChange(next: boolean): void
  onError(message: string | null): void
}) {
  const {
    conversationId, activeWorkspaceId, agentId, directory, viewerPrincipalId, scope, buildHref, retryCount, router,
    onResolvingChange, onError,
  } = args
  const attemptedAgentRef = useRef<string | null>(null)
  const startAgentChat = useStartAgentChat()
  const nativePending = useNativeThreadPending()
  const native = useNativeThreadClient()

  useEffect(() => {
    attemptedAgentRef.current = null
  }, [activeWorkspaceId, conversationId, scope, retryCount])

  useEffect(() => {
    if (!activeWorkspaceId || !directory || agentAutoOpenBlocked(conversationId, directory, nativePending, native)) return
    const scopedDirectory = agentsForCreatorScope(directory, viewerPrincipalId, scope)
    if (agentId && !scopedDirectory.some((agent) => agent.id === agentId)) return
    const target = pickAgentToOpen(scopedDirectory, activeWorkspaceId, agentId)
    if (!target || attemptedAgentRef.current === target.id) return
    attemptedAgentRef.current = target.id
    rememberAgentOpened(activeWorkspaceId, target.id)
    onResolvingChange(true)
    onError(null)
    let cancelled = false
    void (async () => {
      try {
        await startAgentChat({
          workspaceId: activeWorkspaceId,
          agentId: target.id,
          feedback: false,
          nativeRequestId: pendingCreateRequest(nativePending),
          recoverPending: Boolean(nativePending),
          agentPrincipalId: target.principalId,
          surface: 'agents',
          scope,
          buildHref,
          push: (href) => { if (!cancelled) router.replace(href) },
        })
      } catch (chatError) {
        if (!cancelled) onError(chatError instanceof Error ? chatError.message : 'Could not open the agent conversation.')
      } finally {
        if (!cancelled) onResolvingChange(false)
      }
    })()
    return () => { cancelled = true; attemptedAgentRef.current = null; onResolvingChange(false) }
  }, [conversationId, activeWorkspaceId, agentId, directory, viewerPrincipalId, scope, buildHref, retryCount, router, onResolvingChange, onError, startAgentChat, nativePending, native])
}

function agentAutoOpenBlocked(conversationId: string | null, directory: WorkspaceAgentDirectoryItem[], pending: string | null | undefined, native: ReturnType<typeof useNativeThreadClient>) {
  return Boolean(conversationId || directory.length === 0 || pending === 'failed'
    || (native.enabled && native.status !== 'ready') || (pending && native.isPending(pending)))
}

function pendingCreateRequest(pending: string | null | undefined) {
  return pending?.startsWith('create:') ? pending.slice('create:'.length) : undefined
}

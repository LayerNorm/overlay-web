'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import type { getInitialEditorState } from '../lib/agent-editor-state'
import { useAgentDirectory } from './AgentDirectoryProvider'

type NativeDirectoryState = Pick<ReturnType<typeof useAgentDirectory>, 'mode' | 'detail' | 'directory' | 'loading' | 'canCreate'>

/** Chooses which source owns the editor state: native subscriptions, a closed native path, or legacy HTTP. */
export function resolveAgentEditorLoad({
  mode,
  agentId,
  native,
  legacy,
}: {
  mode: 'new' | 'edit'
  agentId: string | undefined
  native: NativeDirectoryState
  legacy: { agent: WorkspaceAgentDirectoryItem | null; loading: boolean; loadFailed: boolean; canCreate: boolean }
}) {
  if (native.mode === 'legacy') return legacy
  if (native.mode === 'unavailable') {
    return { agent: null, loading: native.loading, loadFailed: !native.loading, canCreate: false }
  }
  const editingAgentId = mode === 'edit' ? agentId : undefined
  const directoryAgent = editingAgentId ? findNativeAgent(native, editingAgentId) : null
  const detailPending = Boolean(editingAgentId && native.detail === undefined && !directoryAgent)
  const detailMissing = Boolean(editingAgentId && !native.loading && native.detail === null && !directoryAgent)
  return {
    agent: directoryAgent,
    loading: native.loading || detailPending,
    loadFailed: detailMissing,
    canCreate: native.canCreate,
  }
}

function findNativeAgent(native: NativeDirectoryState, agentId: string) {
  if (native.detail === null) return null
  if (native.detail?.id === agentId) return native.detail
  return native.directory?.find((item) => item.id === agentId) ?? null
}

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
  const { capabilities } = useOverlayCapabilities()
  const native = useAgentDirectory()
  const nativeMode = native.mode
  const setNativeDetailAgentId = native.setDetailAgentId
  const [agent, setAgent] = useState<WorkspaceAgentDirectoryItem | null>(initial.agent)
  const [loading, setLoading] = useState(initial.loading)
  const [loadFailed, setLoadFailed] = useState(false)
  const [canCreate, setCanCreate] = useState(initial.canCreate)
  const [connectedAgentsEnabled, setConnectedAgentsEnabled] = useState(false)
  /** Whether the connected-agents check has answered; the settings wait for it so the agent-type choice does not pop in. */
  const [connectedAgentsChecked, setConnectedAgentsChecked] = useState(false)

  // Reset the load state when the load parameters change (before the effect
  // below kicks off the next fetch).
  const [loadParams, setLoadParams] = useState({  mode, agentId, activeWorkspaceId })
  if (
    loadParams.mode !== mode
    || loadParams.agentId !== agentId || loadParams.activeWorkspaceId !== activeWorkspaceId
  ) {
    setLoadParams({  mode, agentId, activeWorkspaceId })
    if (activeWorkspaceId) {
      setLoading(true)
      setLoadFailed(false)
    }
  }

  // Load the agent (edit) or the create permission (new).
  useEffect(() => {
    if (!activeWorkspaceId) return
    if (nativeMode === 'native') {
      setNativeDetailAgentId(mode === 'edit' ? agentId ?? null : null)
      return
    }
    if (nativeMode === 'unavailable') {
      return
    }
    let cancelled = false
    if (mode === 'edit' && agentId) {
      void overlayAppClient.agents.get(activeWorkspaceId, agentId).then(
        (result) => { if (!cancelled) { setAgent(result.agent); setLoading(false) } },
        () => { if (!cancelled) { setAgent(null); setLoadFailed(true); setLoading(false) } },
      )
    } else {
      void overlayAppClient.agents.list(activeWorkspaceId).then(
        (result) => { if (!cancelled) { setCanCreate(result.canCreate); setLoading(false) } },
        () => { if (!cancelled) { setLoadFailed(true); setLoading(false) } },
      )
    }
    return () => { cancelled = true }
  }, [
    activeWorkspaceId,
    agentId,
    mode,
    nativeMode,
    setNativeDetailAgentId,
  ])

  // Connected-agent availability gates the BYO type.
  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    void overlayAppClient.agentEnvironments.listBindings(activeWorkspaceId)
      .then((result) => { if (!cancelled) {
        setConnectedAgentsEnabled(capabilities.externalAgents === true && result.launchEnabled === true)
        setConnectedAgentsChecked(true)
      } })
      .catch(() => { if (!cancelled) { setConnectedAgentsEnabled(false); setConnectedAgentsChecked(true) } })
    return () => { cancelled = true }
  }, [activeWorkspaceId, capabilities.externalAgents, ])

  const resolved = resolveAgentEditorLoad({
    mode,
    agentId,
    native,
    legacy: { agent, loading, loadFailed, canCreate },
  })

  return {
    agent: resolved.agent,
    setAgent,
    loading: resolved.loading,
    loadFailed: resolved.loadFailed,
    canCreate: resolved.canCreate,
    connectedAgentsEnabled,
    connectedAgentsChecked,
  }
}

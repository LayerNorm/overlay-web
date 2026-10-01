'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type {
  SurfaceBinding,
  SurfaceChannelOption,
  SurfaceConnection,
} from '@overlay/workspace-contracts'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { AgentType } from './AgentEditorForm'

export type SurfaceChannelPicker = {
  connectionId: string
  options: SurfaceChannelOption[]
  loading: boolean
  error: string | null
}

const SURFACE_ERROR_LABELS: Record<string, string> = {
  expired_state: 'That Slack connection expired — start it again.',
  denied: 'The Slack connection was cancelled.',
  missing_code: 'Slack did not return an authorization code — try again.',
  account_mismatch: 'Finish connecting with the same account that started it.',
  connect_failed: 'Could not start the Slack connection — try again.',
  exchange_failed: 'Slack rejected the connection — try again.',
  slack_not_configured: 'Slack is not configured on this deployment.',
  agent_not_found: 'This agent is no longer available for surfaces.',
  team_already_connected: 'That Slack workspace is already connected elsewhere.',
}

/**
 * Agent editor "Reachable on" state: workspace surface connections, this
 * agent's channel bindings, the lazy channel picker, and immediate-commit
 * bind/unbind mutations. Mirrors `useByoConnection` — the editor page stays
 * presentational. Only Overlay-type agents can bind (BYO surfaces are
 * deferred), so the hook no-ops for them.
 */
export function useAgentSurfaces(args: {
  activeWorkspaceId: string | null
  showcase: boolean
  agent: WorkspaceAgentDirectoryItem | null
  agentType: AgentType
}) {
  const { activeWorkspaceId, showcase, agent, agentType } = args
  const searchParams = useSearchParams()
  const [connections, setConnections] = useState<SurfaceConnection[]>([])
  const [bindings, setBindings] = useState<SurfaceBinding[]>([])
  const [canBind, setCanBind] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [channelPicker, setChannelPicker] = useState<SurfaceChannelPicker | null>(null)
  const [busyBindingId, setBusyBindingId] = useState<string | null>(null)

  const enabled = Boolean(
    !showcase && activeWorkspaceId && agent && !agent.archivedAt && agentType === 'overlay',
  )

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId || !agent) return
    const [connectionsResult, bindingsResult] = await Promise.all([
      overlayAppClient.surfaces.listConnections(activeWorkspaceId),
      overlayAppClient.surfaces.listBindings(activeWorkspaceId, agent.id),
    ])
    setConnections(connectionsResult.connections)
    setBindings(bindingsResult.bindings)
    setCanBind(bindingsResult.canBind)
  }, [activeWorkspaceId, agent])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void refresh()
      .catch(() => { if (!cancelled) setError('Could not load surface connections.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, refresh])

  const connectSlack = useCallback(() => {
    if (!agent) return
    const returnTo = `${window.location.pathname}${window.location.search}`
    // Full-page navigation on purpose: the connect route 302s to Slack's
    // cross-site OAuth consent, which a client-side router push cannot do.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(
      `/api/v1/surfaces/slack/connect?agentId=${encodeURIComponent(agent.id)}&returnTo=${encodeURIComponent(returnTo)}`,
    )
  }, [agent])

  const openChannelPicker = useCallback(async (connectionId: string) => {
    if (!activeWorkspaceId) return
    setChannelPicker({ connectionId, options: [], loading: true, error: null })
    try {
      const result = await overlayAppClient.surfaces.listChannels(activeWorkspaceId, connectionId)
      setChannelPicker((current) => current?.connectionId === connectionId
        ? { connectionId, options: result.channels, loading: false, error: null }
        : current)
    } catch {
      setChannelPicker((current) => current?.connectionId === connectionId
        ? { connectionId, options: [], loading: false, error: 'Could not load channels.' }
        : current)
    }
  }, [activeWorkspaceId])

  const closeChannelPicker = useCallback(() => setChannelPicker(null), [])

  const createBinding = useCallback(async (connectionId: string, channel: SurfaceChannelOption) => {
    if (!activeWorkspaceId || !agent) return
    setBusyBindingId(channel.id)
    setError(null)
    try {
      await overlayAppClient.surfaces.createBinding(activeWorkspaceId, {
        agentId: agent.id,
        connectionId,
        channelId: channel.id,
        channelName: channel.name,
      })
      setChannelPicker(null)
      await refresh()
    } catch (bindingError) {
      setError(bindingError instanceof Error ? bindingError.message : 'Could not add the channel.')
    } finally {
      setBusyBindingId(null)
    }
  }, [activeWorkspaceId, agent, refresh])

  const removeBinding = useCallback(async (bindingId: string) => {
    if (!activeWorkspaceId) return
    setBusyBindingId(bindingId)
    setError(null)
    try {
      await overlayAppClient.surfaces.removeBinding(activeWorkspaceId, bindingId)
      await refresh()
    } catch (bindingError) {
      setError(bindingError instanceof Error ? bindingError.message : 'Could not remove the channel.')
    } finally {
      setBusyBindingId(null)
    }
  }, [activeWorkspaceId, refresh])

  // OAuth returns to the editor with ?surfaceConnected / ?surfaceError — the
  // refetch above already picks up the new connection; this is only the notice.
  const notice = useMemo(() => {
    if (searchParams?.get('surfaceConnected') === 'slack') {
      return { kind: 'success' as const, message: 'Slack connected.' }
    }
    const reason = searchParams?.get('surfaceError')
    if (!reason) return null
    return { kind: 'error' as const, message: SURFACE_ERROR_LABELS[reason] ?? 'The Slack connection failed — try again.' }
  }, [searchParams])

  const activeBindings = useMemo(
    () => bindings.filter((binding) => binding.status === 'active'),
    [bindings],
  )

  return {
    enabled,
    loading,
    connections,
    bindings: activeBindings,
    canBind,
    channelPicker,
    busyBindingId,
    error,
    notice,
    connectSlack,
    openChannelPicker,
    closeChannelPicker,
    createBinding,
    removeBinding,
  }
}

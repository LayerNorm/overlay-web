'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from '@overlay/ui/primitives'
import { consumeOneShotNotification } from './notification-events'
import type {
  SurfaceBinding,
  SurfaceChannelOption,
  SurfaceConnection,
} from '@overlay/workspace-contracts'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useLiveAgentSurfaces } from '@/hooks/use-connections'
import type { AgentType } from './AgentEditorForm'

export type SurfaceChannelPicker = {
  connectionId: string
  options: SurfaceChannelOption[]
  loading: boolean
  error: string | null
}

const SURFACE_ERROR_LABELS: Record<string, string> = {
  expired_state: 'That Slack connection expired. Start it again.',
  denied: 'The Slack connection was cancelled.',
  missing_code: 'Slack did not return an authorization code. Try again.',
  account_mismatch: 'Finish connecting with the account that started it.',
  connect_failed: 'Could not start the Slack connection. Try again.',
  exchange_failed: 'Slack rejected the connection. Try again.',
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
const NO_CONNECTIONS: SurfaceConnection[] = []
const NO_BINDINGS: SurfaceBinding[] = []

export function useAgentSurfaces(args: {
  activeWorkspaceId: string | null

  agent: WorkspaceAgentDirectoryItem | null
  agentType: AgentType
}) {
  const { activeWorkspaceId,  agent, agentType } = args
  const searchParams = useSearchParams()
  const handledOAuthNoticeRef = useRef<string | null>(null)
  const [channelPicker, setChannelPicker] = useState<SurfaceChannelPicker | null>(null)
  const [busyBindingId, setBusyBindingId] = useState<string | null>(null)

  const enabled = Boolean(
    activeWorkspaceId && agent && !agent.archivedAt && agentType === 'overlay',
  )
  // Live: a Slack install, a channel bound or removed in any tab, or a connection degrading, updates at once.
  const live = useLiveAgentSurfaces(enabled && agent ? agent.id : null)
  const connections: SurfaceConnection[] = live?.connections ?? NO_CONNECTIONS
  const bindings: SurfaceBinding[] = live?.bindings ?? NO_BINDINGS
  const canBind = live?.canBind ?? false
  const loading = enabled && live === undefined
  const initialLoading = loading
  const error = enabled && live === null ? 'Could not load surface connections.' : null

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
    try {
      await overlayAppClient.surfaces.createBinding(activeWorkspaceId, {
        agentId: agent.id,
        connectionId,
        channelId: channel.id,
        channelName: channel.name,
      })
    } catch (bindingError) {
      toast.error(bindingError instanceof Error ? bindingError.message : 'Could not add the channel.')
      return
    } finally {
      setBusyBindingId(null)
    }
    setChannelPicker(null)
    toast.success('Channel added.')
  }, [activeWorkspaceId, agent])

  const removeBinding = useCallback(async (bindingId: string) => {
    if (!activeWorkspaceId) return
    setBusyBindingId(bindingId)
    try {
      await overlayAppClient.surfaces.removeBinding(activeWorkspaceId, bindingId)
    } catch (bindingError) {
      toast.error(bindingError instanceof Error ? bindingError.message : 'Could not remove the channel.')
      return
    } finally {
      setBusyBindingId(null)
    }
    toast.success('Channel removed.')
  }, [activeWorkspaceId])

  // Consume OAuth callback results once so rerenders do not replay a notice.
  useEffect(() => {
    const connected = searchParams?.get('surfaceConnected')
    const reason = searchParams?.get('surfaceError')
    const key = connected ? `connected:${connected}` : reason ? `error:${reason}` : null
    if (!consumeOneShotNotification(key, handledOAuthNoticeRef)) return
    if (connected === 'slack') toast.success('Slack connected.')
    else if (reason) toast.error(SURFACE_ERROR_LABELS[reason] ?? 'The Slack connection failed. Try again.')
    const params = new URLSearchParams(window.location.search)
    params.delete('surfaceConnected')
    params.delete('surfaceError')
    const query = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  }, [searchParams])

  const activeBindings = useMemo(
    () => bindings.filter((binding) => binding.status === 'active'),
    [bindings],
  )

  return {
    enabled,
    loading,
    initialLoading,
    connections,
    bindings: activeBindings,
    canBind,
    channelPicker,
    busyBindingId,
    error,
    connectSlack,
    openChannelPicker,
    closeChannelPicker,
    createBinding,
    removeBinding,
  }
}

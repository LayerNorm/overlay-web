'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from '@overlay/ui/primitives'
import type { SurfaceChannelOption } from '@overlay/workspace-contracts'
import { useLiveWorkspaceSurfaces } from '@/hooks/use-connections'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export type SlackChannelPicker = {
  connectionId: string
  options: SurfaceChannelOption[]
  loading: boolean
  error: string | null
}

export function useWorkspaceSlack(workspaceId: string) {
  const data = useLiveWorkspaceSurfaces(workspaceId)
  const searchParams = useSearchParams()
  const notice = useRef<string | null>(null)
  const channelRequest = useRef<AbortController | null>(null)
  const [picker, setPicker] = useState<SlackChannelPicker | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => channelRequest.current?.abort(), [])
  useEffect(() => {
    const connected = searchParams?.get('surfaceConnected')
    const reason = searchParams?.get('surfaceError')
    const key = connected ? `connected:${connected}` : reason ? `error:${reason}` : null
    if (!key || notice.current === key) return
    notice.current = key
    if (connected === 'slack') toast.success('Slack connected.')
    else if (reason) toast.error('Slack could not be connected. Please try again.')
    const params = new URLSearchParams(window.location.search)
    params.delete('surfaceConnected')
    params.delete('surfaceError')
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}${window.location.hash}`)
  }, [searchParams])

  async function perform(key: string, operation: () => Promise<unknown>, message: string) {
    setBusy(key)
    setError(null)
    try {
      await operation()
      toast.success(message)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Slack action failed. Try again.')
      return false
    } finally {
      setBusy(null)
    }
  }

  function closePicker() {
    channelRequest.current?.abort()
    setPicker(null)
  }

  async function openPicker(connectionId: string) {
    channelRequest.current?.abort()
    const controller = new AbortController()
    channelRequest.current = controller
    setPicker({ connectionId, options: [], loading: true, error: null })
    try {
      const result = await overlayAppClient.surfaces.listChannels(workspaceId, connectionId, { signal: controller.signal })
      if (!controller.signal.aborted) setPicker({ connectionId, options: result.channels, loading: false, error: null })
    } catch {
      if (!controller.signal.aborted) setPicker({ connectionId, options: [], loading: false, error: 'Could not load public channels. Try again.' })
    }
  }

  function connect() {
    const returnTo = new URL(window.location.href)
    returnTo.searchParams.set('workspaceTab', 'slack')
    const params = new URLSearchParams({ workspaceId, returnTo: `${returnTo.pathname}${returnTo.search}` })
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/v1/surfaces/slack/connect?${params}`)
  }

  function link(connectionId: string) {
    const params = new URLSearchParams({ workspaceId, connectionId })
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/v1/surfaces/slack/identity/start?${params}`)
  }

  async function addChannel(connectionId: string, channel: SurfaceChannelOption) {
    if (await perform(channel.id, () => overlayAppClient.surfaces.createBinding(workspaceId, {
      connectionId, channelId: channel.id, channelName: channel.name,
    }), 'Channel added.')) closePicker()
  }

  return {
    data, picker, busy, error, connect, link, openPicker, closePicker, addChannel,
    removeChannel: (id: string) => perform(id, () => overlayAppClient.surfaces.removeBinding(workspaceId, id), 'Channel removed.'),
    disconnect: (id: string) => perform(id, () => overlayAppClient.surfaces.disconnect(workspaceId, id), 'Slack disconnected.'),
    unlink: (id: string) => perform(id, () => overlayAppClient.surfaces.unlinkIdentity(workspaceId, id), 'Slack account unlinked.'),
  }
}

export type WorkspaceSlackController = ReturnType<typeof useWorkspaceSlack>

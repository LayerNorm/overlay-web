'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useConvexAuth, useQuery } from 'convex/react'
import { Download } from 'lucide-react'
import {
  Button,
  EmptyState,
  Skeleton,
  toast,
} from '@overlay/ui/primitives'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import type { SyncProvider } from '@/shared/sync/types'
import { api } from '../../../../convex/_generated/api'
import {
  SYNC_PROVIDERS,
  OAUTH_RETURN_PARAMS,
  oauthReturnNotice,
  syncUrls,
  type SyncAvailableChannel,
  type SyncStatus,
} from '../lib/sync-settings'

import { Monogram, ProviderBody, type SyncPickerState, type SyncSettingsActions, type SyncSettingsViewProps } from './SyncSettingsParts'

export type { SyncSettingsViewProps } from './SyncSettingsParts'

const SYNC_PROVIDER_ORDER: SyncProvider[] = ['slack', 'teams']

export function SyncSettingsView({ provider, status, unavailable, urls, busy, picker, pickerTarget, linkTargets, now, actions }: SyncSettingsViewProps) {
  const copy = SYNC_PROVIDERS[provider]
  const state = status?.providers.find(item => item.provider === provider)
  return (
    <div className="@container px-5 py-5" data-testid="sync-settings">
      <div className="mb-6 flex items-center gap-1" role="tablist" aria-label="Service">
        {SYNC_PROVIDER_ORDER.map(key => (
          <Button
            key={key}
            role="tab"
            aria-selected={provider === key}
            variant={provider === key ? 'secondary' : 'ghost'}
            size="sm"
            className="gap-1.5"
            onClick={() => actions.onProviderChange(key)}
          >
            <Monogram provider={key} small />
            {SYNC_PROVIDERS[key].name}
          </Button>
        ))}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" aria-label="One-time import" onClick={actions.onOpenImport}>
          <Download size={13} />
          <span className="hidden @md:inline">One-time import</span>
        </Button>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-(--foreground)">{copy.name} sync</h3>
        <p className="mt-1 text-[13px] text-(--muted)">
          Choose which {copy.name} channels stay in sync with Overlay. Each channel links to one Overlay channel.
          {status && !status.canManage ? ' Only owners and admins can change workspace sync settings.' : ''}
        </p>
      </div>
      {unavailable ? (
        <EmptyState
          className="mt-6 rounded-xl border border-(--border) px-6 py-10"
          icon={<Monogram provider={provider} />}
          title={copy.name + ' sync isn’t available yet'}
          description="It will appear here as soon as it’s ready for this workspace. Slack sync works today."
          data-testid="sync-unavailable"
        />
      ) : status === undefined ? (
        <div className="mt-6 space-y-4" aria-label="Loading sync settings" data-testid="sync-loading">
          <div className="grid gap-4 @2xl:grid-cols-2">
            <Skeleton className="h-[66px] rounded-xl" />
            <Skeleton className="h-[66px] rounded-xl" />
          </div>
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : !status || !state ? (
        <EmptyState
          className="mt-6 rounded-xl border border-(--border) px-6 py-10"
          title="Sync settings aren’t available"
          description="You may no longer have access to this workspace. Refresh the page to try again."
          data-testid="sync-error"
        />
      ) : (
        <ProviderBody
          provider={provider}
          state={state}
          canManage={status.canManage}
          urls={urls}
          busy={busy}
          picker={picker}
          pickerTarget={pickerTarget}
          linkTargets={linkTargets}
          now={now}
          actions={actions}
        />
      )}
    </div>
  )
}

type SyncResponse = { status: number; data: { error?: string; channels?: SyncAvailableChannel[] } }

async function syncRequest(provider: SyncProvider, workspaceId: string, init?: RequestInit, search = ''): Promise<SyncResponse> {
  try {
    const response = await fetch('/api/v1/sync/' + provider + search, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json', [ACTIVE_WORKSPACE_HEADER]: workspaceId },
    })
    return { status: response.status, data: await response.json().catch(() => ({})) }
  } catch {
    return { status: 0, data: { error: 'Network request failed. Try again.' } }
  }
}

function unavailableStatus(status: number) {
  return status === 404 || status === 503
}

/** Live Slack and Teams sync settings for the active workspace, with the one-time import one click away. */
export function SyncSettingsPanel({ onOpenImport }: { onOpenImport(): void }) {
  const { activeWorkspace } = useWorkspace()
  const workspaceId = activeWorkspace?.id ?? null
  const { isAuthenticated, isLoading } = useConvexAuth()
  const pathname = usePathname()
  const [provider, setProvider] = useState<SyncProvider>('slack')
  const [busy, setBusy] = useState<string | null>(null)
  const [picker, setPicker] = useState<SyncPickerState | null>(null)
  const [pickerTarget, setPickerTarget] = useState('')
  const [unavailable, setUnavailable] = useState<Record<SyncProvider, boolean | undefined>>({ slack: false, teams: undefined })
  const [now, setNow] = useState(() => Date.now())
  const handledReturn = useRef(false)
  const live = useQuery(api.sync.links.status, workspaceId && isAuthenticated && !isLoading ? { workspaceId } : 'skip') as SyncStatus | null | undefined
  const targets = useQuery(api.sync.ui.linkTargets, picker && workspaceId ? { workspaceId } : 'skip')
  const state = live?.providers.find(item => item.provider === provider)
  const returnTo = (pathname ?? '/app/settings') + '?section=workspace&workspace_tab=import'
  const urls = syncUrls(provider, returnTo, workspaceId ?? '')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (handledReturn.current) return
    handledReturn.current = true
    const params = new URLSearchParams(window.location.search)
    const notice = oauthReturnNotice(params)
    if (!notice) return
    if (notice.kind === 'success') toast.success(notice.text)
    else toast.error(notice.text)
    const returned = notice.provider
    if (returned) queueMicrotask(() => setProvider(returned))
    for (const name of OAUTH_RETURN_PARAMS) params.delete(name)
    const query = params.toString()
    window.history.replaceState(window.history.state, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash)
  }, [])

  const teamsConnected = Boolean(live?.providers.some(item => item.provider === 'teams' && item.connection && item.connection.status !== 'disconnected'))
  useEffect(() => {
    if (provider !== 'teams' || unavailable.teams !== undefined || !workspaceId || live === undefined || teamsConnected) return
    let cancelled = false
    void syncRequest('teams', workspaceId, undefined, '?action=channels').then(({ status }) => {
      if (!cancelled) setUnavailable(previous => ({ ...previous, teams: unavailableStatus(status) }))
    })
    return () => { cancelled = true }
  }, [live, provider, teamsConnected, unavailable.teams, workspaceId])

  async function post(key: string, body: Record<string, unknown>, success: string, description?: string) {
    if (!workspaceId) return false
    setBusy(key)
    const { status, data } = await syncRequest(provider, workspaceId, { method: 'POST', body: JSON.stringify(body) })
    setBusy(null)
    if (status >= 200 && status < 300) {
      toast.success(success, description ? { description } : undefined)
      return true
    }
    toast.error(unavailableStatus(status) ? SYNC_PROVIDERS[provider].name + ' sync isn’t available yet.' : data.error ?? 'Sync request failed. Try again.')
    return false
  }

  async function loadChannels() {
    if (!workspaceId) return
    setPicker({ status: 'loading' })
    const { status, data } = await syncRequest(provider, workspaceId, undefined, '?action=channels')
    if (status >= 200 && status < 300) {
      setPicker({ status: 'ready', channels: data.channels ?? [] })
      return
    }
    setPicker({
      status: 'error',
      message: unavailableStatus(status)
        ? SYNC_PROVIDERS[provider].name + ' sync isn’t available yet.'
        : data.error ?? 'Could not load channels. Try again.',
    })
  }

  const name = SYNC_PROVIDERS[provider].name
  const actions: SyncSettingsActions = {
    onProviderChange(next) {
      setProvider(next)
      setPicker(null)
      setPickerTarget('')
    },
    onOpenImport,
    onDisconnect() {
      void post('disconnect', { action: 'disconnect' }, name + ' disconnected', 'Every link is paused. Synced messages stay in Overlay.')
    },
    onDisconnectAccount() {
      void post('account', { action: 'disconnectAccount' }, 'Your ' + name + ' account is disconnected', 'Messages you already sent stay in both places.')
    },
    onDmSync(enabled) {
      void post('dm', { action: 'dmSync', enabled }, enabled ? 'Direct message sync is on' : 'Direct message sync is off')
    },
    onAutoLink(enabled) {
      void post('autoLink', { action: 'autoLink', enabled }, enabled ? 'Auto-link is on' : 'Auto-link is off')
    },
    onTogglePicker() {
      if (picker) {
        setPicker(null)
        setPickerTarget('')
        return
      }
      void loadChannels()
    },
    onPickerTargetChange: setPickerTarget,
    onLink(channel) {
      const target = (targets ?? []).find(item => item.conversationId === pickerTarget)
      void post('link:' + channel.id, {
        action: 'link',
        channelId: channel.id,
        name: channel.name,
        kind: channel.kind,
        ...(channel.groupId ? { groupId: channel.groupId } : {}),
        ...(target ? { existingConversationId: target.conversationId } : {}),
      }, 'Channel linked', '#' + (target?.name ?? channel.name) + ' now receives new messages. History imports in the background.').then(linked => {
        if (linked) setPickerTarget('')
      })
    },
    onUnlink(link) {
      void post('unlink:' + link.linkId, { action: 'unlink', linkId: link.linkId }, 'Sync stopped', '#' + link.overlayChannelName + ' keeps its members and messages in Overlay.')
    },
  }

  return (
    <SyncSettingsView
      provider={provider}
      status={live}
      unavailable={unavailable[provider] === true && !state?.connection}
      urls={urls}
      busy={busy}
      picker={picker}
      pickerTarget={pickerTarget}
      linkTargets={targets ?? []}
      now={now}
      actions={actions}
    />
  )
}

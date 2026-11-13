'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useConvexAuth, useQuery } from 'convex/react'
import { Download, Hash, Loader2, Lock, MoreHorizontal, Pause, Plus, Timer, X, Check } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ListboxSelect,
  Progress,
  Skeleton,
  Switch,
  toast,
} from '@overlay/ui/primitives'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import type { SyncProvider } from '@/shared/sync/types'
import { api } from '../../../../convex/_generated/api'
import {
  SYNC_PROVIDERS,
  channelKindLabel,
  connectedDetail,
  healthNote,
  historyProgress,
  linkStatusDetail,
  needsPrivateTarget,
  OAUTH_RETURN_PARAMS,
  oauthReturnNotice,
  syncUrls,
  type SyncAvailableChannel,
  type SyncLinkRow,
  type SyncLinkTarget,
  type SyncProviderStatus,
  type SyncStatus,
} from '../lib/sync-settings'

export type SyncPickerState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; channels: SyncAvailableChannel[] }

export type SyncSettingsActions = {
  onProviderChange(provider: SyncProvider): void
  onOpenImport(): void
  onDisconnect(): void
  onDisconnectAccount(): void
  onDmSync(enabled: boolean): void
  onAutoLink(enabled: boolean): void
  onTogglePicker(): void
  onPickerTargetChange(conversationId: string): void
  onLink(channel: SyncAvailableChannel): void
  onUnlink(link: SyncLinkRow): void
}

export type SyncSettingsViewProps = {
  provider: SyncProvider
  /** Undefined while loading, null when the viewer cannot read this workspace. */
  status: SyncStatus | null | undefined
  unavailable: boolean
  urls: ReturnType<typeof syncUrls>
  busy: string | null
  picker: SyncPickerState | null
  pickerTarget: string
  linkTargets: SyncLinkTarget[]
  now: number
  actions: SyncSettingsActions
}

const SYNC_PROVIDER_ORDER: SyncProvider[] = ['slack', 'teams']

function Monogram({ provider, small = false }: { provider: SyncProvider; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={small
        ? 'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-semibold text-white'
        : 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white'}
      style={{ backgroundColor: SYNC_PROVIDERS[provider].accent }}
    >
      {SYNC_PROVIDERS[provider].monogram}
    </span>
  )
}

function OptionsMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <MoreHorizontal size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 p-1">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

function Setting({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium text-(--foreground)">{title}</span>
        <span className="mt-0.5 text-xs text-(--muted)">{description}</span>
      </span>
      {children}
    </div>
  )
}

function LinkStatusCell({ provider, link, now }: { provider: SyncProvider; link: SyncLinkRow; now: number }) {
  const detail = linkStatusDetail(provider, link, now)
  if (link.status === 'syncing') {
    return (
      <span className="flex items-center gap-2 text-[13px] text-(--foreground)">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fa66a]" />
        Syncing
      </span>
    )
  }
  const icon = link.status === 'history'
    ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />
    : link.status === 'catching_up' ? <Timer size={12} /> : <Pause size={12} className="text-[#c98a1b]" />
  const label = link.status === 'history' ? 'Importing history' : link.status === 'catching_up' ? 'Catching up' : 'Paused'
  return (
    <span className="flex items-start gap-2 text-[13px] text-(--foreground)">
      <span className="mt-1 shrink-0 text-(--muted)">{icon}</span>
      <span className="flex min-w-0 flex-col">
        {label}
        {detail ? <span className="mt-0.5 text-[11px] leading-snug text-(--muted)">{detail}</span> : null}
        {link.status === 'history' ? (
          <Progress
            value={historyProgress(link)}
            aria-label="History imported"
            className="mt-1.5 h-[3px] max-w-44 bg-(--surface-subtle)"
            indicatorClassName="bg-(--muted)"
          />
        ) : null}
      </span>
    </span>
  )
}

function ChannelPicker({ provider, picker, pickerTarget, linkTargets, linkedIds, busy, actions }: {
  provider: SyncProvider
  picker: SyncPickerState
  pickerTarget: string
  linkTargets: SyncLinkTarget[]
  linkedIds: ReadonlySet<string>
  busy: string | null
  actions: SyncSettingsActions
}) {
  const name = SYNC_PROVIDERS[provider].name
  const target = linkTargets.find(item => item.conversationId === pickerTarget)
  const channels = picker.status === 'ready' ? picker.channels.filter(channel => !linkedIds.has(channel.id)) : []
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-(--border)" data-testid="sync-channel-picker">
      <div className="flex items-center gap-2 border-b border-(--border) py-1.5 pl-3.5 pr-2 text-xs text-(--muted)">
        <span className="flex-1">Available in {name}</span>
        {linkTargets.length > 0 ? (
          <ListboxSelect
            aria-label="Link into"
            value={pickerTarget}
            onChange={actions.onPickerTargetChange}
            buttonClassName="h-7 text-xs"
            options={[
              { value: '', label: 'Into a new channel' },
              ...linkTargets.map(item => ({ value: item.conversationId, label: 'Into #' + item.name, group: 'Existing channels' })),
            ]}
          />
        ) : null}
        <Button variant="ghost" size="icon-xs" aria-label="Close channel list" onClick={actions.onTogglePicker}>
          <X size={14} />
        </Button>
      </div>
      {picker.status === 'loading' ? (
        <p className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-(--muted)"><Loader2 size={13} className="animate-spin" />Loading channels…</p>
      ) : picker.status === 'error' ? (
        <p role="alert" className="px-3.5 py-3 text-[13px] text-(--muted)">{picker.message}</p>
      ) : channels.length === 0 ? (
        <p className="px-3.5 py-3 text-[13px] text-(--muted)">Every channel Overlay can see is already linked. To link a private channel, add Overlay to it in {name} first.</p>
      ) : (
        <div className="max-h-72 divide-y divide-(--border) overflow-y-auto">
          {channels.map(channel => {
            const mustBePrivate = needsPrivateTarget(provider, channel.kind)
            const blocked = Boolean(target && mustBePrivate && target.visibility !== 'private')
            const into = target
              ? blocked ? 'needs a private Overlay channel' : 'into #' + target.name
              : 'to new ' + (mustBePrivate ? 'private ' : '') + 'channel'
            return (
              <div key={channel.id} className="flex items-center gap-2.5 py-2 pl-3.5 pr-2 text-(--muted)">
                {channel.kind === 'public' ? <Hash size={13} className="shrink-0" /> : <Lock size={13} className="shrink-0" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-(--foreground)">{channel.name}</span>
                  <span className="mt-0.5 text-[11px]">{channelKindLabel(channel.kind, channel.groupName)}</span>
                </span>
                <span className="hidden text-xs @xl:inline">{into}</span>
                <Button variant="ghost" size="sm" disabled={blocked || busy !== null} onClick={() => actions.onLink(channel)}>
                  {busy === 'link:' + channel.id ? <Loader2 size={13} className="animate-spin" /> : null}
                  Link
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OrgCard({ provider, state, connection, canManage, urls, busy, actions }: {
  provider: SyncProvider
  state: SyncProviderStatus
  connection: SyncProviderStatus['connection']
  canManage: boolean
  urls: ReturnType<typeof syncUrls>
  busy: string | null
  actions: SyncSettingsActions
}) {
  const copy = SYNC_PROVIDERS[provider]
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-(--foreground)">{copy.orgLabel}</p>
      <div className="flex min-h-[66px] items-center gap-3 rounded-xl border border-(--border) p-3.5" data-testid="sync-org-card">
        <Monogram provider={provider} />
        {connection ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium text-(--foreground)">{connection.externalOrgName}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-(--muted)">
              {connection.status === 'connected' ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3fa66a]" /> : null}
              {connectedDetail(connection)}
            </span>
          </span>
        ) : (
          <span className="flex-1 text-[13px] leading-snug text-(--muted)">
            {state.connection ? copy.name + ' was disconnected. Linked channels are paused.' : 'Not connected yet.'}
            {canManage ? null : ' An owner or admin can connect it.'}
          </span>
        )}
        {canManage && !connection ? (
          <Button asChild variant="secondary" size="sm">
            <a href={urls.connect}>{state.connection ? 'Reconnect' : 'Connect'}</a>
          </Button>
        ) : null}
        {canManage && (connection || urls.appPackage) ? (
          <OptionsMenu label="Connection options">
            {urls.appPackage ? (
              <DropdownMenuItem asChild>
                <a href={urls.appPackage} download><Download size={13} />Download app package</a>
              </DropdownMenuItem>
            ) : null}
            {connection ? (
              <DropdownMenuItem disabled={busy !== null} onSelect={actions.onDisconnect}>Disconnect {copy.name}</DropdownMenuItem>
            ) : null}
          </OptionsMenu>
        ) : null}
      </div>
    </div>
  )
}

function AccountCard({ provider, state, connection, urls, busy, actions }: {
  provider: SyncProvider
  state: SyncProviderStatus
  connection: SyncProviderStatus['connection']
  urls: ReturnType<typeof syncUrls>
  busy: string | null
  actions: SyncSettingsActions
}) {
  const copy = SYNC_PROVIDERS[provider]
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-(--foreground)">Your {copy.name} account</p>
      <div className="flex min-h-[66px] items-center gap-3 rounded-xl border border-(--border) p-3.5" data-testid="sync-account-card">
        <Monogram provider={provider} />
        {state.account ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium text-(--foreground)">
              Connected as {state.account.externalDisplayName ?? 'you'}
            </span>
            <span className="mt-0.5 text-xs text-(--muted)">Messages you send in linked channels post to {copy.name} as you.</span>
          </span>
        ) : (
          <span className="flex-1 text-[13px] leading-snug text-(--muted)">
            Connect your {copy.name} account to reply from Overlay in linked channels.
          </span>
        )}
        {state.account ? (
          <OptionsMenu label="Account options">
            <DropdownMenuItem disabled={busy !== null} onSelect={actions.onDisconnectAccount}>Disconnect your account</DropdownMenuItem>
          </OptionsMenu>
        ) : connection ? (
          <Button asChild variant="secondary" size="sm">
            <a href={urls.connectAccount}>Connect</a>
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled title={'Available once ' + copy.name + ' is connected'}>Connect</Button>
        )}
      </div>
      {state.account ? (
        <div className="mt-2.5 px-1">
          <Setting title="Sync my direct messages" description="Only you see them. Off by default.">
            <Switch
              aria-label="Sync my direct messages"
              checked={state.account.dmSyncEnabled}
              disabled={busy !== null}
              onCheckedChange={actions.onDmSync}
            />
          </Setting>
        </div>
      ) : null}
    </div>
  )
}

function LinkTable({ provider, state, connection, canManage, busy, now, actions }: {
  provider: SyncProvider
  state: SyncProviderStatus
  connection: SyncProviderStatus['connection']
  canManage: boolean
  busy: string | null
  now: number
  actions: SyncSettingsActions
}) {
  const copy = SYNC_PROVIDERS[provider]
  return (
    <div role="table" aria-label={copy.name + ' channel links'} className="overflow-hidden rounded-xl border border-(--border)">
      <div role="row" className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] items-center gap-4 border-b border-(--border) py-2.5 pl-3.5 pr-2 text-[10px] font-medium uppercase tracking-[0.04em] text-(--muted) @xl:grid">
        <span role="columnheader">{copy.name} channel</span>
        <span role="columnheader">Overlay channel</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className="sr-only">Actions</span>
      </div>
      {state.links.length === 0 ? (
        <p className="px-3.5 py-4 text-[13px] text-(--muted)">
          {connection ? 'No channels linked yet. Link a channel to start syncing.' : 'Connect ' + copy.name + ' to link channels.'}
        </p>
      ) : (
        <div className="divide-y divide-(--border)">
          {state.links.map(link => (
            <div
              key={link.linkId}
              role="row"
              data-testid="sync-link-row"
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 pl-3.5 pr-2 @xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] @xl:gap-4"
            >
              <span role="cell" className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium text-(--foreground)">{provider === 'slack' ? '#' : ''}{link.externalChannelName}</span>
                <span className="mt-0.5 text-[11px] text-(--muted)">{channelKindLabel(link.externalChannelKind)}</span>
              </span>
              <span role="cell" className="col-start-1 flex min-w-0 items-center gap-1.5 text-[13px] text-(--foreground) @xl:col-start-auto">
                {link.overlayChannelVisibility === 'public' ? <Hash size={12} className="shrink-0 text-(--muted)" /> : <Lock size={12} className="shrink-0 text-(--muted)" />}
                <span className="truncate">{link.overlayChannelName}</span>
              </span>
              <span role="cell" className="col-span-2 @xl:col-span-1">
                <LinkStatusCell provider={provider} link={link} now={now} />
              </span>
              <span role="cell" className="col-start-2 row-span-2 row-start-1 flex justify-end @xl:col-start-auto @xl:row-span-1 @xl:row-start-auto">
                {canManage ? (
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => actions.onUnlink(link)}>Unlink</Button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProviderBody({ provider, state, canManage, urls, busy, picker, pickerTarget, linkTargets, now, actions }: {
  provider: SyncProvider
  state: SyncProviderStatus
  canManage: boolean
  urls: ReturnType<typeof syncUrls>
  busy: string | null
  picker: SyncPickerState | null
  pickerTarget: string
  linkTargets: SyncLinkTarget[]
  now: number
  actions: SyncSettingsActions
}) {
  const copy = SYNC_PROVIDERS[provider]
  const connection = state.connection && state.connection.status !== 'disconnected' ? state.connection : null
  const health = healthNote(provider, state.links)
  const linkedIds = new Set(state.links.map(link => link.externalChannelId))
  const HealthIcon = health?.tone === 'warning' ? Pause : health?.tone === 'busy' ? Timer : Check
  return (
    <>
      <div className="mb-8 mt-6 grid gap-4 @2xl:grid-cols-2">
        <OrgCard provider={provider} state={state} connection={connection} canManage={canManage} urls={urls} busy={busy} actions={actions} />
        <AccountCard provider={provider} state={state} connection={connection} urls={urls} busy={busy} actions={actions} />
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-(--foreground)">Channels</h3>
        {canManage ? (
          <Button variant="secondary" size="sm" disabled={!connection || connection.status !== 'connected'} onClick={actions.onTogglePicker}>
            <Plus size={13} />
            Link channel
          </Button>
        ) : null}
      </div>
      <div className="mb-3 border-b border-(--border) pb-3.5">
        <Setting title={copy.autoLabel} description={copy.autoHelp}>
          <Switch
            aria-label={copy.autoLabel}
            checked={connection?.autoLink ?? false}
            disabled={!canManage || !connection || busy !== null}
            onCheckedChange={actions.onAutoLink}
          />
        </Setting>
      </div>

      {picker && connection ? (
        <ChannelPicker
          provider={provider}
          picker={picker}
          pickerTarget={pickerTarget}
          linkTargets={linkTargets}
          linkedIds={linkedIds}
          busy={busy}
          actions={actions}
        />
      ) : null}

      <LinkTable provider={provider} state={state} connection={connection} canManage={canManage} busy={busy} now={now} actions={actions} />
      {health ? (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-(--muted)" data-testid="sync-health">
          <HealthIcon size={12} className={health.tone === 'warning' ? 'text-[#c98a1b]' : undefined} />
          {health.text}
        </p>
      ) : null}
    </>
  )
}

/** The Import & sync tab: one Slack or Teams provider at a time, from the live sync status. */
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

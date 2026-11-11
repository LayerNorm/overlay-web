'use client'

import { useState } from 'react'
import { Hash, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@overlay/ui/primitives'
import { ConfirmDialog } from '@overlay/ui/overlays'
import { OverlayMark } from '@/components/brand/OverlayMark'
import { SlackLogo } from '@/components/brand/SlackLogo'
import type { SurfaceConnection } from '@overlay/workspace-contracts'
import { useWorkspaceSlack, type WorkspaceSlackController } from './use-workspace-slack'

export function WorkspaceSlackSettings({ workspaceId }: { workspaceId: string }) {
  const controller = useWorkspaceSlack(workspaceId)
  return <WorkspaceSlackContent controller={controller} />
}

function SlackChannelPicker({ connectionId, controller }: { connectionId: string; controller: WorkspaceSlackController }) {
  const [search, setSearch] = useState('')
  const picker = controller.picker?.connectionId === connectionId ? controller.picker : null
  const enabled = new Set(controller.data?.bindings.filter(binding => binding.connectionId === connectionId).map(binding => binding.channelId))
  const options = picker?.options.filter(channel => !enabled.has(channel.id) && channel.name.toLowerCase().includes(search.toLowerCase().replace(/^#/, ''))) ?? []
  return <Popover open={picker !== null} onOpenChange={open => {
    if (open) { setSearch(''); void controller.openPicker(connectionId) }
    else controller.closePicker()
  }}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" disabled={controller.busy !== null}><Plus size={13} />Add channel</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-64 p-2">
      <Input aria-label="Search public channels" placeholder="Search public channels…" value={search} onChange={event => setSearch(event.target.value)} className="mb-1" />
      {picker?.loading ? <p role="status" className="px-2 py-3 text-xs text-(--muted)">Loading public channels…</p>
        : picker?.error ? <div role="alert" className="px-2 py-3 text-xs text-(--muted)"><p>{picker.error}</p><Button size="xs" variant="ghost" className="mt-2" onClick={() => void controller.openPicker(connectionId)}>Retry</Button></div>
          : <>{options.map(channel => <Button key={channel.id} variant="ghost" className="w-full justify-start text-sm" disabled={controller.busy !== null} onClick={() => void controller.addChannel(connectionId, channel)}><Hash size={14} />{channel.name}</Button>)}{!options.length && <p className="px-2 py-3 text-xs text-(--muted)">No matching public channels.</p>}</>}
    </PopoverContent>
  </Popover>
}

function ConnectSlackRow({ controller }: { controller: WorkspaceSlackController }) {
  return <div className="grid grid-cols-[36px_minmax(0,1fr)] items-start gap-3 px-5 py-4 sm:grid-cols-[36px_minmax(0,1fr)_auto]">
    <span className="flex size-9 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle)"><SlackLogo /></span>
    <div className="min-w-0"><h3 className="text-sm font-medium leading-5">Connect Slack</h3><p className="mt-1 text-sm leading-relaxed text-(--muted)">{controller.data?.canManage ? 'The Overlay bot joins your Slack workspace and routes every message to your workspace Chief.' : 'Ask a workspace administrator to connect Slack. Messages will route to your workspace Chief.'}</p></div>
    {controller.data?.canManage && <Button size="sm" variant="secondary" className="col-start-2 justify-self-start sm:col-start-3" onClick={controller.connect}>Connect Slack</Button>}
  </div>
}

type Confirmation = { kind: 'disconnect' | 'unlink'; id: string; teamName: string } | null

function SlackConnection({ connection, controller, onConfirm }: {
  connection: SurfaceConnection
  controller: WorkspaceSlackController
  onConfirm(value: NonNullable<Confirmation>): void
}) {
  const { data, busy } = controller
  const active = connection.status === 'active'
  const admin = data?.canManage === true
  const channels = data?.bindings.filter(binding => binding.connectionId === connection.id) ?? []
  const identity = data?.identityLinks.find(link => link.connectionId === connection.id)
  const teamName = connection.externalTeamName ?? connection.externalTeamId
  return <div>
    <div className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-5 py-4">
      <span className="flex size-9 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle)"><SlackLogo /></span>
      <div className="min-w-0"><h3 className="break-words text-sm font-medium leading-5">{teamName}</h3><p className="mt-0.5 text-xs leading-4 text-(--muted)">Slack workspace</p></div>
      <span className="self-start justify-self-end pr-3 text-xs leading-5 text-(--muted)">{active ? 'Connected' : 'Disconnected'}</span>
      <p className="col-span-2 col-start-2 flex items-center gap-1.5 text-xs leading-5 text-(--muted)"><OverlayMark size={15} /><span>Overlay bot · Workspace Chief</span></p>
    </div>
    {!active && <div className="flex items-center justify-between gap-3 border-t border-(--border) px-5 py-3"><p className="text-xs leading-5 text-(--muted)">Reconnect Slack to receive and reply to messages.</p>{admin && <Button size="sm" variant="secondary" onClick={controller.connect}>Reconnect Slack</Button>}</div>}
    <div className="flex h-10 items-center justify-between gap-3 border-t border-(--border) px-5 py-1"><h3 className="text-xs font-medium leading-5 text-(--muted)">Enabled public channels</h3>{admin && active && <SlackChannelPicker connectionId={connection.id} controller={controller} />}</div>
    <div className="divide-y divide-(--border)">
      {channels.map(channel => <div key={channel.id} className="flex h-12 items-center gap-3 px-5 py-3"><span className="flex h-6 w-9 shrink-0 items-center justify-center text-(--muted)"><Hash size={16} /></span><span className="min-w-0 flex-1 truncate text-sm font-medium leading-5">{channel.channelName ?? channel.channelId}</span>{admin && <Button variant="ghost" size="icon-xs" aria-label={`Remove #${channel.channelName ?? channel.channelId}`} disabled={busy !== null} onClick={() => void controller.removeChannel(channel.id)}><Trash2 size={13} /></Button>}</div>)}
      {!channels.length && <p className="px-5 py-3 text-sm text-(--muted)">{admin ? 'No channels enabled. Add a public channel to receive messages.' : 'No public channels are enabled yet.'}</p>}
    </div>
    <div className={'flex min-h-16 items-center justify-between gap-3 border-t border-(--border) px-5 py-3 ' + (!identity ? 'max-sm:items-start max-sm:flex-col' : '')}>
      <div className="min-w-0"><h3 className="text-sm font-medium leading-5">Your Slack account</h3><p className="mt-0.5 break-words text-xs leading-4 text-(--muted)">{identity ? `Linked as ${identity.displayName ? `@${identity.displayName}` : identity.slackUserId}` : 'Link your account to message Overlay in Slack.'}</p></div>
      <Button variant={identity ? 'ghost' : 'secondary'} size="sm" disabled={busy !== null || (!identity && !active)} onClick={() => identity ? onConfirm({ kind: 'unlink', id: identity.id, teamName }) : controller.link(connection.id)}>{identity ? 'Unlink' : 'Link your Slack account'}</Button>
    </div>
    {admin && active && <div className="flex items-center justify-between gap-3 border-t border-(--border) px-5 py-3"><span className="text-sm text-(--muted)">Slack connection</span><Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => onConfirm({ kind: 'disconnect', id: connection.id, teamName })}>Disconnect</Button></div>}
  </div>
}

export function WorkspaceSlackContent({ controller }: { controller: WorkspaceSlackController }) {
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const { data, error, busy } = controller
  if (data === undefined) return <p role="status" className="px-5 py-4 text-sm text-(--muted)">Loading Slack connection…</p>
  if (data === null) return <p role="alert" className="px-5 py-4 text-sm text-(--muted)">Could not load Slack settings. Check your workspace access and try again.</p>
  return <>
    {error && <p role="alert" className="border-b border-(--border) px-5 py-3 text-sm text-red-500">{error}</p>}
    {data.connections.length ? <div className="divide-y divide-(--border)">{data.connections.map(connection => <SlackConnection key={connection.id} connection={connection} controller={controller} onConfirm={setConfirmation} />)}</div> : <ConnectSlackRow controller={controller} />}
    <p className="border-t border-(--border) px-5 py-3 text-xs leading-5 text-(--muted)">DMs, private channels and Slack Connect aren’t supported yet.</p>
    <ConfirmDialog isOpen={confirmation !== null} title={confirmation?.kind === 'disconnect' ? 'Disconnect Slack?' : 'Unlink your Slack account?'} description={confirmation?.kind === 'disconnect' ? `Overlay will stop receiving and replying to messages in every enabled channel in ${confirmation.teamName}. You can reconnect later.` : 'You won’t be able to send requests to Overlay in Slack until you link your account again. The workspace connection stays connected.'} confirmLabel={confirmation?.kind === 'disconnect' ? 'Disconnect Slack' : 'Unlink account'} busy={busy !== null} onCancel={() => setConfirmation(null)} onConfirm={async () => {
      if (!confirmation) return
      const success = confirmation.kind === 'disconnect' ? await controller.disconnect(confirmation.id) : await controller.unlink(confirmation.id)
      if (success) setConfirmation(null)
    }} />
  </>
}

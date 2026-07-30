'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, Hash, Lock, Search, UserRound } from 'lucide-react'
import { Button, DialogFrame, Input } from '@overlay/ui/primitives'
import type { ChannelVisibility, WorkspaceManagementItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export function NewChannelDialog({
  open,
  workspaceId,
  showcase = false,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  workspaceId: string
  showcase?: boolean
  onOpenChange(open: boolean): void
  onCreated(channel: { id: string; title: string }): void
}) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [visibility, setVisibility] = useState<ChannelVisibility>('public')
  const [members, setMembers] = useState<WorkspaceManagementItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || visibility !== 'private' || showcase) return
    let cancelled = false
    void Promise.all([
      overlayAppClient.workspaces.management(workspaceId, 'people'),
      overlayAppClient.workspaces.management(workspaceId, 'chats-agents'),
    ]).then(([people, agents]) => {
      if (cancelled) return
      const byPrincipal = new Map<string, WorkspaceManagementItem>()
      for (const item of [...people.items, ...agents.items]) {
        if (item.kind === 'member' && item.principalId && item.status === 'active') {
          byPrincipal.set(item.principalId, item)
        }
      }
      setMembers([...byPrincipal.values()].filter((item) => item.principalId !== people.currentPrincipalId))
    }).catch(() => setError('Could not load workspace members.'))
    return () => { cancelled = true }
  }, [open, showcase, visibility, workspaceId])

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return members.filter((item) => !needle || `${item.name} ${item.description ?? ''}`.toLowerCase().includes(needle))
  }, [members, query])

  async function create() {
    if (!name.trim() || busy) return
    if (showcase) {
      onCreated({ id: 'showcase-channel-product', title: name.trim() })
      onOpenChange(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { channel } = await overlayAppClient.conversations.createChannel({
        name: name.trim(),
        topic: topic.trim() || undefined,
        visibility,
        principalIds: visibility === 'private' ? selected : undefined,
      })
      onCreated({ id: channel.conversationId, title: channel.name })
      setName('')
      setTopic('')
      setSelected([])
      onOpenChange(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create channel.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Create a channel"
      description="Channels give a workspace a durable place for a topic, project, or team."
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create channel'}
          </Button>
        </>
      )}
    >
      <div className="mt-5 space-y-4">
        <label className="block text-xs font-medium text-[var(--foreground)]">
          Name
          <div className="relative mt-1.5">
            <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" />
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="pl-9" placeholder="product-launch" />
          </div>
        </label>
        <label className="block text-xs font-medium text-[var(--foreground)]">
          Topic <span className="font-normal text-[var(--muted-light)]">optional</span>
          <Input value={topic} onChange={(event) => setTopic(event.target.value)} className="mt-1.5" placeholder="What belongs in this channel?" />
        </label>
        <div>
          <span className="text-xs font-medium text-[var(--foreground)]">Visibility</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {([
              ['public', Hash, 'Everyone joins automatically'],
              ['private', Lock, 'Only invited members can open it'],
            ] as const).map(([value, Icon, detail]) => (
              <button key={value} type="button" onClick={() => setVisibility(value)} className={`rounded-lg border p-3 text-left ${visibility === value ? 'border-[var(--foreground)] bg-[var(--surface-subtle)]' : 'border-[var(--border)]'}`}>
                <span className="flex items-center gap-2 text-xs font-medium capitalize"><Icon size={13} />{value}</span>
                <span className="mt-1 block text-[10px] leading-4 text-[var(--muted-light)]">{detail}</span>
              </button>
            ))}
          </div>
        </div>
        {visibility === 'private' ? (
          <div>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Add people or agents" />
            </div>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {candidates.map((item) => {
                const principalId = item.principalId!
                const active = selected.includes(principalId)
                const Icon = item.principalType === 'agent' ? Bot : UserRound
                return (
                  <button key={principalId} type="button" onClick={() => setSelected((current) => active ? current.filter((id) => id !== principalId) : [...current, principalId])} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--surface-subtle)]">
                    <Icon size={13} className="text-[var(--muted)]" />
                    <span className="min-w-0 flex-1 truncate text-xs">{item.name}</span>
                    <span className={`flex h-4 w-4 items-center justify-center rounded border ${active ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--border)]'}`}>{active ? <Check size={10} /> : null}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
      </div>
    </DialogFrame>
  )
}

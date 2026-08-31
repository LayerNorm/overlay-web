'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, Search, UserRound, UserPlus } from 'lucide-react'
import { Button, DialogFrame, Input } from '@overlay/ui/primitives'
import type { WorkspaceManagementItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

const SHOWCASE_CURRENT_PRINCIPAL_ID = 'showcase-divyansh'
const SHOWCASE_ITEMS: WorkspaceManagementItem[] = [
  {
    id: 'showcase-member-priya',
    kind: 'member',
    name: 'Priya Nair',
    description: 'priya@acme.test',
    principalId: 'showcase-priya',
    principalType: 'human',
    role: 'member',
    status: 'active',
  },
  {
    id: 'showcase-agent-research',
    kind: 'member',
    name: 'Research agent',
    description: 'Sources, synthesis, and briefs',
    principalId: 'showcase-agent-research',
    principalType: 'agent',
    role: 'member',
    status: 'active',
  },
]

export function NewDirectMessageDialog({
  open,
  workspaceId,
  sourceConversationId,
  addToConversationId,
  addToConversationType = 'channel',
  showcase = false,
  excludedPrincipalIds = [],
  onOpenChange,
  onCreated,
  onParticipantsAdded,
}: {
  open: boolean
  workspaceId: string
  sourceConversationId?: string
  addToConversationId?: string
  addToConversationType?: 'dm' | 'channel'
  showcase?: boolean
  excludedPrincipalIds?: string[]
  onOpenChange(open: boolean): void
  onCreated?(conversation: { id: string; title: string }): void
  onParticipantsAdded?(): void
}) {
  const [items, setItems] = useState<WorkspaceManagementItem[]>(showcase ? SHOWCASE_ITEMS : [])
  const [currentPrincipalId, setCurrentPrincipalId] = useState(
    showcase ? SHOWCASE_CURRENT_PRINCIPAL_ID : '',
  )
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(!showcase)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteSent, setInviteSent] = useState(false)

  useEffect(() => {
    if (!open || showcase) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setInviteSent(false)
    void Promise.all([
      overlayAppClient.workspaces.management(workspaceId, 'people'),
      overlayAppClient.workspaces.management(workspaceId, 'chats-agents'),
    ]).then(([people, agents]) => {
      if (cancelled) return
      setCurrentPrincipalId(people.currentPrincipalId)
      const byId = new Map<string, WorkspaceManagementItem>()
      for (const item of [...people.items, ...agents.items]) {
        if (item.kind === 'member' && item.principalId) byId.set(item.principalId, item)
      }
      setItems([...byId.values()])
    }).catch(() => {
      if (!cancelled) setError('Could not load workspace members.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [open, showcase, workspaceId])

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items
      .filter((item) => (
        item.principalId !== currentPrincipalId
        && item.status === 'active'
        && !excludedPrincipalIds.includes(item.principalId ?? '')
      ))
      .filter((item) => !needle || `${item.name} ${item.description ?? ''}`.toLowerCase().includes(needle))
  }, [currentPrincipalId, excludedPrincipalIds, items, query])
  const emailQuery = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.trim())
    ? query.trim().toLowerCase()
    : null

  function toggle(principalId: string) {
    setSelected((current) => current.includes(principalId)
      ? current.filter((id) => id !== principalId)
      : [...current, principalId])
  }

  async function create() {
    if (selected.length === 0 || busy) return
    if (showcase) {
      if (addToConversationId) onParticipantsAdded?.()
      else onCreated?.({ id: 'showcase-created-dm', title: 'New direct message' })
      onOpenChange(false)
      setSelected([])
      setQuery('')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (addToConversationId && addToConversationType === 'channel') {
        await Promise.all(selected.map((principalId) => (
          overlayAppClient.conversations.addParticipant(addToConversationId, principalId)
        )))
        onParticipantsAdded?.()
        onOpenChange(false)
        setSelected([])
        setQuery('')
        return
      }
      const { directMessage } = await overlayAppClient.conversations.createWorkspaceDirectMessage(workspaceId, {
        principalIds: addToConversationId
          ? [...excludedPrincipalIds, ...selected]
          : selected,
        sourceConversationId,
      })
      onCreated?.({ id: directMessage.conversationId, title: directMessage.title })
      onOpenChange(false)
      setSelected([])
      setQuery('')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the message.')
    } finally {
      setBusy(false)
    }
  }

  async function invite(email: string) {
    if (showcase) {
      setInviteSent(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await overlayAppClient.workspaces.invite(workspaceId, { email, role: 'member' })
      setInviteSent(true)
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Could not send the invitation.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={addToConversationId && addToConversationType === 'dm' ? 'Start a group DM' : addToConversationId ? 'Add people' : sourceConversationId ? 'Continue with people' : 'New direct message'}
      description={addToConversationId
        ? addToConversationType === 'dm'
          ? 'Overlay will start a new group DM without copying this private history.'
          : 'People added to this channel can read its history.'
        : sourceConversationId
        ? 'Choose people. Overlay will fork this Personal chat so the original stays private.'
        : 'Choose one person for a DM or several people for a group DM.'}
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void create()} disabled={busy || selected.length === 0}>
            {busy ? 'Working…' : addToConversationId && addToConversationType === 'dm' ? 'Start group DM' : addToConversationId ? 'Add people' : sourceConversationId ? 'Continue in DM' : 'Start message'}
          </Button>
        </>
      )}
    >
      <div className="mt-5">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-light)]" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setInviteSent(false)
            }}
            className="pl-9"
            placeholder="Search people or enter an email"
            aria-label="Search workspace people"
          />
        </div>

        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 py-2" aria-label="Loading people">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-11 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
              ))}
            </div>
          ) : candidates.length > 0 ? candidates.map((item) => {
            const principalId = item.principalId!
            const checked = selected.includes(principalId)
            const AgentIcon = item.principalType === 'agent' ? Bot : UserRound
            return (
              <button
                key={principalId}
                type="button"
                onClick={() => toggle(principalId)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  checked ? 'bg-[var(--surface-subtle)]' : 'hover:bg-[var(--surface-subtle)]'
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
                  <AgentIcon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--foreground)]">{item.name}</span>
                  <span className="block truncate text-[11px] text-[var(--muted-light)]">{item.description}</span>
                </span>
                <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                  checked
                    ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]'
                    : 'border-[var(--border)]'
                }`}>
                  {checked ? <Check size={12} /> : null}
                </span>
              </button>
            )
          }) : emailQuery ? (
            <button
              type="button"
              disabled={busy || inviteSent}
              onClick={() => void invite(emailQuery)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-60"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)]">
                <UserPlus size={14} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                  {inviteSent ? 'Invitation sent' : `Invite ${emailQuery}`}
                </span>
                <span className="block text-[11px] text-[var(--muted-light)]">
                  They can join this workspace, then you can message them.
                </span>
              </span>
            </button>
          ) : (
            <div className="px-3 py-6 text-center text-xs text-[var(--muted-light)]">
              {query.trim() ? 'No matching people.' : 'Invite someone to this workspace to start a DM.'}
            </div>
          )}
        </div>
        {selected.length > 0 ? (
          <p className="mt-3 text-[11px] text-[var(--muted-light)]">
            {selected.length === 1 ? '1 person selected' : `${selected.length} people selected · group DM`}
          </p>
        ) : null}
        {error ? <p role="alert" className="mt-3 text-xs text-red-500">{error}</p> : null}
      </div>
    </DialogFrame>
  )
}

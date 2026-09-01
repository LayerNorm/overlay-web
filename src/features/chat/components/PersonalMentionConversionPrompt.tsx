'use client'

import { useState } from 'react'
import { Hash, MessageCircle } from 'lucide-react'
import type { MentionItem } from '@/shared/knowledge/mention-types'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { savePendingCollaborationMessage } from '../lib/pending-collaboration-message'

export function PersonalMentionConversionPrompt({
  draft,
  mentions,
  sourceConversationId,
  workspaceId,
  onCancel,
}: {
  draft: string
  mentions: MentionItem[]
  sourceConversationId?: string | null
  workspaceId: string
  onCancel(): void
}) {
  const [busy, setBusy] = useState<'dm' | 'channel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const people = mentions.filter((mention) => mention.type === 'person')
  const participantIds = [...new Set(people.map((mention) => mention.id))]
  const names = [...new Set(people.map((mention) => mention.name))]

  async function create(kind: 'dm' | 'channel') {
    if (!draft.trim() || participantIds.length === 0 || busy) return
    setBusy(kind)
    setError(null)
    try {
      let conversationId: string | undefined
      if (kind === 'dm') {
        conversationId = (await overlayAppClient.conversations.createWorkspaceDirectMessage(workspaceId, {
          principalIds: participantIds,
          sourceConversationId: sourceConversationId ?? undefined,
        })).directMessage.conversationId
      } else {
        conversationId = (await overlayAppClient.conversations.createWorkspaceChannel(workspaceId, {
          name: `${names.join(' & ') || 'New'} discussion`.slice(0, 100),
          visibility: 'private',
          principalIds: participantIds,
        })).channel?.conversationId
      }
      if (!conversationId) throw new Error('Could not create the conversation.')

      savePendingCollaborationMessage({ conversationId, content: draft })
      const params = new URLSearchParams(window.location.search)
      params.set('id', conversationId)
      params.set('view', kind === 'dm' ? 'dms' : 'channels')
      window.history.pushState(null, '', `${window.location.pathname}?${params.toString()}`)
      window.dispatchEvent(new Event('overlay:chat-route-selected'))
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the conversation.')
      setBusy(null)
    }
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--muted)]" role="status">
      <span className="min-w-0 flex-1">
        You mentioned {names.join(', ')}. Send this in a shared conversation instead of your Personal chat; your existing Personal chat stays private.
      </span>
      <button
        type="button"
        onClick={() => void create('dm')}
        disabled={Boolean(busy)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--foreground)] px-2.5 font-medium text-[var(--background)] disabled:opacity-60"
      >
        <MessageCircle size={13} />
        {busy === 'dm' ? 'Starting…' : 'Start DM'}
      </button>
      <button
        type="button"
        onClick={() => void create('channel')}
        disabled={Boolean(busy)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 font-medium text-[var(--foreground)] disabled:opacity-60"
      >
        <Hash size={13} />
        {busy === 'channel' ? 'Creating…' : 'Private channel'}
      </button>
      <button type="button" onClick={onCancel} disabled={Boolean(busy)} className="h-8 rounded-lg px-2 text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--foreground)] disabled:opacity-60">
        Keep editing
      </button>
      {error ? <span role="alert" className="w-full text-red-500">{error}</span> : null}
    </div>
  )
}

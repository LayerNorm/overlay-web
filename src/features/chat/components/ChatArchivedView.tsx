'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Button, EmptyState } from '@overlay/ui/primitives'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

type ArchivedConversation = {
  _id: string
  title?: string | null
  conversationType?: string
  lastModified?: number
  archivedAt?: number
}

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; conversations: ArchivedConversation[] }

/**
 * Conversations the actor archived. These are exactly the rows the main
 * conversations list subtracts, so this is the only surface that can reach them
 * again — restore puts one back, delete removes it for good.
 */
export function ChatArchivedView() {
  const router = useRouter()
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const response = await fetch('/api/v1/conversations?archived=true', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('Could not load archived conversations.')
      const conversations = await response.json() as ArchivedConversation[]
      setState({ status: 'ready', conversations: Array.isArray(conversations) ? conversations : [] })
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load archived conversations.',
      })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function restore(conversationId: string) {
    setBusyId(conversationId)
    try {
      await overlayAppClient.conversations.updateParticipantState(conversationId, { archived: false })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function deleteForever(conversationId: string) {
    setBusyId(conversationId)
    try {
      const response = await fetch(
        `/api/v1/conversations?conversationId=${encodeURIComponent(conversationId)}`,
        { method: 'DELETE', credentials: 'same-origin' },
      )
      if (!response.ok) throw new Error('Failed to delete conversation')
      setConfirmingId(null)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-72 flex-1 items-center justify-center text-sm text-[var(--muted)]">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Loading archived chats…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <EmptyState
        className="min-h-72 px-6 py-12"
        icon={<Archive size={28} />}
        title="Archived chats are unavailable"
        description={state.message}
        action={<Button size="sm" onClick={() => void load()}>Try again</Button>}
      />
    )
  }

  if (state.conversations.length === 0) {
    return (
      <EmptyState
        className="min-h-72 px-6 py-12"
        icon={<Archive size={28} />}
        title="Nothing archived"
        description="Archived direct messages and channels are kept here. Archive one from its conversation menu."
      />
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4">
          <h1 className="text-sm font-medium text-[var(--foreground)]">Archived</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Hidden from your chat list. Restoring puts a conversation back; deleting cannot be undone.
          </p>
        </div>
        <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {state.conversations.map((conversation) => (
            <li key={conversation._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => router.push(`/app/chat?id=${encodeURIComponent(conversation._id)}`)}
              >
                <p className="truncate text-sm text-[var(--foreground)]">
                  {conversation.title?.trim() || 'Untitled conversation'}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {conversation.conversationType === 'channel' ? 'Channel' : 'Direct message'}
                  {conversation.archivedAt
                    ? ` · archived ${new Date(conversation.archivedAt).toLocaleDateString()}`
                    : ''}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === conversation._id}
                  onClick={() => void restore(conversation._id)}
                >
                  <RotateCcw size={13} />
                  Restore
                </Button>
                {confirmingId === conversation._id ? (
                  <>
                    <Button
                      size="sm"
                      disabled={busyId === conversation._id}
                      onClick={() => void deleteForever(conversation._id)}
                    >
                      {busyId === conversation._id ? <Loader2 size={13} className="animate-spin" /> : null}
                      Delete forever
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${conversation.title?.trim() || 'conversation'} permanently`}
                    disabled={busyId === conversation._id}
                    onClick={() => setConfirmingId(conversation._id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

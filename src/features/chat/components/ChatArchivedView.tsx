'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Archive, Loader2 } from 'lucide-react'
import { Button, EmptyState } from '@overlay/ui/primitives'
import { AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import {
  CHAT_ARCHIVED_EVENT,
  type ChatArchivedDetail,
} from '@/shared/chat/chat-title'
import { usePersonalChat } from '@/components/providers/PersonalChatProvider'
import { excludeNativePersonalChats, isNativePersonalChatCandidate } from '@/shared/chat/native-personal-chat'

const ChatExperience = dynamic(() => import('./ChatExperience'))
const DirectMessageExperience = dynamic(
  () => import('./DirectMessageExperience').then((module) => ({ default: module.DirectMessageExperience })),
)

type ArchivedConversation = {
  _id: string
  title?: string | null
  conversationType?: string
  scope?: 'personal' | 'workspace'
  workspaceId?: string
  lastModified?: number
  archivedAt?: number
}

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; conversations: ArchivedConversation[] }

function unwrapList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: T[] }).data
  }
  return []
}

function readSelectedId(searchId: string | null): string | null {
  if (typeof window === 'undefined') return searchId
  return new URLSearchParams(window.location.search).get('id') ?? searchId
}

/**
 * Archived chats open as the conversation itself. The sidebar list is the
 * index; this page is only ever empty-state or the most recently archived
 * (or explicitly selected) chat.
 */
export function ChatArchivedView({
  userId,
  firstName,
}: {
  userId: string | null
  firstName?: string
}) {
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const searchId = searchParams?.get('id') ?? null
  const nativePersonal = usePersonalChat()
  const nativePersonalEnabled = nativePersonal.configured && Boolean(userId)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [routeVersion, setRouteVersion] = useState(0)
  const archivedHeader = <AppScreenHeader title="Archived" />

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const response = await fetch('/api/v1/conversations?archived=true', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('Could not load archived conversations.')
      const rows = unwrapList<ArchivedConversation>(await response.json())
      const retainedRows = nativePersonalEnabled
        ? nativePersonal.workspaceId
          ? excludeNativePersonalChats(rows, nativePersonal.workspaceId)
          : rows.filter((row) => (row.conversationType ?? 'personal') !== 'personal' || row.scope === 'workspace')
        : rows
      setState({ status: 'ready', conversations: retainedRows })
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load archived conversations.',
      })
    }
  }, [nativePersonalEnabled, nativePersonal.workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    function bumpRoute() {
      setRouteVersion((value) => value + 1)
    }
    function handleChatArchived(event: Event) {
      const archived = (event as CustomEvent<ChatArchivedDetail>).detail?.chat
      if (!archived?._id) return
      if (nativePersonalEnabled && (
        nativePersonal.archived.rows.some((row) => row._id === archived._id)
        || isNativePersonalChatCandidate(archived, nativePersonal.workspaceId)
      )) return
      setState((current) => {
        if (current.status !== 'ready') return current
        if (current.conversations.some((conversation) => conversation._id === archived._id)) return current
        return {
          status: 'ready',
          conversations: [{
            _id: archived._id,
            title: archived.title,
            conversationType: archived.conversationType,
            scope: archived.scope,
            workspaceId: archived.workspaceId,
            lastModified: archived.lastModified,
            archivedAt: archived.archivedAt,
          }, ...current.conversations],
        }
      })
      bumpRoute()
    }
    window.addEventListener('overlay:chat-route-selected', bumpRoute)
    window.addEventListener(CHAT_ARCHIVED_EVENT, handleChatArchived)
    window.addEventListener('popstate', bumpRoute)
    return () => {
      window.removeEventListener('overlay:chat-route-selected', bumpRoute)
      window.removeEventListener(CHAT_ARCHIVED_EVENT, handleChatArchived)
      window.removeEventListener('popstate', bumpRoute)
    }
  }, [nativePersonal.archived.rows, nativePersonalEnabled, nativePersonal.workspaceId])

  void routeVersion
  const selectedId = readSelectedId(searchId)
  const conversations = useMemo(() => {
    const legacy = state.status === 'ready' ? state.conversations : []
    if (!nativePersonalEnabled) return legacy
    if (!nativePersonal.workspaceId) return []
    const nativeRows = [...nativePersonal.archived.rows]
    const selectedSummary = nativePersonal.selectedSummary
    if (selectedSummary?.archivedAt
      && selectedSummary.workspaceId === nativePersonal.workspaceId
      && !nativeRows.some((row) => row._id === selectedSummary._id)) {
      nativeRows.push(selectedSummary)
    }
    const byId = new Map<string, ArchivedConversation>()
    for (const row of [...legacy, ...nativeRows]) byId.set(row._id, row)
    return [...byId.values()].sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
  }, [
    nativePersonal.archived.rows,
    nativePersonal.selectedSummary,
    nativePersonal.workspaceId,
    nativePersonalEnabled,
    state,
  ])
  const loading = state.status === 'loading'
    || (nativePersonalEnabled && nativePersonal.archived.status === 'loading')

  useEffect(() => {
    if (loading || conversations.length === 0) return
    const selected = conversations.find((conversation) => conversation._id === selectedId)
      ?? conversations[0]
    if (!selected || selected._id === selectedId) return
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
    params.set('id', selected._id)
    const next = `${pathname}?${params.toString()}`
    window.history.replaceState(null, '', next)
    window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', {
      detail: { chatId: selected._id },
    }))
  }, [conversations, loading, pathname, selectedId])

  if (loading) {
    return (
      <AppScreenShell className="h-full" header={archivedHeader}>
        <div className="flex h-full min-h-72 items-center justify-center text-sm text-(--muted)">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading archived chat…
        </div>
      </AppScreenShell>
    )
  }

  if (state.status === 'error' && conversations.length === 0) {
    return (
      <AppScreenShell className="h-full" header={archivedHeader}>
        <EmptyState
          className="h-full min-h-72 px-6 py-12"
          icon={<Archive size={28} />}
          title="Archived chats are unavailable"
          description={state.message}
          action={<Button size="sm" onClick={() => void load()}>Try again</Button>}
        />
      </AppScreenShell>
    )
  }

  if (conversations.length === 0) {
    return (
      <AppScreenShell className="h-full" header={archivedHeader}>
        <EmptyState
          className="h-full min-h-72 px-6 py-12"
          icon={<Archive size={28} />}
          title={nativePersonalEnabled && nativePersonal.archived.status === 'unavailable'
            ? 'Archived chats are unavailable'
            : 'Nothing archived'}
          description={nativePersonalEnabled && nativePersonal.archived.status === 'unavailable'
            ? 'Native archived conversations could not be loaded.'
            : 'Archived direct messages and channels are kept here. Archive one from its conversation menu.'}
          action={nativePersonalEnabled && nativePersonal.archived.hasMore ? (
            <Button
              size="sm"
              disabled={nativePersonal.archived.loadingMore}
              onClick={() => nativePersonal.archived.loadMore()}
            >
              {nativePersonal.archived.loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          ) : undefined}
        />
      </AppScreenShell>
    )
  }

  const selected = conversations.find((conversation) => conversation._id === selectedId)
  if (!selected) {
    return (
      <AppScreenShell className="h-full" header={archivedHeader}>
        <div className="flex h-full min-h-72 items-center justify-center text-sm text-(--muted)">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Opening archived chat…
        </div>
      </AppScreenShell>
    )
  }
  if (selected.conversationType === 'channel') {
    return (
      <DirectMessageExperience
        key={`archived-channel:${selected._id}`}
        conversationId={selected._id}
        conversationType="channel"
      />
    )
  }
  if (selected.conversationType === 'dm') {
    return (
      <DirectMessageExperience
        key={`archived-dm:${selected._id}`}
        conversationId={selected._id}
      />
    )
  }
  return (
    <ChatExperience
      userId={userId}
      firstName={firstName}
      hideSidebar
    />
  )
}

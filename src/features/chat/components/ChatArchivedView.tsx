'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useConvexAuth, useQuery } from 'convex/react'
import { Archive, Loader2 } from 'lucide-react'
import { Button, EmptyState } from '@overlay/ui/primitives'
import { AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { usePersonalChat } from '@/components/providers/PersonalChatProvider'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { api } from '../../../../convex/_generated/api'

const ChatExperience = dynamic(() => import('./ChatExperience'))
const DirectMessageExperience = dynamic(
  () => import('./DirectMessageExperience').then((module) => ({ default: module.DirectMessageExperience })),
)

type ArchivedConversation = {
  _id: string
  title?: string | null
  conversationType?: string
  archivedAt?: number
}

function readSelectedId(searchId: string | null): string | null {
  if (typeof window === 'undefined') return searchId
  return new URLSearchParams(window.location.search).get('id') ?? searchId
}

/** Archived personal chats (live chat list) and channels and DMs (live archived-rooms query), newest first. */
function useArchivedConversations(userId: string | null, selectedId: string | null) {
  const nativePersonal = usePersonalChat()
  const workspaceId = useOptionalWorkspace()?.activeWorkspaceId ?? null
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const rooms = useQuery(api.collaboration.archive.rooms,
    workspaceId && userId && isAuthenticated && !authLoading ? { workspaceId } : 'skip')
  const { archived, selectedSummary } = nativePersonal

  const conversations = useMemo(() => {
    if (!workspaceId || nativePersonal.workspaceId !== workspaceId) return []
    const rows: ArchivedConversation[] = [...(rooms ?? []), ...archived.rows]
    if (selectedSummary?.archivedAt && selectedSummary.workspaceId === workspaceId) rows.push(selectedSummary)
    const byId = new Map<string, ArchivedConversation>()
    for (const row of rows) byId.set(row._id, row)
    return [...byId.values()].sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
  }, [archived.rows, nativePersonal.workspaceId, rooms, selectedSummary, workspaceId])

  const waitingForSelected = Boolean(selectedId && (
    nativePersonal.selectedConversationId !== selectedId || selectedSummary === undefined
  ))
  const selectedUnavailable = waitingForSelected && archived.status === 'unavailable'
  const loading = Boolean(userId && (rooms === undefined || authLoading))
    || (waitingForSelected && !selectedUnavailable)
    || archived.status === 'loading'
  return {
    archived,
    conversations,
    loading,
    waitingForSelected,
    selectedUnavailable,
    unavailable: rooms === null || archived.status === 'unavailable',
  }
}

/** Points the URL at the selected archived chat, or the newest one when none (or a missing one) is selected. */
function useSelectArchivedChat(conversations: ArchivedConversation[], selectedId: string | null, ready: boolean) {
  const pathname = usePathname() ?? ''
  useEffect(() => {
    if (!ready || conversations.length === 0) return
    const selected = conversations.find((conversation) => conversation._id === selectedId) ?? conversations[0]
    if (!selected || selected._id === selectedId) return
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
    params.set('id', selected._id)
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`)
    window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', { detail: { chatId: selected._id } }))
  }, [conversations, pathname, ready, selectedId])
}

function ArchivedNotice({ children }: { children: ReactNode }) {
  return (
    <AppScreenShell className="h-full" header={<AppScreenHeader title="Archived" />}>
      {children}
    </AppScreenShell>
  )
}

function ArchivedSpinner({ label }: { label: string }) {
  return (
    <ArchivedNotice>
      <div className="flex h-full min-h-72 items-center justify-center text-sm text-(--muted)">
        <Loader2 size={16} className="mr-2 animate-spin" />
        {label}
      </div>
    </ArchivedNotice>
  )
}

/**
 * Archived chats open as the conversation itself. Settings → Archived is the index; this page shows the selected
 * archived chat (or the most recent one). Personal AI chats come from the live chat list and channels and DMs from
 * the live archived-rooms query, so an archive or restore anywhere shows at once.
 */
export function ChatArchivedView({
  userId,
  firstName,
}: {
  userId: string | null
  firstName?: string
}) {
  const searchParams = useSearchParams()
  const selectedId = readSelectedId(searchParams?.get('id') ?? null)
  const { archived, conversations, loading, waitingForSelected, selectedUnavailable, unavailable } =
    useArchivedConversations(userId, selectedId)
  useSelectArchivedChat(conversations, selectedId, !loading && !waitingForSelected)

  if (loading) return <ArchivedSpinner label="Loading archived chat…" />
  const selected = conversations.find((conversation) => conversation._id === selectedId)
  if (selectedUnavailable && !selected) {
    return (
      <ArchivedNotice>
        <EmptyState
          className="h-full min-h-72 px-6 py-12"
          icon={<Archive size={28} />}
          title="Archived chats are unavailable"
          description="The selected conversation could not be checked."
        />
      </ArchivedNotice>
    )
  }
  if (conversations.length === 0) {
    return (
      <ArchivedNotice>
        <EmptyState
          className="h-full min-h-72 px-6 py-12"
          icon={<Archive size={28} />}
          title={unavailable ? 'Archived chats are unavailable' : 'Nothing archived'}
          description={unavailable
            ? 'Archived conversations could not be loaded.'
            : 'Archived direct messages and channels are kept here. Archive one from its conversation menu.'}
          action={archived.hasMore ? (
            <Button size="sm" disabled={archived.loadingMore} onClick={() => archived.loadMore()}>
              {archived.loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          ) : undefined}
        />
      </ArchivedNotice>
    )
  }
  if (!selected) return <ArchivedSpinner label="Opening archived chat…" />
  if (selected.conversationType === 'channel' || selected.conversationType === 'dm') {
    return (
      <DirectMessageExperience
        key={`archived-${selected.conversationType}:${selected._id}`}
        conversationId={selected._id}
        {...(selected.conversationType === 'channel' ? { conversationType: 'channel' as const } : {})}
      />
    )
  }
  return <ChatExperience userId={userId} firstName={firstName} hideSidebar />
}

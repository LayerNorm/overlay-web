'use client'

import { createContext, useContext, useState, useRef, useEffect, useLayoutEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useMutation } from 'convex/react'
import { useSearchParams } from 'next/navigation'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { useRoomTranscript } from '../DirectMessageExperience.hooks'
import { mergeRoomMessages, type RoomMessageRecord } from './room-message-view'
import { useNativeCollaboration } from './NativeCollaborationProvider'
import { useNativeRoomTranscript } from './useNativeRoomTranscript'
import { NativeRoomStateProvider } from './NativeRoomState'

type Session = {
  room: ReturnType<typeof useNativeRoomTranscript>['room']
  root: [string | null, Dispatch<SetStateAction<string | null>>]
  threadHistory: { hasMore: boolean; loading: boolean; loadMore(): void }
  transcript: ReturnType<typeof useRoomTranscript>
  edit(messageId: string, content: string): Promise<void>
  remove(messageId: string): Promise<void>
}
const NativeRoomContext = createContext<Session | null>(null)
export const useNativeRoomSession = () => useContext(NativeRoomContext)
export function useRoomTranscriptSource(legacy: ReturnType<typeof useRoomTranscript>) {
  return useNativeRoomSession()?.transcript ?? legacy
}
export function useRoomThreadSelection(legacy: Session['root']): Session['root'] {
  return useNativeRoomSession()?.root ?? legacy
}

export function NativeRoomScope({ children, conversationId }: { children: ReactNode; conversationId: string }) {
  const native = useNativeCollaboration()
  const params = useSearchParams()
  if (native.status === 'disabled') return children
  if (native.status !== 'ready' || !native.workspaceId) return <RoomStatus loading={native.status === 'loading'} />
  return <NativeRoomLive key={`${native.scopeKey}:${conversationId}:${params?.get('thread') ?? ''}`} workspaceId={native.workspaceId} conversationId={conversationId}>{children}</NativeRoomLive>
}

function RoomStatus({ loading }: { loading: boolean }) {
  return <div role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">
    {loading ? 'Loading conversation…' : 'This conversation is unavailable.'}
  </div>
}

function NativeRoomLive({ children, workspaceId, conversationId }: { children: ReactNode; workspaceId: string; conversationId: string }) {
  const searchParams = useSearchParams()
  const [threadRootId, setThreadRootId] = useState<string | null>(searchParams?.get('thread') ?? null)
  const rootRef = useRef(threadRootId)
  const [overlay, setOverlay] = useState<{ root: string | null; rows: RoomMessageRecord[] }>({ root: null, rows: [] })
  const pending = overlay.root === threadRootId ? overlay.rows : []
  const main = useNativeRoomTranscript({ workspaceId, conversationId, anchorMessageId: searchParams?.get('message') ?? undefined })
  const thread = useNativeRoomTranscript({ workspaceId, conversationId, threadRootMessageId: threadRootId ?? undefined,
    anchorMessageId: threadRootId ?? undefined, enabled: Boolean(threadRootId) })
  const revoked = main.status === 'unavailable' || thread.status === 'unavailable'
  if (overlay.root !== threadRootId || (revoked && overlay.rows.length > 0)) {
    setOverlay({ root: threadRootId, rows: [] })
  }
  const canonical = mergeRoomMessages(main.rows, threadRootId ? thread.rows : [])
  const canonicalRef = useRef(canonical)
  const messages = mergeRoomMessages(canonical, pending)
  const messagesRef = useRef(messages)
  useLayoutEffect(() => {
    rootRef.current = threadRootId
    canonicalRef.current = canonical
    messagesRef.current = messages
  }, [canonical, messages, threadRootId])
  const listRef = useRef<HTMLDivElement>(null)
  const [stickToBottom, setStickToBottom] = useState(true)
  const edit = useMutation(api.collaboration.nativeRooms.editMessage)
  const remove = useMutation(api.collaboration.nativeRooms.deleteMessage)
  const loading = main.status === 'loading'
  const generatingMessages = messages.filter(row => row.status === 'generating')
  const generatingTextLength = generatingMessages.reduce((total, row) => total + row.content.length, 0)
  useEffect(() => {
    if (loading || !stickToBottom || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [generatingTextLength, loading, messages.length, stickToBottom])
  const setMessages: Dispatch<SetStateAction<RoomMessageRecord[]>> = action => {
    if (rootRef.current !== threadRootId) return
    setOverlay(current => {
      const currentRows = mergeRoomMessages(canonicalRef.current, current.root === threadRootId ? current.rows : [])
      const next = typeof action === 'function' ? action(currentRows) : action
      const rows = next.filter(row => row.id.startsWith('optimistic_'))
      return current.root === threadRootId && rows === current.rows ? current : { root: threadRootId, rows }
    })
  }
  const value: Session = {
    room: main.room,
    root: [threadRootId, setThreadRootId],
    threadHistory: { hasMore: thread.hasMore, loading: thread.status === 'loading' || thread.loadingMore, loadMore: thread.loadMore },
    transcript: {
      messages, messagesRef, setMessages, loading, setLoading() {},
      hasMoreMessages: main.hasMore, loadingOlderMessages: main.loadingMore,
      conversationTitle: main.room?.title ?? null, setConversationTitle() {}, surfacePlatform: main.room?.externalPlatform ?? null,
      listRef, stickToBottom, setStickToBottom, async loadMessages() {}, async loadOlderMessages() { main.loadMore() },
      applyLiveRoomMessages() {}, generatingMessages, generatingTextLength,
      handleTranscriptScroll() {
        const node = listRef.current
        if (!node) return
        setStickToBottom(node.scrollHeight - node.scrollTop - node.clientHeight <= 96)
        if (node.scrollTop <= 120) main.loadMore()
      },
    },
    async edit(messageId, content) { await edit({ workspaceId, conversationId: conversationId as Id<'conversations'>, messageId: messageId as Id<'conversationMessages'>, content }) },
    async remove(messageId) { await remove({ workspaceId, conversationId: conversationId as Id<'conversations'>, messageId: messageId as Id<'conversationMessages'> }) },
  }
  if (main.status === 'unavailable' || (threadRootId && thread.status === 'unavailable')) return <RoomStatus loading={false} />
  return <NativeRoomContext.Provider value={value}><NativeRoomStateProvider workspaceId={workspaceId} conversationId={conversationId}
    messageIds={canonical.filter(row => row.deletedAt === undefined).map(row => row.id)}>{children}</NativeRoomStateProvider></NativeRoomContext.Provider>
}

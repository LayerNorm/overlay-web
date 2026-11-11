'use client'

import { useAgentDirectory as useLiveAgentDirectory } from '@/hooks/use-agent-directory'
import { useTranscriptHasContentBelow } from './collaboration/useTranscriptHasContentBelow'
import { useConvex, useMutation } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import type { RoomPaging, RoomSummary } from './collaboration/ConvexRoomMessageSubscription'
import { useRoomState, type RoomStateApi } from './collaboration/useRoomState'
import { useRoomCompatibility } from './collaboration/useRoomCompatibility'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { useRouter } from 'next/navigation'
import type {
  ChannelSummary,
  ConversationParticipant,
  ConversationPin,
  ConversationPresence,
  ConversationSavedMessage,
  MessageReaction,
} from '@overlay/workspace-contracts'
import type { AttachmentPreview, AttachmentPreviewOpenOptions } from '@overlay/chat-react'
import { toast } from '@overlay/ui/primitives'
import type { MentionCategory, MentionItem } from '@/shared/knowledge/mention-types'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { resolveMentionedPrincipalIds } from '@/shared/mentions/principal-mentions'
import { clearDraft, readDraft, writeDraft } from '@/shared/chat/conversation-drafts'
import { buildNativeThreadHandoff } from '@/shared/chat/native-thread-handoff'
import {
  agentConversationRedirect,
  isTransientConversationDraft,
} from '@/shared/chat/chat-view-navigation'
import {
  CHAT_TITLE_UPDATED_EVENT,
  dispatchChatArchived,
  dispatchChatCreated,
  dispatchChatModified,
  dispatchChatTitleUpdated,
  mergeChatTitle,
  sanitizeChatTitle,
  type ChatTitleUpdatedDetail,
} from '@/shared/chat/chat-title'
import { announceArchived } from '@/shared/app/archive-toast'
import {
  AGENT_DRAFT_PREVIEW_EVENT,
  type AgentDraftPreviewEventDetail,
} from '@/shared/workspace/sidebar-events'
import {
  restorePendingCollaborationMessage,
  takePendingCollaborationMessage,
} from '../lib/pending-collaboration-message'
import { shouldRenameAgentThread } from '../lib/agent-thread-title'
import { defaultMemoryEnabled } from '@/shared/chat/tool-requests'
import { prefetchTitle } from '@/features/chat/lib/generate-title'
import {
  compareRoomMessageRecords,
  mergeRoomMessages,
  remoteAgentCommands,
  roomMessageDomId,
  type RemoteAgentCommand,
  type RoomMessageRecord,
} from './collaboration/room-message-view'
import type { RoomPanelKind } from './collaboration/RoomSidePanels'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { useChatPanels } from './chat/useChatPanels'
import { useChatShellPanels } from './chat/useChatShellPanels'
import { useChatAttachments } from './useChatAttachments'
import { useAgentTurnScroll } from './collaboration/useAgentTurnScroll'
import { useComposerTextState } from './chat/useComposerTextState'
import { useNativeThreadSafety } from './chat/useNativeThreadSafety'
import {
  isNativeThreadSafetyError,
  nativeThreadSafetyErrorStatus,
  nativeThreadSafetyStatus,
  type NativeThreadSafetyStatus,
} from '@/shared/chat/native-thread-safety'
import { buildTextTurnPayload } from './chat/chat-send-body-builders'
import { roomScrollReadKey } from './room-scroll-read-key'
import { createHandoffConversation } from './chat/chat-send-create'

export type OptimisticMessage = RoomMessageRecord
export type RoomSendResult = {
  accepted: boolean
  safetyRejected?: boolean
  notSubmitted?: boolean
  scopeChanged?: boolean
  error?: unknown
}

/** Ids of the client-only rows that show an agent is about to reply (see `useSendMessage`). */
const PENDING_AGENT_REPLY_PREFIX = 'optimistic_pending_reply_'
const PENDING_AGENT_REPLY_SORT_LEAD_MS = 30_000

export function useThreadPanel({
  room,
  conversationId,

  setRoomPanel,
}: {
  conversationId: string
  room: RoomStateApi
  setRoomPanel: Dispatch<SetStateAction<RoomPanelKind | null>>
}) {
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const [threadInput, setThreadInputState] = useState('')
  const threadInputRef = useRef(threadInput)
  const threadInputVersionRef = useRef(0)
  const threadScopeRef = useRef({ conversationId, threadRootId })
  useLayoutEffect(() => {
    threadScopeRef.current = { conversationId, threadRootId }
  }, [conversationId, threadRootId])
  const setThreadInput = useCallback((value: string) => {
    if (value !== threadInputRef.current) threadInputVersionRef.current += 1
    threadInputRef.current = value
    setThreadInputState(value)
  }, [])
  const submitThreadMessage = useCallback(async ({ sendMessage, threadRootMessageId }: {
    sendMessage: SendMessage
    threadRootMessageId: string
  }) => {
    const scope = threadScopeRef.current
    if (scope.conversationId !== conversationId || scope.threadRootId !== threadRootMessageId) return
    const text = threadInputRef.current
    const version = threadInputVersionRef.current
    const submitted: { clearedVersion: number | null } = { clearedVersion: null }
    const clearSubmittedInput = () => {
      if (submitted.clearedVersion !== null || threadScopeRef.current !== scope
          || threadInputVersionRef.current !== version || threadInputRef.current !== text) return
      setThreadInput('')
      submitted.clearedVersion = threadInputVersionRef.current
    }
    const result = await sendMessage(text, {
      threadRootMessageId, requireCurrentThread: true, onSubmitted: clearSubmittedInput,
    })
    if (result.accepted) clearSubmittedInput()
    else if (submitted.clearedVersion !== null && threadScopeRef.current === scope
        && threadInputVersionRef.current === submitted.clearedVersion) setThreadInput(text)
  }, [conversationId, setThreadInput])

  const threadFollowing = Boolean(threadRootId
    && room.state?.follows.some((follow) => follow.threadRootMessageId === threadRootId))
  const { args: roomArgs, setThreadFollow } = room
  const toggleThreadFollow = useCallback(() => {
    if (!threadRootId || !roomArgs) return
    void setThreadFollow({ ...roomArgs, threadRootMessageId: threadRootId as Id<'conversationMessages'>, followed: !threadFollowing })
      .catch(() => toast.error('Could not update thread notifications.'))
  }, [roomArgs, setThreadFollow, threadFollowing, threadRootId])

  const openThread = useCallback((messageId: string) => {
    setThreadRootId(messageId)
    setRoomPanel('thread')
  }, [setRoomPanel])

  return {
    threadRootId,
    setThreadRootId,
    threadFollowing,
    threadInput,
    setThreadInput,
    submitThreadMessage,
    toggleThreadFollow,
    openThread,
  }
}

export function useReadMarkers({
  conversationId,
  room,
  markConversationRead,
}: {
  conversationId: string
  room: RoomStateApi
  markConversationRead: (conversationId: string) => void
}) {
  const { args: roomArgs, updateMyState } = room
  const [unreadBoundarySequence, setUnreadBoundarySequence] = useState<number | null>(null)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const unreadBoundaryInitializedRef = useRef(false)
  const readMarkInFlightRef = useRef(false)
  /** Transcript state last marked read from scrolling; later scrolls over it add nothing. */
  const scrollReadKeyRef = useRef<string | null>(null)

  const clearCollaborationNotifications = useCallback(() => {
    markConversationRead(conversationId)
  }, [conversationId, markConversationRead])

  const markVisibleRead = useCallback(async (scrollReadKey?: string) => {
    if (document.visibilityState !== 'visible') return
    if (scrollReadKey !== undefined && scrollReadKey === scrollReadKeyRef.current) return
    if (readMarkInFlightRef.current) return
    readMarkInFlightRef.current = true
    try {
      // Opening a room should clear unread immediately (Slack-style). Do not
      // wait for the transcript to settle at the bottom — that race left
      // badges stuck after the user switched into a DM or channel.
      if (!roomArgs) return
      await updateMyState({ ...roomArgs, markRead: true })
      scrollReadKeyRef.current = scrollReadKey ?? null
      setUnreadBoundarySequence(null)
      setNewMessageCount(0)
      clearCollaborationNotifications()
    } finally {
      readMarkInFlightRef.current = false
    }
  }, [clearCollaborationNotifications, roomArgs, updateMyState])

  const noteParticipantsLoaded = useCallback((
    nextParticipants: ConversationParticipant[],
    principalId: string,
  ) => {
    if (!unreadBoundaryInitializedRef.current) {
      unreadBoundaryInitializedRef.current = true
      const current = nextParticipants.find((participant) => participant.principalId === principalId)
      setUnreadBoundarySequence(current?.lastReadSequence ?? null)
    }
  }, [])

  return {
    unreadBoundarySequence,
    newMessageCount,
    setNewMessageCount,
    markVisibleRead,
    noteParticipantsLoaded,
  }
}

const NO_PARTICIPANTS: ConversationParticipant[] = []
const NO_PRESENCE: ConversationPresence[] = []

/** The live roster. A removed participant reads null state, which closes the room for them. */
export function useRoomRoster({
  room,
  noteParticipantsLoaded,
}: {
  room: RoomStateApi
  noteParticipantsLoaded: (participants: ConversationParticipant[], principalId: string) => void
}) {
  const state = room.state
  const participants = (state?.participants as ConversationParticipant[] | undefined) ?? NO_PARTICIPANTS
  const currentPrincipalId = state?.currentPrincipalId ?? ''
  const presence = (state?.presence as ConversationPresence[] | undefined) ?? NO_PRESENCE
  useEffect(() => {
    if (state) noteParticipantsLoaded(state.participants as ConversationParticipant[], state.currentPrincipalId)
  }, [noteParticipantsLoaded, state])
  return { participants, currentPrincipalId, presence, ready: state !== undefined }
}

const NO_REACTIONS: MessageReaction[] = []
const NO_PINS: ConversationPin[] = []
const NO_SAVED: ConversationSavedMessage[] = []

/** Live channel facts, reactions, pins and saves for the room. */
export function useRoomCollaboration({ room }: { room: RoomStateApi }) {
  const state = room.state
  return {
    channel: (state?.channel as ChannelSummary | null | undefined) ?? null,
    reactions: (state?.reactions as MessageReaction[] | undefined) ?? NO_REACTIONS,
    pins: (state?.pins as ConversationPin[] | undefined) ?? NO_PINS,
    savedMessages: (state?.saved as ConversationSavedMessage[] | undefined) ?? NO_SAVED,
  }
}

export function useRoomTranscript({
  conversationId,
  rosterReady,
  anchorAgentTurns = false,


  agentResponding,
  markVisibleRead,
  setNewMessageCount,
}: {
  conversationId: string
  rosterReady: boolean
  anchorAgentTurns?: boolean


  agentResponding: string | null
  markVisibleRead: (scrollReadKey?: string) => Promise<void>
  setNewMessageCount: Dispatch<SetStateAction<number>>
}) {
  const [messages, setMessages] = useState<OptimisticMessage[]>(
    [],
  )
  const [paging, setPaging] = useState<RoomPaging>({ hasMore: false, loadingMore: false, loadMore: () => undefined })
  const hasMoreMessages = paging.hasMore
  const loadingOlderMessages = paging.loadingMore
  // undefined while the room is resolving, null when this member cannot read it.
  const [room, setRoom] = useState<{ conversationId: string; summary: RoomSummary | null | undefined; transcriptReady: boolean }>(
    { conversationId, summary: undefined, transcriptReady: false },
  )
  const currentRoom = room.conversationId === conversationId ? room : { summary: undefined, transcriptReady: false }
  const loading = !rosterReady || (currentRoom.summary !== null && !currentRoom.transcriptReady)
  const [conversationTitle, setConversationTitle] = useState<string | null>(null)
  /** Platform a mirrored surface thread came from (Slack): the room is read-only. */
  const [surfacePlatform, setSurfacePlatform] = useState<string | null>(null)
  const [stickToBottom, setStickToBottom] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)
  const turnScroll = useAgentTurnScroll({ enabled: anchorAgentTurns, conversationId, messages, listRef })
  const { spacerRef: turnSpacerRef } = turnScroll
  const hasContentBelow = useTranscriptHasContentBelow(listRef, turnSpacerRef)
  /** Latest messages for callbacks that must not close over a stale render. */
  const messagesRef = useRef<OptimisticMessage[]>(messages)
  useEffect(() => {
    messagesRef.current = messages
  })
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null)
  const skipNextMessageGrowthRef = useRef(false)
  const previousMessageCountRef = useRef(messages.length)
  const generatingMessages = messages.filter((message) => message.status === 'generating')
  const generatingTextLength = generatingMessages
    .reduce((length, message) => length + message.content.length, 0)

  useEffect(() => {
    const handleTitleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ChatTitleUpdatedDetail>).detail
      if (detail?.chatId === conversationId) setConversationTitle(detail.title)
    }
    window.addEventListener(CHAT_TITLE_UPDATED_EVENT, handleTitleUpdated)
    return () => window.removeEventListener(CHAT_TITLE_UPDATED_EVENT, handleTitleUpdated)
  }, [conversationId])
  const loadOlderMessages = useCallback(() => {
    if (paging.loadingMore || !paging.hasMore) return
    const node = listRef.current
    if (node) {
      prependScrollRef.current = { height: node.scrollHeight, top: node.scrollTop }
      skipNextMessageGrowthRef.current = true
    }
    paging.loadMore()
  }, [paging])

  const applyLiveRoomMessages = useCallback((liveMessages: RoomMessageRecord[]) => {
    setMessages((current) => mergeRoomMessages(liveMessages, current))
    setRoom((current) => current.conversationId === conversationId && current.transcriptReady
      ? current
      : { conversationId, summary: current.conversationId === conversationId ? current.summary : undefined, transcriptReady: true })
  }, [conversationId])

  const applyRoomSummary = useCallback((summary: RoomSummary | null | undefined) => {
    setRoom((current) => ({
      conversationId,
      summary,
      transcriptReady: current.conversationId === conversationId && current.transcriptReady,
    }))
    const loadedTitle = summary?.title?.trim()
    if (loadedTitle) setConversationTitle((current) => mergeChatTitle(current ?? 'New thread', loadedTitle))
    if (summary !== undefined) setSurfacePlatform(summary?.externalPlatform ?? null)
  }, [conversationId])

  useEffect(() => {
    queueMicrotask(() => setConversationTitle(null))
  }, [conversationId])

  useEffect(() => {
    if (loading) return
    void markVisibleRead()
    const onVisible = () => { void markVisibleRead() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loading, markVisibleRead, messages.length, generatingMessages.length])

  useEffect(() => {
    queueMicrotask(() => {
      const previousCount = previousMessageCountRef.current
      if (messages.length > previousCount) {
        if (skipNextMessageGrowthRef.current) {
          skipNextMessageGrowthRef.current = false
        } else if (!stickToBottom && !loading) {
          setNewMessageCount((count) => count + (messages.length - previousCount))
        }
      }
      previousMessageCountRef.current = messages.length
    })
  }, [loading, messages.length, setNewMessageCount, stickToBottom])

  useLayoutEffect(() => {
    const node = listRef.current
    const anchor = prependScrollRef.current
    if (!node || !anchor) return
    node.scrollTop = anchor.top + (node.scrollHeight - anchor.height)
    prependScrollRef.current = null
  }, [messages.length])

  // Pin to latest after the initial transcript paint (and when stick-to-bottom).
  // Double rAF waits for layout of markdown/images so open-room no longer starts
  // mid-history at the top of a long channel.
  useLayoutEffect(() => {
    if (loading) return
    if (!stickToBottom) return
    const node = listRef.current
    if (!node) return
    const pin = () => {
      if (turnScroll.anchored.current) return
      node.scrollTop = node.scrollHeight
    }
    pin()
    const frame = window.requestAnimationFrame(() => {
      pin()
      window.requestAnimationFrame(pin)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [agentResponding, conversationId, loading, messages.length, generatingTextLength, stickToBottom, turnScroll.anchored])

  const handleTranscriptScroll = useCallback(() => {
    const node = listRef.current
    if (node) {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      setStickToBottom(!turnScroll.anchored.current && distanceFromBottom <= 96)
      if (node.scrollTop <= 120 && hasMoreMessages) void loadOlderMessages()
    }
    void markVisibleRead(roomScrollReadKey(conversationId, messagesRef.current))
  }, [conversationId, hasMoreMessages, loadOlderMessages, markVisibleRead, turnScroll.anchored])

  return {
    messages,
    setMessages,
    loading,
    hasMoreMessages,
    loadingOlderMessages,
    conversationTitle,
    setConversationTitle,
    surfacePlatform,
    listRef,
    turnSpacerRef,
    hasContentBelow,
    releaseTurnAnchor: turnScroll.release,
    messagesRef,
    stickToBottom,
    setStickToBottom,
    loadOlderMessages,
    applyLiveRoomMessages,
    applyRoomSummary,
    setPaging,
    generatingMessages,
    generatingTextLength,
    handleTranscriptScroll,
  }
}

/** Native presence for this session: online while the room is open, typing on demand, offline on leave. */
export function useRoomLifecycle({ room }: { room: RoomStateApi }) {
  const sessionIdRef = useRef<string | null>(null)
  const { args, heartbeat } = room
  const workspaceId = args?.workspaceId ?? null
  const conversationId = args?.conversationId ?? null

  useEffect(() => {
    if (!workspaceId || !conversationId) return
    const sessionId = sessionIdRef.current ?? crypto.randomUUID()
    sessionIdRef.current = sessionId
    const beat = (status: 'online' | 'offline') => {
      void heartbeat({ workspaceId, conversationId, sessionId, status }).catch(() => undefined)
    }
    beat('online')
    const heartbeatTimer = window.setInterval(() => beat('online'), 45_000)
    return () => {
      window.clearInterval(heartbeatTimer)
      beat('offline')
    }
  }, [conversationId, heartbeat, workspaceId])

  const reportTyping = useCallback((typing: boolean) => {
    const sessionId = sessionIdRef.current
    if (!workspaceId || !conversationId || !sessionId) return
    void heartbeat({ workspaceId, conversationId, sessionId, status: 'online', typing }).catch(() => undefined)
  }, [conversationId, heartbeat, workspaceId])

  return { reportTyping }
}

type AgentDirectoryEntry = {
  isDefault?: boolean
  id?: string
  name: string
  avatarColor?: string
  avatarShape?: string
}

export function useAgentDirectory({
  activeWorkspaceId,
}: {
  activeWorkspaceId: string | null | undefined
  conversationId: string
}) {
  const live = useLiveAgentDirectory()
  const agentsByPrincipal = useMemo(() => new Map<string, AgentDirectoryEntry>(
    live.workspaceId === activeWorkspaceId
      ? (live.agents ?? []).map((agent) => [agent.principalId, {
          id: agent.id,
          name: agent.name,
          avatarColor: agent.avatarColor,
          avatarShape: agent.avatarShape,
          isDefault: agent.isDefault,
        }])
      : [],
  ), [activeWorkspaceId, live.agents, live.workspaceId])
  // Unsaved editor drafts overlay the live directory so the header renames
  // and re-skins while the user types; cleared by a null patch on save/cancel.
  const [drafts, setDrafts] = useState<{
    workspaceId: string | null | undefined
    byPrincipal: ReadonlyMap<string, { name: string; avatarColor?: string; avatarShape?: string }>
  }>({ workspaceId: activeWorkspaceId, byPrincipal: new Map() })
  const agentDrafts = drafts.workspaceId === activeWorkspaceId ? drafts.byPrincipal : null
  const directoryAgentsByPrincipal = useMemo(() => {
    if (!agentDrafts?.size) return agentsByPrincipal
    const merged = new Map(agentsByPrincipal)
    for (const [principalId, draft] of agentDrafts) {
      const existing = merged.get(principalId)
      merged.set(principalId, {
        id: existing?.id,
        isDefault: existing?.isDefault,
        name: draft.name,
        avatarColor: draft.avatarColor ?? existing?.avatarColor,
        avatarShape: draft.avatarShape ?? existing?.avatarShape,
      })
    }
    return merged
  }, [agentsByPrincipal, agentDrafts])
  useEffect(() => {
    if (!activeWorkspaceId) return
    const onDraftPreview = (event: Event) => {
      const detail = (event as CustomEvent<AgentDraftPreviewEventDetail>).detail
      if (!detail?.principalId || detail.workspaceId !== activeWorkspaceId) return
      setDrafts((current) => {
        const next = new Map(current.workspaceId === activeWorkspaceId ? current.byPrincipal : [])
        if (detail.patch) next.set(detail.principalId!, detail.patch)
        else next.delete(detail.principalId!)
        return { workspaceId: activeWorkspaceId, byPrincipal: next }
      })
    }
    window.addEventListener(AGENT_DRAFT_PREVIEW_EVENT, onDraftPreview)
    return () => window.removeEventListener(AGENT_DRAFT_PREVIEW_EVENT, onDraftPreview)
  }, [activeWorkspaceId])
  return directoryAgentsByPrincipal
}

function resolveRoomIdentity({
  participants,
  currentPrincipalId,
  conversationTitle,
  draftTitle,
  conversationType,
  channel,
  directoryAgentsByPrincipal,
}: {
  participants: ConversationParticipant[]
  currentPrincipalId: string
  conversationTitle: string | null
  draftTitle: string | undefined
  conversationType: 'dm' | 'channel'
  channel: ChannelSummary | null
  directoryAgentsByPrincipal: ReadonlyMap<string, AgentDirectoryEntry>
}) {
  const otherParticipants = participants.filter((participant) => participant.principalId !== currentPrincipalId)
  // Agent identity (creature color + shape) resolves from the directory once
  // per conversation: the header for one-to-one agent DMs and every agent
  // message avatar read from the same map. Falls back to neutral while
  // loading; chat-list rows keep their Lucide icons because they carry no
  // agent identity data.
  const soloAgentParticipant = conversationType !== 'channel'
    && otherParticipants.length === 1
    && otherParticipants[0]?.principalType === 'agent'
    ? otherParticipants[0]
    : null
  const headerAgent = soloAgentParticipant
    ? (directoryAgentsByPrincipal.get(soloAgentParticipant.principalId) ?? { name: soloAgentParticipant.displayName })
    : null
  const title = conversationType === 'channel'
    ? channel?.name ?? draftTitle ?? 'Channel'
    : soloAgentParticipant
      // A one-to-one agent DM's title is the agent's name; the stored
      // conversation title and participant displayName are snapshots from when
      // the DM was created and go stale on rename, so the directory wins.
      ? (headerAgent?.name ?? conversationTitle ?? draftTitle ?? 'Direct message')
      : conversationTitle ?? draftTitle ?? (otherParticipants.map((participant) => participant.displayName).join(', ') || 'Direct message')
  return { otherParticipants, soloAgentParticipant, headerAgent, title }
}

function useRoomMessageDerivations({
  messages,
  unreadBoundarySequence,
  threadRootId,
}: {
  messages: OptimisticMessage[]
  unreadBoundarySequence: number | null
  threadRootId: string | null
}) {
  const mainMessages = messages.filter((message) => !message.threadRootMessageId)
  const agentCommands = useMemo<RemoteAgentCommand[]>(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const commands = remoteAgentCommands(messages[index]?.parts)
      if (commands.length > 0) return commands
    }
    return []
  }, [messages])
  const threadRoot = messages.find((message) => message.id === threadRootId)
  const threadReplies = messages.filter((message) => (
    Boolean(threadRootId) && message.threadRootMessageId === threadRootId
  ))
  const unreadBoundaryMessageId = unreadBoundarySequence === null
    ? null
    : mainMessages.find((message) => (
      message.eventSequence !== undefined && message.eventSequence > unreadBoundarySequence
    ))?.id ?? null
  const replyCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const message of messages) {
      const root = message.threadRootMessageId
      if (!root) continue
      counts.set(root, (counts.get(root) ?? 0) + 1)
    }
    return counts
  }, [messages])

  /** Latest reply per root for Slack-style thread teasers under the parent row. */
  const threadTeasers = useMemo(() => {
    const latest = new Map<string, OptimisticMessage>()
    for (const message of messages) {
      const root = message.threadRootMessageId
      if (!root || message.deletedAt) continue
      const existing = latest.get(root)
      if (!existing || message.createdAt >= existing.createdAt) latest.set(root, message)
    }
    return latest
  }, [messages])
  return { mainMessages, agentCommands, threadRoot, threadReplies, unreadBoundaryMessageId, replyCounts, threadTeasers }
}

export function useRoomViewModels({
  participants,
  currentPrincipalId,
  presence,
  messages,
  unreadBoundarySequence,
  conversationTitle,
  draftTitle,
  conversationType,
  channel,
  directoryAgentsByPrincipal,
  pins,
  threadRootId,
}: {
  participants: ConversationParticipant[]
  currentPrincipalId: string
  presence: ConversationPresence[]
  messages: OptimisticMessage[]
  unreadBoundarySequence: number | null
  conversationTitle: string | null
  draftTitle: string | undefined
  conversationType: 'dm' | 'channel'
  channel: ChannelSummary | null
  directoryAgentsByPrincipal: ReadonlyMap<string, AgentDirectoryEntry>
  pins: ConversationPin[]
  threadRootId: string | null
}) {
  const { otherParticipants, soloAgentParticipant, headerAgent, title } = resolveRoomIdentity({
    participants,
    currentPrincipalId,
    conversationTitle,
    draftTitle,
    conversationType,
    channel,
    directoryAgentsByPrincipal,
  })
  const online = presence.filter((row) => (
    row.principalId !== currentPrincipalId && row.status === 'online'
  )).length
  const currentParticipant = participants.find((participant) => participant.principalId === currentPrincipalId)
  const {
    mainMessages,
    agentCommands,
    threadRoot,
    threadReplies,
    unreadBoundaryMessageId,
    replyCounts,
    threadTeasers,
  } = useRoomMessageDerivations({ messages, unreadBoundarySequence, threadRootId })

  const participantMentions = useMemo(() => participants.map((participant) => {
    const agent = participant.principalType === 'agent'
      ? directoryAgentsByPrincipal.get(participant.principalId)
      : undefined
    return {
      type: (participant.principalType === 'agent' ? 'agent' : 'person') as 'agent' | 'person',
      id: participant.principalId,
      name: participant.displayName,
      avatarColor: agent?.avatarColor,
      avatarShape: agent?.avatarShape,
      isDefault: agent?.isDefault,
    }
  }), [directoryAgentsByPrincipal, participants])

  const mentionCategories: MentionCategory[] = useMemo(() => {
    const items = participants
      .filter((participant) => participant.status === 'active' && participant.principalId !== currentPrincipalId)
      .map((participant) => ({
        type: 'person' as const,
        id: participant.principalId,
        name: participant.displayName,
        description: participant.principalType === 'agent' ? 'Agent' : 'Member',
        principalType: participant.principalType,
        avatarColor: directoryAgentsByPrincipal.get(participant.principalId)?.avatarColor,
        avatarShape: directoryAgentsByPrincipal.get(participant.principalId)?.avatarShape,
        isDefault: directoryAgentsByPrincipal.get(participant.principalId)?.isDefault,
        icon: 'UsersRound',
      }))
    return items.length ? [{ type: 'person', label: 'Members', icon: 'UsersRound', items }] : []
  }, [currentPrincipalId, directoryAgentsByPrincipal, participants])

  const pinnedSummaries = pins
    .map((pin) => {
      const message = messages.find((row) => row.id === pin.messageId)
      if (!message) return null
      const author = participants.find((participant) => participant.principalId === message.authorPrincipalId)
      return {
        messageId: pin.messageId,
        authorName: message.authorPrincipalId === currentPrincipalId
          ? 'You'
          : author?.displayName ?? 'Someone',
        preview: message.content.trim() || 'Attachment',
        createdAt: message.createdAt,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return {
    otherParticipants,
    soloAgentParticipant,
    headerAgent,
    title,
    online,
    currentParticipant,
    mainMessages,
    agentCommands,
    threadRoot,
    threadReplies,
    unreadBoundaryMessageId,
    replyCounts,
    threadTeasers,
    participantMentions,
    mentionCategories,
    pinnedSummaries,
  }
}

export function useDraftConversation({
  conversationId,
  conversationType,
  draft: requestedDraft,

  title,
  messages,
  messagesRef,
}: {
  conversationId: string
  conversationType: 'dm' | 'channel'
  draft: boolean

  title: string
  messages: OptimisticMessage[]
  messagesRef: RefObject<OptimisticMessage[]>
}) {
  const draft = isTransientConversationDraft(conversationType, requestedDraft)
  const draftCommittedRef = useRef(!draft)

  const commitDraftConversation = useCallback(() => {
    if (!draft || draftCommittedRef.current) return
    draftCommittedRef.current = true
    dispatchChatCreated({
      chat: {
        _id: conversationId,
        title,
        lastModified: Date.now(),
        conversationType,
      },
    })
    const url = new URL(window.location.href)
    url.searchParams.delete('draft')
    url.searchParams.delete('title')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [conversationId, conversationType, draft, title])

  useEffect(() => () => {
    if (!draft || draftCommittedRef.current || messagesRef.current.length > 0) return
    void (async () => {
      const removed = await overlayAppClient.conversations.deleteResponse({
        conversationId,
        scope: 'self',
      })
      if (!removed.ok) {
        await overlayAppClient.conversations.updateParticipantState(conversationId, {
          archived: true,
          archiveScope: 'self',
        }).catch(() => undefined)
      }
    })()
  }, [conversationId, draft, messagesRef, ])

  useEffect(() => {
    if (draft && messages.some((message) => !message.id.startsWith('optimistic_'))) {
      commitDraftConversation()
    }
  }, [commitDraftConversation, draft, messages])

  return commitDraftConversation
}

export function useSendMessage({
  canSendToThread,
  ensureCanSendToThread,
  nativeThreadSafetyStatusValue,
  selectedThreadSafetyStatus,
  currentThreadRootId,

  currentPrincipalId,
  setMessages,
  setConversationTitle,
  conversationId,
  participants,
  conversationType,
  loading,
  conversationTitle,
  soloAgentParticipant,
  messagesRef,
  memoryEnabled,
  commitDraftConversation,
  setAgentResponding,
  messages,
  mentions,
}: {
  canSendToThread?: (threadRootMessageId?: string) => boolean
  ensureCanSendToThread: (threadRootMessageId?: string) => Promise<{
    accepted: boolean
    error?: unknown
    status?: NativeThreadSafetyStatus
  }>
  nativeThreadSafetyStatusValue: NativeThreadSafetyStatus
  selectedThreadSafetyStatus: NativeThreadSafetyStatus
  currentThreadRootId: string | null

  currentPrincipalId: string
  setMessages: Dispatch<SetStateAction<OptimisticMessage[]>>
  setConversationTitle: Dispatch<SetStateAction<string | null>>
  conversationId: string
  participants: ConversationParticipant[]
  conversationType: 'dm' | 'channel'
  loading: boolean
  conversationTitle: string | null
  soloAgentParticipant: ConversationParticipant | null
  messagesRef: RefObject<OptimisticMessage[]>
  memoryEnabled: boolean
  commitDraftConversation: () => void
  setAgentResponding: Dispatch<SetStateAction<string | null>>
  messages: OptimisticMessage[]
  mentions: MentionItem[]
}) {
  const threadRenameRequestedRef = useRef<string | null>(null)
  const pendingCollaborationMessageSentRef = useRef<string | null>(null)
  const pendingCollaborationSafetyCheckRef = useRef<string | null>(null)
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId
  const currentThreadRootRef = useRef<string | null>(null)
  currentThreadRootRef.current = currentThreadRootId
  const conversationTitleRef = useRef(conversationTitle)
  conversationTitleRef.current = conversationTitle
  const loadingRef = useRef(loading)
  loadingRef.current = loading
  const soloAgentParticipantRef = useRef(soloAgentParticipant)
  soloAgentParticipantRef.current = soloAgentParticipant
  const inFlightSendsRef = useRef(new Set<string>())
  const pendingPreflightsRef = useRef(new Set<string>())

  // Unanswered placeholders expire after a minute; reconciliation replaces answered ones atomically.
  useEffect(() => {
    const pending = messages.filter((message) => message.id.startsWith(PENDING_AGENT_REPLY_PREFIX))
    if (!pending.length) return
    const drop = (ids: Set<string>) => setMessages((current) => current.filter((message) => !ids.has(message.id)))
    const timer = window.setTimeout(() => drop(new Set(pending.map((message) => message.id))), 60_000)
    return () => window.clearTimeout(timer)
  }, [messages, setMessages])

  function resolveMentionTargets(text: string): string[] {
    const fromChips = mentions
      .filter((mention) => mention.type === 'person')
      .map((mention) => mention.id)
    const fromText = resolveMentionedPrincipalIds(text, participants.map((participant) => ({
      principalId: participant.principalId,
      displayName: participant.displayName,
      principalType: participant.principalType,
    })))
    return Array.from(new Set([...fromChips, ...fromText]))
  }

  function getInvokedAgents(mentionedPrincipalIds: string[], threadRootMessageId?: string) {
    const agentParticipants = participants.filter((participant) => participant.principalType === 'agent')
    const humanParticipants = participants.filter((participant) => participant.principalType === 'human')
    const threadAgentId = threadRootMessageId
      ? messages.find((message) => message.id === threadRootMessageId && message.authorKind === 'agent')?.authorPrincipalId
      : undefined
    const mentionedPrincipalIdSet = new Set(mentionedPrincipalIds)
    return agentParticipants.filter((participant) => (
      (conversationType === 'dm' && agentParticipants.length === 1 && humanParticipants.length === 1)
      || mentionedPrincipalIdSet.has(participant.principalId)
      || threadAgentId === participant.principalId
    ))
  }

  function appendPendingAgentReplies(
    clientNonce: string,
    threadRootMessageId: string | undefined,
    invokedAgents: ConversationParticipant[],
  ) {
    if (!invokedAgents.length) return
    setAgentResponding(invokedAgents.length === 1 ? invokedAgents[0]!.displayName : 'Agents')
    const pendingAt = Date.now()
    setMessages((current) => [
      ...current.filter((message) => !message.id.startsWith(`${PENDING_AGENT_REPLY_PREFIX}${clientNonce}`)),
      ...invokedAgents.map((agent) => ({
        id: `${PENDING_AGENT_REPLY_PREFIX}${clientNonce}_${agent.principalId}`,
        turnId: `${PENDING_AGENT_REPLY_PREFIX}${clientNonce}_${agent.principalId}`,
        authorKind: 'agent' as const,
        authorPrincipalId: agent.principalId,
        content: '',
        createdAt: pendingAt + PENDING_AGENT_REPLY_SORT_LEAD_MS,
        updatedAt: pendingAt,
        status: 'generating' as const,
        threadRootMessageId,
      } satisfies OptimisticMessage)),
    ].sort(compareRoomMessageRecords))
  }

  function scheduleAgentThreadRename(
    shouldRename: boolean,
    agent: ConversationParticipant | null,
    titlePromise: Promise<string | null> | null,
    titleAtSend: string | null,
  ) {
    if (!shouldRename || !agent) return
    const agentName = agent.displayName
    const previousTitle = titleAtSend ?? 'New thread'
    void titlePromise?.then(async (aiTitle) => {
      if (!aiTitle) {
        if (threadRenameRequestedRef.current === conversationId) {
          threadRenameRequestedRef.current = null
        }
        return
      }
      const title = sanitizeChatTitle(aiTitle, agentName)
      dispatchChatTitleUpdated({ chatId: conversationId, title })
      if (conversationIdRef.current === conversationId) setConversationTitle(title)
      try {
        const res = await overlayAppClient.conversations.updateResponse({ conversationId, title })
        if (!res.ok) throw new Error('Could not update conversation title')
      } catch {
        dispatchChatTitleUpdated({ chatId: conversationId, title: previousTitle })
        if (conversationIdRef.current === conversationId) setConversationTitle(previousTitle)
        if (threadRenameRequestedRef.current === conversationId) {
          threadRenameRequestedRef.current = null
        }
      }
    })
  }

  function markRoomSendFailure(
    clientNonce: string,
    error: unknown,
    ownsThreadRename: boolean,
  ) {
    if (ownsThreadRename && threadRenameRequestedRef.current === conversationId) {
      threadRenameRequestedRef.current = null
    }
    if (isNativeThreadSafetyError(error)) {
      setMessages((current) => current
        .filter((message) => !message.id.startsWith(`${PENDING_AGENT_REPLY_PREFIX}${clientNonce}`))
        .filter((message) => message.clientNonce !== clientNonce))
    } else {
      setMessages((current) => current
        .filter((message) => !message.id.startsWith(`${PENDING_AGENT_REPLY_PREFIX}${clientNonce}`))
        .map((message) => (
          message.clientNonce === clientNonce ? {
            ...message,
            delivery: 'failed',
            deliveryError: error instanceof Error ? error.message : 'Could not send this message.',
          } : message
        )))
    }
  }

  async function preflightRoomMessage({
    text,
    parts,
    threadRootMessageId,
  }: {
    text: string
    parts?: RoomMessageRecord['parts']
    threadRootMessageId?: string
  }): Promise<RoomSendResult | null> {
    if (canSendToThread?.(threadRootMessageId) === false) {
      const status = threadRootMessageId && threadRootMessageId === currentThreadRootRef.current
        ? selectedThreadSafetyStatus
        : nativeThreadSafetyStatusValue
      return {
        accepted: false,
        safetyRejected: status === 'retired' || status === 'unavailable',
        error: status === 'retired' || status === 'unavailable'
          ? { code: status === 'retired' ? 'native_runner_retired' : 'native_thread_compatibility_unavailable' }
          : undefined,
      }
    }
    if (!text && !parts?.length) return { accepted: false }
    const preflightKey = `${conversationId}:${threadRootMessageId ?? ''}`
    if (pendingPreflightsRef.current.has(preflightKey)) return { accepted: false }
    pendingPreflightsRef.current.add(preflightKey)
    let admission: { accepted: boolean; error?: unknown; status?: NativeThreadSafetyStatus }
    try {
      admission = await ensureCanSendToThread(threadRootMessageId)
    } catch (error) {
      admission = { accepted: false, error }
    } finally {
      pendingPreflightsRef.current.delete(preflightKey)
    }
    if (admission.accepted) return null
    const status = admission.status ?? nativeThreadSafetyErrorStatus(admission.error)
    return {
      accepted: false,
      safetyRejected: status === 'retired' || status === 'unavailable',
      error: admission.error,
    }
  }

  async function sendMessage(
    content: string,
    options?: Parameters<SendMessage>[1],
  ): Promise<RoomSendResult> {
    const threadRootMessageId = options?.threadRootMessageId
    const text = content.trim()
    const parts = options?.parts ?? options?.existing?.parts
    const preflightResult = await preflightRoomMessage({ text, parts, threadRootMessageId })
    if (preflightResult) return { ...preflightResult, notSubmitted: true }
    if (
      conversationIdRef.current !== conversationId
      || (options?.requireCurrentThread && threadRootMessageId !== currentThreadRootRef.current)
    ) return { accepted: false, scopeChanged: true }
    let ownsThreadRename = false
    const clientNonce = options?.existing?.clientNonce ?? crypto.randomUUID()
    const turnId = options?.existing?.turnId ?? `human_${crypto.randomUUID()}`
    const optimisticId = `optimistic_${clientNonce}`
    const sendKey = `${conversationId}:${threadRootMessageId ?? ''}`
    if (inFlightSendsRef.current.has(sendKey)) return { accepted: false, notSubmitted: true }
    inFlightSendsRef.current.add(sendKey)

    setMessages((current) => [
      ...current.filter((message) => message.clientNonce !== clientNonce),
      {
        id: optimisticId,
        turnId,
        authorKind: 'human',
        authorPrincipalId: currentPrincipalId,
        content: text,
        parts,
        createdAt: options?.existing?.createdAt ?? Date.now(),
        clientNonce,
        delivery: 'sending',
        threadRootMessageId,
      } satisfies OptimisticMessage,
    ].sort(compareRoomMessageRecords))
    try {
      options?.onSubmitted?.()
      const mentionedPrincipalIds = resolveMentionTargets(text)
      const renameAgent = soloAgentParticipantRef.current
      const titleAtSend = loadingRef.current ? null : conversationTitleRef.current
      const hasPriorHumanMessage = messagesRef.current.some((message) => (
        message.authorKind === 'human'
        && message.clientNonce !== clientNonce
        && message.turnId !== turnId
        && message.id !== optimisticId
      ))
      const renameAgentThread = shouldRenameAgentThread({
        title: titleAtSend,
        agentName: renameAgent?.displayName ?? '',
        hasPriorHumanMessage,
        alreadyRequested: threadRenameRequestedRef.current === conversationId,
        hasSoloAgent: Boolean(renameAgent),
        text,
      })
      const titlePromise = renameAgentThread ? prefetchTitle(text) : null
      if (renameAgentThread) {
        ownsThreadRename = true
        threadRenameRequestedRef.current = conversationId
      }
      const invokedAgents = getInvokedAgents(mentionedPrincipalIds, threadRootMessageId)
      appendPendingAgentReplies(clientNonce, threadRootMessageId, invokedAgents)
      const saved = await overlayAppClient.conversations.addMessage({
        conversationId,
        turnId,
        role: 'user',
        mode: 'act',
        content: text,
        contentType: 'text',
        clientNonce,
        mentionedPrincipalIds,
        memoryEnabled,
        threadRootMessageId,
        ...(parts?.length ? { parts: parts as Array<Record<string, unknown>> } : {}),
        ...(options?.attachmentNames?.length ? { attachmentNames: options.attachmentNames } : {}),
        ...(options?.reply?.replyToTurnId
          ? { replyToTurnId: options.reply.replyToTurnId, replySnippet: options.reply.snippet }
          : {}),
      })
      // Saving the message is what starts the agent turn; the server owns it
      // from here. The reply arrives in the transcript on its own, so there is
      // nothing for this client to hold open and nothing to wait for.
      scheduleAgentThreadRename(renameAgentThread, renameAgent, titlePromise, titleAtSend)
      commitDraftConversation()
      void saved
      return { accepted: true }
    } catch (error) {
      markRoomSendFailure(clientNonce, error, ownsThreadRename)
      return { accepted: false, safetyRejected: isNativeThreadSafetyError(error), error }
    } finally {
      inFlightSendsRef.current.delete(sendKey)
      setAgentResponding(null)
    }
  }

  useEffect(() => {
    if (
      !currentPrincipalId
      || loading
      || !participants.length
      || pendingCollaborationMessageSentRef.current === conversationId
      || pendingCollaborationSafetyCheckRef.current === conversationId
    ) return
    pendingCollaborationSafetyCheckRef.current = conversationId
    void (async () => {
      try {
        if (canSendToThread?.() !== true) {
          pendingCollaborationSafetyCheckRef.current = null
          return
        }
        const admission = await ensureCanSendToThread()
        if (!admission.accepted || conversationIdRef.current !== conversationId) {
          pendingCollaborationSafetyCheckRef.current = null
          return
        }
        const pending = takePendingCollaborationMessage(
          conversationId,
          (message) => {
            if (!message.expectedAgentPrincipalId) return true
            const senderIsLoaded = participants.some((participant) => (
              participant.principalId === currentPrincipalId && participant.principalType === 'human'
            ))
            return senderIsLoaded && soloAgentParticipant?.principalId === message.expectedAgentPrincipalId
          },
        )
        if (!pending) {
          pendingCollaborationSafetyCheckRef.current = null
          return
        }
        pendingCollaborationMessageSentRef.current = conversationId
        const result = await sendMessage(pending.content)
        if (
          !result.accepted
          && (result.notSubmitted || result.safetyRejected || result.scopeChanged || isNativeThreadSafetyError(result.error))
        ) {
          restorePendingCollaborationMessage(pending)
          pendingCollaborationMessageSentRef.current = null
          pendingCollaborationSafetyCheckRef.current = null
        }
      } catch {
        pendingCollaborationSafetyCheckRef.current = null
      }
    })()
  // `sendMessage` is intentionally omitted: it is recreated while room state
  // changes, whereas a pending conversion must be consumed exactly once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    conversationId,
    currentPrincipalId,
    participants,
    soloAgentParticipant,
    loading,
    canSendToThread,
    ensureCanSendToThread,
    nativeThreadSafetyStatusValue,
    selectedThreadSafetyStatus,
  ])

  return sendMessage
}

export function useRoomComposer({

  activeWorkspaceId,
  conversationId,
  reportTyping,
  sendMessage,
  mentions,
  setMentions,
  readOnly = false,
}: {

  activeWorkspaceId: string | null | undefined
  conversationId: string
  reportTyping: (typing: boolean) => void
  sendMessage: SendMessage
  mentions: MentionItem[]
  setMentions: Dispatch<SetStateAction<MentionItem[]>>
  /** Surface-mirrored rooms accept no uploads. */
  readOnly?: boolean
}) {
  // ── composer state (identical wiring to the personal chat composer) ─────────
  const [isDragging, setIsDragging] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [replyContext, setReplyContext] = useState<
    { snippet: string; bodyForModel: string; replyToTurnId?: string } | null
  >(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<import('./chat-interface/MentionInput').MentionInputHandle>(null)
  const lastTypingSentAt = useRef(0)
  const draftScopeRef = useRef<object | null>(null)
  useLayoutEffect(() => {
    draftScopeRef.current = {}
    return () => { draftScopeRef.current = null }
  }, [activeWorkspaceId, conversationId])
  const {
    handleComposerInputChange,
    hasComposerText,
    input,
    inputRef,
    inputVersionRef,
    inputRevision,
    setInput,
    subscribeToInput,
  } = useComposerTextState(readOnly)
  const {
    attachedImages,
    setAttachedImages,
    pendingChatDocuments,
    setPendingChatDocuments,
    attachmentError,
    setAttachmentError,
    fileInputRef,
    docInputRef,
    dragCounterRef,
    removePendingDocument,
    queueDocumentUpload,
    addDocumentsFromPicker,
    addImages,
    handlePaste,
  } = useChatAttachments()
  const latestDraftStateRef = useRef({
    conversationId,
    activeWorkspaceId,
    attachedImages,
    pendingChatDocuments,
    replyContext,
    mentions,
  })
  useLayoutEffect(() => {
    latestDraftStateRef.current = {
      conversationId,
      activeWorkspaceId,
      attachedImages,
      pendingChatDocuments,
      replyContext,
      mentions,
    }
  }, [activeWorkspaceId, attachedImages, conversationId, mentions, pendingChatDocuments, replyContext])

  // Restore a half-written message when the room reopens. Storage failures are
  // absorbed by the draft module, so private browsing simply starts empty.
  useEffect(() => {

    queueMicrotask(() => setInput(readDraft({ workspaceId: activeWorkspaceId, conversationId })))
  }, [activeWorkspaceId, conversationId, setInput, ])

  useEffect(() => {
    if (!showAttachMenu) return
    function handleOutside(event: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target as Node)) {
        setShowAttachMenu(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showAttachMenu])

  /**
   * Reads the agent's reply as it is written. The server persists the finished
   * message itself, so the streamed text is a live preview that the next load
   * replaces with the stored row.
   */
  async function handleSend() {
    if (readOnly) return
    const text = (inputRef.current ?? input).trim()
    const readyDocuments = pendingChatDocuments.filter((document) => document.status === 'ready')
    if (pendingChatDocuments.some((document) => document.status === 'uploading')) {
      setAttachmentError('Wait for documents to finish indexing.')
      return
    }
    if (!text && attachedImages.length === 0 && readyDocuments.length === 0) return

    const turnId = `human_${crypto.randomUUID()}`
    const payload = buildTextTurnPayload({
      text,
      attachedImages,
      pendingChatDocuments,
      mentions,
      replyContext,
      turnId,
    })
    // Document names ride along in the body using the same marker the chat
    // transcript already understands, so the room renders them as file chips.
    const documentMarker = payload.indexedFileNames.length
      ? `${text ? '\n\n' : ''}[Indexed documents: ${payload.indexedFileNames.join(', ')}]`
      : ''
    const replySnippet = replyContext?.snippet

    const submittedScope = draftScopeRef.current
    const submitted = {
      state: latestDraftStateRef.current,
      text: inputRef.current ?? input,
      version: inputVersionRef.current,
    }
    const cleared: { current: typeof submitted | null } = { current: null }
    function draftMatches(expected: typeof submitted): boolean {
      const latest = latestDraftStateRef.current
      return submittedScope !== null && draftScopeRef.current === submittedScope
        && latest.conversationId === conversationId
        && latest.activeWorkspaceId === activeWorkspaceId
        && inputVersionRef.current === expected.version
        && inputRef.current === expected.text
        && latest.attachedImages === expected.state.attachedImages
        && latest.pendingChatDocuments === expected.state.pendingChatDocuments
        && latest.replyContext === expected.state.replyContext
        && (latest.mentions === expected.state.mentions
          // The rich editor resynchronizes empty mentions after an external clear.
          || (expected === cleared.current && latest.mentions.length === 0))
    }
    function clearSubmittedDraft() {
      if (cleared.current || !draftMatches(submitted)) return
      const state: typeof submitted.state = {
        ...submitted.state, attachedImages: [], pendingChatDocuments: [], replyContext: null, mentions: [],
      }
      setInput('')
      composerRef.current?.clear()
      setMentions(state.mentions)
      setAttachedImages(state.attachedImages)
      setPendingChatDocuments(state.pendingChatDocuments)
      setAttachmentError(null)
      setReplyContext(null)
      latestDraftStateRef.current = state
      cleared.current = { state, text: '', version: inputVersionRef.current }
      clearDraft({ workspaceId: activeWorkspaceId, conversationId })
    }
    const result = await sendMessage(`${text}${documentMarker}`, {
      existing: { turnId, clientNonce: crypto.randomUUID(), createdAt: Date.now(), parts: payload.partsForModel },
      parts: payload.partsForModel,
      attachmentNames: payload.indexedFileNames,
      onSubmitted: clearSubmittedDraft,
      ...(replyContext ? { reply: { replyToTurnId: replyContext.replyToTurnId, snippet: replySnippet ?? '' } } : {}),
    })
    if (result.accepted) {
      // Also supports send implementations that do not emit the optimistic callback.
      clearSubmittedDraft()
      return
    }
    const empty = cleared.current
    if (!empty || !draftMatches(empty)) return
    setInput(submitted.text)
    composerRef.current?.setPlainText(submitted.text)
    setAttachedImages(current => current === empty.state.attachedImages ? submitted.state.attachedImages : current)
    setPendingChatDocuments(current => current === empty.state.pendingChatDocuments ? submitted.state.pendingChatDocuments : current)
    setReplyContext(current => current === empty.state.replyContext ? submitted.state.replyContext : current)
    setMentions(current => current.length === 0 ? submitted.state.mentions : current)
    writeDraft({ workspaceId: activeWorkspaceId, conversationId }, submitted.text)
  }

  function onComposerInput(text: string) {
    handleComposerInputChange(text)

    writeDraft({ workspaceId: activeWorkspaceId, conversationId }, text)
    const now = Date.now()
    if (now - lastTypingSentAt.current > 2_500) {
      lastTypingSentAt.current = now
      reportTyping(Boolean(text.trim()))
    }
  }

  function beginQuoteReply(message: OptimisticMessage) {
    const snippet = message.content.trim()
    if (!snippet) return
    setReplyContext({
      snippet: snippet.length > 160 ? `${snippet.slice(0, 160)}…` : snippet,
      bodyForModel: snippet.slice(0, 16000),
      replyToTurnId: message.turnId,
    })
    composerRef.current?.focus()
  }

  const dropZoneProps = {
    onDragEnter: (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragCounterRef.current++
      if (!readOnly && event.dataTransfer.types.includes('Files')) setIsDragging(true)
    },
    onDragOver: (event: ReactDragEvent<HTMLDivElement>) => event.preventDefault(),
    onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragCounterRef.current--
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0
        setIsDragging(false)
      }
    },
    onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragCounterRef.current = 0
      setIsDragging(false)
      if (readOnly) return
      const files = Array.from(event.dataTransfer.files ?? [])
      const images = files.filter((file) => file.type.startsWith('image/'))
      const documents = files.filter((file) => !file.type.startsWith('image/'))
      if (images.length) addImages(images)
      documents.forEach((file) => queueDocumentUpload(file))
    },
  }

  return {
    isDragging,
    showAttachMenu,
    setShowAttachMenu,
    showModeMenu,
    setShowModeMenu,
    replyContext,
    setReplyContext,
    attachMenuRef,
    modeMenuRef,
    composerRef,
    handleComposerInputChange,
    hasComposerText,
    input,
    inputRef,
    inputRevision,
    setInput,
    attachedImages,
    subscribeToInput,
    setAttachedImages,
    pendingChatDocuments,
    setPendingChatDocuments,
    attachmentError,
    setAttachmentError,
    fileInputRef,
    docInputRef,
    dragCounterRef,
    removePendingDocument,
    queueDocumentUpload,
    addDocumentsFromPicker,
    addImages,
    handlePaste,
    handleSend,
    onComposerInput,
    beginQuoteReply,
    dropZoneProps,
  }
}

export function useRemoteAgentControls({
  activeWorkspaceId,
  conversationId,
  setMessages,
  setAttachmentError,
}: {
  activeWorkspaceId: string | null | undefined
  conversationId: string
  setMessages: Dispatch<SetStateAction<OptimisticMessage[]>>
  setAttachmentError: Dispatch<SetStateAction<string | null>>
}) {
  const pendingControls = useRef(new Set<string>())
  async function controlRemoteQueue(runId: string, action: 'cancel' | 'retry' | 'resume' | 'start_fresh') {
    const controlKey = `${conversationId}:${runId}:${action}`
    if (!activeWorkspaceId || pendingControls.current.has(controlKey)) return
    pendingControls.current.add(controlKey)
    setMessages(current => current.map(message => ({ ...message,
      parts: message.parts?.map(part => part.type === 'data-remote-agent-status' && part.data?.runId === runId
        ? { ...part, data: { ...part.data, state: action === 'cancel' ? 'cancelling' : 'recovering' } } : part),
    })))
    try {
      await overlayAppClient.conversations.controlRemoteQueue({
        workspaceId: activeWorkspaceId,
        conversationId,
        runId,
        action,
        controlRequestId: crypto.randomUUID(),
      })
    } catch (value) {
      setAttachmentError(value instanceof Error ? value.message : 'Could not update the connected agent run.')
    } finally {
      pendingControls.current.delete(controlKey)
    }
  }

  async function resolveRemoteRequest(
    request: NonNullable<import('./collaboration/RoomMessageItem').RoomMessageView['remoteRequest']>,
    decision: string,
    response?: Record<string, unknown>,
  ) {
    if (!activeWorkspaceId) return
    try {
      await overlayAppClient.conversations.resolveRemoteRequest({ workspaceId: activeWorkspaceId,
        conversationId, runId: request.runId, requestKey: request.requestKey, decision, response })
    } catch (value) {
      setAttachmentError(value instanceof Error ? value.message : 'Could not resolve the connected agent request.')
    }
  }

  async function stopAgentResponse(messageId: string) {
    try {
      await overlayAppClient.conversations.stopResponse({ conversationId, messageId })
    } catch {
      // The run may have already finished; the live transcript settles either way.
    }
  }

  return { controlRemoteQueue, resolveRemoteRequest, stopAgentResponse }
}

export function useMessageActions({
  isReadOnlyMessage,
  conversationId,
  room,
  reactions,
  pins,
  savedMessages,
}: {
  isReadOnlyMessage?: (messageId: string) => boolean
  conversationId: string
  room: RoomStateApi
  reactions: MessageReaction[]
  pins: ConversationPin[]
  savedMessages: ConversationSavedMessage[]
}) {
  const { activeWorkspaceId } = useWorkspace()
  const editRoomMessage = useMutation(api.collaboration.rooms.editMessage)
  const deleteRoomMessage = useMutation(api.collaboration.rooms.deleteMessage)
  const updateRoomUiPart = useMutation(api.collaboration.rooms.updateMessageUiPart)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')

  async function copyMessagePermalink(messageId: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('message', messageId)
    try {
      await navigator.clipboard.writeText(url.toString())
      toast.success('Message link copied.')
    } catch {
      toast.error('Could not copy the message link.')
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    const current = reactions.find((reaction) => reaction.messageId === messageId && reaction.emoji === emoji)

    if (!room.args) return
    await room.setReaction({ ...room.args, messageId: messageId as Id<'conversationMessages'>, emoji, enabled: !current?.reactedByCurrentPrincipal })
      .catch(() => toast.error('Could not update the reaction.'))
  }

  async function togglePinned(messageId: string) {
    const pinned = pins.some((pin) => pin.messageId === messageId)

    if (!room.args) return
    await room.setPinned({ ...room.args, messageId: messageId as Id<'conversationMessages'>, pinned: !pinned })
      .catch(() => toast.error('Could not update the pin.'))
  }

  /**
   * Reporting records an audit event and tells the reporter it was received.
   * Nothing in the room changes; review policy arrives with enterprise
   * moderation.
   */
  async function reportMessage(messageId: string) {

    try {
      await overlayAppClient.conversations.reportMessage(conversationId, {
        messageId,
        reason: 'other',
      })
      toast.success('Report sent to the workspace owners.')
    } catch {
      toast.error('Could not send the report.')
    }
  }

  async function toggleSaved(messageId: string) {
    const saved = savedMessages.some((row) => row.conversationId === conversationId && row.messageId === messageId)

    if (!room.args) return
    await room.setSaved({ ...room.args, messageId: messageId as Id<'conversationMessages'>, saved: !saved })
      .catch(() => toast.error('Could not save the message.'))
  }

  async function saveGeneratedUiPart(messageId: string, partId: string, data: GeneratedUiData) {
    if (isReadOnlyMessage?.(messageId)) throw new Error('This thread is read-only')
    if (!activeWorkspaceId || data.kind !== 'json_render') throw new Error('Could not save this view')
    await updateRoomUiPart({ workspaceId: activeWorkspaceId, conversationId: conversationId as Id<'conversations'>,
      messageId: messageId as Id<'conversationMessages'>, partId, data })
  }

  async function saveEdit(messageId: string) {
    if (isReadOnlyMessage?.(messageId)) return
    const content = editingContent.trim()
    if (!content) return

    try {
      if (!activeWorkspaceId) throw new Error('No workspace')
      setEditingId(null)
      const edited = await editRoomMessage({ workspaceId: activeWorkspaceId, conversationId: conversationId as Id<'conversations'>,
        messageId: messageId as Id<'conversationMessages'>, content })
      if (!edited) throw new Error('This message can no longer be edited.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not edit this message.')
    }
  }

  async function deleteMessage(messageId: string) {
    if (isReadOnlyMessage?.(messageId)) return
    try {
      if (!activeWorkspaceId) throw new Error('No workspace')
      const deleted = await deleteRoomMessage({ workspaceId: activeWorkspaceId, conversationId: conversationId as Id<'conversations'>,
        messageId: messageId as Id<'conversationMessages'> })
      if (!deleted) throw new Error('This message can no longer be deleted.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete this message.')
    }
  }

  return {
    editingId,
    setEditingId,
    editingContent,
    setEditingContent,
    copyMessagePermalink,
    toggleReaction,
    togglePinned,
    reportMessage,
    toggleSaved,
    saveGeneratedUiPart,
    saveEdit,
    deleteMessage,
  }
}

export function useMessageNavigation({
  listRef,
  messagesRef,
  releaseTurnAnchor,
  setStickToBottom,
  markVisibleRead,
  setNewMessageCount,
  setThreadRootId,
  setRoomPanel,
  messageCount,
}: {
  listRef: RefObject<HTMLDivElement | null>
  messagesRef: RefObject<OptimisticMessage[]>
  releaseTurnAnchor?: () => void
  setStickToBottom: Dispatch<SetStateAction<boolean>>
  markVisibleRead: (scrollReadKey?: string) => Promise<void>
  setNewMessageCount: Dispatch<SetStateAction<number>>
  setThreadRootId: Dispatch<SetStateAction<string | null>>
  setRoomPanel: Dispatch<SetStateAction<RoomPanelKind | null>>
  messageCount: number
}) {
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const permalinkJumpedRef = useRef<string | null>(null)

  /**
   * Scrolls a pinned message back into view and flashes it. A reply only exists
   * inside its thread, so the thread panel opens first and the scroll happens
   * there instead of in the main transcript.
   */
  const jumpToMessage = useCallback((messageId: string) => {
    const target = messagesRef.current.find((message) => message.id === messageId)
    const root = target?.threadRootMessageId
    if (root) {
      setThreadRootId(root)
      setRoomPanel('thread')
    } else {
      setThreadRootId(null)
      setRoomPanel(null)
    }
    setHighlightedMessageId(messageId)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById(roomMessageDomId(messageId))?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      })
    })
  }, [messagesRef, setRoomPanel, setThreadRootId])

  const jumpToLatest = useCallback(() => {
    const node = listRef.current
    if (!node) return
    releaseTurnAnchor?.()
    setStickToBottom(true)
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
    setNewMessageCount(0)
    void markVisibleRead()
  }, [listRef, markVisibleRead, setNewMessageCount, setStickToBottom, releaseTurnAnchor])

  useEffect(() => {
    const target = typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('message')?.trim() || null
    if (!target || permalinkJumpedRef.current === target || !messagesRef.current.some((message) => message.id === target)) return
    permalinkJumpedRef.current = target
    queueMicrotask(() => jumpToMessage(target))
  }, [jumpToMessage, messageCount, messagesRef])

  useEffect(() => {
    if (!highlightedMessageId) return
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 2_000)
    return () => window.clearTimeout(timer)
  }, [highlightedMessageId])

  return { highlightedMessageId, jumpToMessage, jumpToLatest }
}

export function useRoomActions({
  conversationId,
  conversationType,

  title,
  activeWorkspaceId,
  router,
  otherParticipantsCount,
  currentParticipantArchived,
  room,
  setMenuOpen,
}: {
  conversationId: string
  conversationType: 'dm' | 'channel'

  title: string
  activeWorkspaceId: string | null | undefined
  router: ReturnType<typeof useRouter>
  otherParticipantsCount: number
  currentParticipantArchived: boolean
  room: RoomStateApi
  setMenuOpen: Dispatch<SetStateAction<boolean>>
}) {
  const buildWorkspaceHref = useWorkspaceHref()
  const [pendingArchiveScope, setPendingArchiveScope] = useState(false)
  const [scopeDialogBusy, setScopeDialogBusy] = useState(false)
  const [scopeDialogError, setScopeDialogError] = useState<string | null>(null)
  const [pendingDeleteScope, setPendingDeleteScope] = useState(false)

  async function updateState(
    state: { notificationLevel?: 'all' | 'mentions' | 'muted'; markUnread?: boolean; archived?: boolean },
    confirmation: string,
  ) {
    try {
      if (!room.args) throw new Error('This conversation is unavailable.')
      await room.updateMyState({ ...room.args, ...state })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the conversation.')
      return false
    }
    toast.success(confirmation)
    setMenuOpen(false)
    return true
  }

  async function archiveConversation(scope: 'self' | 'everyone') {

    setScopeDialogBusy(true)
    setScopeDialogError(null)
    try {
      await overlayAppClient.conversations.updateParticipantState(conversationId, {
        archived: true,
        archiveScope: scope,
      })
      dispatchChatArchived({
        chat: {
          _id: conversationId,
          title,
          lastModified: Date.now(),
          conversationType,
        },
      })
      announceArchived({
        name: title || 'Conversation',
        undo: async () => {
          await overlayAppClient.conversations.updateParticipantState(conversationId, { archived: false, archiveScope: scope })
        },
        onUndone: () => dispatchChatModified({ chat: { _id: conversationId, title, lastModified: Date.now(), conversationType } }),
      })
      setPendingArchiveScope(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversation could not be archived'
      if (pendingArchiveScope) setScopeDialogError(message)
      toast.error(message)
    } finally {
      setScopeDialogBusy(false)
    }
  }

  function archiveMenuAction() {
    setMenuOpen(false)
    if (currentParticipantArchived) {
      void updateState({ archived: false }, 'Conversation restored').then((updated) => {
        if (!updated) return
        const view = conversationType === 'channel' ? 'channels' : 'dms'
        router.push(buildWorkspaceHref(
          activeWorkspaceId ?? null,
          `/app/chat?${new URLSearchParams({ view, id: conversationId }).toString()}`,
          'workspace',
        ))
      }).catch(() => undefined)
      return
    }
    // A one-to-one DM has nobody else to keep it for — archive directly
    // instead of asking about scope.
    if (otherParticipantsCount <= 1) {
      void archiveConversation('self')
      return
    }
    setScopeDialogError(null)
    setPendingArchiveScope(true)
  }

  async function deleteConversation(scope: 'self' | 'everyone') {
    setScopeDialogBusy(true)
    setScopeDialogError(null)
    try {
      const response = await overlayAppClient.conversations.deleteResponse({
        conversationId,
        scope,
      })
      if (!response.ok) throw new Error('Conversation was not deleted')
      dispatchChatArchived({
        chat: {
          _id: conversationId,
          title,
          lastModified: Date.now(),
          conversationType,
          archivedAt: Date.now(),
        },
      })
      setPendingDeleteScope(false)
      const view = conversationType === 'channel' ? 'channels' : 'dms'
      router.push(buildWorkspaceHref(
        activeWorkspaceId ?? null,
        `/app/chat?${new URLSearchParams({ view }).toString()}`,
        'workspace',
      ))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversation could not be deleted'
      setScopeDialogError(message)
      toast.error(message)
    } finally {
      setScopeDialogBusy(false)
    }
  }

  return {
    pendingArchiveScope,
    setPendingArchiveScope,
    scopeDialogBusy,
    scopeDialogError,
    pendingDeleteScope,
    setPendingDeleteScope,
    updateState,
    archiveConversation,
    archiveMenuAction,
    deleteConversation,
  }
}

export function useRoomPanels({
  renderAttachmentViewer,
}: {
  renderAttachmentViewer: import('./chat/useChatShellPanels').RenderAttachmentViewer
}) {
  const panels = useChatPanels()
  const {
    shellRightPanel,
    shellRightPanelClose,
    shellRightPanelMode,
    shellRightPanelResize,
    shellRightPanelWidth,
  } = useChatShellPanels({
    attachmentPreview: panels.attachmentPreview,
    attachmentPreviewMode: panels.attachmentPreviewMode,
    closeAttachmentPreview: panels.closeAttachmentPreview,
    closeLinkPreview: panels.closeLinkPreview,
    closeSourcesPanel: panels.closeSourcesPanel,
    linkPreview: panels.linkPreview,
    panelPresentation: panels.panelPresentation,
    panelWidth: panels.panelWidth,
    setPanelWidth: panels.setPanelWidth,
    setPanelPresentation: panels.setPanelPresentation,
    setAttachmentPreviewMode: panels.setAttachmentPreviewMode,
    sourcesPanel: panels.sourcesPanel,
    renderAttachmentViewer,
  })
  return {
    ...panels,
    shellRightPanel,
    shellRightPanelClose,
    shellRightPanelMode,
    shellRightPanelResize,
    shellRightPanelWidth,
  }
}

export type RoomMessageContext = {
  isReadOnlyMessage?: (messageId: string) => boolean
  conversationId: string
  conversationType: 'dm' | 'channel'
  currentPrincipalId: string
  participants: ConversationParticipant[]
  directoryAgentsByPrincipal: ReadonlyMap<string, AgentDirectoryEntry>
  participantMentions: Array<{
    type: 'person' | 'agent'
    id: string
    name: string
    avatarColor?: string
    avatarShape?: string
    isDefault?: boolean
  }>
  reactions: MessageReaction[]
  pins: ConversationPin[]
  savedMessages: ConversationSavedMessage[]
  threadRootId: string | null
  threadTeasers: ReadonlyMap<string, OptimisticMessage>
  replyCounts: ReadonlyMap<string, number>
  editingId: string | null
  editingContent: string
  setEditingContent: Dispatch<SetStateAction<string>>
  setEditingId: Dispatch<SetStateAction<string | null>>
  saveEdit: (messageId: string) => Promise<void>
  saveGeneratedUiPart: (messageId: string, partId: string, data: GeneratedUiData) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  reportMessage: (messageId: string) => Promise<void>
  toggleReaction: (messageId: string, emoji: string) => Promise<void>
  togglePinned: (messageId: string) => Promise<void>
  toggleSaved: (messageId: string) => Promise<void>
  openThread: (messageId: string) => void
  beginQuoteReply: (message: OptimisticMessage) => void
  sendMessage: SendMessage
  onOpenAttachmentPreview: (preview: AttachmentPreview, options?: AttachmentPreviewOpenOptions) => void
  copyMessagePermalink: (messageId: string) => Promise<void>
  stopAgentResponse: (messageId: string) => Promise<void>
  controlRemoteQueue: (runId: string, action: 'cancel' | 'retry' | 'resume' | 'start_fresh') => Promise<void>
  resolveRemoteRequest: (
    request: NonNullable<import('./collaboration/RoomMessageItem').RoomMessageView['remoteRequest']>,
    decision: string,
    response?: Record<string, unknown>,
  ) => Promise<void>
  highlightedMessageId: string | null
}

export type SendMessage = (content: string, options?: {
  existing?: Pick<OptimisticMessage, 'clientNonce' | 'turnId' | 'createdAt' | 'parts'>
  threadRootMessageId?: string
  requireCurrentThread?: boolean
  /** Called with the optimistic bubble, after admission and before the save response. */
  onSubmitted?: () => void
  parts?: RoomMessageRecord['parts']
  attachmentNames?: string[]
  reply?: { replyToTurnId?: string; snippet: string } | null
}) => Promise<RoomSendResult>

export function buildRoomMessageContext({
  isReadOnlyMessage,
  conversationId,
  conversationType,
  roster,
  collab,
  thread,
  vm,
  directoryAgentsByPrincipal,
  actions,
  composer,
  sendMessage,
  navigation,
  remoteControls,
  onOpenAttachmentPreview,
}: {
  isReadOnlyMessage?: (messageId: string) => boolean
  conversationId: string
  conversationType: 'dm' | 'channel'
  roster: ReturnType<typeof useRoomRoster>
  collab: ReturnType<typeof useRoomCollaboration>
  thread: ReturnType<typeof useThreadPanel>
  vm: ReturnType<typeof useRoomViewModels>
  directoryAgentsByPrincipal: ReadonlyMap<string, AgentDirectoryEntry>
  actions: ReturnType<typeof useMessageActions>
  composer: ReturnType<typeof useRoomComposer>
  sendMessage: SendMessage
  navigation: ReturnType<typeof useMessageNavigation>
  remoteControls: ReturnType<typeof useRemoteAgentControls>
  onOpenAttachmentPreview: RoomMessageContext['onOpenAttachmentPreview']
}): RoomMessageContext {
  return {
    isReadOnlyMessage,
    conversationId,
    conversationType,
    currentPrincipalId: roster.currentPrincipalId,
    participants: roster.participants,
    directoryAgentsByPrincipal,
    participantMentions: vm.participantMentions,
    reactions: collab.reactions,
    pins: collab.pins,
    savedMessages: collab.savedMessages,
    threadRootId: thread.threadRootId,
    threadTeasers: vm.threadTeasers,
    replyCounts: vm.replyCounts,
    editingId: actions.editingId,
    editingContent: actions.editingContent,
    setEditingContent: actions.setEditingContent,
    setEditingId: actions.setEditingId,
    saveEdit: actions.saveEdit,
    saveGeneratedUiPart: actions.saveGeneratedUiPart,
    deleteMessage: actions.deleteMessage,
    reportMessage: actions.reportMessage,
    toggleReaction: actions.toggleReaction,
    togglePinned: actions.togglePinned,
    toggleSaved: actions.toggleSaved,
    openThread: thread.openThread,
    beginQuoteReply: composer.beginQuoteReply,
    sendMessage,
    onOpenAttachmentPreview,
    copyMessagePermalink: actions.copyMessagePermalink,
    stopAgentResponse: remoteControls.stopAgentResponse,
    controlRemoteQueue: remoteControls.controlRemoteQueue,
    resolveRemoteRequest: remoteControls.resolveRemoteRequest,
    highlightedMessageId: navigation.highlightedMessageId,
  }
}

export function useDirectMessageRoom({
  conversationId,

  conversationType,
  draft,
  draftTitle,
  router,
  activeWorkspaceId,
  markConversationRead,
  onOpenAttachmentPreview,
}: {
  conversationId: string

  conversationType: 'dm' | 'channel'
  draft: boolean
  draftTitle: string | undefined
  router: ReturnType<typeof useRouter>
  activeWorkspaceId: string | null | undefined
  markConversationRead: (conversationId: string) => void
  onOpenAttachmentPreview: RoomMessageContext['onOpenAttachmentPreview']
}) {
  const createAgentThread = useMutation(api.agents.threads.create)
  const convex = useConvex()

  const [menuOpen, setMenuOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const [roomPanel, setRoomPanel] = useState<RoomPanelKind | null>(null)
  const [addPeopleOpen, setAddPeopleOpen] = useState(false)
  const [agentResponding, setAgentResponding] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [memoryEnabled, setMemoryEnabled] = useState(() =>
    defaultMemoryEnabled({ temporary: false }),
  )
  const [mentions, setMentions] = useState<MentionItem[]>([])

  const room = useRoomState(activeWorkspaceId, conversationId)
  const readMarkers = useReadMarkers({ conversationId, room, markConversationRead })
  const roster = useRoomRoster({ room, noteParticipantsLoaded: readMarkers.noteParticipantsLoaded })
  const collab = useRoomCollaboration({ room })
  const thread = useThreadPanel({ conversationId, room, setRoomPanel })
  const roomCompatibility = useRoomCompatibility({ workspaceId: activeWorkspaceId, conversationId })
  const selectedCompatibility = useRoomCompatibility({
    workspaceId: activeWorkspaceId,
    conversationId: thread.threadRootId ? conversationId : null,
    threadRootMessageId: thread.threadRootId,
  })
  const nativeThreadSafety = useNativeThreadSafety({
    conversationId, workspaceId: activeWorkspaceId, liveCompatibility: roomCompatibility,
  })
  const selectedThreadSafety = useNativeThreadSafety({
    conversationId: thread.threadRootId ? conversationId : null,
    workspaceId: activeWorkspaceId,
    threadRootMessageId: thread.threadRootId ?? undefined,
    liveCompatibility: selectedCompatibility,
  })
  const effectiveSelectedThreadSafety = nativeThreadSafety.readOnly
    ? nativeThreadSafety
    : selectedThreadSafety
  const checkMainRoomWritable = nativeThreadSafety.checkWritable
  const checkSelectedThreadWritable = selectedThreadSafety.checkWritable
  const canSendToThread = useCallback((root?: string) => !nativeThreadSafety.readOnly
    && (!root || root !== thread.threadRootId || !selectedThreadSafety.readOnly),
  [nativeThreadSafety.readOnly, selectedThreadSafety.readOnly, thread.threadRootId])
  const ensureCanSendToThread = useCallback(async (root?: string) => {
    if (!root) {
      return checkMainRoomWritable()
    }
    if (root === thread.threadRootId) {
      return checkSelectedThreadWritable()
    }
    try {
      if (!activeWorkspaceId) return { accepted: false, status: 'error' as const }
      const result = await convex.query(api.collaboration.rooms.compatibility, {
        workspaceId: activeWorkspaceId,
        conversationId: conversationId as Id<'conversations'>,
        threadRootMessageId: root as Id<'conversationMessages'>,
      })
      const status = result ? nativeThreadSafetyStatus(result.compatibility) : 'error'
      return {
        accepted: status === 'writable',
        status,
      }
    } catch (error) {
      return { accepted: false, status: nativeThreadSafetyErrorStatus(error), error }
    }
  }, [
    activeWorkspaceId,
    convex,
    conversationId,
    checkMainRoomWritable,
    checkSelectedThreadWritable,
    thread.threadRootId,
  ])
  const transcript = useRoomTranscript({
    conversationId,
    rosterReady: roster.ready,
    anchorAgentTurns: conversationType === 'dm' && roster.participants.some(participant => participant.principalType === 'agent'),


    agentResponding,
    markVisibleRead: readMarkers.markVisibleRead,
    setNewMessageCount: readMarkers.setNewMessageCount,
  })
  const { reportTyping } = useRoomLifecycle({ room })
  const directoryAgentsByPrincipal = useAgentDirectory({
    activeWorkspaceId,

    conversationId,

  })
  const vm = useRoomViewModels({
    participants: roster.participants,
    currentPrincipalId: roster.currentPrincipalId,
    presence: roster.presence,
    messages: transcript.messages,
    unreadBoundarySequence: readMarkers.unreadBoundarySequence,
    conversationTitle: transcript.conversationTitle,
    draftTitle,
    conversationType,
    channel: collab.channel,
    directoryAgentsByPrincipal,
    pins: collab.pins,
    threadRootId: thread.threadRootId,
  })
  const commitDraftConversation = useDraftConversation({
    conversationId,
    conversationType,
    draft,

    title: vm.title,
    messages: transcript.messages,
    messagesRef: transcript.messagesRef,
  })
  const sendMessage = useSendMessage({
    canSendToThread,
    ensureCanSendToThread,
    nativeThreadSafetyStatusValue: nativeThreadSafety.status,
    selectedThreadSafetyStatus: selectedThreadSafety.status,
    currentThreadRootId: thread.threadRootId,

    currentPrincipalId: roster.currentPrincipalId,
    setMessages: transcript.setMessages,
    setConversationTitle: transcript.setConversationTitle,
    conversationId,
    participants: roster.participants,
    conversationType,
    loading: transcript.loading,
    conversationTitle: transcript.conversationTitle,
    soloAgentParticipant: vm.soloAgentParticipant,
    messagesRef: transcript.messagesRef,
    memoryEnabled,
      commitDraftConversation,
    setAgentResponding,
    messages: transcript.messages,
    mentions,
  })
  const composer = useRoomComposer({

    activeWorkspaceId,
    conversationId,
    reportTyping,
    sendMessage,
    mentions,
    setMentions,
    readOnly: Boolean(transcript.surfacePlatform) || nativeThreadSafety.readOnly,
  })
  const remoteControls = useRemoteAgentControls({
    activeWorkspaceId,
    conversationId,
    setMessages: transcript.setMessages,
    setAttachmentError: composer.setAttachmentError,
  })
  const isReadOnlyMessage = (messageId: string) => {
    const message = transcript.messages.find((row) => row.id === messageId)
    return Boolean(transcript.surfacePlatform) || !canSendToThread(message?.threadRootMessageId ?? messageId)
  }
  const actions = useMessageActions({
    isReadOnlyMessage,
    conversationId,

    room,
    reactions: collab.reactions,
    pins: collab.pins,
    savedMessages: collab.savedMessages,
  })
  const navigation = useMessageNavigation({
    listRef: transcript.listRef,
    messagesRef: transcript.messagesRef,
    releaseTurnAnchor: transcript.releaseTurnAnchor,
    setStickToBottom: transcript.setStickToBottom,
    markVisibleRead: readMarkers.markVisibleRead,
    setNewMessageCount: readMarkers.setNewMessageCount,
    setThreadRootId: thread.setThreadRootId,
    setRoomPanel,
    messageCount: transcript.messages.length,
  })
  const buildWorkspaceHref = useWorkspaceHref()
  const handoffToRoomRoot = async (handoff: string) => {
    const mainAdmission = await nativeThreadSafety.checkWritable()
    if (!mainAdmission.accepted || !nativeThreadSafety.isCurrentScope() || !selectedThreadSafety.isCurrentScope()) return
    const rootDraftScope = { workspaceId: activeWorkspaceId, conversationId }
    const existingRootDraft = composer.inputRef.current || readDraft(rootDraftScope)
    const separator = existingRootDraft.trim() ? '\n\n' : ''
    const availableHandoffLength = Math.max(0, 20_000 - existingRootDraft.length - separator.length)
    const combinedDraft = `${existingRootDraft}${availableHandoffLength > 0
      ? `${separator}${handoff.slice(0, availableHandoffLength)}`
      : ''}`
    writeDraft(rootDraftScope, combinedDraft)
    composer.setInput(combinedDraft)
    thread.setThreadRootId(null)
    thread.setThreadInput('')
    setRoomPanel(null)
    composer.composerRef.current?.focus()
  }
  const startNewNativeThread = async () => {
    const rootId = thread.threadRootId
    const safety = rootId ? effectiveSelectedThreadSafety : nativeThreadSafety
    if (!safety.readOnly) {
      thread.setThreadRootId(null)
      thread.setThreadInput('')
      setRoomPanel(null)
      composer.composerRef.current?.focus()
      return
    }
    if (safety.status !== 'retired') return
    const root = rootId ? transcript.messages.find((message) => message.id === rootId) : undefined
    if (rootId && !root) {
      toast.error('Could not load the original thread for this handoff. Try again.')
      return
    }
    const handoffMessages = root
      ? [root, ...transcript.messages.filter((message) => message.threadRootMessageId === root.id)]
      : transcript.messages
    const handoff = buildNativeThreadHandoff({
      conversationId,
      ...(root ? { threadRootMessageId: root.id } : {}),
      messages: handoffMessages,
    })
    if (root && rootId && !nativeThreadSafety.readOnly) {
      await handoffToRoomRoot(handoff)
      return
    }
    const agentId = nativeThreadSafety.agentId
    if (agentId && activeWorkspaceId) {
      const next = await createAgentThread({ workspaceId: activeWorkspaceId, agentId })
      if (!safety.isCurrentScope()) return
      writeDraft({ workspaceId: activeWorkspaceId, conversationId: next.conversationId }, handoff)
      dispatchChatCreated({ chat: {
        _id: next.conversationId, title: next.title, lastModified: Date.now(), conversationType: 'dm',
      } })
      const targetHref = agentConversationRedirect({
        pathname: window.location.pathname,
        workspaceId: activeWorkspaceId ?? null,
        agentId,
        conversationId: next.conversationId,
        guided: false,
      })
      const target = new URL(targetHref ?? window.location.href, window.location.origin)
      target.searchParams.set('id', next.conversationId)
      target.searchParams.set('handoff', '1')
      target.searchParams.delete('message')
      target.searchParams.delete('draft')
      router.push(`${target.pathname}?${target.searchParams.toString()}`)
    } else {
      const newConversationId = await createHandoffConversation({
        workspaceId: activeWorkspaceId ?? null,
        title: 'Continued thread',
      })
      if (!newConversationId) throw new Error('Could not create a new conversation for the handoff.')
      if (!safety.isCurrentScope()) return
      writeDraft({ workspaceId: activeWorkspaceId, conversationId: newConversationId }, handoff)
      dispatchChatCreated({ chat: {
        _id: newConversationId,
        title: 'Continued thread',
        lastModified: Date.now(),
        conversationType: 'personal',
      } })
      const params = new URLSearchParams({ id: newConversationId, handoff: '1' })
      if (activeWorkspaceId) params.set('view', 'workspace-chats')
      router.push(buildWorkspaceHref(activeWorkspaceId ?? null, `/app/chat?${params.toString()}`))
    }
  }
  const roomActions = useRoomActions({
    conversationId,
    conversationType,

    title: vm.title,
    activeWorkspaceId,
    router,
    otherParticipantsCount: vm.otherParticipants.length,
    currentParticipantArchived: Boolean(vm.currentParticipant?.archivedAt),
    room,
    setMenuOpen,
  })
  const messageCtx = buildRoomMessageContext({
    isReadOnlyMessage,
    conversationId,
    conversationType,
    roster,
    collab,
    thread,
    vm,
    directoryAgentsByPrincipal,
    actions,
    composer,
    sendMessage,
    navigation,
    remoteControls,
    onOpenAttachmentPreview,
  })

  return {

    menuOpen,
    setMenuOpen,
    menuTriggerRef,
    roomPanel,
    setRoomPanel,
    addPeopleOpen,
    setAddPeopleOpen,
    agentResponding,
    setAgentResponding,
    shareOpen,
    setShareOpen,
    memoryEnabled,
    setMemoryEnabled,
    mentions,
    setMentions,
    readMarkers,
    roster,
    collab,
    thread,
    transcript,
    vm,
    sendMessage,
    composer,
    remoteControls,
    actions,
    navigation,
    roomActions,
    messageCtx,
    nativeThreadSafety,
    selectedThreadSafety: effectiveSelectedThreadSafety,
    startNewNativeThread,
    isReadOnlyMessage,
  }
}

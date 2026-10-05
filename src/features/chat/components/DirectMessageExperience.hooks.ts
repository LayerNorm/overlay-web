'use client'

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
  Computer,
  ConversationParticipant,
  ConversationPin,
  ConversationPresence,
  ConversationSavedMessage,
  MessageReaction,
} from '@overlay/workspace-contracts'
import type { AttachmentPreview, AttachmentPreviewOpenOptions } from '@overlay/chat-react'
import type { MentionCategory, MentionItem } from '@/shared/knowledge/mention-types'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { resolveMentionedPrincipalIds } from '@/shared/mentions/principal-mentions'
import { clearDraft, readDraft, writeDraft } from '@/shared/chat/conversation-drafts'
import { dispatchChatArchived, dispatchChatCreated, dispatchChatTitleUpdated, sanitizeChatTitle } from '@/shared/chat/chat-title'
import {
  AGENT_DIRECTORY_CHANGED_EVENT,
  AGENT_DRAFT_PREVIEW_EVENT,
  type AgentDraftPreviewEventDetail,
} from '@/shared/workspace/sidebar-events'
import { takePendingCollaborationMessage } from '../lib/pending-collaboration-message'
import { defaultMemoryEnabled } from '@/shared/chat/tool-requests'
import { generateTitle } from '@/features/chat/lib/generate-title'
import {
  compareRoomMessageRecords,
  mergeRoomMessages,
  remoteAgentCommands,
  roomMessageDomId,
  type RemoteAgentCommand,
  type RoomMessageRecord,
} from './collaboration/room-message-view'
import type { RoomPanelKind } from './collaboration/RoomSidePanels'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import { useChatPanels } from './chat/useChatPanels'
import { useChatShellPanels } from './chat/useChatShellPanels'
import { useChatAttachments } from './useChatAttachments'
import { useComposerTextState } from './chat/useComposerTextState'
import { buildTextTurnPayload } from './chat/chat-send-body-builders'

export type OptimisticMessage = RoomMessageRecord

/** Ids of the client-only rows that show an agent is about to reply (see `useSendMessage`). */
const PENDING_AGENT_REPLY_PREFIX = 'optimistic_pending_reply_'
const PENDING_AGENT_REPLY_SORT_LEAD_MS = 30_000

export const SHOWCASE_CONVERSATION_ID = 'showcase-dm'
export const SHOWCASE_WORKSPACE_ID = 'showcase-acme'
export const SHOWCASE_CURRENT_PRINCIPAL_ID = 'showcase-divyansh'
export const SHOWCASE_PARTICIPANTS: ConversationParticipant[] = [
  ['showcase-divyansh', 'Divyansh', 'moderator'],
  ['showcase-maya', 'Maya Chen', 'member'],
  ['showcase-rahul', 'Rahul Shah', 'member'],
].map(([principalId, displayName, role], index) => ({
  conversationId: SHOWCASE_CONVERSATION_ID,
  workspaceId: SHOWCASE_WORKSPACE_ID,
  principalId,
  principalType: 'human',
  displayName,
  role: role as ConversationParticipant['role'],
  status: 'active',
  notificationLevel: 'all',
  joinedAt: Date.parse('2026-07-29T17:00:00.000Z') + index,
  updatedAt: Date.parse('2026-07-29T17:00:00.000Z') + index,
}))
export const SHOWCASE_PRESENCE: ConversationPresence[] = SHOWCASE_PARTICIPANTS.map((participant, index) => ({
  workspaceId: SHOWCASE_WORKSPACE_ID,
  principalId: participant.principalId,
  conversationId: SHOWCASE_CONVERSATION_ID,
  status: index < 2 ? 'online' : 'away',
  typing: false,
  lastSeenAt: Date.parse('2026-07-29T18:10:00.000Z') - index * 60_000,
}))
export const SHOWCASE_MESSAGES: OptimisticMessage[] = [
  {
    id: 'showcase-dm-message-1',
    turnId: 'showcase-dm-turn-1',
    authorKind: 'human',
    authorPrincipalId: 'showcase-maya',
    content: 'I pulled the customer feedback into the launch project. The onboarding gap is still the clearest pattern.',
    createdAt: Date.parse('2026-07-29T18:02:00.000Z'),
  },
  {
    id: 'showcase-dm-message-2',
    turnId: 'showcase-dm-turn-2',
    authorKind: 'human',
    authorPrincipalId: SHOWCASE_CURRENT_PRINCIPAL_ID,
    content: 'Agreed. Let’s make the first useful outcome happen before we introduce the rest of the workspace.',
    createdAt: Date.parse('2026-07-29T18:05:00.000Z'),
  },
  {
    id: 'showcase-dm-message-3',
    turnId: 'showcase-dm-turn-3',
    authorKind: 'human',
    authorPrincipalId: 'showcase-rahul',
    content: '@Divyansh I can have the revised flow ready for review this afternoon.',
    createdAt: Date.parse('2026-07-29T18:08:00.000Z'),
  },
  {
    id: 'showcase-thread-reply-1',
    turnId: 'showcase-thread-turn-1',
    authorKind: 'human',
    authorPrincipalId: 'showcase-rahul',
    content: 'I can turn that pattern into the first-run checklist today.',
    createdAt: Date.parse('2026-07-29T18:09:00.000Z'),
    threadRootMessageId: 'showcase-dm-message-1',
  },
]

export const SHOWCASE_AGENT_CONVERSATION_ID = 'showcase-agent-welcome'
export const SHOWCASE_AGENT_PRINCIPAL_ID = 'showcase-research-principal'
export const SHOWCASE_AGENT_IDENTITY = {
  name: 'Research partner',
  avatarColor: '#2563eb',
  avatarShape: 'droplet',
} as const
export const SHOWCASE_AGENT_PARTICIPANTS: ConversationParticipant[] = [
  {
    conversationId: SHOWCASE_AGENT_CONVERSATION_ID,
    workspaceId: SHOWCASE_WORKSPACE_ID,
    principalId: SHOWCASE_CURRENT_PRINCIPAL_ID,
    principalType: 'human',
    displayName: 'Divyansh',
    role: 'moderator',
    status: 'active',
    notificationLevel: 'all',
    joinedAt: Date.parse('2026-07-29T17:00:00.000Z'),
    updatedAt: Date.parse('2026-07-29T17:00:00.000Z'),
  },
  {
    conversationId: SHOWCASE_AGENT_CONVERSATION_ID,
    workspaceId: SHOWCASE_WORKSPACE_ID,
    principalId: SHOWCASE_AGENT_PRINCIPAL_ID,
    principalType: 'agent',
    displayName: SHOWCASE_AGENT_IDENTITY.name,
    role: 'member',
    status: 'active',
    notificationLevel: 'all',
    joinedAt: Date.parse('2026-07-29T17:00:00.000Z'),
    updatedAt: Date.parse('2026-07-29T17:00:00.000Z'),
  },
]
export const SHOWCASE_AGENT_PRESENCE: ConversationPresence[] = SHOWCASE_AGENT_PARTICIPANTS.map((participant) => ({
  workspaceId: SHOWCASE_WORKSPACE_ID,
  principalId: participant.principalId,
  conversationId: SHOWCASE_AGENT_CONVERSATION_ID,
  status: 'online',
  typing: false,
  lastSeenAt: Date.parse('2026-07-29T18:10:00.000Z'),
}))
export const SHOWCASE_AGENT_MESSAGES: OptimisticMessage[] = [
  {
    id: 'showcase-agent-message-1',
    turnId: 'showcase-agent-turn-1',
    authorKind: 'human',
    authorPrincipalId: SHOWCASE_CURRENT_PRINCIPAL_ID,
    content: 'Can you pull together what customers keep saying about onboarding?',
    createdAt: Date.parse('2026-07-29T18:02:00.000Z'),
  },
  {
    id: 'showcase-agent-message-2',
    turnId: 'showcase-agent-turn-2',
    authorKind: 'agent',
    authorPrincipalId: SHOWCASE_AGENT_PRINCIPAL_ID,
    content: 'I read through the latest 23 feedback notes. The clearest pattern is the first-run gap — it shows up in 9 of them, mostly around workspace setup. Want me to turn this into a checklist for the team?',
    createdAt: Date.parse('2026-07-29T18:05:00.000Z'),
  },
  {
    id: 'showcase-agent-message-3',
    turnId: 'showcase-agent-turn-3',
    authorKind: 'human',
    authorPrincipalId: SHOWCASE_CURRENT_PRINCIPAL_ID,
    content: 'Yes — draft it, and flag anything that needs a human decision.',
    createdAt: Date.parse('2026-07-29T18:08:00.000Z'),
  },
]

function requireArray<T>(value: T[] | undefined, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} returned an invalid response`)
  return value
}

export function useThreadPanel({
  conversationId,
  showcase,
  setRoomPanel,
}: {
  conversationId: string
  showcase: boolean
  setRoomPanel: Dispatch<SetStateAction<RoomPanelKind | null>>
}) {
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const [threadFollowing, setThreadFollowing] = useState(false)
  const [threadInput, setThreadInput] = useState('')

  useEffect(() => {
    if (!threadRootId || showcase) {
      queueMicrotask(() => setThreadFollowing(false))
      return
    }
    let cancelled = false
    void overlayAppClient.conversations.threadFollow(conversationId, threadRootId)
      .then((result) => {
        if (!cancelled) setThreadFollowing(result.following)
      })
      .catch(() => {
        if (!cancelled) setThreadFollowing(false)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, showcase, threadRootId])

  const toggleThreadFollow = useCallback(() => {
    if (!threadRootId || showcase) return
    const next = !threadFollowing
    setThreadFollowing(next)
    void overlayAppClient.conversations.setThreadFollow(conversationId, threadRootId, next)
      .then((result) => setThreadFollowing(result.followed))
      .catch(() => setThreadFollowing(!next))
  }, [conversationId, showcase, threadFollowing, threadRootId])

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
    toggleThreadFollow,
    openThread,
  }
}

export function useReadMarkers({
  conversationId,
  showcase,
  refreshNotifications,
}: {
  conversationId: string
  showcase: boolean
  refreshNotifications: () => void
}) {
  const [unreadBoundarySequence, setUnreadBoundarySequence] = useState<number | null>(null)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const unreadBoundaryInitializedRef = useRef(false)
  const readMarkInFlightRef = useRef(false)

  const clearCollaborationNotifications = useCallback(async () => {
    if (showcase) return
    try {
      await overlayAppClient.conversations.markConversationNotificationsRead(conversationId)
      refreshNotifications()
    } catch {
      // Badge clear is best-effort; the room transcript still works.
    }
    window.dispatchEvent(new CustomEvent('overlay:collaboration-read', {
      detail: { conversationId },
    }))
  }, [conversationId, refreshNotifications, showcase])

  const markVisibleRead = useCallback(async () => {
    if (showcase || document.visibilityState !== 'visible') return
    if (readMarkInFlightRef.current) return
    readMarkInFlightRef.current = true
    try {
      // Opening a room should clear unread immediately (Slack-style). Do not
      // wait for the transcript to settle at the bottom — that race left
      // badges stuck after the user switched into a DM or channel.
      await overlayAppClient.conversations.updateParticipantState(conversationId, { markRead: true })
      setUnreadBoundarySequence(null)
      setNewMessageCount(0)
      await clearCollaborationNotifications()
    } finally {
      readMarkInFlightRef.current = false
    }
  }, [clearCollaborationNotifications, conversationId, showcase])

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

export function useRoomRoster({
  conversationId,
  showcase,
  isAgentShowcase,
  noteParticipantsLoaded,
}: {
  conversationId: string
  showcase: boolean
  isAgentShowcase: boolean
  noteParticipantsLoaded: (participants: ConversationParticipant[], principalId: string) => void
}) {
  const [participants, setParticipants] = useState<ConversationParticipant[]>(
    isAgentShowcase ? SHOWCASE_AGENT_PARTICIPANTS : showcase ? SHOWCASE_PARTICIPANTS : [],
  )
  const [currentPrincipalId, setCurrentPrincipalId] = useState(
    showcase ? SHOWCASE_CURRENT_PRINCIPAL_ID : '',
  )
  const [presence, setPresence] = useState<ConversationPresence[]>(
    isAgentShowcase ? SHOWCASE_AGENT_PRESENCE : showcase ? SHOWCASE_PRESENCE : [],
  )
  const applyConvexPresence = useCallback((next: ConversationPresence[]) => {
    setPresence(next)
  }, [])

  const loadParticipants = useCallback(async () => {
    const result = await overlayAppClient.conversations.participants(conversationId)
    const nextParticipants = requireArray(result.participants, 'Conversation participants')
    if (typeof result.currentPrincipalId !== 'string' || !result.currentPrincipalId) {
      throw new Error('Conversation participants returned an invalid principal')
    }
    setParticipants(nextParticipants)
    setCurrentPrincipalId(result.currentPrincipalId)
    noteParticipantsLoaded(nextParticipants, result.currentPrincipalId)
  }, [conversationId, noteParticipantsLoaded])

  const loadPresence = useCallback(async () => {
    const result = await overlayAppClient.conversations.presence(conversationId)
    setPresence(requireArray(result.presence, 'Conversation presence'))
  }, [conversationId])

  return {
    participants,
    currentPrincipalId,
    presence,
    applyConvexPresence,
    loadParticipants,
    loadPresence,
  }
}

export function useRoomCollaboration({
  conversationId,
  conversationType,
  showcase,
}: {
  conversationId: string
  conversationType: 'dm' | 'channel'
  showcase: boolean
}) {
  const [channel, setChannel] = useState<ChannelSummary | null>(showcase && conversationType === 'channel' ? {
    conversationId,
    workspaceId: SHOWCASE_WORKSPACE_ID,
    name: 'product-launch',
    slug: 'product-launch',
    topic: 'Launch decisions, customer feedback, and rollout coordination',
    visibility: 'public',
    participantCount: SHOWCASE_PARTICIPANTS.length,
    createdAt: Date.parse('2026-07-29T17:00:00.000Z'),
    updatedAt: Date.parse('2026-07-29T18:10:00.000Z'),
  } : null)
  const [reactions, setReactions] = useState<MessageReaction[]>(showcase ? [{
    conversationId,
    messageId: 'showcase-dm-message-1',
    emoji: '👍',
    principalIds: ['showcase-divyansh', 'showcase-rahul'],
    count: 2,
    reactedByCurrentPrincipal: true,
  }] : [])
  const [pins, setPins] = useState<ConversationPin[]>([])
  const [savedMessages, setSavedMessages] = useState<ConversationSavedMessage[]>([])

  const loadCollaboration = useCallback(async () => {
    const [reactionResult, pinResult, savedResult, channelResult] = await Promise.all([
      overlayAppClient.conversations.reactions(conversationId),
      overlayAppClient.conversations.pins(conversationId),
      overlayAppClient.conversations.savedMessages(),
      conversationType === 'channel' ? overlayAppClient.conversations.channels() : Promise.resolve({ channels: [] }),
    ])
    setReactions(requireArray(reactionResult.reactions, 'Conversation reactions'))
    setPins(requireArray(pinResult.pins, 'Conversation pins'))
    setSavedMessages(requireArray(savedResult.savedMessages, 'Saved messages'))
    if (conversationType === 'channel') {
      const channels = requireArray(channelResult.channels, 'Workspace channels')
      setChannel(channels.find((item) => item.conversationId === conversationId) ?? null)
    }
  }, [conversationId, conversationType])

  return {
    channel,
    reactions,
    setReactions,
    pins,
    setPins,
    savedMessages,
    setSavedMessages,
    loadCollaboration,
  }
}

export function useRoomTranscript({
  conversationId,
  threadRootId,
  showcase,
  isAgentShowcase,
  agentResponding,
  setNotice,
  markVisibleRead,
  setNewMessageCount,
}: {
  conversationId: string
  threadRootId: string | null
  showcase: boolean
  isAgentShowcase: boolean
  agentResponding: string | null
  setNotice: Dispatch<SetStateAction<string | null>>
  markVisibleRead: () => Promise<void>
  setNewMessageCount: Dispatch<SetStateAction<number>>
}) {
  const [messages, setMessages] = useState<OptimisticMessage[]>(
    isAgentShowcase ? SHOWCASE_AGENT_MESSAGES : showcase ? SHOWCASE_MESSAGES : [],
  )
  const [loading, setLoading] = useState(!showcase)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [conversationTitle, setConversationTitle] = useState<string | null>(null)
  /** Platform a mirrored surface thread came from (Slack): the room is read-only. */
  const [surfacePlatform, setSurfacePlatform] = useState<string | null>(null)
  const [stickToBottom, setStickToBottom] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)
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

  const loadMessages = useCallback(async () => {
    const permalinkMessageId = typeof window === 'undefined'
      ? undefined
      : new URLSearchParams(window.location.search).get('message')?.trim() || undefined
    const result = await overlayAppClient.conversations.get<{
      title?: string
      conversationType?: 'personal' | 'dm' | 'channel'
      externalPlatform?: string
      messages: Array<{
        id: string
        authorKind: RoomMessageRecord['authorKind']
        authorPrincipalId?: string
        importedAuthorName?: string
        importedAuthorEmail?: string
        importedAuthorStatus?: RoomMessageRecord['importedAuthorStatus']
        content?: string
        parts?: Array<{ type?: string; text?: string; url?: string; mediaType?: string; fileName?: string; data?: Record<string, unknown> }>
        createdAt: number
        updatedAt?: number
        eventSequence?: number
        editedAt?: number
        deletedAt?: number
        clientNonce?: string
        threadRootMessageId?: string
        status?: 'generating' | 'completed' | 'error'
      }>
      hasMore?: boolean
    }>({
      conversationId,
      messages: true,
      limit: 100,
      ...(permalinkMessageId ? { messageId: permalinkMessageId } : { mainOnly: true }),
    })
    const threadResult = threadRootId
      ? await overlayAppClient.conversations.get<{
          messages: Array<{
            id: string
            authorKind: RoomMessageRecord['authorKind']
            authorPrincipalId?: string
            importedAuthorName?: string
            importedAuthorEmail?: string
            importedAuthorStatus?: RoomMessageRecord['importedAuthorStatus']
            content?: string
            parts?: Array<{ type?: string; text?: string; url?: string; mediaType?: string; fileName?: string; data?: Record<string, unknown> }>
            createdAt: number
            updatedAt?: number
            eventSequence?: number
            editedAt?: number
            deletedAt?: number
            clientNonce?: string
            threadRootMessageId?: string
            status?: 'generating' | 'completed' | 'error'
          }>
        }>({ conversationId, messages: true, limit: 100, threadRootMessageId: threadRootId })
      : null
    setConversationTitle(result.title?.trim() || null)
    setSurfacePlatform(result.externalPlatform ?? null)
    setHasMoreMessages(result.hasMore === true)
    const persisted = [...(result.messages ?? []), ...(threadResult?.messages ?? [])].map((message) => ({
      ...message,
      content: message.content
        ?? message.parts?.find((part) => part.type === 'text')?.text
        ?? '',
      turnId: message.id,
    }))
    setMessages((current) => mergeRoomMessages(persisted, current))
  }, [conversationId, threadRootId])

  const loadOlderMessages = useCallback(async () => {
    if (showcase || loadingOlderMessages || !hasMoreMessages) return
    const earliest = messagesRef.current
      .filter((message) => !message.threadRootMessageId)
      .reduce<number | undefined>((value, message) => value === undefined ? message.createdAt : Math.min(value, message.createdAt), undefined)
    if (earliest === undefined) return
    const node = listRef.current
    if (node) {
      prependScrollRef.current = { height: node.scrollHeight, top: node.scrollTop }
      skipNextMessageGrowthRef.current = true
    }
    setLoadingOlderMessages(true)
    try {
      const result = await overlayAppClient.conversations.get<{
        messages: Array<{
          id: string
          authorKind: RoomMessageRecord['authorKind']
          authorPrincipalId?: string
          importedAuthorName?: string
          importedAuthorEmail?: string
          importedAuthorStatus?: RoomMessageRecord['importedAuthorStatus']
          content?: string
          parts?: Array<{ type?: string; text?: string; url?: string; mediaType?: string; fileName?: string }>
          createdAt: number
          updatedAt?: number
          eventSequence?: number
          editedAt?: number
          deletedAt?: number
          clientNonce?: string
          threadRootMessageId?: string
          status?: 'generating' | 'completed' | 'error'
        }>
        hasMore?: boolean
      }>({ conversationId, messages: true, limit: 100, beforeCreatedAt: earliest, mainOnly: true })
      setHasMoreMessages(result.hasMore === true)
      const older = (result.messages ?? []).map((message) => ({
        ...message,
        content: message.content
          ?? message.parts?.find((part) => part.type === 'text')?.text
          ?? '',
        turnId: message.id,
      }))
      setMessages((current) => mergeRoomMessages(older, current))
    } catch {
      setNotice('Older messages could not be loaded.')
      prependScrollRef.current = null
      skipNextMessageGrowthRef.current = false
    } finally {
      setLoadingOlderMessages(false)
    }
  }, [conversationId, hasMoreMessages, loadingOlderMessages, setNotice, showcase])

  const applyLiveRoomMessages = useCallback((liveMessages: RoomMessageRecord[]) => {
    setMessages((current) => mergeRoomMessages(liveMessages, current))
  }, [])

  useEffect(() => {
    queueMicrotask(() => setConversationTitle(null))
  }, [conversationId])

  useEffect(() => {
    if (loading) return
    void markVisibleRead()
  }, [loading, markVisibleRead, messages.length])

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
      node.scrollTop = node.scrollHeight
    }
    pin()
    const frame = window.requestAnimationFrame(() => {
      pin()
      window.requestAnimationFrame(pin)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [agentResponding, conversationId, loading, messages.length, generatingTextLength, stickToBottom])

  const handleTranscriptScroll = useCallback(() => {
    const node = listRef.current
    if (node) {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      setStickToBottom(distanceFromBottom <= 96)
      if (node.scrollTop <= 120 && hasMoreMessages) void loadOlderMessages()
    }
    void markVisibleRead()
  }, [hasMoreMessages, loadOlderMessages, markVisibleRead])

  return {
    messages,
    setMessages,
    loading,
    setLoading,
    hasMoreMessages,
    loadingOlderMessages,
    conversationTitle,
    surfacePlatform,
    listRef,
    messagesRef,
    stickToBottom,
    setStickToBottom,
    loadMessages,
    loadOlderMessages,
    applyLiveRoomMessages,
    generatingMessages,
    generatingTextLength,
    handleTranscriptScroll,
  }
}

export function useRoomLifecycle({
  conversationId,
  convexRoomSubscriptionEnabled,
  showcase,
  loadParticipants,
  loadMessages,
  loadCollaboration,
  loadPresence,
  setLoading,
}: {
  conversationId: string
  convexRoomSubscriptionEnabled: boolean
  showcase: boolean
  loadParticipants: () => Promise<void>
  loadMessages: () => Promise<void>
  loadCollaboration: () => Promise<void>
  loadPresence: () => Promise<void>
  setLoading: Dispatch<SetStateAction<boolean>>
}) {
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (showcase) return
    let cancelled = false
    // When Convex realtime presence subscription is active, skip the initial
    // HTTP presence load — the subscription will deliver presence state.
    const skipPresencePolling = convexRoomSubscriptionEnabled
    const initialLoadTimer = window.setTimeout(() => {
      // Presence, reactions, pins, and saved state enrich a room, but must not
      // decide whether its critical transcript can open.
      void Promise.allSettled([
        skipPresencePolling ? Promise.resolve() : loadPresence(),
        loadCollaboration(),
      ])
      void Promise.all([loadParticipants(), loadMessages()])
        // A room can receive its transcript through the realtime transport
        // while one of these initial BFF reads is transiently unavailable.
        // Do not turn that recoverable race into a false access failure.
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 0)
    const sessionId = sessionIdRef.current ?? crypto.randomUUID()
    sessionIdRef.current = sessionId
    void overlayAppClient.conversations
      .updatePresence(conversationId, { status: 'online', sessionId })
      .catch(() => undefined)
    // Only poll presence via HTTP when Convex subscription is unavailable.
    const presenceTimer = skipPresencePolling
      ? undefined
      : window.setInterval(() => void loadPresence().catch(() => undefined), 15_000)
    const heartbeatTimer = window.setInterval(() => {
      void overlayAppClient.conversations
        .updatePresence(conversationId, { status: 'online', sessionId })
        .catch(() => undefined)
    }, 45_000)
    return () => {
      cancelled = true
      window.clearTimeout(initialLoadTimer)
      if (presenceTimer !== undefined) window.clearInterval(presenceTimer)
      window.clearInterval(heartbeatTimer)
      void overlayAppClient.conversations
        .updatePresence(conversationId, { status: 'offline', sessionId })
        .catch(() => undefined)
    }
  }, [conversationId, convexRoomSubscriptionEnabled, loadCollaboration, loadMessages, loadParticipants, loadPresence, setLoading, showcase])

  return sessionIdRef
}

type AgentDirectoryEntry = {
  id?: string
  name: string
  avatarColor?: string
  avatarShape?: string
}

export function useAgentDirectory({
  activeWorkspaceId,
  showcase,
  conversationId,
  isAgentShowcase,
}: {
  activeWorkspaceId: string | null | undefined
  showcase: boolean
  conversationId: string
  isAgentShowcase: boolean
}) {
  const [agentsByPrincipal, setAgentsByPrincipal] = useState<ReadonlyMap<string, AgentDirectoryEntry>>(new Map())
  // Unsaved editor drafts overlay the fetched directory so the header renames
  // and re-skins while the user types; cleared by a null patch on save/cancel.
  const [agentDrafts, setAgentDrafts] = useState<ReadonlyMap<string, {
    name: string
    avatarColor?: string
    avatarShape?: string
  }>>(new Map())
  const directoryAgentsByPrincipal = useMemo(() => {
    if (agentDrafts.size === 0) return agentsByPrincipal
    const merged = new Map(agentsByPrincipal)
    for (const [principalId, draft] of agentDrafts) {
      const existing = merged.get(principalId)
      merged.set(principalId, {
        id: existing?.id,
        name: draft.name,
        avatarColor: draft.avatarColor ?? existing?.avatarColor,
        avatarShape: draft.avatarShape ?? existing?.avatarShape,
      })
    }
    return merged
  }, [agentsByPrincipal, agentDrafts])
  useEffect(() => {
    if (showcase) {
      queueMicrotask(() => setAgentsByPrincipal(isAgentShowcase ? new Map([[SHOWCASE_AGENT_PRINCIPAL_ID, {
        name: SHOWCASE_AGENT_IDENTITY.name,
        avatarColor: SHOWCASE_AGENT_IDENTITY.avatarColor,
        avatarShape: SHOWCASE_AGENT_IDENTITY.avatarShape,
      }]]) : new Map()))
      return
    }
    if (!activeWorkspaceId) {
      queueMicrotask(() => {
        setAgentsByPrincipal(new Map())
        setAgentDrafts(new Map())
      })
      return
    }
    let cancelled = false
    const load = () => {
      overlayAppClient.agents.list(activeWorkspaceId).then((response) => {
        if (cancelled) return
        setAgentsByPrincipal(new Map(response.agents.map((agent) => [agent.principalId, {
          id: agent.id,
          name: agent.name,
          avatarColor: agent.avatarColor,
          avatarShape: agent.avatarShape,
        }])))
      }).catch(() => undefined)
    }
    load()
    // Renames and avatar changes save through the editor and dispatch this
    // event; refetching keeps the header and message identity in sync without
    // a reload.
    window.addEventListener(AGENT_DIRECTORY_CHANGED_EVENT, load)
    const onDraftPreview = (event: Event) => {
      const detail = (event as CustomEvent<AgentDraftPreviewEventDetail>).detail
      if (!detail?.principalId || detail.workspaceId !== activeWorkspaceId) return
      setAgentDrafts((current) => {
        const next = new Map(current)
        if (detail.patch) next.set(detail.principalId!, detail.patch)
        else next.delete(detail.principalId!)
        return next
      })
    }
    window.addEventListener(AGENT_DRAFT_PREVIEW_EVENT, onDraftPreview)
    return () => {
      cancelled = true
      window.removeEventListener(AGENT_DIRECTORY_CHANGED_EVENT, load)
      window.removeEventListener(AGENT_DRAFT_PREVIEW_EVENT, onDraftPreview)
    }
  }, [activeWorkspaceId, showcase, conversationId, isAgentShowcase])
  return directoryAgentsByPrincipal
}

export function useAgentDesktop({
  showcase,
  computersEnabled,
  activeWorkspaceId,
  headerAgentId,
}: {
  showcase: boolean
  computersEnabled: boolean | undefined
  activeWorkspaceId: string | null | undefined
  headerAgentId: string | undefined
}) {
  // The bound computer behind a one-to-one agent DM — surfaced as a subtle
  // "Desktop" affordance in the header (Grokbot-style) when one is usable.
  const [agentComputer, setAgentComputer] = useState<Computer | null>(null)
  const [desktopOpenBusy, setDesktopOpenBusy] = useState(false)
  useEffect(() => {
    if (showcase || !computersEnabled || !activeWorkspaceId || !headerAgentId) {
      queueMicrotask(() => setAgentComputer(null))
      return
    }
    let cancelled = false
    void overlayAppClient.computers.list(activeWorkspaceId).then((result) => {
      if (cancelled) return
      setAgentComputer(result.computers.find(
        (computer) => computer.ownerType === 'agent' && computer.ownerId === headerAgentId,
      ) ?? null)
    }, () => undefined)
    return () => { cancelled = true }
  }, [showcase, computersEnabled, activeWorkspaceId, headerAgentId])
  const openAgentDesktop = useCallback(() => {
    if (!activeWorkspaceId || !agentComputer || desktopOpenBusy) return
    setDesktopOpenBusy(true)
    void overlayAppClient.computers.openDesktop(activeWorkspaceId, agentComputer.id)
      .then((ticket) => {
        if (ticket.url) window.open(ticket.url, '_blank', 'noopener')
      })
      .catch(() => undefined)
      .finally(() => setDesktopOpenBusy(false))
  }, [activeWorkspaceId, agentComputer, desktopOpenBusy])
  return { agentComputer, desktopOpenBusy, openAgentDesktop }
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
        icon: 'UsersRound',
      }))
    return items.length ? [{ type: 'person', label: 'Members', icon: 'UsersRound', items }] : []
  }, [currentPrincipalId, participants])

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
  draft,
  showcase,
  title,
  messages,
  messagesRef,
}: {
  conversationId: string
  conversationType: 'dm' | 'channel'
  draft: boolean
  showcase: boolean
  title: string
  messages: OptimisticMessage[]
  messagesRef: RefObject<OptimisticMessage[]>
}) {
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
    if (!draft || draftCommittedRef.current || showcase || messagesRef.current.length > 0) return
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
  }, [conversationId, draft, messagesRef, showcase])

  useEffect(() => {
    if (draft && messages.some((message) => !message.id.startsWith('optimistic_'))) {
      commitDraftConversation()
    }
  }, [commitDraftConversation, draft, messages])

  return commitDraftConversation
}

export function useSendMessage({
  showcase,
  currentPrincipalId,
  setMessages,
  conversationId,
  participants,
  conversationType,
  loading,
  conversationTitle,
  soloAgentParticipant,
  memoryEnabled,
  convexRoomSubscriptionEnabled,
  loadMessages,
  commitDraftConversation,
  setAgentResponding,
  messages,
  mentions,
}: {
  showcase: boolean
  currentPrincipalId: string
  setMessages: Dispatch<SetStateAction<OptimisticMessage[]>>
  conversationId: string
  participants: ConversationParticipant[]
  conversationType: 'dm' | 'channel'
  loading: boolean
  conversationTitle: string | null
  soloAgentParticipant: ConversationParticipant | null
  memoryEnabled: boolean
  convexRoomSubscriptionEnabled: boolean
  loadMessages: () => Promise<void>
  commitDraftConversation: () => void
  setAgentResponding: Dispatch<SetStateAction<string | null>>
  messages: OptimisticMessage[]
  mentions: MentionItem[]
}) {
  const threadRenameRequestedRef = useRef(false)
  const pendingCollaborationMessageSentRef = useRef(false)

  // A pending reply row goes once the agent's real reply row exists (or after a minute, so none can linger).
  useEffect(() => {
    const pending = messages.filter((message) => message.id.startsWith(PENDING_AGENT_REPLY_PREFIX))
    if (!pending.length) return
    const settled = pending.filter((placeholder) => messages.some((message) => (
      !message.id.startsWith(PENDING_AGENT_REPLY_PREFIX)
      && message.authorKind === 'agent'
      && message.authorPrincipalId === placeholder.authorPrincipalId
      && message.createdAt >= (placeholder.updatedAt ?? placeholder.createdAt) - 2_000
    )))
    const drop = (ids: Set<string>) => setMessages((current) => current.filter((message) => !ids.has(message.id)))
    if (settled.length) drop(new Set(settled.map((message) => message.id)))
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

  async function sendMessage(
    content: string,
    options?: {
      existing?: Pick<OptimisticMessage, 'clientNonce' | 'turnId' | 'createdAt' | 'parts'>
      threadRootMessageId?: string
      parts?: RoomMessageRecord['parts']
      attachmentNames?: string[]
      reply?: { replyToTurnId?: string; snippet: string } | null
    },
  ) {
    const text = content.trim()
    const parts = options?.parts ?? options?.existing?.parts
    if (!text && !parts?.length) return
    const clientNonce = options?.existing?.clientNonce ?? crypto.randomUUID()
    const turnId = options?.existing?.turnId ?? `human_${crypto.randomUUID()}`
    const optimisticId = `optimistic_${clientNonce}`
    const threadRootMessageId = options?.threadRootMessageId
    if (showcase) {
    setMessages((current) => [...current, {
        id: optimisticId,
        turnId,
        authorKind: 'human',
        authorPrincipalId: currentPrincipalId,
        content: text,
        parts,
        createdAt: options?.existing?.createdAt ?? Date.now(),
        clientNonce,
        threadRootMessageId,
      } satisfies OptimisticMessage].sort(compareRoomMessageRecords))
      return
    }
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
      const mentionedPrincipalIds = resolveMentionTargets(text)
      // One-to-one agent threads take their title from the first human message,
      // matching personal chats. Only placeholder titles are replaced — never a
      // custom name — and the ref stops racing sends from double-renaming.
      const renameAgentThread = soloAgentParticipant
        && !loading
        && text.length > 0
        && !threadRenameRequestedRef.current
        && (conversationTitle === 'New thread' || conversationTitle === soloAgentParticipant.displayName)
      const agentParticipants = participants.filter((participant) => participant.principalType === 'agent')
      const humanParticipants = participants.filter((participant) => participant.principalType === 'human')
      const threadAgentId = threadRootMessageId
        ? messages.find((message) => message.id === threadRootMessageId && message.authorKind === 'agent')?.authorPrincipalId
        : undefined
      const mentionedPrincipalIdSet = new Set(mentionedPrincipalIds)
      const invokedAgents = agentParticipants.filter((participant) => (
        (conversationType === 'dm' && agentParticipants.length === 1 && humanParticipants.length === 1)
        || mentionedPrincipalIdSet.has(participant.principalId)
        || threadAgentId === participant.principalId
      ))
      if (invokedAgents.length) {
        setAgentResponding(invokedAgents.length === 1 ? invokedAgents[0]!.displayName : 'Agents')
        // Show each invoked agent's avatar with its loading dots at once; the real row replaces it when the server creates it.
        const pendingAt = Date.now()
        setMessages((current) => [
          ...current.filter((message) => !message.id.startsWith(`${PENDING_AGENT_REPLY_PREFIX}${clientNonce}`)),
          ...invokedAgents.map((agent) => ({
            id: `${PENDING_AGENT_REPLY_PREFIX}${clientNonce}_${agent.principalId}`,
            turnId: `${PENDING_AGENT_REPLY_PREFIX}${clientNonce}_${agent.principalId}`,
            authorKind: 'agent' as const,
            authorPrincipalId: agent.principalId,
            content: '',
            // Sorts after the message it answers even once that message takes the server's (possibly later) timestamp;
            // the real send time is kept in updatedAt for matching the real reply.
            createdAt: pendingAt + PENDING_AGENT_REPLY_SORT_LEAD_MS,
            updatedAt: pendingAt,
            status: 'generating' as const,
            threadRootMessageId,
          } satisfies OptimisticMessage)),
        ].sort(compareRoomMessageRecords))
      }
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
      if (renameAgentThread && soloAgentParticipant) {
        threadRenameRequestedRef.current = true
        const agentName = soloAgentParticipant.displayName
        void generateTitle(text).then(async (aiTitle) => {
          if (!aiTitle) {
            threadRenameRequestedRef.current = false
            return
          }
          const title = sanitizeChatTitle(aiTitle, agentName)
          try {
            const res = await overlayAppClient.conversations.updateResponse({ conversationId, title })
            if (res.ok) dispatchChatTitleUpdated({ chatId: conversationId, title })
            else threadRenameRequestedRef.current = false
          } catch {
            // Keep the placeholder thread title.
            threadRenameRequestedRef.current = false
          }
        })
      }
      if (!convexRoomSubscriptionEnabled) await loadMessages()
      commitDraftConversation()
      void saved
    } catch {
      setMessages((current) => current
        .filter((message) => !message.id.startsWith(`${PENDING_AGENT_REPLY_PREFIX}${clientNonce}`))
        .map((message) => (
          message.clientNonce === clientNonce ? { ...message, delivery: 'failed' } : message
        )))
    } finally {
      setAgentResponding(null)
    }
  }

  useEffect(() => {
    if (showcase || !currentPrincipalId || pendingCollaborationMessageSentRef.current) return
    const pending = takePendingCollaborationMessage(conversationId)
    if (!pending) return
    pendingCollaborationMessageSentRef.current = true
    void sendMessage(pending.content)
  // `sendMessage` is intentionally omitted: it is recreated while room state
  // changes, whereas a pending conversion must be consumed exactly once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, currentPrincipalId, showcase])

  return sendMessage
}

export function useRoomComposer({
  showcase,
  activeWorkspaceId,
  conversationId,
  sessionIdRef,
  sendMessage,
  mentions,
  setMentions,
  readOnly = false,
}: {
  showcase: boolean
  activeWorkspaceId: string | null | undefined
  conversationId: string
  sessionIdRef: RefObject<string | null>
  sendMessage: (content: string, options?: {
    existing?: Pick<OptimisticMessage, 'clientNonce' | 'turnId' | 'createdAt' | 'parts'>
    threadRootMessageId?: string
    parts?: RoomMessageRecord['parts']
    attachmentNames?: string[]
    reply?: { replyToTurnId?: string; snippet: string } | null
  }) => Promise<void>
  mentions: MentionItem[]
  setMentions: Dispatch<SetStateAction<MentionItem[]>>
  /** Surface-mirrored rooms accept no uploads. */
  readOnly?: boolean
}) {
  // ── composer state (identical wiring to the personal chat composer) ─────────
  const [composerNotice, setComposerNotice] = useState<string | null>(null)
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
  const {
    handleComposerInputChange,
    hasComposerText,
    input,
    inputRef,
    inputRevision,
    setInput,
  } = useComposerTextState()
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
  } = useChatAttachments({ setComposerNotice })

  // Restore a half-written message when the room reopens. Storage failures are
  // absorbed by the draft module, so private browsing simply starts empty.
  useEffect(() => {
    if (showcase) return
    queueMicrotask(() => setInput(readDraft({ workspaceId: activeWorkspaceId, conversationId })))
  }, [activeWorkspaceId, conversationId, setInput, showcase])

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
    const text = (inputRef.current ?? input).trim()
    const readyDocuments = pendingChatDocuments.filter((document) => document.status === 'ready')
    if (pendingChatDocuments.some((document) => document.status === 'uploading')) {
      setComposerNotice('Attachments are still uploading.')
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

    setInput('')
    composerRef.current?.clear()
    setMentions([])
    setAttachedImages([])
    setPendingChatDocuments([])
    setAttachmentError(null)
    setComposerNotice(null)
    setReplyContext(null)
    clearDraft({ workspaceId: activeWorkspaceId, conversationId })

    await sendMessage(`${text}${documentMarker}`, {
      existing: { turnId, clientNonce: crypto.randomUUID(), createdAt: Date.now(), parts: payload.partsForModel },
      parts: payload.partsForModel,
      attachmentNames: payload.indexedFileNames,
      ...(replyContext ? { reply: { replyToTurnId: replyContext.replyToTurnId, snippet: replySnippet ?? '' } } : {}),
    })
  }

  function onComposerInput(text: string) {
    handleComposerInputChange(text)
    if (showcase) return
    writeDraft({ workspaceId: activeWorkspaceId, conversationId }, text)
    const now = Date.now()
    if (now - lastTypingSentAt.current > 2_500) {
      lastTypingSentAt.current = now
      void overlayAppClient.conversations.updatePresence(conversationId, {
        status: 'online',
        typing: Boolean(text.trim()),
        sessionId: sessionIdRef.current ?? undefined,
      }).catch(() => undefined)
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
    composerNotice,
    setComposerNotice,
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
  loadMessages,
  setAttachmentError,
}: {
  activeWorkspaceId: string | null | undefined
  conversationId: string
  loadMessages: () => Promise<void>
  setAttachmentError: Dispatch<SetStateAction<string | null>>
}) {
  async function controlRemoteQueue(runId: string, action: 'cancel' | 'retry' | 'resume' | 'start_fresh') {
    if (!activeWorkspaceId) return
    try {
      await overlayAppClient.conversations.controlRemoteQueue({
        workspaceId: activeWorkspaceId,
        conversationId,
        runId,
        action,
      })
      await loadMessages()
    } catch (value) {
      setAttachmentError(value instanceof Error ? value.message : 'Could not update the connected agent run.')
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
      await loadMessages()
    } catch (value) {
      setAttachmentError(value instanceof Error ? value.message : 'Could not resolve the connected agent request.')
    }
  }

  async function stopAgentResponse(messageId: string) {
    try {
      await overlayAppClient.conversations.stopResponse({ conversationId, messageId })
    } catch {
      // The run may have already finished; the live row refresh settles either way.
    }
    await loadMessages().catch(() => undefined)
  }

  return { controlRemoteQueue, resolveRemoteRequest, stopAgentResponse }
}

export function useMessageActions({
  conversationId,
  currentPrincipalId,
  showcase,
  reactions,
  setReactions,
  pins,
  setPins,
  savedMessages,
  setSavedMessages,
  setMessages,
  loadMessages,
  setNotice,
}: {
  conversationId: string
  currentPrincipalId: string
  showcase: boolean
  reactions: MessageReaction[]
  setReactions: Dispatch<SetStateAction<MessageReaction[]>>
  pins: ConversationPin[]
  setPins: Dispatch<SetStateAction<ConversationPin[]>>
  savedMessages: ConversationSavedMessage[]
  setSavedMessages: Dispatch<SetStateAction<ConversationSavedMessage[]>>
  setMessages: Dispatch<SetStateAction<OptimisticMessage[]>>
  loadMessages: () => Promise<void>
  setNotice: Dispatch<SetStateAction<string | null>>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')

  async function copyMessagePermalink(messageId: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('message', messageId)
    try {
      await navigator.clipboard.writeText(url.toString())
      setNotice('Message link copied.')
    } catch {
      setNotice('Could not copy the message link.')
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    const current = reactions.find((reaction) => reaction.messageId === messageId && reaction.emoji === emoji)
    if (showcase) {
      setReactions((rows) => current
        ? rows.map((row) => row === current ? { ...row, count: Math.max(0, row.count + (row.reactedByCurrentPrincipal ? -1 : 1)), reactedByCurrentPrincipal: !row.reactedByCurrentPrincipal } : row)
        : [...rows, { conversationId, messageId, emoji, principalIds: [currentPrincipalId], count: 1, reactedByCurrentPrincipal: true }])
      return
    }
    const result = await overlayAppClient.conversations.setReaction(conversationId, {
      messageId,
      emoji,
      enabled: !current?.reactedByCurrentPrincipal,
    })
    setReactions(requireArray(result.reactions, 'Conversation reactions'))
  }

  async function togglePinned(messageId: string) {
    const pinned = pins.some((pin) => pin.messageId === messageId)
    if (showcase) {
      setPins((rows) => pinned ? rows.filter((row) => row.messageId !== messageId) : [...rows, { conversationId, messageId, pinnedByPrincipalId: currentPrincipalId, createdAt: Date.now() }])
      return
    }
    await overlayAppClient.conversations.setPinned(conversationId, { messageId, pinned: !pinned })
    const result = await overlayAppClient.conversations.pins(conversationId)
    setPins(requireArray(result.pins, 'Conversation pins'))
  }

  /**
   * Reporting records an audit event and tells the reporter it was received.
   * Nothing in the room changes; review policy arrives with enterprise
   * moderation.
   */
  async function reportMessage(messageId: string) {
    if (showcase) return
    try {
      await overlayAppClient.conversations.reportMessage(conversationId, {
        messageId,
        reason: 'other',
      })
      setNotice('Report sent to the workspace owners.')
    } catch {
      setNotice('Could not send the report.')
    }
  }

  async function toggleSaved(messageId: string) {
    const saved = savedMessages.some((row) => row.conversationId === conversationId && row.messageId === messageId)
    if (showcase) {
      setSavedMessages((rows) => saved ? rows.filter((row) => row.messageId !== messageId) : [...rows, { conversationId, messageId, principalId: currentPrincipalId, createdAt: Date.now() }])
      return
    }
    await overlayAppClient.conversations.setSaved({ conversationId, messageId, saved: !saved })
    const result = await overlayAppClient.conversations.savedMessages()
    setSavedMessages(requireArray(result.savedMessages, 'Saved messages'))
  }

  async function saveEdit(messageId: string) {
    const content = editingContent.trim()
    if (!content) return
    if (showcase) {
      setMessages((current) => current.map((message) => (
        message.id === messageId ? { ...message, content, editedAt: Date.now() } : message
      )))
      setEditingId(null)
      return
    }
    await overlayAppClient.conversations.editCollaborativeMessage(conversationId, messageId, content)
    setEditingId(null)
    await loadMessages()
  }

  async function deleteMessage(messageId: string) {
    if (showcase) {
      setMessages((current) => current.map((message) => (
        message.id === messageId ? { ...message, deletedAt: Date.now(), content: '' } : message
      )))
      return
    }
    await overlayAppClient.conversations.deleteCollaborativeMessage(conversationId, messageId)
    await loadMessages()
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
    saveEdit,
    deleteMessage,
  }
}

export function useMessageNavigation({
  listRef,
  messagesRef,
  setStickToBottom,
  markVisibleRead,
  setNewMessageCount,
  setThreadRootId,
  setRoomPanel,
  messageCount,
}: {
  listRef: RefObject<HTMLDivElement | null>
  messagesRef: RefObject<OptimisticMessage[]>
  setStickToBottom: Dispatch<SetStateAction<boolean>>
  markVisibleRead: () => Promise<void>
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
    setStickToBottom(true)
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
    setNewMessageCount(0)
    void markVisibleRead()
  }, [listRef, markVisibleRead, setNewMessageCount, setStickToBottom])

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
  showcase,
  title,
  activeWorkspaceId,
  router,
  otherParticipantsCount,
  currentParticipantArchived,
  loadParticipants,
  setNotice,
  setMenuOpen,
}: {
  conversationId: string
  conversationType: 'dm' | 'channel'
  showcase: boolean
  title: string
  activeWorkspaceId: string | null | undefined
  router: ReturnType<typeof useRouter>
  otherParticipantsCount: number
  currentParticipantArchived: boolean
  loadParticipants: () => Promise<void>
  setNotice: Dispatch<SetStateAction<string | null>>
  setMenuOpen: Dispatch<SetStateAction<boolean>>
}) {
  const [pendingArchiveScope, setPendingArchiveScope] = useState(false)
  const [scopeDialogBusy, setScopeDialogBusy] = useState(false)
  const [scopeDialogError, setScopeDialogError] = useState<string | null>(null)
  const [pendingDeleteScope, setPendingDeleteScope] = useState(false)

  async function updateState(
    state: Parameters<typeof overlayAppClient.conversations.updateParticipantState>[1],
    confirmation: string,
  ) {
    if (showcase) {
      setNotice(confirmation)
      setMenuOpen(false)
      return
    }
    await overlayAppClient.conversations.updateParticipantState(conversationId, state)
    setNotice(confirmation)
    setMenuOpen(false)
    await loadParticipants()
  }

  async function archiveConversation(scope: 'self' | 'everyone') {
    if (showcase) {
      setNotice('Conversation archived')
      setMenuOpen(false)
      setPendingArchiveScope(false)
      return
    }
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
      setPendingArchiveScope(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversation could not be archived'
      if (pendingArchiveScope) setScopeDialogError(message)
      else setNotice(message)
    } finally {
      setScopeDialogBusy(false)
    }
  }

  function archiveMenuAction() {
    setMenuOpen(false)
    if (currentParticipantArchived) {
      void updateState({ archived: false }, 'Conversation restored').then(() => {
        const view = conversationType === 'channel' ? 'channels' : 'dms'
        const chatBase = activeWorkspaceId
          ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
          : '/app/chat'
        router.push(`${chatBase}?${new URLSearchParams({ view, id: conversationId }).toString()}`)
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
      const chatBase = activeWorkspaceId
        ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
        : '/app/chat'
      router.push(`${chatBase}?${new URLSearchParams({ view }).toString()}`)
    } catch (error) {
      setScopeDialogError(error instanceof Error ? error.message : 'Conversation could not be deleted')
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
  parts?: RoomMessageRecord['parts']
  attachmentNames?: string[]
  reply?: { replyToTurnId?: string; snippet: string } | null
}) => Promise<void>

export function buildRoomMessageContext({
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
  showcase,
  conversationType,
  draft,
  draftTitle,
  router,
  activeWorkspaceId,
  convexRoomSubscriptionEnabled,
  refreshNotifications,
  computersEnabled,
  onOpenAttachmentPreview,
}: {
  conversationId: string
  showcase: boolean
  conversationType: 'dm' | 'channel'
  draft: boolean
  draftTitle: string | undefined
  router: ReturnType<typeof useRouter>
  activeWorkspaceId: string | null | undefined
  convexRoomSubscriptionEnabled: boolean
  refreshNotifications: () => void
  computersEnabled: boolean
  onOpenAttachmentPreview: RoomMessageContext['onOpenAttachmentPreview']
}) {
  const isAgentShowcase = showcase && conversationId === SHOWCASE_AGENT_CONVERSATION_ID
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const [roomPanel, setRoomPanel] = useState<RoomPanelKind | null>(null)
  const [addPeopleOpen, setAddPeopleOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [agentResponding, setAgentResponding] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [memoryEnabled, setMemoryEnabled] = useState(() =>
    defaultMemoryEnabled({ temporary: false }),
  )
  const [mentions, setMentions] = useState<MentionItem[]>([])

  const readMarkers = useReadMarkers({ conversationId, showcase, refreshNotifications })
  const roster = useRoomRoster({
    conversationId,
    showcase,
    isAgentShowcase,
    noteParticipantsLoaded: readMarkers.noteParticipantsLoaded,
  })
  const collab = useRoomCollaboration({ conversationId, conversationType, showcase })
  const thread = useThreadPanel({ conversationId, showcase, setRoomPanel })
  const transcript = useRoomTranscript({
    conversationId,
    threadRootId: thread.threadRootId,
    showcase,
    isAgentShowcase,
    agentResponding,
    setNotice,
    markVisibleRead: readMarkers.markVisibleRead,
    setNewMessageCount: readMarkers.setNewMessageCount,
  })
  const sessionIdRef = useRoomLifecycle({
    conversationId,
    convexRoomSubscriptionEnabled,
    showcase,
    loadParticipants: roster.loadParticipants,
    loadMessages: transcript.loadMessages,
    loadCollaboration: collab.loadCollaboration,
    loadPresence: roster.loadPresence,
    setLoading: transcript.setLoading,
  })
  const directoryAgentsByPrincipal = useAgentDirectory({
    activeWorkspaceId,
    showcase,
    conversationId,
    isAgentShowcase,
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
  const desktop = useAgentDesktop({
    showcase,
    computersEnabled,
    activeWorkspaceId,
    headerAgentId: vm.headerAgent?.id,
  })
  const commitDraftConversation = useDraftConversation({
    conversationId,
    conversationType,
    draft,
    showcase,
    title: vm.title,
    messages: transcript.messages,
    messagesRef: transcript.messagesRef,
  })
  const sendMessage = useSendMessage({
    showcase,
    currentPrincipalId: roster.currentPrincipalId,
    setMessages: transcript.setMessages,
    conversationId,
    participants: roster.participants,
    conversationType,
    loading: transcript.loading,
    conversationTitle: transcript.conversationTitle,
    soloAgentParticipant: vm.soloAgentParticipant,
    memoryEnabled,
    convexRoomSubscriptionEnabled,
    loadMessages: transcript.loadMessages,
    commitDraftConversation,
    setAgentResponding,
    messages: transcript.messages,
    mentions,
  })
  const composer = useRoomComposer({
    showcase,
    activeWorkspaceId,
    conversationId,
    sessionIdRef,
    sendMessage,
    mentions,
    setMentions,
    readOnly: Boolean(transcript.surfacePlatform),
  })
  const remoteControls = useRemoteAgentControls({
    activeWorkspaceId,
    conversationId,
    loadMessages: transcript.loadMessages,
    setAttachmentError: composer.setAttachmentError,
  })
  const actions = useMessageActions({
    conversationId,
    currentPrincipalId: roster.currentPrincipalId,
    showcase,
    reactions: collab.reactions,
    setReactions: collab.setReactions,
    pins: collab.pins,
    setPins: collab.setPins,
    savedMessages: collab.savedMessages,
    setSavedMessages: collab.setSavedMessages,
    setMessages: transcript.setMessages,
    loadMessages: transcript.loadMessages,
    setNotice,
  })
  const navigation = useMessageNavigation({
    listRef: transcript.listRef,
    messagesRef: transcript.messagesRef,
    setStickToBottom: transcript.setStickToBottom,
    markVisibleRead: readMarkers.markVisibleRead,
    setNewMessageCount: readMarkers.setNewMessageCount,
    setThreadRootId: thread.setThreadRootId,
    setRoomPanel,
    messageCount: transcript.messages.length,
  })
  const roomActions = useRoomActions({
    conversationId,
    conversationType,
    showcase,
    title: vm.title,
    activeWorkspaceId,
    router,
    otherParticipantsCount: vm.otherParticipants.length,
    currentParticipantArchived: Boolean(vm.currentParticipant?.archivedAt),
    loadParticipants: roster.loadParticipants,
    setNotice,
    setMenuOpen,
  })
  const messageCtx = buildRoomMessageContext({
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
    isAgentShowcase,
    menuOpen,
    setMenuOpen,
    menuTriggerRef,
    roomPanel,
    setRoomPanel,
    addPeopleOpen,
    setAddPeopleOpen,
    notice,
    setNotice,
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
    desktop,
    sendMessage,
    composer,
    remoteControls,
    actions,
    navigation,
    roomActions,
    messageCtx,
  }
}

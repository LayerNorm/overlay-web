'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Archive,
  Bell,
  BellOff,
  Bot,
  Hash,
  MoreHorizontal,
  Paperclip,
  Pin,
  Share2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { FloatingMenu, MenuItem } from '@overlay/ui/primitives'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { AttachmentPreviewDialog } from '@overlay/chat-react'
import type {
  ChannelSummary,
  ConversationPin,
  ConversationParticipant,
  ConversationPresence,
  ConversationSavedMessage,
  MessageReaction,
} from '@overlay/workspace-contracts'
import type { AttachmentPreview } from '@overlay/chat-react'
import type { MentionCategory, MentionItem } from '@/shared/knowledge/mention-types'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { NewDirectMessageDialog } from './NewDirectMessageDialog'
import { ShareDialog } from '@/components/share/ShareDialog'
import { AttachResourceDialog } from '@/components/share/AttachResourceDialog'
import { resolveMentionedPrincipalIds } from '@/shared/mentions/principal-mentions'
import { clearDraft, readDraft, writeDraft } from '@/shared/chat/conversation-drafts'
import { dispatchChatArchived } from '@/shared/chat/chat-title'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { buildWorkspaceHref } from '@/features/workspaces/lib/workspace-routing'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useConvexAuthToken } from '@/components/providers/ConvexAuthProvider'
import { useAuth } from '@/contexts/AuthContext'
import { ChatComposer } from './ChatComposer'
import { ChatDropOverlay } from './ChatDropOverlay'
import { useChatAttachments } from './useChatAttachments'
import { useComposerTextState } from './chat/useComposerTextState'
import { useChatPanels } from './chat/useChatPanels'
import { useChatShellPanels } from './chat/useChatShellPanels'
import { buildTextTurnPayload } from './chat/chat-send-body-builders'
import { usePostgresConversationEvents } from './chat/usePostgresConversationEvents'
import { RoomMessageItem, roomMessageDomId } from './collaboration/RoomMessageItem'
import { ConversationScopeActionDialog } from './collaboration/ConversationScopeActionDialog'
import { ConvexRoomMessageSubscription } from './collaboration/ConvexRoomMessageSubscription'
import { useCollaborationRealtime } from './collaboration/CollaborationRealtimeProvider'
import { useQuery } from '@/components/providers/convex-hooks'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { takePendingCollaborationMessage } from '../lib/pending-collaboration-message'
import {
  compareRoomMessageRecords,
  mergeRoomMessages,
  toRoomMessageView,
  type RoomMessageRecord,
} from './collaboration/room-message-view'
import {
  RoomPeoplePanel,
  RoomPinnedPanel,
  RoomThreadPanel,
  type RoomPanelKind,
} from './collaboration/RoomSidePanels'

const FileViewerPanel = dynamic(
  () => import('@overlay/modules-react/knowledge').then((mod) => ({ default: mod.FileViewerPanel })),
  { loading: () => null },
)

type OptimisticMessage = RoomMessageRecord

const SHOWCASE_CONVERSATION_ID = 'showcase-dm'
const SHOWCASE_WORKSPACE_ID = 'showcase-acme'
const SHOWCASE_CURRENT_PRINCIPAL_ID = 'showcase-divyansh'
const SHOWCASE_PARTICIPANTS: ConversationParticipant[] = [
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
const SHOWCASE_PRESENCE: ConversationPresence[] = SHOWCASE_PARTICIPANTS.map((participant, index) => ({
  workspaceId: SHOWCASE_WORKSPACE_ID,
  principalId: participant.principalId,
  conversationId: SHOWCASE_CONVERSATION_ID,
  status: index < 2 ? 'online' : 'away',
  typing: false,
  lastSeenAt: Date.parse('2026-07-29T18:10:00.000Z') - index * 60_000,
}))
const SHOWCASE_MESSAGES: OptimisticMessage[] = [
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

function roomDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function roomDayLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function requireArray<T>(value: T[] | undefined, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} returned an invalid response`)
  return value
}

export function DirectMessageExperience({
  conversationId,
  showcase = false,
  conversationType = 'dm',
}: {
  conversationId: string
  showcase?: boolean
  conversationType?: 'dm' | 'channel'
}) {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace()
  const { appDataCapabilities, capabilities } = useOverlayCapabilities()
  const { user: authUser } = useAuth()
  const convexAccessToken = useConvexAuthToken()
  const { refreshNotifications } = useCollaborationRealtime()
  const convexLiveSyncEnabled = !showcase
    && appDataCapabilities.provider === 'convex'
    && appDataCapabilities.requiresConvexClient
    && appDataCapabilities.supportsRealtime
  const convexRoomSubscriptionEnabled = convexLiveSyncEnabled
    && Boolean(authUser?.id && convexAccessToken && activeWorkspaceId)
  // Convex uses its native WebSocket subscription exclusively. The BFF event
  // stream is a Postgres-only fallback; running both caused a request fan-out.
  const roomEventSyncEnabled = !showcase
    && appDataCapabilities.supportsRealtime
    && appDataCapabilities.provider === 'postgres'
  const router = useRouter()
  const [participants, setParticipants] = useState<ConversationParticipant[]>(
    showcase ? SHOWCASE_PARTICIPANTS : [],
  )
  const [currentPrincipalId, setCurrentPrincipalId] = useState(
    showcase ? SHOWCASE_CURRENT_PRINCIPAL_ID : '',
  )
  const [presence, setPresence] = useState<ConversationPresence[]>(
    showcase ? SHOWCASE_PRESENCE : [],
  )
  const [messages, setMessages] = useState<OptimisticMessage[]>(
    showcase ? SHOWCASE_MESSAGES : [],
  )
  const [loading, setLoading] = useState(!showcase)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const [roomPanel, setRoomPanel] = useState<RoomPanelKind | null>(null)
  const [addPeopleOpen, setAddPeopleOpen] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingArchiveScope, setPendingArchiveScope] = useState(false)
  const [scopeDialogBusy, setScopeDialogBusy] = useState(false)
  const [scopeDialogError, setScopeDialogError] = useState<string | null>(null)
  const [pendingDeleteScope, setPendingDeleteScope] = useState(false)
  const [unreadBoundarySequence, setUnreadBoundarySequence] = useState<number | null>(null)
  const [newMessageCount, setNewMessageCount] = useState(0)
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
  const [conversationTitle, setConversationTitle] = useState<string | null>(null)
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
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const [threadFollowing, setThreadFollowing] = useState(false)
  const [threadInput, setThreadInput] = useState('')
  const [agentResponding, setAgentResponding] = useState<string | null>(null)
  /** Live agent text keyed by principal, replaced by the stored row once saved. */
  const [streamingAgentReplies, setStreamingAgentReplies] = useState<Record<string, {
    principalId: string
    name: string
    text: string
    threadRootMessageId?: string
  }>>({})
  const streamingAgentTextLength = Object.values(streamingAgentReplies)
    .reduce((length, reply) => length + reply.text.length, 0)
  const [shareOpen, setShareOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  /** Latest messages for callbacks that must not close over a stale render. */
  const messagesRef = useRef<OptimisticMessage[]>(messages)
  messagesRef.current = messages
  const sessionIdRef = useRef<string | null>(null)
  const activeConversationRef = useRef<string | null>(conversationId)
  const stickToBottomRef = useRef(true)
  const unreadBoundaryInitializedRef = useRef(false)
  const previousMessageCountRef = useRef(messages.length)
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null)
  const skipNextMessageGrowthRef = useRef(false)
  const permalinkJumpedRef = useRef<string | null>(null)
  const readMarkInFlightRef = useRef(false)
  activeConversationRef.current = conversationId
  const lastTypingSentAt = useRef(0)
  const pendingCollaborationMessageSentRef = useRef(false)

  // ── composer state (identical wiring to the personal chat composer) ─────────
  const [composerNotice, setComposerNotice] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [mentions, setMentions] = useState<MentionItem[]>([])
  const [replyContext, setReplyContext] = useState<
    { snippet: string; bodyForModel: string; replyToTurnId?: string } | null
  >(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<import('./chat-interface/MentionInput').MentionInputHandle>(null)
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
  const {
    attachmentPreview,
    attachmentPreviewMode,
    closeAttachmentPreview,
    closeSourcesPanel,
    openAttachmentPreview,
    openFilePreview,
    panelPresentation,
    setPanelPresentation,
    setAttachmentPreviewMode,
    sourcesPanel,
  } = useChatPanels()

  const loadParticipants = useCallback(async () => {
    const result = await overlayAppClient.conversations.participants(conversationId)
    const nextParticipants = requireArray(result.participants, 'Conversation participants')
    if (typeof result.currentPrincipalId !== 'string' || !result.currentPrincipalId) {
      throw new Error('Conversation participants returned an invalid principal')
    }
    setParticipants(nextParticipants)
    setCurrentPrincipalId(result.currentPrincipalId)
    if (!unreadBoundaryInitializedRef.current) {
      unreadBoundaryInitializedRef.current = true
      const current = nextParticipants.find((participant) => participant.principalId === result.currentPrincipalId)
      setUnreadBoundarySequence(current?.lastReadSequence ?? null)
    }
  }, [conversationId])

  const loadMessages = useCallback(async () => {
    const permalinkMessageId = typeof window === 'undefined'
      ? undefined
      : new URLSearchParams(window.location.search).get('message')?.trim() || undefined
    const result = await overlayAppClient.conversations.get<{
      title?: string
      conversationType?: 'personal' | 'dm' | 'channel'
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
            parts?: Array<{ type?: string; text?: string; url?: string; mediaType?: string; fileName?: string }>
            createdAt: number
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
  }, [conversationId, hasMoreMessages, loadingOlderMessages, showcase])

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

  const loadPresence = useCallback(async () => {
    const result = await overlayAppClient.conversations.presence(conversationId)
    setPresence(requireArray(result.presence, 'Conversation presence'))
  }, [conversationId])

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

  const applyLiveRoomMessages = useCallback((liveMessages: RoomMessageRecord[]) => {
    setMessages((current) => mergeRoomMessages(liveMessages, current))
  }, [])

  usePostgresConversationEvents({
    activeChatIdRef: activeConversationRef,
    enabled: roomEventSyncEnabled,
    hasActiveLocalStream: () => Object.keys(streamingAgentReplies).length > 0,
    loadChats: async () => {},
    onRemoteStop: () => {},
    onEvents: (events) => {
      if (events.some((event) => event.conversationId === conversationId && (
        event.type === 'reaction.changed' || event.type === 'pin.changed'
      ))) {
        void loadCollaboration().catch(() => undefined)
      }
    },
    reloadActiveConversation: loadMessages,
  })

  useEffect(() => {
    setConversationTitle(null)
  }, [conversationId])

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
  }, [conversationId, convexRoomSubscriptionEnabled, loadCollaboration, loadMessages, loadParticipants, loadPresence, showcase])

  // Convex presence subscription: when realtime is available, presence updates
  // arrive via the subscription and the HTTP polling fallback is skipped.
  const convexPresenceArgs = convexRoomSubscriptionEnabled && authUser?.id && convexAccessToken && activeWorkspaceId
    ? {
        accessToken: convexAccessToken,
        actorUserId: authUser.id,
        conversationId: conversationId as Id<'conversations'>,
        workspaceId: activeWorkspaceId,
      }
    : 'skip'
  const convexPresence = useQuery(
    api.collaboration.directMessages.watchPresence,
    convexPresenceArgs,
  ) as { ok: boolean; presence: typeof presence } | undefined

  useEffect(() => {
    if (convexPresence?.ok && Array.isArray(convexPresence.presence)) {
      setPresence(convexPresence.presence as typeof presence)
    }
  }, [convexPresence])

  useEffect(() => {
    if (loading) return
    void markVisibleRead()
  }, [loading, markVisibleRead, messages.length])

  useEffect(() => {
    const previousCount = previousMessageCountRef.current
    if (messages.length > previousCount) {
      if (skipNextMessageGrowthRef.current) {
        skipNextMessageGrowthRef.current = false
      } else if (!stickToBottomRef.current && !loading) {
        setNewMessageCount((count) => count + (messages.length - previousCount))
      }
    }
    previousMessageCountRef.current = messages.length
  }, [loading, messages.length])

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
    if (!stickToBottomRef.current) return
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
  }, [agentResponding, conversationId, loading, messages.length, streamingAgentTextLength])

  // Restore a half-written message when the room reopens. Storage failures are
  // absorbed by the draft module, so private browsing simply starts empty.
  useEffect(() => {
    if (showcase) return
    setInput(readDraft({ workspaceId: activeWorkspaceId, conversationId }))
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

  const otherParticipants = participants.filter((participant) => participant.principalId !== currentPrincipalId)
  const title = conversationType === 'channel'
    ? channel?.name ?? 'Channel'
    : conversationTitle ?? (otherParticipants.map((participant) => participant.displayName).join(', ') || 'Direct message')
  const HeaderIcon = conversationType === 'channel'
    ? Hash
    : otherParticipants.length === 1 && otherParticipants[0]?.principalType === 'agent'
      ? Bot
      : otherParticipants.length <= 1
        ? UserRound
        : UsersRound
  const online = presence.filter((row) => (
    row.principalId !== currentPrincipalId && row.status === 'online'
  )).length
  const currentParticipant = participants.find((participant) => participant.principalId === currentPrincipalId)
  const mainMessages = messages.filter((message) => !message.threadRootMessageId)
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

  const participantMentions = useMemo(() => participants.map((participant) => ({
    type: participant.principalType === 'agent' ? 'person' : 'person',
    id: participant.principalId,
    name: participant.displayName,
  })), [participants])

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
  }, [])

  const jumpToLatest = useCallback(() => {
    const node = listRef.current
    if (!node) return
    stickToBottomRef.current = true
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
    setNewMessageCount(0)
    void markVisibleRead()
  }, [markVisibleRead])

  useEffect(() => {
    const target = typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('message')?.trim() || null
    if (!target || permalinkJumpedRef.current === target || !messagesRef.current.some((message) => message.id === target)) return
    permalinkJumpedRef.current = target
    jumpToMessage(target)
  }, [jumpToMessage, messages.length])

  useEffect(() => {
    if (!highlightedMessageId) return
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 2_000)
    return () => window.clearTimeout(timer)
  }, [highlightedMessageId])

  useEffect(() => {
    if (!threadRootId || showcase) {
      setThreadFollowing(false)
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
  }, [])

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
      const agentParticipants = participants.filter((participant) => participant.principalType === 'agent')
      const humanParticipants = participants.filter((participant) => participant.principalType === 'human')
      const threadAgentId = threadRootMessageId
        ? messages.find((message) => message.id === threadRootMessageId && message.authorKind === 'agent')?.authorPrincipalId
        : undefined
      const invokedAgents = agentParticipants.filter((participant) => (
        (conversationType === 'dm' && agentParticipants.length === 1 && humanParticipants.length === 1)
        || mentionedPrincipalIds.includes(participant.principalId)
        || threadAgentId === participant.principalId
      ))
      if (invokedAgents.length) {
        setAgentResponding(invokedAgents.length === 1 ? invokedAgents[0]!.displayName : 'Agents')
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
        threadRootMessageId,
        // When an agent is going to answer, this client watches the reply
        // stream, so the server must not also run the invocation.
        ...(invokedAgents.length ? { deferAgentReply: true } : {}),
        ...(parts?.length ? { parts: parts as Array<Record<string, unknown>> } : {}),
        ...(options?.attachmentNames?.length ? { attachmentNames: options.attachmentNames } : {}),
        ...(options?.reply?.replyToTurnId
          ? { replyToTurnId: options.reply.replyToTurnId, replySnippet: options.reply.snippet }
          : {}),
      })
      if (!convexRoomSubscriptionEnabled) await loadMessages()
      if (invokedAgents.length) {
        const humanMessageId = saved.messageId ?? messagesRef.current.find((message) => (
          message.clientNonce === clientNonce
        ))?.id
        if (humanMessageId) {
          await streamAgentReply({
            humanMessageId,
            mentionedPrincipalIds,
            threadRootMessageId,
            agents: invokedAgents.map((participant) => ({
              principalId: participant.principalId,
              displayName: participant.displayName,
            })),
          })
        }
      }
      void saved
    } catch {
      setMessages((current) => current.map((message) => (
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

  /**
   * Reads the agent's reply as it is written. The server persists the finished
   * message itself, so the streamed text is a live preview that the next load
   * replaces with the stored row.
   */
  async function streamAgentReply({
    humanMessageId,
    mentionedPrincipalIds,
    threadRootMessageId,
    agents,
  }: {
    humanMessageId: string
    mentionedPrincipalIds: string[]
    threadRootMessageId?: string
    agents: Array<{ principalId: string; displayName: string }>
  }) {
    const fallbackAgent = agents[0]
    try {
      const response = await overlayAppClient.conversations.agentReplyStreamResponse({
        conversationId,
        messageId: humanMessageId,
        mentionedPrincipalIds,
        ...(threadRootMessageId ? { threadRootMessageId } : {}),
      })
      const reader = response.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ''
      const accumulated = new Map<string, string>()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const line = frame.split('\n').find((row) => row.startsWith('data: '))
          if (!line) continue
          let event: { type?: string; agentPrincipalId?: string; agentName?: string; delta?: string }
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          if (event.type !== 'delta' || !event.delta) continue
          const principalId = event.agentPrincipalId ?? fallbackAgent?.principalId ?? 'agent'
          const next = (accumulated.get(principalId) ?? '') + event.delta
          accumulated.set(principalId, next)
          setStreamingAgentReplies((current) => ({
            ...current,
            [principalId]: {
              principalId,
              name: event.agentName ?? fallbackAgent?.displayName ?? 'Agent',
              text: next,
              threadRootMessageId,
            },
          }))
        }
      }
    } catch {
      // The reply is still persisted server-side; the next poll picks it up.
    } finally {
      setStreamingAgentReplies({})
      if (!convexRoomSubscriptionEnabled) await loadMessages().catch(() => undefined)
    }
  }

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

  const renderAttachmentViewer = useCallback(
    ({ preview, headerRight }: { preview: AttachmentPreview; headerRight: React.ReactNode }) => (
      <FileViewerPanel
        name={preview.name}
        content={preview.content}
        url={preview.url}
        headerRight={headerRight}
      />
    ),
    [],
  )

  const {
    shellRightPanel,
    shellRightPanelClose,
    shellRightPanelMode,
    shellRightPanelWidth,
  } = useChatShellPanels({
    attachmentPreview,
    attachmentPreviewMode,
    closeAttachmentPreview,
    closeSourcesPanel,
    panelPresentation,
    setPanelPresentation,
    setAttachmentPreviewMode,
    sourcesPanel,
    renderAttachmentViewer,
  })

  function renderMessage(message: OptimisticMessage, options?: { inThread?: boolean; grouped?: boolean }) {
    const author = participants.find((participant) => participant.principalId === message.authorPrincipalId)
    const authorName = author?.displayName
      ?? (message.authorKind === 'agent' || message.authorKind === 'model' ? 'Agent' : 'Someone')
    const view = toRoomMessageView({
      message,
      currentPrincipalId,
      authorName,
      mentions: participantMentions,
      streaming: message.status === 'generating',
    })
    const teaserMessage = options?.inThread ? null : threadTeasers.get(message.id) ?? null
    const teaserAuthor = teaserMessage
      ? teaserMessage.importedAuthorName?.trim()
        ?? participants.find((participant) => participant.principalId === teaserMessage.authorPrincipalId)?.displayName
        ?? (teaserMessage.authorKind === 'agent' || teaserMessage.authorKind === 'model' ? 'Agent' : 'Someone')
      : null
    return (
      <RoomMessageItem
        key={message.clientNonce ? `nonce-${message.clientNonce}` : message.id}
        message={view}
        reactions={reactions
          .filter((reaction) => reaction.messageId === message.id && reaction.count > 0)
          .map((reaction) => ({
            emoji: reaction.emoji,
            count: reaction.count,
            reactedByCurrentPrincipal: reaction.reactedByCurrentPrincipal,
          }))}
        replyCount={options?.inThread ? 0 : replyCounts.get(message.id) ?? 0}
        threadTeaser={teaserMessage && teaserAuthor ? {
          authorName: teaserAuthor,
          text: teaserMessage.content.trim().slice(0, 120),
          createdAt: teaserMessage.createdAt,
        } : null}
        pinned={pins.some((pin) => pin.messageId === message.id)}
        saved={savedMessages.some((row) => (
          row.conversationId === conversationId && row.messageId === message.id
        ))}
        editing={editingId === message.id}
        editingContent={editingContent}
        onEditingContentChange={setEditingContent}
        onSaveEdit={() => void saveEdit(message.id)}
        onCancelEdit={() => setEditingId(null)}
        onStartEdit={() => {
          setEditingId(message.id)
          setEditingContent(message.content)
        }}
        onDelete={() => void deleteMessage(message.id)}
        onReport={() => void reportMessage(message.id)}
        onToggleReaction={(emoji) => void toggleReaction(message.id, emoji)}
        onTogglePinned={() => void togglePinned(message.id)}
        onToggleSaved={() => void toggleSaved(message.id)}
        onOpenThread={() => openThread(options?.inThread ? threadRootId ?? message.id : message.id)}
        onQuoteReply={() => beginQuoteReply(message)}
        onRetrySend={() => void sendMessage(message.content, { existing: message, threadRootMessageId: message.threadRootMessageId })}
        onOpenAttachmentPreview={openAttachmentPreview}
        onCopyPermalink={() => void copyMessagePermalink(message.id)}
        highlighted={highlightedMessageId === message.id}
        grouped={options?.grouped}
      />
    )
  }

  const streamingReplies = Object.values(streamingAgentReplies)
  const mainStreamingReplies = streamingReplies.filter((reply) => !reply.threadRootMessageId)
  const threadStreamingReplies = streamingReplies.filter((reply) => (
    Boolean(threadRootId) && reply.threadRootMessageId === threadRootId
  ))

  /** A live agent reply renders through the same message body as a stored one. */
  function renderStreamingAgentReply(reply: { principalId: string; name: string; text: string }) {
    return (
      <RoomMessageItem
        key={`streaming-${reply.principalId}`}
        message={{
          id: `streaming-${reply.principalId}`,
          mine: false,
          authorName: reply.name,
          authorKind: 'agent',
          createdAt: Date.now(),
          text: reply.text,
          blocks: reply.text ? [{ kind: 'text', text: reply.text }] : [],
          images: [],
          documentNames: [],
          mentions: participantMentions,
          streaming: true,
        }}
        reactions={[]}
        replyCount={0}
        threadTeaser={null}
        pinned={false}
        saved={false}
        editing={false}
        editingContent=""
        onEditingContentChange={() => undefined}
        onSaveEdit={() => undefined}
        onCancelEdit={() => undefined}
        onStartEdit={() => undefined}
        onDelete={() => undefined}
        onReport={() => undefined}
        onToggleReaction={() => undefined}
        onTogglePinned={() => undefined}
        onToggleSaved={() => undefined}
        onOpenThread={() => undefined}
        onQuoteReply={() => undefined}
        onRetrySend={() => undefined}
        onOpenAttachmentPreview={openAttachmentPreview}
        onCopyPermalink={() => undefined}
      />
    )
  }

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

  const roomPanelContent = roomPanel === 'people' ? (
    <RoomPeoplePanel
      participants={participants}
      presence={presence}
      currentPrincipalId={currentPrincipalId}
      onAddPeople={showcase ? undefined : () => setAddPeopleOpen(true)}
      onClose={() => setRoomPanel(null)}
    />
  ) : roomPanel === 'pinned' ? (
    <RoomPinnedPanel
      pinned={pinnedSummaries}
      onJump={jumpToMessage}
      onUnpin={(messageId) => void togglePinned(messageId)}
      onClose={() => setRoomPanel(null)}
    />
  ) : roomPanel === 'thread' && threadRoot ? (
    <RoomThreadPanel
      roomLabel={conversationType === 'channel' ? `#${title}` : title}
      replyCount={threadReplies.length}
      following={threadFollowing}
      onToggleFollow={toggleThreadFollow}
      input={threadInput}
      onInputChange={setThreadInput}
      onSubmit={() => {
        const text = threadInput
        setThreadInput('')
        void sendMessage(text, { threadRootMessageId: threadRoot.id })
      }}
      onClose={() => {
        setRoomPanel(null)
        setThreadRootId(null)
      }}
      messages={[
        ...[threadRoot, ...threadReplies].map((message) => renderMessage(message, { inThread: true })),
        ...threadStreamingReplies.map((reply) => renderStreamingAgentReply(reply)),
      ]}
    />
  ) : null

  // The attachment preview wins the slot while it is open; otherwise the room's
  // own panels share the shell surface the sources sidebar already uses.
  const rightPanel = shellRightPanel ?? roomPanelContent
  const rightPanelClose = shellRightPanel
    ? shellRightPanelClose
    : roomPanelContent
      ? () => {
        setRoomPanel(null)
        setThreadRootId(null)
      }
      : undefined

  return (
    <>
      {convexRoomSubscriptionEnabled && authUser?.id && convexAccessToken && activeWorkspaceId ? (
        <ConvexRoomMessageSubscription
          accessToken={convexAccessToken}
          actorUserId={authUser.id}
          conversationId={conversationId}
          threadRootMessageId={threadRootId}
          workspaceId={activeWorkspaceId}
          onMessages={applyLiveRoomMessages}
        />
      ) : null}
      <AppScreenShell
        contentClassName="flex min-h-0"
        rightPanel={rightPanel}
        rightPanelOpen={Boolean(rightPanel)}
        rightPanelWidth={shellRightPanel ? shellRightPanelWidth : 380}
        rightPanelMode={shellRightPanelMode}
        onRightPanelClose={rightPanelClose}
      >
        <div
          className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col"
          onDragEnter={(event) => {
            event.preventDefault()
            dragCounterRef.current++
            if (event.dataTransfer.types.includes('Files')) setIsDragging(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault()
            dragCounterRef.current--
            if (dragCounterRef.current <= 0) {
              dragCounterRef.current = 0
              setIsDragging(false)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            dragCounterRef.current = 0
            setIsDragging(false)
            const files = Array.from(event.dataTransfer.files ?? [])
            const images = files.filter((file) => file.type.startsWith('image/'))
            const documents = files.filter((file) => !file.type.startsWith('image/'))
            if (images.length) addImages(images)
            documents.forEach((file) => queueDocumentUpload(file))
          }}
        >
          {isDragging && <ChatDropOverlay />}
          <AppScreenHeader
            title={title}
            subtitle={participants.length > 2 ? `${participants.length} people` : online > 0 ? 'Online' : undefined}
            leading={(
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
                <HeaderIcon size={15} />
              </span>
            )}
            actions={(
              <div className="relative flex items-center gap-1">
                {pins.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setRoomPanel((current) => (current === 'pinned' ? null : 'pinned'))}
                    aria-pressed={roomPanel === 'pinned'}
                    title="Pinned messages"
                    className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
                      roomPanel === 'pinned' ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'text-[var(--muted)]'
                    }`}
                  >
                    <Pin size={13} />{pins.length}
                  </button>
                ) : null}
                {!showcase ? (
                  <button
                    type="button"
                    onClick={() => setAttachOpen(true)}
                    title="Attach a file, project, knowledge base, automation, or agent"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  >
                    <Paperclip size={14} />
                    <span className="hidden sm:inline">Attach</span>
                  </button>
                ) : null}
                {!showcase && currentParticipant?.role === 'moderator' ? (
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  >
                    <Share2 size={14} />
                    <span className="hidden sm:inline">Share</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRoomPanel((current) => (current === 'people' ? null : 'people'))}
                  aria-pressed={roomPanel === 'people'}
                  title="People in this room"
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
                    roomPanel === 'people' ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'text-[var(--muted)]'
                  }`}
                >
                  <UsersRound size={14} />
                  {participants.length}
                </button>
                <button
                  ref={menuTriggerRef}
                  type="button"
                  aria-label="Conversation options"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                >
                  <MoreHorizontal size={15} />
                </button>
                <FloatingMenu
                  anchorRef={menuTriggerRef}
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  align="end"
                  className="w-48 p-1"
                >
                    <MenuButton
                      icon={currentParticipant?.notificationLevel === 'muted' ? Bell : BellOff}
                      label={currentParticipant?.notificationLevel === 'muted' ? 'Unmute' : 'Mute'}
                      onClick={() => {
                        setMenuOpen(false)
                        void updateState({
                          notificationLevel: currentParticipant?.notificationLevel === 'muted' ? 'all' : 'muted',
                        }, currentParticipant?.notificationLevel === 'muted' ? 'Notifications on' : 'Conversation muted')
                      }}
                    />
                    <MenuButton
                      icon={Bell}
                      label="Mark unread"
                      onClick={() => {
                        setMenuOpen(false)
                        void updateState({ markUnread: true }, 'Marked unread')
                      }}
                    />
                    <MenuButton
                      icon={Archive}
                      label={currentParticipant?.archivedAt ? 'Restore' : 'Archive'}
                      onClick={() => {
                        setMenuOpen(false)
                        if (currentParticipant?.archivedAt) {
                          void updateState({ archived: false }, 'Conversation restored').then(() => {
                            const view = conversationType === 'channel' ? 'channels' : 'dms'
                            const chatBase = activeWorkspaceId
                              ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
                              : '/app/chat'
                            router.push(`${chatBase}?${new URLSearchParams({ view, id: conversationId }).toString()}`)
                          }).catch(() => undefined)
                          return
                        }
                        setScopeDialogError(null)
                        setPendingArchiveScope(true)
                      }}
                    />
                </FloatingMenu>
              </div>
            )}
          />
          <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="flex min-h-0 flex-1 flex-col">
            {notice ? (
              <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-xs text-[var(--muted)]">
                <span>{notice}</span>
                <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={13} /></button>
              </div>
            ) : null}
            <div className="overlay-chat-surface relative min-h-0 flex-1">
              {newMessageCount > 0 && !stickToBottomRef.current ? (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  data-testid="jump-to-latest"
                  className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-lg transition-colors hover:bg-[var(--surface-subtle)]"
                >
                  {newMessageCount} new {newMessageCount === 1 ? 'message' : 'messages'} ↓
                </button>
              ) : null}
              <div
                ref={listRef}
                onScroll={() => {
                  const node = listRef.current
                  if (node) {
                    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
                    stickToBottomRef.current = distanceFromBottom <= 96
                    if (node.scrollTop <= 120 && hasMoreMessages) void loadOlderMessages()
                  }
                  void markVisibleRead()
                }}
                className="h-full min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 sm:px-4 sm:py-4"
              >
                <div className={`mx-auto flex min-h-full w-full min-w-0 max-w-4xl flex-col gap-1 sm:gap-1.5 ${!loading && mainMessages.length === 0 ? 'justify-center' : 'justify-end'}`}>
                  {hasMoreMessages ? (
                    <button
                      type="button"
                      onClick={() => void loadOlderMessages()}
                      disabled={loadingOlderMessages}
                      className="mx-auto my-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] disabled:opacity-60"
                    >
                      {loadingOlderMessages ? 'Loading older messages…' : 'Load older messages'}
                    </button>
                  ) : null}
                  {loading ? (
                    <div className="space-y-3 py-4" aria-label="Loading messages">
                      {[0, 1, 2].map((row) => (
                        <div key={row} className="h-12 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
                      ))}
                    </div>
                  ) : mainMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
                        {conversationType === 'channel' ? <Hash size={20} /> : <UsersRound size={20} />}
                      </span>
                      <h2 className="mt-4 text-base font-medium text-[var(--foreground)]">{title}</h2>
                      <p className="mt-1 max-w-sm text-sm text-[var(--muted)]">
                        {conversationType === 'channel'
                          ? channel?.topic ?? 'This is the beginning of this channel.'
                          : 'This is the beginning of your conversation. Messages are visible only to its participants.'}
                      </p>
                    </div>
                  ) : (
                    mainMessages.map((message, index) => {
                      const previous = mainMessages[index - 1]
                      const isUnreadBoundary = message.id === unreadBoundaryMessageId
                      const grouped = Boolean(
                        previous
                        && Boolean(message.authorPrincipalId)
                        && Boolean(previous.authorPrincipalId)
                        && previous.authorPrincipalId === message.authorPrincipalId
                        && previous.authorKind === message.authorKind
                        && message.createdAt - previous.createdAt <= 5 * 60_000
                        && !isUnreadBoundary
                        && previous.id !== unreadBoundaryMessageId,
                      )
                      const showDayDivider = !previous
                        || roomDayKey(previous.createdAt) !== roomDayKey(message.createdAt)
                      return (
                        <div key={`room-message-row-${message.id}`} className="contents">
                          {showDayDivider ? (
                            <div className="flex items-center gap-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-light)]">
                              <span className="h-px flex-1 bg-[var(--border)]" />
                              <span>{roomDayLabel(message.createdAt)}</span>
                              <span className="h-px flex-1 bg-[var(--border)]" />
                            </div>
                          ) : null}
                          {isUnreadBoundary ? (
                            <div className="flex items-center gap-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-500" data-testid="unread-boundary">
                              <span className="h-px flex-1 bg-rose-200 dark:bg-rose-900" />
                              <span>New messages</span>
                              <span className="h-px flex-1 bg-rose-200 dark:bg-rose-900" />
                            </div>
                          ) : null}
                          {renderMessage(message, { grouped })}
                        </div>
                      )
                    })
                  )}
                  {mainStreamingReplies.map((reply) => renderStreamingAgentReply(reply))}
                  {agentResponding && mainStreamingReplies.length === 0 ? (
                    <div className="flex items-center gap-2 px-1" aria-label={`${agentResponding} response pending`}>
                      <span className="text-xs font-medium text-[var(--foreground)]">{agentResponding}</span>
                      <span className="flex items-center gap-1">
                        {[0, 1, 2].map((dot) => (
                          <span
                            key={dot}
                            className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted-light)]"
                            style={{ animationDelay: `${dot * 120}ms` }}
                          />
                        ))}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <ChatComposer
              mode="chat"
              surface={{
                hideModeMenu: true,
                hideGenerationModes: true,
                placeholder: `Message ${title}, use @ to notify someone…`,
                mentionCategories,
              }}
              emptyState={{ showCenteredEmptyChat: false, greetingLine: '' }}
              attachments={{
                attachedImages,
                setAttachedImages,
                pendingChatDocuments,
                removePendingDocument,
                attachmentError,
                fileInputRef,
                docInputRef,
                onAddImages: addImages,
                onAddDocumentsFromPicker: addDocumentsFromPicker,
                onOpenAttachmentPreview: openAttachmentPreview,
                onOpenFilePreview: openFilePreview,
              }}
              runtime={{
                composerNotice,
                isSendBlocked: false,
                isActiveLoading: false,
                isTemporaryChat: false,
                blockedComposerContent: null,
              }}
              inputState={{
                replyContext,
                setReplyContext,
                textareaRef: composerRef,
                input,
                inputRevision,
                onInputChange: onComposerInput,
                onMentionsChange: setMentions,
                onPaste: handlePaste,
                hasComposerText,
              }}
              toolState={{
                showAttachMenu,
                setShowAttachMenu,
                attachMenuRef,
                selectedToolIds: [],
                memoryEnabled: false,
                capabilities,
                onToggleTool: () => {},
                onToggleMemory: () => {},
                onRemoveTool: () => {},
              }}
              modeState={{
                onModeChange: () => {},
                generationChip: null,
                setGenerationChip: () => {},
                showModeMenu,
                setShowModeMenu,
                modeMenuRef,
                onNavigateMode: () => {},
              }}
              actions={{
                onStop: () => {},
                onSend: () => void handleSend(),
              }}
            />
          </AppScreenBody>
        </div>
      </AppScreenShell>

      <AttachmentPreviewDialog
        open={Boolean(attachmentPreview && attachmentPreviewMode === 'dialog')}
        preview={attachmentPreview}
        onClose={closeAttachmentPreview}
        onModeChange={setAttachmentPreviewMode}
        renderViewer={renderAttachmentViewer}
      />

      <ShareDialog
        workspaceId={activeWorkspaceId}
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        resource={{
          id: conversationId,
          type: 'chat',
          title,
        }}
      />

      {attachOpen ? (
        <AttachResourceDialog
          workspaceId={activeWorkspaceId}
          isOpen
          conversationId={conversationId}
          conversationTitle={title}
          onClose={() => setAttachOpen(false)}
          onPost={(message) => sendMessage(message)}
        />
      ) : null}

      {addPeopleOpen ? (
        <NewDirectMessageDialog
          open
          showcase={showcase}
          workspaceId={currentParticipant?.workspaceId ?? ''}
          addToConversationId={conversationId}
          addToConversationType={conversationType}
          excludedPrincipalIds={participants.map((participant) => participant.principalId)}
          onOpenChange={setAddPeopleOpen}
          onCreated={({ id }) => {
            const view = conversationType === 'channel' ? 'channels' : 'dms'
            router.push(`/app/chat?view=${view}&id=${encodeURIComponent(id)}`)
          }}
          onParticipantsAdded={() => {
            setAddPeopleOpen(false)
            void loadParticipants()
          }}
        />
      ) : null}
      <ConversationScopeActionDialog
        open={pendingArchiveScope}
        action="archive"
        conversationTitle={title}
        canApplyToEveryone={activeWorkspace?.role === 'owner'}
        busy={scopeDialogBusy}
        error={scopeDialogError}
        onOpenChange={(open) => {
          if (!open && !scopeDialogBusy) setPendingArchiveScope(false)
        }}
        onSelect={async (scope) => {
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
            setScopeDialogError(error instanceof Error ? error.message : 'Conversation could not be archived')
          } finally {
            setScopeDialogBusy(false)
          }
        }}
      />
      <ConversationScopeActionDialog
        open={pendingDeleteScope}
        action="delete"
        conversationTitle={title}
        canApplyToEveryone={activeWorkspace?.role === 'owner'}
        busy={scopeDialogBusy}
        error={scopeDialogError}
        onOpenChange={(open) => {
          if (!open && !scopeDialogBusy) setPendingDeleteScope(false)
        }}
        onSelect={async (scope) => {
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
        }}
      />
    </>
  )
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bell
  label: string
  onClick(): void
}) {
  return (
    <MenuItem
      type="button"
      onClick={onClick}
      className="h-8 rounded-md px-2"
    >
      <Icon size={13} />
      {label}
    </MenuItem>
  )
}

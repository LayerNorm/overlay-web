'use client'
import { useNativeReadMarkersSource } from './collaboration/native-room-read-markers'

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
  dispatchChatCreated,
  dispatchChatTitleUpdated,
  mergeChatTitle,
  sanitizeChatTitle,
  type ChatTitleUpdatedDetail,
} from '@/shared/chat/chat-title'
import {
  AGENT_DIRECTORY_CHANGED_EVENT,
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
import { useComposerTextState } from './chat/useComposerTextState'
import { roomExecutionQuery, useNativeRoomSafety } from './collaboration/useNativeRoomSafety'
import { useNativeCollaboration } from './collaboration/NativeCollaborationProvider'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useAgentDirectory as useNativeAgentDirectory } from '@/components/providers/AgentDirectoryProvider'
import {
  isNativeThreadSafetyError,
  nativeThreadSafetyErrorStatus,
  nativeThreadSafetyStatus,
  type NativeThreadSafetyStatus,
} from '@/shared/chat/native-thread-safety'
import { buildTextTurnPayload } from './chat/chat-send-body-builders'
import { createHandoffConversation } from './chat/chat-send-create'
import { useRoomTranscriptSource } from './collaboration/NativeRoomScope'
import { useRoomRosterSource } from './collaboration/native-room-adapters'
import { useRoomPresenceWriter } from './collaboration/room-state-adapters'

import { useThreadPanel, useRoomRoster, useRoomCollaboration } from './collaboration/room-state-hooks'
export { useThreadPanel, useRoomRoster, useRoomCollaboration } from './collaboration/room-state-hooks'

import { useRoomLifecycle, useRoomActions } from './collaboration/room-lifecycle-actions'
export { useRoomLifecycle, useRoomActions } from './collaboration/room-lifecycle-actions'

import { useMessageActions } from './collaboration/room-message-actions'
export { useMessageActions } from './collaboration/room-message-actions'

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



function useLegacyReadMarkers({
  conversationId,

  refreshNotifications,
}: {
  conversationId: string

  refreshNotifications: () => void
}) {
  const [unreadBoundarySequence, setUnreadBoundarySequence] = useState<number | null>(null)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const unreadBoundaryInitializedRef = useRef(false)
  const readMarkInFlightRef = useRef(false)

  const clearCollaborationNotifications = useCallback(async () => {

    try {
      await overlayAppClient.conversations.markConversationNotificationsRead(conversationId)
      refreshNotifications()
    } catch {
      // Badge clear is best-effort; the room transcript still works.
    }
    window.dispatchEvent(new CustomEvent('overlay:collaboration-read', {
      detail: { conversationId },
    }))
  }, [conversationId, refreshNotifications, ])

  const markVisibleRead = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
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
  }, [clearCollaborationNotifications, conversationId, ])

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



export function useReadMarkers(args: Parameters<typeof useLegacyReadMarkers>[0]) {
  return useNativeReadMarkersSource(args.conversationId, useLegacyReadMarkers(args))
}

export function useRoomTranscript({
  conversationId,
  threadRootId,


  agentResponding,
  markVisibleRead,
  setNewMessageCount,
}: {
  conversationId: string
  threadRootId: string | null


  agentResponding: string | null
  markVisibleRead: () => Promise<void>
  setNewMessageCount: Dispatch<SetStateAction<number>>
}) {
  const [messages, setMessages] = useState<OptimisticMessage[]>(
    [],
  )
  const [loading, setLoading] = useState(true)
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

  const activeConversationRef = useRef(conversationId)
  activeConversationRef.current = conversationId
  useEffect(() => {
    const handleTitleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ChatTitleUpdatedDetail>).detail
      if (detail?.chatId === conversationId) setConversationTitle(detail.title)
    }
    window.addEventListener(CHAT_TITLE_UPDATED_EVENT, handleTitleUpdated)
    return () => window.removeEventListener(CHAT_TITLE_UPDATED_EVENT, handleTitleUpdated)
  }, [conversationId])
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
    if (activeConversationRef.current !== conversationId) return
    const loadedTitle = result.title?.trim()
    if (loadedTitle) {
      setConversationTitle((current) => mergeChatTitle(current ?? 'New thread', loadedTitle))
    }
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
    if (loadingOlderMessages || !hasMoreMessages) return
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
      toast.error('Older messages could not be loaded.')
      prependScrollRef.current = null
      skipNextMessageGrowthRef.current = false
    } finally {
      setLoadingOlderMessages(false)
    }
  }, [conversationId, hasMoreMessages, loadingOlderMessages, ])

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
    setConversationTitle,
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


type AgentDirectoryEntry = {
  isDefault?: boolean
  id?: string
  name: string
  avatarColor?: string
  avatarShape?: string
}

export function useAgentDirectory({
  activeWorkspaceId,

  conversationId,

}: {
  activeWorkspaceId: string | null | undefined

  conversationId: string

}) {
  const native = useNativeAgentDirectory()
  const nativeScope = useNativeCollaboration()
  const scope = JSON.stringify([nativeScope.scopeKey, activeWorkspaceId, conversationId, native.mode])
  const [draftScope, setDraftScope] = useState(scope)
  const [agentsByPrincipal, setAgentsByPrincipal] = useState<ReadonlyMap<string, AgentDirectoryEntry>>(new Map())
  // Unsaved editor drafts overlay the fetched directory so the header renames
  // and re-skins while the user types; cleared by a null patch on save/cancel.
  const [agentDrafts, setAgentDrafts] = useState<ReadonlyMap<string, {
    name: string
    avatarColor?: string
    avatarShape?: string
  }>>(new Map())
  if (draftScope !== scope) {
    setDraftScope(scope)
    setAgentDrafts(new Map())
    setAgentsByPrincipal(new Map())
  }
  const directoryAgentsByPrincipal = useMemo(() => {
    const canonical = native.mode === 'legacy' ? agentsByPrincipal : new Map(
      native.workspaceId === activeWorkspaceId ? (native.directory ?? []).map(agent => [agent.principalId, {
        id: agent.id, name: agent.name, avatarColor: agent.avatarColor, avatarShape: agent.avatarShape, isDefault: agent.isDefault,
      }]) : [],
    )
    if (agentDrafts.size === 0) return canonical
    const merged = new Map(canonical)
    for (const [principalId, draft] of agentDrafts) {
      if (native.mode !== 'legacy' && !canonical.has(principalId)) continue
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
  }, [activeWorkspaceId, agentsByPrincipal, agentDrafts, native.directory, native.mode, native.workspaceId])
  useEffect(() => {

    if (!activeWorkspaceId) {
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
          isDefault: agent.isDefault,
        }])))
      }).catch(() => undefined)
    }
    if (native.mode === 'legacy') load()
    // Renames and avatar changes save through the editor and dispatch this
    // event; refetching keeps the header and message identity in sync without
    // a reload.
    if (native.mode === 'legacy') window.addEventListener(AGENT_DIRECTORY_CHANGED_EVENT, load)
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
  }, [activeWorkspaceId, conversationId, native.mode])
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
  convexRoomSubscriptionEnabled,
  loadMessages,
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
  convexRoomSubscriptionEnabled: boolean
  loadMessages: () => Promise<void>
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
      if (!convexRoomSubscriptionEnabled) await loadMessages().catch(() => undefined)
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
  sessionIdRef,
  sendMessage,
  mentions,
  setMentions,
  readOnly = false,
}: {

  activeWorkspaceId: string | null | undefined
  conversationId: string
  sessionIdRef: RefObject<string | null>
  sendMessage: SendMessage
  mentions: MentionItem[]
  setMentions: Dispatch<SetStateAction<MentionItem[]>>
  /** Surface-mirrored rooms accept no uploads. */
  readOnly?: boolean
}) {
  const updatePresence = useRoomPresenceWriter(conversationId)
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
      void updatePresence({
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
  loadMessages,
  setMessages,
  setAttachmentError,
}: {
  activeWorkspaceId: string | null | undefined
  conversationId: string
  setMessages: Dispatch<SetStateAction<OptimisticMessage[]>>
  loadMessages: () => Promise<void>
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
      await loadMessages()
    } catch (value) {
      setAttachmentError(value instanceof Error ? value.message : 'Could not update the connected agent run.')
      await loadMessages().catch(() => undefined)
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
  convexRoomSubscriptionEnabled,
  refreshNotifications,
  onOpenAttachmentPreview,
}: {
  conversationId: string

  conversationType: 'dm' | 'channel'
  draft: boolean
  draftTitle: string | undefined
  router: ReturnType<typeof useRouter>
  activeWorkspaceId: string | null | undefined
  convexRoomSubscriptionEnabled: boolean
  refreshNotifications: () => void
  onOpenAttachmentPreview: RoomMessageContext['onOpenAttachmentPreview']
}) {

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

  const readMarkers = useReadMarkers({ conversationId,  refreshNotifications })
  const roster = useRoomRosterSource(useRoomRoster({
    conversationId,


    noteParticipantsLoaded: readMarkers.noteParticipantsLoaded,
  }))
  const collab = useRoomCollaboration({ conversationId, conversationType,  })
  const thread = useThreadPanel({ conversationId,  setRoomPanel })
  const nativeCollaboration = useNativeCollaboration()
  const nativeThreadSafety = useNativeRoomSafety({ conversationId, workspaceId: activeWorkspaceId ?? null })
  const selectedThreadSafety = useNativeRoomSafety({
    conversationId: thread.threadRootId ? conversationId : null,
    workspaceId: activeWorkspaceId ?? null,
    threadRootMessageId: thread.threadRootId ?? undefined,
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
      if (nativeCollaboration.status !== 'disabled') {
        if (nativeCollaboration.status !== 'ready' || !nativeCollaboration.client || !activeWorkspaceId
          || !nativeCollaboration.isCurrentScope?.()) return { accepted: false, status: 'unavailable' as const }
        const execution = await nativeCollaboration.client.query(roomExecutionQuery, {
          workspaceId: activeWorkspaceId, conversationId: conversationId as Id<'conversations'>, threadRootMessageId: root as Id<'conversationMessages'>,
        })
        const scoped = nativeCollaboration.isCurrentScope() && nativeThreadSafety.isCurrentScope()
          && execution?.workspaceId === activeWorkspaceId && execution.conversationId === conversationId
          && execution.userId === nativeCollaboration.viewerUserId && execution.threadRootMessageId === root
        const status = scoped ? nativeThreadSafetyStatus(execution.compatibility) : 'unavailable'
        return { accepted: status === 'writable', status }
      }
      const result = await overlayAppClient.conversations.get<{
        nativeThreadCompatibility?: unknown
      }>({ conversationId, threadRootMessageId: root })
      const status = nativeThreadSafetyStatus(result.nativeThreadCompatibility)
      return {
        accepted: status === 'writable',
        status,
      }
    } catch (error) {
      return { accepted: false, status: nativeThreadSafetyErrorStatus(error), error }
    }
  }, [
    conversationId,
    activeWorkspaceId,
    nativeCollaboration,
    nativeThreadSafety,
    checkMainRoomWritable,
    checkSelectedThreadWritable,
    thread.threadRootId,
  ])
  const transcript = useRoomTranscriptSource(useRoomTranscript({
    conversationId,
    threadRootId: thread.threadRootId,


    agentResponding,
    markVisibleRead: readMarkers.markVisibleRead,
    setNewMessageCount: readMarkers.setNewMessageCount,
  }))
  const sessionIdRef = useRoomLifecycle({
    conversationId,
    convexRoomSubscriptionEnabled,

    loadParticipants: roster.loadParticipants,
    loadMessages: transcript.loadMessages,
    loadCollaboration: collab.loadCollaboration,
    loadPresence: roster.loadPresence,
    setLoading: transcript.setLoading,
  })
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
    convexRoomSubscriptionEnabled,
    loadMessages: transcript.loadMessages,
    commitDraftConversation,
    setAgentResponding,
    messages: transcript.messages,
    mentions,
  })
  const composer = useRoomComposer({

    activeWorkspaceId,
    conversationId,
    sessionIdRef,
    sendMessage,
    mentions,
    setMentions,
    readOnly: Boolean(transcript.surfacePlatform) || nativeThreadSafety.readOnly,
  })
  const remoteControls = useRemoteAgentControls({
    activeWorkspaceId,
    conversationId,
    loadMessages: transcript.loadMessages,
    setMessages: transcript.setMessages,
    setAttachmentError: composer.setAttachmentError,
  })
  const isReadOnlyMessage = (messageId: string) => {
    const message = transcript.messages.find((row) => row.id === messageId)
    return !canSendToThread(message?.threadRootMessageId ?? messageId)
  }
  const actions = useMessageActions({
    isReadOnlyMessage,
    conversationId,
    currentPrincipalId: roster.currentPrincipalId,

    reactions: collab.reactions,
    setReactions: collab.setReactions,
    pins: collab.pins,
    setPins: collab.setPins,
    savedMessages: collab.savedMessages,
    setSavedMessages: collab.setSavedMessages,
    setMessages: transcript.setMessages,
    loadMessages: transcript.loadMessages,
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
      const { thread: next } = await overlayAppClient.agents.createThread(activeWorkspaceId, agentId, {})
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
    loadParticipants: roster.loadParticipants,
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

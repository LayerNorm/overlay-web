/**
 * Shared room screen for DMs and channels — the mobile counterpart of web
 * `DirectMessageExperience`: persist-first sends (`addMessage` — the server
 * owns the agent turn), Slack-style transcript, reactions, pins, threads,
 * participants, presence, and polling-based realtime.
 *
 * Thread mode (`threadRootMessageId` set) renders the root message + its
 * replies with a follow toggle, mirroring the web thread panel.
 */
import { useHeaderHeight } from '@react-navigation/elements'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useAndroidKeyboardVisible } from '../../hooks/useAndroidKeyboardVisible'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { hapticImpact, hapticNotify } from '../../lib/haptics'
import type { ConversationParticipant, ConversationPresence } from '@overlay/workspace-contracts'
import { useTheme } from '../../hooks/useTheme'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { borderRadius, spacing } from '../../constants/theme'
import {
  compareRoomMessageRecords,
  channelComposerPlaceholder,
  dayLabel,
  isGroupedWithPrevious,
  isSameDay,
  mergeRoomMessages,
  resolveMentionTargets,
  toRoomMessageView,
  type RoomMessageRecord,
  type RoomMessageView,
} from '../../lib/roomMessages'
import { getComposerBottomInset } from '../../lib/keyboardLayout'
import {
  addRoomParticipant,
  deleteRoomMessage,
  editRoomMessage,
  fetchRoomParticipants,
  fetchRoomPins,
  fetchRoomPresence,
  COLLABORATION_NATIVE_READY,
  fetchRoomReactions,
  fetchSavedMessages,
  loadRoomMessages,
  markConversationNotificationsRead,
  removeRoomParticipant,
  reportRoomMessage,
  sendRoomMessage,
  sendRoomPresence,
  setMessageSaved,
  setRoomPinned,
  setRoomReaction,
  setThreadFollowed,
  updateRoomParticipantState,
  subscribeRoomState,
  subscribeRoomMessages,
} from '../../services/collaborationService'
import { uploadDocument } from '../../services/aiService'
import type { ChatMentionItem } from '../../services/chatTypes'
import { Composer, type ComposerReplyContext, type PendingDocument } from './Composer'
import { RoomMessageItem } from './RoomMessageItem'
import { RoomMessageMenu, type RoomAction } from './RoomMessageMenu'
import { RoomConfirmDialog, RoomMembersSheet, RoomMessagesSheet, type RoomConfirmation } from './RoomSheets'
import { ChatHeader } from './ChatViews'
import { useDrawer } from '../../contexts/DrawerContext'
import { EmptyState } from '../ui/AppChrome'
import { FeatureGate } from '../ui/FeatureGate'

const PRESENCE_HEARTBEAT_MS = 25_000
const TYPING_THROTTLE_MS = 2_500

interface RoomState {
  title: string
  messages: RoomMessageRecord[]
  hasMore: boolean
  participants: ConversationParticipant[]
  currentPrincipalId: string
  presence: ConversationPresence[]
  reactions: Record<string, { emoji: string; count: number; reactedByCurrentPrincipal: boolean }[]>
  pinnedIds: Set<string>
  savedIds: Set<string>
  loading: boolean
}

function groupReactions(
  reactions: Array<{ messageId: string; emoji: string; count: number; reactedByCurrentPrincipal: boolean }>,
): RoomState['reactions'] {
  const map: RoomState['reactions'] = {}
  for (const reaction of reactions) {
    const list = (map[reaction.messageId] ??= [])
    list.push({
      emoji: reaction.emoji,
      count: reaction.count,
      reactedByCurrentPrincipal: reaction.reactedByCurrentPrincipal,
    })
  }
  return map
}

function participantMap(participants: ConversationParticipant[]): Map<string, ConversationParticipant> {
  return new Map(participants.map((participant) => [participant.principalId, participant]))
}

function resolveAuthor(
  message: RoomMessageRecord,
  participants: Map<string, ConversationParticipant>,
): { name: string; color?: string; shape?: string } {
  const participant = message.authorPrincipalId
    ? participants.get(message.authorPrincipalId)
    : undefined
  const fallback =
    message.authorKind === 'agent' || message.authorKind === 'model'
      ? 'Agent'
      : message.authorKind === 'system'
        ? 'Overlay'
        : 'Member'
  return {
    name: participant?.displayName?.trim() || fallback,
    // Participant avatar color/shape are not in the contract payload today;
    // agents fall back to their generated creature defaults.
    color: undefined,
    shape: undefined,
  }
}

export function RoomScreen({
  conversationId,
  conversationType,
  threadRootMessageId,
}: {
  conversationId: string
  conversationType: 'dm' | 'channel'
  threadRootMessageId?: string
}): React.ReactElement {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const headerHeight = useHeaderHeight()
  const keyboardVisible = useAndroidKeyboardVisible()
  const router = useRouter()
  const { openDrawer } = useDrawer()
  const { capabilities, isFeatureEnabled } = useAppSession()
  const { activeWorkspaceId } = useWorkspace()
  const nativeReady = useNativeDataReady()
  const [accessDenied, setAccessDenied] = useState(false)
  const olderCursor = useRef<string | undefined>(undefined)
  const olderSubscriptions = useRef<Array<() => void>>([])
  const hasOlderPages = useRef(false)

  const [state, setState] = useState<RoomState>({
    title: '',
    messages: [],
    hasMore: false,
    participants: [],
    currentPrincipalId: '',
    presence: [],
    reactions: {},
    pinnedIds: new Set(),
    savedIds: new Set(),
    loading: true,
  })
  const [following, setFollowing] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  // Composer state
  const [input, setInput] = useState('')
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [mentions, setMentions] = useState<ChatMentionItem[]>([])
  const [replyContext, setReplyContext] = useState<ComposerReplyContext | null>(null)
  const [sending, setSending] = useState(false)

  // Editing state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)

  // Sheet state
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [pinsOpen, setPinsOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)
  const [muted, setMuted] = useState(false)

  const sessionIdRef = useRef(`mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  const lastTypingSentAt = useRef(0)
  const listRef = useRef<FlatList<RoomMessageRecord>>(null)
  const nearBottomRef = useRef(true)
  const inputRef = useRef<TextInput | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const isThread = Boolean(threadRootMessageId)

  // ── Loading ────────────────────────────────────────────────────────────────

  const loadAll = useCallback(
    async (mode: 'initial' | 'poll' = 'initial') => {
      try {
        const [transcript, participantResult, presenceList, reactionList, pinList, savedList] =
          await Promise.all([
            loadRoomMessages(conversationId, {
              ...(isThread
                ? { threadRootMessageId, limit: 200 }
                : { mainOnly: true, limit: 100 }),
            }),
            fetchRoomParticipants(conversationId).catch(() => null),
            fetchRoomPresence(conversationId).catch(() => []),
            fetchRoomReactions(conversationId).catch(() => []),
            fetchRoomPins(conversationId).catch(() => []),
            fetchSavedMessages(conversationId).catch(() => []),
          ])
        if (!mountedRef.current) return
        setState((current) => ({
          ...current,
          title: transcript.title?.trim() || current.title,
          messages: mergeRoomMessages(transcript.messages, current.messages),
          hasMore: transcript.hasMore,
          participants: participantResult?.participants ?? current.participants,
          currentPrincipalId:
            participantResult?.currentPrincipalId ?? current.currentPrincipalId,
          presence: presenceList,
          reactions: groupReactions(reactionList),
          pinnedIds: new Set(pinList.map((pin) => pin.messageId)),
          savedIds: new Set(
            savedList
              .filter((saved) => saved.conversationId === conversationId)
              .map((saved) => saved.messageId),
          ),
          loading: false,
        }))
        const me = participantResult?.participants.find(
          (participant) => participant.principalId === participantResult.currentPrincipalId,
        )
        if (me) setMuted(me.notificationLevel === 'muted')
        if (mode === 'initial') {
          // Opening the room clears its notifications + advances read state —
          // same side effects as the web room view.
          void markConversationNotificationsRead(conversationId).catch(() => undefined)
          void updateRoomParticipantState(conversationId, { markRead: true }).catch(() => undefined)
        }
      } catch {
        if (mountedRef.current) {
          setState((current) => ({ ...current, loading: false }))
        }
      }
    },
    [conversationId, isThread, threadRootMessageId],
  )

  useFocusEffect(
    useCallback(() => {
      if (!nativeReady || !activeWorkspaceId) return
      let active = true
      olderCursor.current = undefined
      hasOlderPages.current = false
      setAccessDenied(false)
      setState((current) => ({ ...current, messages: [], participants: [], presence: [], reactions: {}, pinnedIds: new Set(), savedIds: new Set(), loading: true }))
      const stopState = subscribeRoomState(conversationId, value => {
        if (!active) return
        setAccessDenied(value === null)
        setState(current => ({ ...current,
          participants: value?.participants ?? [], currentPrincipalId: value?.currentPrincipalId ?? '',
          presence: value?.presence ?? [], reactions: groupReactions(value?.reactions ?? []),
          pinnedIds: new Set(value?.pins.map(pin => pin.messageId) ?? []),
          savedIds: new Set(value?.saved.map(row => row.messageId) ?? []),
          ...(value === null ? { messages: [], loading: false } : {}),
        }))
        setFollowing(Boolean(value?.follows.some(row => row.threadRootMessageId === threadRootMessageId)))
        const me = value?.participants.find(row => row.principalId === value.currentPrincipalId)
        setMuted(me?.notificationLevel === 'muted')
      })
      const stopMessages = subscribeRoomMessages(conversationId, { threadRootMessageId }, page => {
        if (!active) return
        if (!hasOlderPages.current) olderCursor.current = page.cursor
        setState(current => ({ ...current, title: page.title ?? current.title,
          messages: mergeRoomMessages(page.messages, current.messages), hasMore: hasOlderPages.current ? current.hasMore : page.hasMore, loading: false }))
      })
      void markConversationNotificationsRead(conversationId).catch(() => undefined)
      void updateRoomParticipantState(conversationId, { markRead: true }).catch(() => undefined)
      return () => {
        active = false; stopState(); stopMessages()
        olderSubscriptions.current.forEach(stop => stop())
        olderSubscriptions.current = []
      }
    }, [nativeReady, activeWorkspaceId, conversationId, threadRootMessageId]),
  )

  // Presence heartbeat while the room is open.
  useFocusEffect(
    useCallback(() => {
      if (!nativeReady || !activeWorkspaceId) return
      const beat = () =>
        void sendRoomPresence(conversationId, {
          status: 'online',
          sessionId: sessionIdRef.current,
        }).catch(() => undefined)
      beat()
      const interval = setInterval(beat, PRESENCE_HEARTBEAT_MS)
      return () => {
        clearInterval(interval)
        void sendRoomPresence(conversationId, {
          status: 'away',
          sessionId: sessionIdRef.current,
        }).catch(() => undefined)
      }
    }, [conversationId, nativeReady, activeWorkspaceId]),
  )

  // ── Derived views ──────────────────────────────────────────────────────────

  const participantsById = useMemo(() => participantMap(state.participants), [state.participants])
  const activeParticipants = useMemo(
    () => state.participants.filter((participant) => participant.status === 'active'),
    [state.participants],
  )

  const onlinePrincipalIds = useMemo(() => {
    const set = new Set<string>()
    for (const presence of state.presence) {
      if (presence.status === 'online') set.add(presence.principalId)
    }
    return set
  }, [state.presence])

  const typingNames = useMemo(() => {
    const names: string[] = []
    for (const presence of state.presence) {
      if (!presence.typing || presence.principalId === state.currentPrincipalId) continue
      if (presence.typingExpiresAt && presence.typingExpiresAt < Date.now()) continue
      const participant = participantsById.get(presence.principalId)
      names.push(participant?.displayName?.trim() || 'Someone')
    }
    return names
  }, [state.presence, state.currentPrincipalId, participantsById])

  const messageViews = useMemo(() => {
    return state.messages.map((message) =>
      toRoomMessageView({
        message,
        currentPrincipalId: state.currentPrincipalId,
        authorName: resolveAuthor(message, participantsById).name,
      }),
    )
  }, [state.messages, state.currentPrincipalId, participantsById])

  const threadReplyCounts = useMemo(() => {
    if (isThread) return new Map<string, number>()
    // Reply counts ride on messages with threadRootMessageId — but mainOnly
    // filtering drops them. The server stamps replyCount on the root message
    // record when present; fall back to counting what we have.
    const counts = new Map<string, number>()
    for (const message of state.messages) {
      const record = message as RoomMessageRecord & { replyCount?: number }
      if (typeof record.replyCount === 'number' && record.replyCount > 0) {
        counts.set(message.id, record.replyCount)
      }
    }
    return counts
  }, [state.messages, isThread])

  const rootMessage = useMemo(
    () =>
      isThread
        ? messageViews.find((view) => view.id === threadRootMessageId) ?? null
        : null,
    [isThread, messageViews, threadRootMessageId],
  )

  const displayRecords = useMemo(
    () =>
      isThread
        ? state.messages.filter((message) => message.id !== threadRootMessageId)
        : state.messages,
    [state.messages, isThread, threadRootMessageId],
  )

  const headerSubtitle = useMemo(() => {
    if (typingNames.length === 1) return `${typingNames[0]} is typing…`
    if (typingNames.length > 1) return `${typingNames.length} people typing…`
    const othersOnline = activeParticipants.filter(
      (participant) =>
        participant.principalId !== state.currentPrincipalId &&
        onlinePrincipalIds.has(participant.principalId),
    ).length
    if (conversationType === 'dm' && othersOnline > 0) return 'Online'
    if (conversationType === 'channel') {
      return `${activeParticipants.length} member${activeParticipants.length === 1 ? '' : 's'}`
    }
    return undefined
  }, [typingNames, activeParticipants, onlinePrincipalIds, state.currentPrincipalId, conversationType])

  // ── Composer handlers ──────────────────────────────────────────────────────

  const roomMentionProvider = useCallback(
    async (query: string): Promise<ChatMentionItem[]> => {
      const needle = query.trim().toLowerCase()
      return activeParticipants
        .filter((participant) => participant.principalId !== state.currentPrincipalId)
        .filter(
          (participant) =>
            !needle || participant.displayName.toLowerCase().includes(needle),
        )
        .slice(0, 8)
        .map((participant) => ({
          type: participant.principalType === 'agent' ? 'agent' : 'person',
          id: participant.principalId,
          name: participant.displayName,
          description: participant.principalType === 'agent' ? 'agent' : 'member',
        }))
    },
    [activeParticipants, state.currentPrincipalId],
  )

  const handlePickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.8,
    })
    const asset = result.assets?.[0]
    if (result.canceled || !asset?.base64) return
    const mime = asset.mimeType ?? 'image/jpeg'
    setImageBase64(`data:${mime};base64,${asset.base64}`)
  }, [])

  const handlePickCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) return
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8 })
    const asset = result.assets?.[0]
    if (result.canceled || !asset?.base64) return
    const mime = asset.mimeType ?? 'image/jpeg'
    setImageBase64(`data:${mime};base64,${asset.base64}`)
  }, [])

  const handlePickFile = useCallback(async () => {
    setAttachmentError(null)
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
    if (result.canceled || !result.assets?.[0]) return
    const asset = result.assets[0]
    const clientId = `doc-${Date.now()}`
    setPendingDocuments((current) => [
      ...current,
      { clientId, name: asset.name, fileIds: [], status: 'uploading' },
    ])
    try {
      const uploaded = await uploadDocument(
        asset.uri,
        asset.name,
        asset.mimeType ?? 'application/octet-stream',
      )
      setPendingDocuments((current) =>
        current.map((doc) =>
          doc.clientId === clientId ? { ...doc, fileIds: uploaded.ids, status: 'ready' } : doc,
        ),
      )
    } catch {
      setPendingDocuments((current) =>
        current.map((doc) => (doc.clientId === clientId ? { ...doc, status: 'error' } : doc)),
      )
      setAttachmentError('Document upload failed.')
    }
  }, [])

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value)
      const now = Date.now()
      if (COLLABORATION_NATIVE_READY && now - lastTypingSentAt.current > TYPING_THROTTLE_MS) {
        lastTypingSentAt.current = now
        void sendRoomPresence(conversationId, {
          status: 'online',
          typing: Boolean(value.trim()),
          sessionId: sessionIdRef.current,
        }).catch(() => undefined)
      }
    },
    [conversationId],
  )

  const resetComposer = useCallback(() => {
    setInput('')
    setImageBase64(null)
    setPendingDocuments([])
    setAttachmentError(null)
    setMentions([])
    setReplyContext(null)
    setEditingMessageId(null)
  }, [])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    const readyDocs = pendingDocuments.filter((doc) => doc.status === 'ready')
    if (pendingDocuments.some((doc) => doc.status === 'uploading')) {
      setAttachmentError('Attachments are still uploading.')
      return
    }
    if (!text && !imageBase64 && readyDocs.length === 0) return

    // Edit-in-place: the composer doubles as the edit field like on web.
    if (editingMessageId) {
      const targetId = editingMessageId
      resetComposer()
      try {
        await editRoomMessage(conversationId, targetId, text)
        await loadAll('poll')
      } catch {
        Alert.alert('Could not edit the message', 'Try again in a moment.')
      }
      return
    }

    const turnId = `human_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const clientNonce = `nonce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const documentMarker = readyDocs.length
      ? `${text ? '\n\n' : ''}[Indexed documents: ${readyDocs.map((doc) => doc.name).join(', ')}]`
      : ''
    const content = `${text}${documentMarker}`
    const parts: Array<Record<string, unknown>> = []
    if (text) parts.push({ type: 'text', text })
    if (imageBase64) {
      parts.push({ type: 'file', url: imageBase64, mediaType: 'image/jpeg', fileName: 'photo.jpg' })
    }

    const mentionedPrincipalIds = [
      ...resolveMentionTargets(text, activeParticipants),
      ...mentions
        .filter((mention) => mention.type === 'person' || mention.type === 'agent')
        .map((mention) => mention.id),
    ]

    const optimistic: RoomMessageRecord = {
      id: `optimistic-${clientNonce}`,
      turnId,
      authorKind: 'human',
      authorPrincipalId: state.currentPrincipalId,
      content,
      parts: parts as RoomMessageRecord['parts'],
      createdAt: Date.now(),
      clientNonce,
      delivery: 'sending',
      threadRootMessageId,
    }
    setState((current) => ({
      ...current,
      messages: [...current.messages, optimistic].sort(compareRoomMessageRecords),
    }))
    resetComposer()
    setSending(true)
    try {
      await sendRoomMessage({
        conversationId,
        turnId,
        content,
        clientNonce,
        mentionedPrincipalIds: [...new Set(mentionedPrincipalIds)],
        memoryEnabled: true,
        threadRootMessageId,
        parts,
        attachmentNames: readyDocs.map((doc) => doc.name),
        ...(replyContext?.replyToTurnId
          ? { replyToTurnId: replyContext.replyToTurnId, replySnippet: replyContext.snippet }
          : {}),
      })
      setState((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.clientNonce === clientNonce ? { ...message, delivery: undefined } : message,
        ),
      }))
      await loadAll('poll')
    } catch {
      setState((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.clientNonce === clientNonce ? { ...message, delivery: 'failed' } : message,
        ),
      }))
    } finally {
      setSending(false)
    }
  }, [
    input,
    pendingDocuments,
    imageBase64,
    editingMessageId,
    conversationId,
    activeParticipants,
    mentions,
    threadRootMessageId,
    state.currentPrincipalId,
    replyContext,
    resetComposer,
    loadAll,
  ])

  const handleRetryMessage = useCallback(
    (view: RoomMessageView) => {
      const record = state.messages.find((message) => message.id === view.id)
      if (!record) return
      setState((current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === view.id ? { ...message, delivery: 'sending' } : message,
        ),
      }))
      void sendRoomMessage({
        conversationId,
        turnId: record.turnId ?? view.id,
        content: record.content,
        clientNonce: record.clientNonce ?? view.id,
        mentionedPrincipalIds: resolveMentionTargets(record.content, activeParticipants),
        memoryEnabled: true,
        threadRootMessageId,
        parts: record.parts as Array<Record<string, unknown>> | undefined,
      })
        .then(() => loadAll('poll'))
        .catch(() => {
          setState((current) => ({
            ...current,
            messages: current.messages.map((message) =>
              message.id === view.id ? { ...message, delivery: 'failed' } : message,
            ),
          }))
        })
    },
    [state.messages, conversationId, activeParticipants, threadRootMessageId, loadAll],
  )

  // ── Message actions ────────────────────────────────────────────────────────

  const handleToggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!COLLABORATION_NATIVE_READY) return
      const current = state.reactions[messageId]?.find((reaction) => reaction.emoji === emoji)
      const enabled = !(current?.reactedByCurrentPrincipal ?? false)
      void setRoomReaction(conversationId, messageId, emoji, enabled)
        .then((reactions) => {
          if (!mountedRef.current) return
          setState((prev) => ({ ...prev, reactions: groupReactions(reactions) }))
        })
        .catch(() => undefined)
      hapticImpact()
    },
    [conversationId, state.reactions],
  )

  const handleTogglePin = useCallback(
    (messageId: string) => {
      if (!COLLABORATION_NATIVE_READY) return
      const pinned = !state.pinnedIds.has(messageId)
      setState((prev) => {
        const next = new Set(prev.pinnedIds)
        if (pinned) next.add(messageId)
        else next.delete(messageId)
        return { ...prev, pinnedIds: next }
      })
      void setRoomPinned(conversationId, messageId, pinned).catch(() => undefined)
    },
    [conversationId, state.pinnedIds],
  )

  const handleToggleSaved = useCallback(
    (messageId: string) => {
      if (!COLLABORATION_NATIVE_READY) return
      const saved = !state.savedIds.has(messageId)
      setState((prev) => {
        const next = new Set(prev.savedIds)
        if (saved) next.add(messageId)
        else next.delete(messageId)
        return { ...prev, savedIds: next }
      })
      void setMessageSaved(conversationId, messageId, saved).catch(() => undefined)
    },
    [conversationId, state.savedIds],
  )

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (!COLLABORATION_NATIVE_READY) return
      setConfirmation({
        title: 'Delete this message?',
        message: 'It will be removed for everyone.',
        label: 'Delete message',
        destructive: true,
        run: () => {
          void deleteRoomMessage(conversationId, messageId)
            .then(() => loadAll('poll'))
            .catch(() => Alert.alert('Could not delete the message', 'Try again in a moment.'))
        },
      })
    },
    [conversationId, loadAll],
  )

  const handleReportMessage = useCallback(
    (view: RoomMessageView) => {
      setConfirmation({
        title: 'Report this message?',
        message: 'Workspace admins will review it.',
        label: 'Report message',
        destructive: true,
        run: () => {
          void reportRoomMessage(conversationId, { messageId: view.id, reason: 'inappropriate' })
            .then(() => hapticNotify())
            .catch(() => Alert.alert('Could not report the message', 'Try again in a moment.'))
        },
      })
    },
    [conversationId],
  )

  const handleStartEdit = useCallback(
    (view: RoomMessageView) => {
      if (!COLLABORATION_NATIVE_READY) return
      setEditingMessageId(view.id)
      setInput(view.text)
      inputRef.current?.focus()
    },
    [],
  )

  const handleQuoteReply = useCallback((view: RoomMessageView) => {
    setReplyContext({
      snippet: view.text.slice(0, 140),
      bodyForModel: view.text,
      replyToTurnId: view.id,
    })
    inputRef.current?.focus()
  }, [])

  const openThread = useCallback(
    (messageId: string) => {
      router.push({
        pathname: '/thread/[id]',
        params: { id: messageId, conversation: conversationId, type: conversationType },
      })
    },
    [router, conversationId, conversationType],
  )

  const handleToggleFollow = useCallback(() => {
    if (!COLLABORATION_NATIVE_READY || !threadRootMessageId) return
    const next = !following
    setFollowing(next)
    void setThreadFollowed(conversationId, threadRootMessageId, next).catch(() => {
      if (mountedRef.current) setFollowing(!next)
    })
  }, [conversationId, threadRootMessageId, following])

  const handleLoadOlder = useCallback(() => {
    if (loadingOlder || !state.hasMore) return
    setLoadingOlder(true)
    try {
      hasOlderPages.current = true
      let previousCursor = olderCursor.current
      const stop = subscribeRoomMessages(conversationId, {
        threadRootMessageId,
        limit: 100,
        cursor: olderCursor.current,
      }, page => {
        if (!mountedRef.current) return
        const isLastPage = olderCursor.current === previousCursor
        if (isLastPage) { olderCursor.current = page.cursor; previousCursor = page.cursor }
        setState(current => ({ ...current, messages: mergeRoomMessages(page.messages, current.messages), hasMore: isLastPage ? page.hasMore : current.hasMore }))
        setLoadingOlder(false)
      })
      olderSubscriptions.current.push(stop)
    } catch {
      setLoadingOlder(false)
    }
  }, [loadingOlder, state.hasMore, conversationId, threadRootMessageId])

  const loadOlderRef = useRef(handleLoadOlder)
  loadOlderRef.current = handleLoadOlder

  // ── Participant actions ────────────────────────────────────────────────────

  const handleRemoveParticipant = useCallback(
    (principalId: string) => {
      void removeRoomParticipant(conversationId, principalId)
        .then(() => loadAll('poll'))
        .catch(() => Alert.alert('Could not remove the member', 'Try again in a moment.'))
    },
    [conversationId, loadAll],
  )

  const handleToggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
    void updateRoomParticipantState(conversationId, {
      notificationLevel: next ? 'muted' : 'all',
    }).catch(() => {
      setMuted(!next)
    })
  }, [conversationId, muted])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (accessDenied) return <FeatureGate title="Room unavailable" description="You no longer have access to this conversation." />

  if (!capabilities.chat) {
    return <FeatureGate title="Chat is turned off" />
  }
  if (conversationType === 'channel' && !isFeatureEnabled('channels')) {
    return <FeatureGate title="Channels are turned off" />
  }
  if (conversationType === 'dm' && !isFeatureEnabled('collaborativeChats')) {
    return <FeatureGate title="Direct messages are turned off" />
  }

  const myParticipant = participantsById.get(state.currentPrincipalId)
  const canManageParticipants =
    conversationType === 'channel' || activeParticipants.length > 2 || myParticipant?.role === 'moderator'
  const roomLabel = conversationType === 'channel' ? '#' + state.title.replace(/^#/, '') : 'this conversation'
  const messageRows = (ids: Set<string>) =>
    messageViews
      .filter((view) => ids.has(view.id))
      .map((view) => ({ id: view.id, author: view.authorName, text: view.deletedAt ? 'Message deleted' : view.text || 'Attachment' }))

  const renderItem = ({ item, index }: { item: RoomMessageRecord; index: number }) => {
    const view = messageViews.find((candidate) => candidate.id === item.id)
    if (!view) return null
    const previous = index > 0 ? displayRecords[index - 1] : undefined
    const grouped = isGroupedWithPrevious(previous, item)
    const showDaySeparator = !previous || !isSameDay(previous.createdAt, item.createdAt)
    return (
      <View>
        {showDaySeparator ? (
          <View style={styles.daySeparator}>
            <View style={[styles.dayLine, { backgroundColor: theme.border }]} />
            <Text style={[styles.dayLabel, { color: theme.textSecondary }]}>
              {dayLabel(item.createdAt)}
            </Text>
            <View style={[styles.dayLine, { backgroundColor: theme.border }]} />
          </View>
        ) : null}
        {withMenu(
          view,
          <RoomMessageItem
            view={view}
            theme={theme}
            grouped={grouped}
            reactions={state.reactions[item.id]}
            replyCount={threadReplyCounts.get(item.id) ?? 0}
            pinned={state.pinnedIds.has(item.id)}
            saved={state.savedIds.has(item.id)}
            onToggleReaction={(emoji) => handleToggleReaction(item.id, emoji)}
            onOpenThread={() => openThread(item.id)}
          />,
        )}
      </View>
    )
  }

  const handleMessageAction = (message: RoomMessageView, action: RoomAction) => {
    if (action === 'thread') { if (isThread) inputRef.current?.focus(); else openThread(message.id) }
    else if (action === 'reply') handleQuoteReply(message)
    else if (action === 'pin') handleTogglePin(message.id)
    else if (action === 'save') handleToggleSaved(message.id)
    else if (action === 'copy') void Clipboard.setStringAsync(message.text)
    else if (action === 'retry') handleRetryMessage(message)
    else if (action === 'edit' && message.mine) handleStartEdit(message)
    else if (action === 'delete' && message.mine) handleDeleteMessage(message.id)
    else if (action === 'report' && !message.mine) handleReportMessage(message)
  }
  const withMenu = (view: RoomMessageView, item: React.ReactElement) => (
    <RoomMessageMenu
      mine={view.mine}
      deleted={Boolean(view.deletedAt)}
      failed={view.delivery === 'failed'}
      pinned={state.pinnedIds.has(view.id)}
      saved={state.savedIds.has(view.id)}
      onReact={(emoji) => handleToggleReaction(view.id, emoji)}
      onAction={(action) => handleMessageAction(view, action)}
    >
      {item}
    </RoomMessageMenu>
  )

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ChatHeader theme={theme} subtitle={headerSubtitle} title={isThread ? 'Thread' : conversationType === 'channel' ? '#' + state.title.replace(/^#/, '') : state.title || 'Direct message'} topInset={insets.top} onDrawer={openDrawer} onBack={isThread ? () => router.back() : undefined} menu={[
          isThread ? (
            <Stack.Toolbar.MenuAction key="follow" icon={following ? 'bell.fill' : 'bell'} isOn={following} onPress={handleToggleFollow}>
              Follow thread
            </Stack.Toolbar.MenuAction>
          ) : null,
          <Stack.Toolbar.Menu key="panels" inline title="">
            <Stack.Toolbar.MenuAction icon="person.2" subtitle={`${activeParticipants.length} member${activeParticipants.length === 1 ? '' : 's'}`} onPress={() => setParticipantsOpen(true)}>
              Members
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="pin" subtitle={state.pinnedIds.size > 0 ? `${state.pinnedIds.size} pinned` : undefined} onPress={() => setPinsOpen(true)}>
              Pinned messages
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="bookmark" subtitle={state.savedIds.size > 0 ? `${state.savedIds.size} saved` : undefined} onPress={() => setSavedOpen(true)}>
              Saved messages
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>,
          <Stack.Toolbar.Menu key="notify" inline title="">
            <Stack.Toolbar.MenuAction icon={muted ? 'bell.slash.fill' : 'bell.slash'} isOn={muted} onPress={handleToggleMute}>
              Mute notifications
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>,
        ]} />

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' || Platform.OS === 'android' ? 'padding' : undefined}
        enabled={Platform.OS !== 'android' || keyboardVisible}
        keyboardVerticalOffset={headerHeight}
      >
        <View style={styles.transcriptRegion}>
          {state.loading && state.messages.length === 0 ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.textSecondary} />
            </View>
          ) : displayRecords.length === 0 ? (
            <EmptyState
              theme={theme}
              icon={conversationType === 'channel' ? 'hash' : 'message-circle'}
              title={isThread ? 'No replies yet' : 'No messages yet'}
              description={
                isThread
                  ? 'Start the thread below.'
                  : 'Send the first message to get things going.'
              }
            />
          ) : (
            <FlatList
              ref={listRef}
              data={displayRecords}
              keyExtractor={(item) => item.clientNonce ?? item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              onScroll={(event) => {
                const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
                nearBottomRef.current =
                  contentSize.height - contentOffset.y - layoutMeasurement.height < 120
              }}
              scrollEventThrottle={120}
              onContentSizeChange={() => {
                if (nearBottomRef.current) {
                  listRef.current?.scrollToEnd({ animated: false })
                }
              }}
              ListHeaderComponent={
                <View>
                  {isThread && rootMessage ? (
                    <View style={[styles.rootMessageWrap, { borderBottomColor: theme.border }]}>
                      {withMenu(
                        rootMessage,
                        <RoomMessageItem
                          view={rootMessage}
                          theme={theme}
                          reactions={state.reactions[rootMessage.id]}
                          pinned={state.pinnedIds.has(rootMessage.id)}
                          saved={state.savedIds.has(rootMessage.id)}
                          onToggleReaction={(emoji) => handleToggleReaction(rootMessage.id, emoji)}
                        />,
                      )}
                      <View style={styles.threadHeaderRow}>
                        <Text style={[styles.threadHeaderText, { color: theme.textSecondary }]}>
                          Thread
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  {!isThread && state.hasMore ? (
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={() => void loadOlderRef.current()}
                      style={styles.loadOlderButton}
                    >
                      {loadingOlder ? (
                        <ActivityIndicator size="small" color={theme.textSecondary} />
                      ) : (
                        <Text style={[styles.loadOlderText, { color: theme.textSecondary }]}>
                          Load earlier messages
                        </Text>
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
              }
            />
          )}
        </View>

        <View
          style={[
            styles.composerWrap,
            {
              paddingBottom: getComposerBottomInset(
                keyboardVisible,
                insets.bottom,
                spacing.sm,
                spacing.sm,
              ),
            },
          ]}
        >
          {editingMessageId ? (
            <View style={[styles.editingBar, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <Feather name="edit-2" size={13} color={theme.textSecondary} />
              <Text style={[styles.editingBarText, { color: theme.textSecondary }]}>Editing message</Text>
              <TouchableOpacity onPress={resetComposer} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={15} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : null}
          <Composer
            theme={theme}
            inputValue={input}
            onChangeInput={handleInputChange}
            onSend={() => void handleSend()}
            onStop={() => undefined}
            isSending={sending}
            placeholder={
              isThread
                ? 'Reply in thread'
                : conversationType === 'channel'
                    ? channelComposerPlaceholder(state.title)
                  : 'Message'
            }
            imageBase64={imageBase64}
            onClearImage={() => setImageBase64(null)}
            pendingDocuments={pendingDocuments}
            onRemoveDocument={(clientId) =>
              setPendingDocuments((current) => current.filter((doc) => doc.clientId !== clientId))
            }
            attachmentError={attachmentError}
            onPickImage={() => void handlePickImage()}
            onPickCamera={() => void handlePickCamera()}
            onPickFile={() => void handlePickFile()}
            mentions={mentions}
            onAddMention={(item) => setMentions((current) => [...current, item])}
            onRemoveMention={(item) =>
              setMentions((current) =>
                current.filter((mention) => !(mention.id === item.id && mention.type === item.type)),
              )
            }
            capabilities={null}
            selectedToolIds={[]}
            onToggleTool={() => undefined}
            memoryEnabled
            onToggleMemory={() => undefined}
            requestMode="chat"
            onChangeRequestMode={() => undefined}
            imageModels={[]}
            videoModels={[]}
            generationKind={null}
            selectedImageModelId={null}
            selectedVideoModelId={null}
            onSelectGeneration={() => undefined}
            replyContext={replyContext}
            onClearReply={() => setReplyContext(null)}
            inputRef={inputRef}
            mentionProvider={roomMentionProvider}
            mentionInsertStyle="text"
            showToolsButton={false}
          />
        </View>
      </KeyboardAvoidingView>

      <RoomMembersSheet
        open={participantsOpen}
        onClose={() => setParticipantsOpen(false)}
        roomLabel={roomLabel}
        members={activeParticipants.map((participant) => {
          const isSelf = participant.principalId === state.currentPrincipalId
          const typing = state.presence.some((presence) => presence.principalId === participant.principalId && presence.typing)
          return {
            id: participant.principalId,
            name: `${participant.displayName}${isSelf ? ' (you)' : ''}`,
            status: typing ? 'Typing…' : onlinePrincipalIds.has(participant.principalId) ? 'Online' : participant.principalType === 'agent' ? 'Agent' : 'Offline',
            moderator: participant.role === 'moderator',
            removable: !isSelf && canManageParticipants,
          }
        })}
        onAdd={canManageParticipants ? () => {
          setParticipantsOpen(false)
          router.push({ pathname: '/new-message', params: { add: conversationId, type: conversationType, exclude: activeParticipants.map((participant) => participant.principalId).join(',') } })
        } : undefined}
        onRemove={handleRemoveParticipant}
      />


      <RoomMessagesSheet
        kind="pinned"
        open={pinsOpen}
        onClose={() => setPinsOpen(false)}
        messages={messageRows(state.pinnedIds)}
        onRemove={handleTogglePin}
        onCopy={(text) => void Clipboard.setStringAsync(text)}
      />
      <RoomMessagesSheet
        kind="saved"
        open={savedOpen}
        onClose={() => setSavedOpen(false)}
        messages={messageRows(state.savedIds)}
        onRemove={handleToggleSaved}
        onCopy={(text) => void Clipboard.setStringAsync(text)}
      />
      <RoomConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, minHeight: 0 },
  transcriptRegion: { flex: 1, minHeight: 0 },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  daySeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  dayLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dayLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  loadOlderButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  loadOlderText: {
    fontSize: 12,
    fontWeight: '600',
  },
  rootMessageWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.sm,
  },
  threadHeaderRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  threadHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  composerWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  editingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 6,
  },
  editingBarText: {
    flex: 1,
    fontSize: 12,
  },
})

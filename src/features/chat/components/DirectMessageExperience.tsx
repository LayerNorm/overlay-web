'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Archive,
  Bell,
  BellOff,
  Hash,
  MoreHorizontal,
  Paperclip,
  Pin,
  Send,
  Share2,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import dynamic from 'next/dynamic'
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
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { ChatComposer } from './ChatComposer'
import { ChatDropOverlay } from './ChatDropOverlay'
import { useChatAttachments } from './useChatAttachments'
import { useComposerTextState } from './chat/useComposerTextState'
import { useChatPanels } from './chat/useChatPanels'
import { useChatShellPanels } from './chat/useChatShellPanels'
import { buildTextTurnPayload } from './chat/chat-send-body-builders'
import { RoomMessageItem } from './collaboration/RoomMessageItem'
import { toRoomMessageView, type RoomMessageRecord } from './collaboration/room-message-view'

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

export function DirectMessageExperience({
  conversationId,
  showcase = false,
  conversationType = 'dm',
}: {
  conversationId: string
  showcase?: boolean
  conversationType?: 'dm' | 'channel'
}) {
  const { activeWorkspaceId } = useWorkspace()
  const { capabilities } = useOverlayCapabilities()
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [addPeopleOpen, setAddPeopleOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
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
  const [threadRootId, setThreadRootId] = useState<string | null>(showcase && conversationType === 'channel' ? 'showcase-dm-message-1' : null)
  const [threadInput, setThreadInput] = useState('')
  const [agentResponding, setAgentResponding] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const lastTypingSentAt = useRef(0)
  const lastNotificationReadAt = useRef(0)

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
    setAttachmentPreviewMode,
    sourcesPanel,
  } = useChatPanels()

  const loadParticipants = useCallback(async () => {
    const result = await overlayAppClient.conversations.participants(conversationId)
    setParticipants(result.participants)
    setCurrentPrincipalId(result.currentPrincipalId)
  }, [conversationId])

  const loadMessages = useCallback(async () => {
    const result = await overlayAppClient.conversations.get<{
      messages: Array<{
        id: string
        authorKind: RoomMessageRecord['authorKind']
        authorPrincipalId?: string
        content?: string
        parts?: Array<{ type?: string; text?: string; url?: string; mediaType?: string; fileName?: string }>
        createdAt: number
        editedAt?: number
        deletedAt?: number
        clientNonce?: string
        threadRootMessageId?: string
        status?: 'generating' | 'completed' | 'error'
      }>
    }>({ conversationId, messages: true, limit: 100 })
    const persisted = (result.messages ?? []).map((message) => ({
      ...message,
      content: message.content
        ?? message.parts?.find((part) => part.type === 'text')?.text
        ?? '',
      turnId: message.id,
    }))
    setMessages((current) => {
      const persistedNonces = new Set(persisted.map((message) => message.clientNonce).filter(Boolean))
      const pending = current.filter((message) => (
        message.delivery && message.clientNonce && !persistedNonces.has(message.clientNonce)
      ))
      return [...persisted, ...pending].sort((a, b) => a.createdAt - b.createdAt)
    })
    await overlayAppClient.conversations.updateParticipantState(conversationId, { markRead: true })
    if (Date.now() - lastNotificationReadAt.current > 10_000) {
      lastNotificationReadAt.current = Date.now()
      const { notifications } = await overlayAppClient.conversations.notifications({
        unreadOnly: true,
        limit: 100,
      })
      const notificationIds = notifications
        .filter((notification) => notification.conversationId === conversationId)
        .map((notification) => notification.id)
      if (notificationIds.length > 0) {
        await overlayAppClient.conversations.markNotificationsRead(notificationIds)
      }
    }
  }, [conversationId])

  const loadPresence = useCallback(async () => {
    const result = await overlayAppClient.conversations.presence(conversationId)
    setPresence(result.presence)
  }, [conversationId])

  const loadCollaboration = useCallback(async () => {
    const [reactionResult, pinResult, savedResult, channelResult] = await Promise.all([
      overlayAppClient.conversations.reactions(conversationId),
      overlayAppClient.conversations.pins(conversationId),
      overlayAppClient.conversations.savedMessages(),
      conversationType === 'channel' ? overlayAppClient.conversations.channels() : Promise.resolve({ channels: [] }),
    ])
    setReactions(reactionResult.reactions)
    setPins(pinResult.pins)
    setSavedMessages(savedResult.savedMessages)
    if (conversationType === 'channel') {
      setChannel(channelResult.channels.find((item) => item.conversationId === conversationId) ?? null)
    }
  }, [conversationId, conversationType])

  useEffect(() => {
    if (showcase) return
    let cancelled = false
    const initialLoadTimer = window.setTimeout(() => {
      void Promise.all([loadParticipants(), loadMessages(), loadPresence(), loadCollaboration()])
        .catch(() => {
          if (!cancelled) setNotice('This conversation is unavailable.')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 0)
    void overlayAppClient.conversations.updatePresence(conversationId, { status: 'online' })
    const messagesTimer = window.setInterval(() => void loadMessages().catch(() => undefined), 2_000)
    const presenceTimer = window.setInterval(() => void loadPresence().catch(() => undefined), 3_000)
    const heartbeatTimer = window.setInterval(() => {
      void overlayAppClient.conversations.updatePresence(conversationId, { status: 'online' })
    }, 45_000)
    return () => {
      cancelled = true
      window.clearTimeout(initialLoadTimer)
      window.clearInterval(messagesTimer)
      window.clearInterval(presenceTimer)
      window.clearInterval(heartbeatTimer)
      void overlayAppClient.conversations.updatePresence(conversationId, { status: 'offline' })
    }
  }, [conversationId, loadCollaboration, loadMessages, loadParticipants, loadPresence, showcase])

  useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length])

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
    : otherParticipants.map((participant) => participant.displayName).join(', ') || 'Direct message'
  const online = presence.filter((row) => (
    row.principalId !== currentPrincipalId && row.status === 'online'
  )).length
  const typingNames = presence
    .filter((row) => row.principalId !== currentPrincipalId && row.typing)
    .map((row) => participants.find((participant) => participant.principalId === row.principalId)?.displayName)
    .filter((name): name is string => Boolean(name))
  const currentParticipant = participants.find((participant) => participant.principalId === currentPrincipalId)
  const mainMessages = messages.filter((message) => !message.threadRootMessageId)
  const threadRoot = messages.find((message) => message.id === threadRootId)
  const threadReplies = messages.filter((message) => message.threadRootMessageId === threadRootId)

  const mentionCategories: MentionCategory[] = useMemo(() => {
    const items = participants
      .filter((participant) => participant.status === 'active' && participant.principalId !== currentPrincipalId)
      .map((participant) => ({
        type: 'person' as const,
        id: participant.principalId,
        name: participant.displayName,
        description: participant.principalType === 'agent' ? 'Agent' : 'Member',
        icon: 'Users',
      }))
    return items.length ? [{ type: 'person', label: 'People', icon: 'Users', items }] : []
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
      } satisfies OptimisticMessage].sort((a, b) => a.createdAt - b.createdAt))
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
    ].sort((a, b) => a.createdAt - b.createdAt))
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
      await overlayAppClient.conversations.addMessage({
        conversationId,
        turnId,
        role: 'user',
        mode: 'act',
        content: text,
        contentType: 'text',
        clientNonce,
        mentionedPrincipalIds,
        threadRootMessageId,
        ...(parts?.length ? { parts: parts as Array<Record<string, unknown>> } : {}),
        ...(options?.attachmentNames?.length ? { attachmentNames: options.attachmentNames } : {}),
        ...(options?.reply?.replyToTurnId
          ? { replyToTurnId: options.reply.replyToTurnId, replySnippet: options.reply.snippet }
          : {}),
      })
      await loadMessages()
    } catch {
      setMessages((current) => current.map((message) => (
        message.clientNonce === clientNonce ? { ...message, delivery: 'failed' } : message
      )))
    } finally {
      setAgentResponding(null)
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
      })
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
    setReactions(result.reactions)
  }

  async function togglePinned(messageId: string) {
    const pinned = pins.some((pin) => pin.messageId === messageId)
    if (showcase) {
      setPins((rows) => pinned ? rows.filter((row) => row.messageId !== messageId) : [...rows, { conversationId, messageId, pinnedByPrincipalId: currentPrincipalId, createdAt: Date.now() }])
      return
    }
    await overlayAppClient.conversations.setPinned(conversationId, { messageId, pinned: !pinned })
    const result = await overlayAppClient.conversations.pins(conversationId)
    setPins(result.pins)
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
    setSavedMessages(result.savedMessages)
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
    setAttachmentPreviewMode,
    sourcesPanel,
    renderAttachmentViewer,
  })

  function renderMessage(message: OptimisticMessage, options?: { inThread?: boolean }) {
    const author = participants.find((participant) => participant.principalId === message.authorPrincipalId)
    const view = toRoomMessageView({
      message,
      currentPrincipalId,
      authorName: author?.displayName
        ?? (message.authorKind === 'agent' || message.authorKind === 'model' ? 'Agent' : 'Overlay'),
      streaming: false,
    })
    return (
      <RoomMessageItem
        key={message.id}
        message={view}
        reactions={reactions
          .filter((reaction) => reaction.messageId === message.id && reaction.count > 0)
          .map((reaction) => ({
            emoji: reaction.emoji,
            count: reaction.count,
            reactedByCurrentPrincipal: reaction.reactedByCurrentPrincipal,
          }))}
        replyCount={options?.inThread
          ? 0
          : messages.filter((reply) => reply.threadRootMessageId === message.id).length}
        pinned={pins.some((pin) => pin.messageId === message.id)}
        saved={savedMessages.some((row) => row.messageId === message.id)}
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
        onOpenThread={() => setThreadRootId(options?.inThread ? threadRootId : message.id)}
        onQuoteReply={() => beginQuoteReply(message)}
        onRetrySend={() => void sendMessage(message.content, { existing: message, threadRootMessageId: message.threadRootMessageId })}
        onOpenAttachmentPreview={openAttachmentPreview}
      />
    )
  }

  return (
    <>
      <AppScreenShell
        contentClassName="flex min-h-0"
        rightPanel={shellRightPanel}
        rightPanelOpen={Boolean(shellRightPanel)}
        rightPanelWidth={shellRightPanelWidth}
        rightPanelMode={shellRightPanelMode}
        onRightPanelClose={shellRightPanelClose}
      >
        <div
          className={`relative flex min-h-0 w-full min-w-0 flex-1 flex-col ${threadRoot ? 'md:pr-[420px]' : ''}`}
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
                {conversationType === 'channel' ? <Hash size={15} /> : <UsersRound size={15} />}
              </span>
            )}
            actions={(
              <div className="relative flex items-center gap-1">
                {pins.length > 0 ? (
                  <span className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-[var(--muted)]">
                    <Pin size={13} />{pins.length}
                  </span>
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
                  onClick={() => setPeopleOpen((open) => !open)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                >
                  <UsersRound size={14} />
                  {participants.length}
                </button>
                <button
                  type="button"
                  aria-label="Conversation options"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                >
                  <MoreHorizontal size={15} />
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 top-10 z-30 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-1 shadow-xl">
                    <MenuButton
                      icon={currentParticipant?.notificationLevel === 'muted' ? Bell : BellOff}
                      label={currentParticipant?.notificationLevel === 'muted' ? 'Unmute' : 'Mute'}
                      onClick={() => void updateState({
                        notificationLevel: currentParticipant?.notificationLevel === 'muted' ? 'all' : 'muted',
                      }, currentParticipant?.notificationLevel === 'muted' ? 'Notifications on' : 'Conversation muted')}
                    />
                    <MenuButton
                      icon={Bell}
                      label="Mark unread"
                      onClick={() => void updateState({ markUnread: true }, 'Marked unread')}
                    />
                    <MenuButton
                      icon={Archive}
                      label="Archive"
                      onClick={() => void updateState({ archived: true }, 'Conversation archived')}
                    />
                  </div>
                ) : null}
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
              <div
                ref={listRef}
                className="h-full min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 sm:px-4 sm:py-4"
              >
                <div className="mx-auto flex min-h-full w-full min-w-0 max-w-4xl flex-col gap-5 sm:gap-6">
                  {loading ? (
                    <div className="space-y-5" aria-label="Loading messages">
                      {[0, 1, 2].map((row) => (
                        <div key={row} className="h-16 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
                      ))}
                    </div>
                  ) : mainMessages.length === 0 ? (
                    <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
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
                    mainMessages.map((message) => renderMessage(message))
                  )}
                  {agentResponding ? (
                    <div className="flex items-center gap-2 px-1" aria-label={`${agentResponding} is responding`}>
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
            <p
              role="status"
              aria-live="polite"
              data-testid="conversation-activity-status"
              className="mx-auto h-4 w-full max-w-[56rem] px-4 text-[11px] text-[var(--muted-light)]"
            >
              {typingNames.length > 0
                ? `${typingNames.join(', ')} ${typingNames.length === 1 ? 'is' : 'are'} typing`
                : agentResponding ? `${agentResponding} is responding` : ''}
            </p>
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

      {peopleOpen ? (
        <div className="fixed inset-y-0 right-0 z-40 w-[min(340px,calc(100vw-2rem))] border-l border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl">
          <div className="flex h-16 items-center justify-between border-b border-[var(--border)] px-5">
            <h2 className="text-sm font-medium">People</h2>
            <button type="button" onClick={() => setPeopleOpen(false)} aria-label="Close people"><X size={15} /></button>
          </div>
          <div className="space-y-1 p-3">
            {participants.map((participant) => (
              <div key={participant.principalId} className="flex items-center gap-3 rounded-lg px-3 py-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)] text-xs">
                  {participant.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{participant.principalId === currentPrincipalId ? 'You' : participant.displayName}</span>
                  <span className="block text-[11px] capitalize text-[var(--muted-light)]">{participant.role}</span>
                </span>
                <span className={`h-2 w-2 rounded-full ${
                  presence.find((row) => row.principalId === participant.principalId)?.status === 'online'
                    ? 'bg-emerald-500'
                    : 'bg-[var(--border)]'
                }`} />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setAddPeopleOpen(true)}
              className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-[var(--border)]"><UserPlus size={14} /></span>
              Add people
            </button>
          </div>
        </div>
      ) : null}

      {threadRoot ? (
        <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl md:w-[420px]" aria-label="Message thread">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] px-5">
            <div>
              <h2 className="text-sm font-medium">Thread</h2>
              <p className="text-[10px] text-[var(--muted-light)]">{conversationType === 'channel' ? `#${title}` : title}</p>
            </div>
            <button type="button" onClick={() => setThreadRootId(null)} aria-label="Close thread" className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-subtle)]"><X size={15} /></button>
          </div>
          <div className="overlay-chat-surface min-h-0 flex-1 overflow-y-auto p-5">
            <div className="flex flex-col gap-5">
              {[threadRoot, ...threadReplies].map((message) => renderMessage(message, { inThread: true }))}
            </div>
          </div>
          <form
            className="m-4 flex shrink-0 items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-2 focus-within:border-[var(--muted-light)]"
            onSubmit={(event) => {
              event.preventDefault()
              const text = threadInput
              setThreadInput('')
              void sendMessage(text, { threadRootMessageId: threadRoot.id })
            }}
          >
            <textarea
              value={threadInput}
              onChange={(event) => setThreadInput(event.target.value)}
              rows={1}
              placeholder="Reply…"
              className="min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[var(--muted-light)]"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <button type="submit" disabled={!threadInput.trim()} aria-label="Send thread reply" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] disabled:opacity-30"><Send size={14} /></button>
          </form>
        </aside>
      ) : null}

      {addPeopleOpen ? (
        <NewDirectMessageDialog
          open
          showcase={showcase}
          workspaceId={currentParticipant?.workspaceId ?? ''}
          addToConversationId={conversationId}
          excludedPrincipalIds={participants.map((participant) => participant.principalId)}
          onOpenChange={setAddPeopleOpen}
          onParticipantsAdded={() => {
            setAddPeopleOpen(false)
            void loadParticipants()
          }}
        />
      ) : null}
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
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

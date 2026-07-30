'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  Archive,
  Bell,
  BellOff,
  Bookmark,
  Hash,
  Check,
  MessageSquareReply,
  MoreHorizontal,
  Pencil,
  Pin,
  Send,
  SmilePlus,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { Button, Input } from '@overlay/ui/primitives'
import type {
  ChannelSummary,
  ConversationPin,
  ConversationParticipant,
  ConversationPresence,
  ConversationSavedMessage,
  MessageReaction,
} from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { NewDirectMessageDialog } from './NewDirectMessageDialog'

type DirectMessage = {
  id: string
  authorKind: 'human' | 'agent' | 'model' | 'system'
  authorPrincipalId?: string
  content: string
  createdAt: number
  editedAt?: number
  deletedAt?: number
  clientNonce?: string
  threadRootMessageId?: string
}

type OptimisticMessage = DirectMessage & {
  delivery?: 'sending' | 'failed'
  turnId: string
}

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
  const [input, setInput] = useState('')
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
  const listRef = useRef<HTMLDivElement>(null)
  const lastTypingSentAt = useRef(0)
  const lastNotificationReadAt = useRef(0)

  const loadParticipants = useCallback(async () => {
    const result = await overlayAppClient.conversations.participants(conversationId)
    setParticipants(result.participants)
    setCurrentPrincipalId(result.currentPrincipalId)
  }, [conversationId])

  const loadMessages = useCallback(async () => {
    const result = await overlayAppClient.conversations.get<{
      messages: Array<{
        id: string
        authorKind: DirectMessage['authorKind']
        authorPrincipalId?: string
        content?: string
        parts?: Array<{ type?: string; text?: string }>
        createdAt: number
        editedAt?: number
        deletedAt?: number
        clientNonce?: string
        threadRootMessageId?: string
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

  async function sendMessage(
    content: string,
    existing?: Pick<OptimisticMessage, 'clientNonce' | 'turnId' | 'createdAt'>,
    threadRootMessageId?: string,
  ) {
    const text = content.trim()
    if (!text) return
    const clientNonce = existing?.clientNonce ?? crypto.randomUUID()
    const turnId = existing?.turnId ?? `human_${crypto.randomUUID()}`
    const optimisticId = `optimistic_${clientNonce}`
    if (showcase) {
      setMessages((current) => [...current, {
        id: optimisticId,
        turnId,
        authorKind: 'human',
        authorPrincipalId: currentPrincipalId,
        content: text,
        createdAt: existing?.createdAt ?? Date.now(),
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
        createdAt: existing?.createdAt ?? Date.now(),
        clientNonce,
        delivery: 'sending',
        threadRootMessageId,
      } satisfies OptimisticMessage,
    ].sort((a, b) => a.createdAt - b.createdAt))
    try {
      const mentionedPrincipalIds = participants
        .filter((participant) => text.toLowerCase().includes(`@${participant.displayName.toLowerCase()}`))
        .map((participant) => participant.principalId)
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
      })
      await loadMessages()
    } catch {
      setMessages((current) => current.map((message) => (
        message.clientNonce === clientNonce ? { ...message, delivery: 'failed' } : message
      )))
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

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = input
    setInput('')
    await sendMessage(text)
  }

  function onInput(value: string) {
    setInput(value)
    if (showcase) return
    const now = Date.now()
    if (now - lastTypingSentAt.current > 2_500) {
      lastTypingSentAt.current = now
      void overlayAppClient.conversations.updatePresence(conversationId, {
        status: 'online',
        typing: Boolean(value.trim()),
      })
    }
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

  return (
    <>
      <AppScreenShell>
        <div className={`flex min-h-0 flex-1 flex-col ${threadRoot ? 'md:pr-[420px]' : ''}`}>
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
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
              <div className="mx-auto w-full max-w-3xl">
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
                  <div className="space-y-5">
                    {mainMessages.map((message) => {
                      const author = participants.find((participant) => participant.principalId === message.authorPrincipalId)
                      const mine = message.authorPrincipalId === currentPrincipalId
                      return (
                        <div key={message.id} className="group flex gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[11px] font-medium text-[var(--muted)]">
                            {(author?.displayName ?? 'AI').slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs font-medium text-[var(--foreground)]">
                                {mine ? 'You' : author?.displayName ?? (message.authorKind === 'agent' ? 'Agent' : 'Overlay')}
                              </span>
                              <time className="text-[10px] text-[var(--muted-light)]">
                                {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                              </time>
                              {message.editedAt ? <span className="text-[10px] text-[var(--muted-light)]">edited</span> : null}
                              {message.delivery === 'sending' ? <span className="text-[10px] text-[var(--muted-light)]">sending</span> : null}
                            </div>
                            {message.deletedAt ? (
                              <p className="mt-1 text-sm italic text-[var(--muted-light)]">Message deleted</p>
                            ) : editingId === message.id ? (
                              <div className="mt-1 flex gap-2">
                                <Input
                                  autoFocus
                                  value={editingContent}
                                  onChange={(event) => setEditingContent(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') void saveEdit(message.id)
                                    if (event.key === 'Escape') setEditingId(null)
                                  }}
                                />
                                <Button size="sm" variant="primary" onClick={() => void saveEdit(message.id)}><Check size={13} /></Button>
                              </div>
                            ) : (
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground)]">
                                {message.content}
                              </p>
                            )}
                            {message.delivery === 'failed' ? (
                              <button
                                type="button"
                                className="mt-1 text-[11px] font-medium text-red-500 hover:underline"
                                onClick={() => void sendMessage(message.content, message)}
                              >
                                Failed to send · Retry
                              </button>
                            ) : null}
                            {!message.deletedAt ? (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {reactions.filter((reaction) => reaction.messageId === message.id && reaction.count > 0).map((reaction) => (
                                  <button
                                    key={reaction.emoji}
                                    type="button"
                                    onClick={() => void toggleReaction(message.id, reaction.emoji)}
                                    className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] ${reaction.reactedByCurrentPrincipal ? 'border-[var(--foreground)] bg-[var(--surface-subtle)]' : 'border-[var(--border)]'}`}
                                  >
                                    <span>{reaction.emoji}</span><span>{reaction.count}</span>
                                  </button>
                                ))}
                                {messages.some((reply) => reply.threadRootMessageId === message.id) ? (
                                  <button type="button" onClick={() => setThreadRootId(message.id)} className="text-[11px] font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
                                    {messages.filter((reply) => reply.threadRootMessageId === message.id).length} replies
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          {!message.deletedAt && !message.delivery ? (
                            <div className="flex h-7 shrink-0 items-center rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                              <button type="button" aria-label="Add reaction" onClick={() => void toggleReaction(message.id, '👍')} className="flex h-7 w-7 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"><SmilePlus size={12} /></button>
                              <button type="button" aria-label="Reply in thread" onClick={() => setThreadRootId(message.id)} className="flex h-7 w-7 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"><MessageSquareReply size={12} /></button>
                              <button type="button" aria-label={pins.some((pin) => pin.messageId === message.id) ? 'Unpin message' : 'Pin message'} onClick={() => void togglePinned(message.id)} className="flex h-7 w-7 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"><Pin size={12} /></button>
                              <button type="button" aria-label={savedMessages.some((row) => row.messageId === message.id) ? 'Remove from saved' : 'Save message'} onClick={() => void toggleSaved(message.id)} className="flex h-7 w-7 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"><Bookmark size={12} /></button>
                              {mine ? (
                                <>
                              <button
                                type="button"
                                aria-label="Edit message"
                                onClick={() => {
                                  setEditingId(message.id)
                                  setEditingContent(message.content)
                                }}
                                className="flex h-7 w-7 items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)]"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete message"
                                onClick={() => void deleteMessage(message.id)}
                                className="flex h-7 w-7 items-center justify-center text-[var(--muted)] hover:text-red-500"
                              >
                                <Trash2 size={12} />
                              </button>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 px-4 pb-4 sm:px-8 sm:pb-6">
              <div className="mx-auto max-w-3xl">
                {typingNames.length > 0 ? (
                  <p className="mb-1.5 h-4 text-[11px] text-[var(--muted-light)]">
                    {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing
                  </p>
                ) : <div className="mb-1.5 h-4" />}
                <form
                  onSubmit={(event) => void submit(event)}
                  className="flex items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-2 shadow-sm focus-within:border-[var(--muted-light)]"
                >
                  <textarea
                    value={input}
                    onChange={(event) => onInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        event.currentTarget.form?.requestSubmit()
                      }
                    }}
                    rows={1}
                    placeholder={`Message ${title}`}
                    className="max-h-36 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)]"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="Send message"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-opacity disabled:opacity-30"
                  >
                    <Send size={14} />
                  </button>
                </form>
                <p className="mt-1.5 px-1 text-[10px] text-[var(--muted-light)]">
                  Enter to send · Shift Enter for a new line · Use @name to notify someone
                </p>
              </div>
            </div>
          </AppScreenBody>
        </div>
      </AppScreenShell>

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
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {[threadRoot, ...threadReplies].map((message, index) => {
              const author = participants.find((participant) => participant.principalId === message.authorPrincipalId)
              return (
                <div key={message.id} className={`${index > 0 ? 'mt-5 border-t border-[var(--border)] pt-5' : ''} flex gap-3`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[11px] font-medium text-[var(--muted)]">{(author?.displayName ?? 'AI').slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium">{message.authorPrincipalId === currentPrincipalId ? 'You' : author?.displayName ?? 'Overlay'}</span>
                      <time className="text-[10px] text-[var(--muted-light)]">{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{message.deletedAt ? 'Message deleted' : message.content}</p>
                  </div>
                </div>
              )
            })}
          </div>
          <form
            className="m-4 flex shrink-0 items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-2 focus-within:border-[var(--muted-light)]"
            onSubmit={(event) => {
              event.preventDefault()
              const text = threadInput
              setThreadInput('')
              void sendMessage(text, undefined, threadRoot.id)
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

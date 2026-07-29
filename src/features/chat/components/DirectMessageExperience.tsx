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
  Check,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { Button, Input } from '@overlay/ui/primitives'
import type {
  ConversationParticipant,
  ConversationPresence,
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
]

export function DirectMessageExperience({
  conversationId,
  showcase = false,
}: {
  conversationId: string
  showcase?: boolean
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

  useEffect(() => {
    if (showcase) return
    let cancelled = false
    const initialLoadTimer = window.setTimeout(() => {
      void Promise.all([loadParticipants(), loadMessages(), loadPresence()])
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
  }, [conversationId, loadMessages, loadParticipants, loadPresence, showcase])

  useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length])

  const otherParticipants = participants.filter((participant) => participant.principalId !== currentPrincipalId)
  const title = otherParticipants.map((participant) => participant.displayName).join(', ') || 'Direct message'
  const online = presence.filter((row) => (
    row.principalId !== currentPrincipalId && row.status === 'online'
  )).length
  const typingNames = presence
    .filter((row) => row.principalId !== currentPrincipalId && row.typing)
    .map((row) => participants.find((participant) => participant.principalId === row.principalId)?.displayName)
    .filter((name): name is string => Boolean(name))
  const currentParticipant = participants.find((participant) => participant.principalId === currentPrincipalId)

  async function sendMessage(
    content: string,
    existing?: Pick<OptimisticMessage, 'clientNonce' | 'turnId' | 'createdAt'>,
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
      })
      await loadMessages()
    } catch {
      setMessages((current) => current.map((message) => (
        message.clientNonce === clientNonce ? { ...message, delivery: 'failed' } : message
      )))
    }
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
        <div className="flex min-h-0 flex-1 flex-col">
          <AppScreenHeader
            title={title}
            subtitle={participants.length > 2 ? `${participants.length} people` : online > 0 ? 'Online' : undefined}
            leading={(
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
                <UsersRound size={15} />
              </span>
            )}
            actions={(
              <div className="relative flex items-center gap-1">
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
                ) : messages.length === 0 ? (
                  <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
                      <UsersRound size={20} />
                    </span>
                    <h2 className="mt-4 text-base font-medium text-[var(--foreground)]">{title}</h2>
                    <p className="mt-1 max-w-sm text-sm text-[var(--muted)]">
                      This is the beginning of your conversation. Messages are visible only to its participants.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {messages.map((message) => {
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
                          </div>
                          {mine && !message.deletedAt && !message.delivery ? (
                            <div className="flex h-7 shrink-0 items-center rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
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

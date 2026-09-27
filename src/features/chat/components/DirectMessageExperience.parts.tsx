'use client'

import { useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Archive,
  Bell,
  BellOff,
  Hash,
  Monitor,
  MoreHorizontal,
  Paperclip,
  Pin,
  Share2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { FloatingMenu, MenuItem } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import { AttachmentPreviewDialog } from '@overlay/chat-react'
import type { AttachmentPreview } from '@overlay/chat-react'
import type {
  ConversationParticipant,
  ConversationPresence,
} from '@overlay/workspace-contracts'
import type { MentionCategory, MentionItem } from '@/shared/knowledge/mention-types'
import type { CapabilityCheck } from '@overlay/app-core'
import { useQuery } from '@/components/providers/convex-hooks'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { ChatComposer } from './ChatComposer'
import { ConversationScopeActionDialog } from './collaboration/ConversationScopeActionDialog'
import { ConvexRoomMessageSubscription } from './collaboration/ConvexRoomMessageSubscription'
import { NewDirectMessageDialog } from './NewDirectMessageDialog'
import { ShareDialog } from '@/components/share/ShareDialog'
import { AttachResourceDialog } from '@/components/share/AttachResourceDialog'
import { RoomMessageItem } from './collaboration/RoomMessageItem'
import {
  roomMessageRowKey,
  toRoomMessageView,
  type RoomMessageRecord,
} from './collaboration/room-message-view'
import {
  RoomPeoplePanel,
  RoomPinnedPanel,
  RoomThreadPanel,
  type RoomPanelKind,
} from './collaboration/RoomSidePanels'
import type {
  OptimisticMessage,
  RoomMessageContext,
  useAgentDesktop,
  useMessageActions,
  useMessageNavigation,
  useReadMarkers,
  useRoomActions,
  useRoomCollaboration,
  useRoomComposer,
  useRoomPanels,
  useRoomRoster,
  useRoomTranscript,
  useRoomViewModels,
  useThreadPanel,
} from './DirectMessageExperience.hooks'

const FileViewerPanel = dynamic(
  () => import('@overlay/modules-react/knowledge').then((mod) => ({ default: mod.FileViewerPanel })),
  { loading: () => null },
)

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

export function AttachmentViewer({
  preview,
  headerRight,
}: {
  preview: AttachmentPreview
  headerRight: React.ReactNode
}) {
  return (
    <FileViewerPanel
      name={preview.name}
      content={preview.content}
      url={preview.url}
      headerRight={headerRight}
    />
  )
}

export function ConvexPresenceSubscription({
  accessToken,
  actorUserId,
  conversationId,
  onPresence,
  workspaceId,
}: {
  accessToken: string
  actorUserId: string
  conversationId: string
  onPresence: (presence: ConversationPresence[]) => void
  workspaceId: string
}) {
  const result = useQuery(
    api.collaboration.directMessages.watchPresence,
    {
      accessToken,
      actorUserId,
      conversationId: conversationId as Id<'conversations'>,
      workspaceId,
    },
  ) as { ok: boolean; presence: ConversationPresence[] } | undefined

  useEffect(() => {
    if (result?.ok && Array.isArray(result.presence)) onPresence(result.presence)
  }, [onPresence, result])

  return null
}

export function RoomRealtimeSubscriptions({
  enabled,
  accessToken,
  actorUserId,
  conversationId,
  threadRootId,
  workspaceId,
  onMessages,
  onPresence,
}: {
  enabled: boolean
  accessToken: string | null | undefined
  actorUserId: string | undefined
  conversationId: string
  threadRootId: string | null
  workspaceId: string | null | undefined
  onMessages: (messages: RoomMessageRecord[]) => void
  onPresence: (presence: ConversationPresence[]) => void
}) {
  if (!enabled || !actorUserId || !accessToken || !workspaceId) return null
  return (
    <>
      <ConvexRoomMessageSubscription
        accessToken={accessToken}
        actorUserId={actorUserId}
        conversationId={conversationId}
        threadRootMessageId={threadRootId}
        workspaceId={workspaceId}
        onMessages={onMessages}
      />
      <ConvexPresenceSubscription
        accessToken={accessToken}
        actorUserId={actorUserId}
        conversationId={conversationId}
        onPresence={onPresence}
        workspaceId={workspaceId}
      />
    </>
  )
}

export function RoomHeaderIcon({
  conversationType,
  otherCount,
  size,
}: {
  conversationType: 'dm' | 'channel'
  otherCount: number
  size: number
}) {
  if (conversationType === 'channel') return <Hash size={size} />
  if (otherCount <= 1) return <UserRound size={size} />
  return <UsersRound size={size} />
}

export function RoomHeaderLeading({
  soloAgentParticipant,
  headerAgent,
  conversationType,
  otherCount,
}: {
  soloAgentParticipant: ConversationParticipant | null
  headerAgent: { name: string; avatarColor?: string; avatarShape?: string } | null
  conversationType: 'dm' | 'channel'
  otherCount: number
}) {
  if (soloAgentParticipant) {
    return <AgentCreature agent={headerAgent ?? { name: soloAgentParticipant.displayName }} size={32} />
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
      <RoomHeaderIcon conversationType={conversationType} otherCount={otherCount} size={15} />
    </span>
  )
}

function AgentDesktopButton({ desktop }: { desktop: ReturnType<typeof useAgentDesktop> }) {
  const { agentComputer, desktopOpenBusy, openAgentDesktop } = desktop
  if (!agentComputer || (agentComputer.status !== 'ready' && agentComputer.status !== 'stopped')) return null
  return (
    <button
      type="button"
      onClick={openAgentDesktop}
      disabled={desktopOpenBusy}
      title={agentComputer.status === 'stopped' ? 'View desktop — resumes the machine' : 'View desktop'}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] disabled:opacity-60"
    >
      <span className="relative">
        <Monitor size={14} />
        <span
          className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${
            agentComputer.status === 'ready' ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
        />
      </span>
      <span className="hidden sm:inline">{desktopOpenBusy ? 'Opening…' : 'Desktop'}</span>
    </button>
  )
}

export function RoomHeaderActions({
  desktop,
  vm,
  roster,
  collab,
  roomActions,
  showcase,
  headerActions,
  roomPanel,
  setRoomPanel,
  menuOpen,
  setMenuOpen,
  menuTriggerRef,
  onAttach,
  onShare,
}: {
  desktop: ReturnType<typeof useAgentDesktop>
  vm: ReturnType<typeof useRoomViewModels>
  roster: ReturnType<typeof useRoomRoster>
  collab: ReturnType<typeof useRoomCollaboration>
  roomActions: ReturnType<typeof useRoomActions>
  showcase: boolean
  headerActions: ReactNode
  roomPanel: RoomPanelKind | null
  setRoomPanel: Dispatch<SetStateAction<RoomPanelKind | null>>
  menuOpen: boolean
  setMenuOpen: Dispatch<SetStateAction<boolean>>
  menuTriggerRef: React.RefObject<HTMLButtonElement | null>
  onAttach: () => void
  onShare: () => void
}) {
  const { currentParticipant } = vm
  const { updateState: onUpdateState, archiveMenuAction: onArchive } = roomActions
  return (
    <div className="relative flex items-center gap-1">
      <AgentDesktopButton desktop={desktop} />
      {headerActions}
      {collab.pins.length > 0 ? (
        <button
          type="button"
          onClick={() => setRoomPanel((current) => (current === 'pinned' ? null : 'pinned'))}
          aria-pressed={roomPanel === 'pinned'}
          title="Pinned messages"
          className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
            roomPanel === 'pinned' ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'text-[var(--muted)]'
          }`}
        >
          <Pin size={13} />{collab.pins.length}
        </button>
      ) : null}
      {!showcase ? (
        <button
          type="button"
          onClick={onAttach}
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
          onClick={onShare}
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
        {roster.participants.length}
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
              void onUpdateState({
                notificationLevel: currentParticipant?.notificationLevel === 'muted' ? 'all' : 'muted',
              }, currentParticipant?.notificationLevel === 'muted' ? 'Notifications on' : 'Conversation muted')
            }}
          />
          <MenuButton
            icon={Bell}
            label="Mark unread"
            onClick={() => {
              setMenuOpen(false)
              void onUpdateState({ markUnread: true }, 'Marked unread')
            }}
          />
          <MenuButton
            icon={Archive}
            label={currentParticipant?.archivedAt ? 'Restore' : 'Archive'}
            onClick={onArchive}
          />
      </FloatingMenu>
    </div>
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

export function RoomNoticeBar({
  notice,
  onDismiss,
}: {
  notice: string | null
  onDismiss: () => void
}) {
  if (!notice) return null
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-xs text-[var(--muted)]">
      <span>{notice}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss"><X size={13} /></button>
    </div>
  )
}


function resolveMessageAuthorName(message: OptimisticMessage, ctx: RoomMessageContext): string {
  return message.importedAuthorName?.trim()
    ?? (message.authorPrincipalId ? ctx.directoryAgentsByPrincipal.get(message.authorPrincipalId)?.name : undefined)
    ?? ctx.participants.find((participant) => participant.principalId === message.authorPrincipalId)?.displayName
    ?? (message.authorKind === 'agent' || message.authorKind === 'model' ? 'Agent' : 'Someone')
}

function buildRoomMessageItemProps({
  view,
  message,
  ctx,
  inThread,
  grouped,
  teaserMessage,
  teaserAuthor,
}: {
  view: ReturnType<typeof toRoomMessageView>
  message: OptimisticMessage
  ctx: RoomMessageContext
  inThread?: boolean
  grouped?: boolean
  teaserMessage: OptimisticMessage | null
  teaserAuthor: string | null
}) {
  return {
    message: view,
    reactions: ctx.reactions
      .filter((reaction) => reaction.messageId === message.id && reaction.count > 0)
      .map((reaction) => ({
        emoji: reaction.emoji,
        count: reaction.count,
        reactedByCurrentPrincipal: reaction.reactedByCurrentPrincipal,
      })),
    replyCount: inThread ? 0 : ctx.replyCounts.get(message.id) ?? 0,
    threadTeaser: teaserMessage && teaserAuthor ? {
      authorName: teaserAuthor,
      text: teaserMessage.content.trim().slice(0, 120),
      createdAt: teaserMessage.createdAt,
    } : null,
    pinned: ctx.pins.some((pin) => pin.messageId === message.id),
    saved: ctx.savedMessages.some((row) => (
      row.conversationId === ctx.conversationId && row.messageId === message.id
    )),
    editing: ctx.editingId === message.id,
    editingContent: ctx.editingContent,
    onEditingContentChange: ctx.setEditingContent,
    onSaveEdit: () => void ctx.saveEdit(message.id),
    onCancelEdit: () => ctx.setEditingId(null),
    onStartEdit: () => {
      ctx.setEditingId(message.id)
      ctx.setEditingContent(message.content)
    },
    onDelete: () => void ctx.deleteMessage(message.id),
    onReport: () => void ctx.reportMessage(message.id),
    onToggleReaction: (emoji: string) => void ctx.toggleReaction(message.id, emoji),
    onTogglePinned: () => void ctx.togglePinned(message.id),
    onToggleSaved: () => void ctx.toggleSaved(message.id),
    onOpenThread: () => ctx.openThread(inThread ? ctx.threadRootId ?? message.id : message.id),
    onQuoteReply: () => ctx.beginQuoteReply(message),
    onRetrySend: () => void ctx.sendMessage(message.content, { existing: message, threadRootMessageId: message.threadRootMessageId }),
    onOpenAttachmentPreview: ctx.onOpenAttachmentPreview,
    onCopyPermalink: () => void ctx.copyMessagePermalink(message.id),
    onStopResponse:
      message.status === 'generating' && !message.id.startsWith('optimistic_')
        ? () => void ctx.stopAgentResponse(message.id)
        : undefined,
    onControlRemoteQueue: (runId: string, action: Parameters<RoomMessageContext['controlRemoteQueue']>[1]) => void ctx.controlRemoteQueue(runId, action),
    onResolveRemoteRequest: (request: Parameters<RoomMessageContext['resolveRemoteRequest']>[0], decision: Parameters<RoomMessageContext['resolveRemoteRequest']>[1], response: Parameters<RoomMessageContext['resolveRemoteRequest']>[2]) => void ctx.resolveRemoteRequest(request, decision, response),
    highlighted: ctx.highlightedMessageId === message.id,
    grouped,
    personalChatStyle: ctx.conversationType !== 'channel',
  }
}

export function RoomMessage({
  message,
  ctx,
  inThread,
  grouped,
}: {
  message: OptimisticMessage
  ctx: RoomMessageContext
  inThread?: boolean
  grouped?: boolean
}) {
  const author = ctx.participants.find((participant) => participant.principalId === message.authorPrincipalId)
  const authorAgent = message.authorPrincipalId
    ? ctx.directoryAgentsByPrincipal.get(message.authorPrincipalId)
    : undefined
  // The directory entry is the live name; participant displayName snapshots
  // go stale when an agent is renamed.
  const authorName = authorAgent?.name ?? author?.displayName
    ?? message.importedAuthorName?.trim()
    ?? (message.authorKind === 'agent' || message.authorKind === 'model' ? 'Agent' : 'Someone')
  const view = toRoomMessageView({
    message,
    currentPrincipalId: ctx.currentPrincipalId,
    authorName,
    authorColor: authorAgent?.avatarColor,
    authorShape: authorAgent?.avatarShape,
    mentions: ctx.participantMentions,
    streaming: message.status === 'generating',
  })
  const teaserMessage = inThread ? null : ctx.threadTeasers.get(message.id) ?? null
  const teaserAuthor = teaserMessage ? resolveMessageAuthorName(teaserMessage, ctx) : null
  const itemProps = buildRoomMessageItemProps({
    view,
    message,
    ctx,
    inThread,
    grouped,
    teaserMessage,
    teaserAuthor,
  })
  return <RoomMessageItem {...itemProps} />
}

function RoomEmptyState({
  conversationType,
  title,
  channelTopic,
}: {
  conversationType: 'dm' | 'channel'
  title: string
  channelTopic: string | undefined
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--muted)]">
        {conversationType === 'channel' ? <Hash size={20} /> : <UsersRound size={20} />}
      </span>
      <h2 className="mt-4 text-base font-medium text-[var(--foreground)]">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-[var(--muted)]">
        {conversationType === 'channel'
          ? channelTopic ?? 'This is the beginning of this channel.'
          : 'This is the beginning of your conversation. Messages are visible only to its participants.'}
      </p>
    </div>
  )
}

export function RoomTranscript({
  transcript,
  readMarkers,
  navigation,
  vm,
  conversationType,
  title,
  channelTopic,
  agentResponding,
  ctx,
}: {
  transcript: ReturnType<typeof useRoomTranscript>
  readMarkers: ReturnType<typeof useReadMarkers>
  navigation: ReturnType<typeof useMessageNavigation>
  vm: ReturnType<typeof useRoomViewModels>
  conversationType: 'dm' | 'channel'
  title: string
  channelTopic: string | undefined
  agentResponding: string | null
  ctx: RoomMessageContext
}) {
  const {
    listRef,
    handleTranscriptScroll: onScroll,
    stickToBottom,
    hasMoreMessages,
    loadingOlderMessages,
    loadOlderMessages,
    loading,
    generatingMessages,
  } = transcript
  const { newMessageCount } = readMarkers
  const { jumpToLatest: onJumpToLatest } = navigation
  const { mainMessages, unreadBoundaryMessageId } = vm
  const generatingCount = generatingMessages.length
  const onLoadOlder = () => void loadOlderMessages()
  return (
    <div className="overlay-chat-surface relative min-h-0 flex-1">
      {newMessageCount > 0 && !stickToBottom ? (
        <button
          type="button"
          onClick={onJumpToLatest}
          data-testid="jump-to-latest"
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-lg transition-colors hover:bg-[var(--surface-subtle)]"
        >
          {newMessageCount} new {newMessageCount === 1 ? 'message' : 'messages'} ↓
        </button>
      ) : null}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="h-full min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 sm:px-4 sm:py-4"
      >
        <div className={`mx-auto flex min-h-full w-full min-w-0 max-w-4xl flex-col gap-1 sm:gap-1.5 ${!loading && mainMessages.length === 0 ? 'justify-center' : 'justify-end'}`}>
          {hasMoreMessages ? (
            <button
              type="button"
              onClick={onLoadOlder}
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
            <RoomEmptyState conversationType={conversationType} title={title} channelTopic={channelTopic} />
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
                <div key={roomMessageRowKey(message)} className="contents">
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
                  <RoomMessage
                    key={message.clientNonce ? `nonce-${message.clientNonce}` : message.id}
                    message={message}
                    ctx={ctx}
                    grouped={grouped}
                  />
                </div>
              )
            })
          )}
          {agentResponding && generatingCount === 0 ? (
            <div className="flex items-center gap-2 px-1" aria-live="polite" aria-label={`${agentResponding} response pending`}>
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
  )
}

export function RoomSidePanel({
  roomPanel,
  conversationType,
  title,
  showcase,
  roster,
  vm,
  thread,
  navigation,
  actions,
  sendMessage,
  onAddPeople,
  onClosePanel,
  ctx,
}: {
  roomPanel: RoomPanelKind | null
  conversationType: 'dm' | 'channel'
  title: string
  showcase: boolean
  roster: ReturnType<typeof useRoomRoster>
  vm: ReturnType<typeof useRoomViewModels>
  thread: ReturnType<typeof useThreadPanel>
  navigation: ReturnType<typeof useMessageNavigation>
  actions: ReturnType<typeof useMessageActions>
  sendMessage: RoomMessageContext['sendMessage']
  onAddPeople: () => void
  onClosePanel: () => void
  ctx: RoomMessageContext
}) {
  const { threadRoot, threadReplies, pinnedSummaries } = vm
  const {
    threadFollowing,
    toggleThreadFollow,
    threadInput,
    setThreadInput,
    setThreadRootId,
  } = thread
  const { jumpToMessage } = navigation
  const { togglePinned } = actions
  if (roomPanel === 'people') {
    return (
      <RoomPeoplePanel
        participants={roster.participants}
        presence={roster.presence}
        currentPrincipalId={roster.currentPrincipalId}
        onAddPeople={showcase ? undefined : onAddPeople}
        onClose={onClosePanel}
      />
    )
  }
  if (roomPanel === 'pinned') {
    return (
      <RoomPinnedPanel
        pinned={pinnedSummaries}
        onJump={jumpToMessage}
        onUnpin={(messageId) => void togglePinned(messageId)}
        onClose={onClosePanel}
      />
    )
  }
  if (roomPanel === 'thread' && threadRoot) {
    return (
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
          onClosePanel()
          setThreadRootId(null)
        }}
        messages={[
          ...[threadRoot, ...threadReplies].map((message) => (
            <RoomMessage
              key={message.clientNonce ? `nonce-${message.clientNonce}` : message.id}
              message={message}
              ctx={ctx}
              inThread
            />
          )),
        ]}
      />
    )
  }
  return null
}

export function RoomComposer({
  composer,
  title,
  mentionCategories,
  agentCommands,
  capabilities,
  participantsHaveAgent,
  memoryEnabled,
  setMemoryEnabled,
  setMentions,
  onOpenAttachmentPreview,
  onOpenFilePreview,
}: {
  composer: ReturnType<typeof useRoomComposer>
  title: string
  mentionCategories: MentionCategory[]
  agentCommands: import('./collaboration/room-message-view').RemoteAgentCommand[]
  capabilities: CapabilityCheck
  participantsHaveAgent: boolean
  memoryEnabled: boolean
  setMemoryEnabled: Dispatch<SetStateAction<boolean>>
  setMentions: Dispatch<SetStateAction<MentionItem[]>>
  onOpenAttachmentPreview: RoomMessageContext['onOpenAttachmentPreview']
  onOpenFilePreview: (name: string, fileIds: string[]) => void | Promise<void>
}) {
  return (
    <ChatComposer
      mode="chat"
      surface={{
        hideModeMenu: true,
        hideGenerationModes: true,
        placeholder: `Message ${title}, use @ to notify someone…`,
        mentionCategories,
        agentCommands,
      }}
      emptyState={{ showCenteredEmptyChat: false, greetingLine: '' }}
      attachments={{
        attachedImages: composer.attachedImages,
        setAttachedImages: composer.setAttachedImages,
        pendingChatDocuments: composer.pendingChatDocuments,
        removePendingDocument: composer.removePendingDocument,
        attachmentError: composer.attachmentError,
        fileInputRef: composer.fileInputRef,
        docInputRef: composer.docInputRef,
        onAddImages: composer.addImages,
        onAddDocumentsFromPicker: composer.addDocumentsFromPicker,
        onOpenAttachmentPreview,
        onOpenFilePreview,
      }}
      runtime={{
        composerNotice: composer.composerNotice,
        isSendBlocked: false,
        isActiveLoading: false,
        isTemporaryChat: false,
        blockedComposerContent: null,
      }}
      inputState={{
        replyContext: composer.replyContext,
        setReplyContext: composer.setReplyContext,
        textareaRef: composer.composerRef,
        input: composer.input,
        inputRevision: composer.inputRevision,
        onInputChange: composer.onComposerInput,
        onMentionsChange: setMentions,
        onPaste: composer.handlePaste,
        hasComposerText: composer.hasComposerText,
      }}
      toolState={{
        showAttachMenu: composer.showAttachMenu,
        setShowAttachMenu: composer.setShowAttachMenu,
        attachMenuRef: composer.attachMenuRef,
        selectedToolIds: [],
        memoryEnabled,
        capabilities: participantsHaveAgent
          ? capabilities
          : { ...capabilities, memory: false, vectorSearch: false },
        onToggleTool: () => {},
        onToggleMemory: () => setMemoryEnabled((current) => !current),
        onRemoveTool: () => {},
      }}
      modeState={{
        onModeChange: () => {},
        generationChip: null,
        setGenerationChip: () => {},
        showModeMenu: composer.showModeMenu,
        setShowModeMenu: composer.setShowModeMenu,
        modeMenuRef: composer.modeMenuRef,
        onNavigateMode: () => {},
      }}
      actions={{
        onStop: () => {},
        onSend: () => void composer.handleSend(),
      }}
    />
  )
}

export function RoomDialogs({
  panels,
  roomActions,
  activeWorkspaceId,
  isWorkspaceOwner,
  shareOpen,
  onShareClose,
  attachOpen,
  onAttachClose,
  addPeopleOpen,
  onAddPeopleOpenChange,
  conversationId,
  conversationType,
  title,
  showcase,
  currentParticipant,
  participants,
  router,
  onParticipantsAdded,
  sendMessage,
}: {
  panels: ReturnType<typeof useRoomPanels>
  roomActions: ReturnType<typeof useRoomActions>
  activeWorkspaceId: string | null | undefined
  isWorkspaceOwner: boolean
  shareOpen: boolean
  onShareClose: () => void
  attachOpen: boolean
  onAttachClose: () => void
  addPeopleOpen: boolean
  onAddPeopleOpenChange: (open: boolean) => void
  conversationId: string
  conversationType: 'dm' | 'channel'
  title: string
  showcase: boolean
  currentParticipant: ConversationParticipant | undefined
  participants: ConversationParticipant[]
  router: ReturnType<typeof useRouter>
  onParticipantsAdded: () => void
  sendMessage: RoomMessageContext['sendMessage']
}) {
  const {
    attachmentPreview,
    attachmentPreviewMode,
    closeAttachmentPreview,
    setAttachmentPreviewMode,
  } = panels
  const {
    pendingArchiveScope,
    pendingDeleteScope,
    scopeDialogBusy,
    scopeDialogError,
    setPendingArchiveScope,
    setPendingDeleteScope,
    archiveConversation,
    deleteConversation,
  } = roomActions
  return (
    <>
      <AttachmentPreviewDialog
        open={Boolean(attachmentPreview && attachmentPreviewMode === 'dialog')}
        preview={attachmentPreview}
        onClose={closeAttachmentPreview}
        onModeChange={setAttachmentPreviewMode}
        renderViewer={AttachmentViewer}
      />

      <ShareDialog
        workspaceId={activeWorkspaceId}
        isOpen={shareOpen}
        onClose={onShareClose}
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
          onClose={onAttachClose}
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
          onOpenChange={onAddPeopleOpenChange}
          onCreated={({ id, title: createdTitle, agentId }) => {
            if (agentId) {
              router.push(`/app/agents?${new URLSearchParams({ agent: agentId, view: 'dms', id }).toString()}`)
              return
            }
            const view = conversationType === 'channel' ? 'channels' : 'dms'
            router.push(`/app/chat?${new URLSearchParams({ view, id, draft: '1', title: createdTitle }).toString()}`)
          }}
          onParticipantsAdded={onParticipantsAdded}
        />
      ) : null}
      <ConversationScopeActionDialog
        open={pendingArchiveScope}
        action="archive"
        conversationTitle={title}
        canApplyToEveryone={isWorkspaceOwner}
        busy={scopeDialogBusy}
        error={scopeDialogError}
        onOpenChange={(open) => {
          if (!open && !scopeDialogBusy) setPendingArchiveScope(false)
        }}
        onSelect={(scope) => void archiveConversation(scope)}
      />
      <ConversationScopeActionDialog
        open={pendingDeleteScope}
        action="delete"
        conversationTitle={title}
        canApplyToEveryone={isWorkspaceOwner}
        busy={scopeDialogBusy}
        error={scopeDialogError}
        onOpenChange={(open) => {
          if (!open && !scopeDialogBusy) setPendingDeleteScope(false)
        }}
        onSelect={deleteConversation}
      />
    </>
  )
}

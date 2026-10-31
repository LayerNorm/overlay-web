'use client'

import { appendDictatedText } from '@/components/desktop/composer-dictation'

import { RemoteRunLiveness } from './collaboration/RemoteRunLiveness'
import { useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Archive,
  Bell,
  BellOff,
  Hash,
  MoreHorizontal,
  Pin,
  Share2,
  Slack,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { Button, FloatingMenu, MenuItem } from '@overlay/ui/primitives'
import { agentThreadHref } from '@/components/layout/sidebar-nav'
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
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { NewDirectMessageDialog } from './NewDirectMessageDialog'
import { ShareDialog } from '@/components/share/ShareDialog'
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
  // Locale pinned to 'en-US' — SSR and client output are identical.
  // react-doctor-disable-next-line react-doctor/no-locale-format-in-render
  return new Date(timestamp).toLocaleDateString('en-US', {
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
  surfacePlatform,
}: {
  conversationType: 'dm' | 'channel'
  otherCount: number
  size: number
  surfacePlatform?: string | null
}) {
  if (surfacePlatform === 'slack') return <Slack size={size} />
  if (conversationType === 'channel') return <Hash size={size} />
  if (otherCount <= 1) return <UserRound size={size} />
  return <UsersRound size={size} />
}

export function RoomHeaderLeading({
  soloAgentParticipant,
  headerAgent,
  conversationType,
  otherCount,
  surfacePlatform,
}: {
  soloAgentParticipant: ConversationParticipant | null
  headerAgent: { isDefault?: boolean; name: string; avatarColor?: string; avatarShape?: string } | null
  conversationType: 'dm' | 'channel'
  otherCount: number
  surfacePlatform?: string | null
}) {
  if (soloAgentParticipant) {
    return <AgentCreature isDefault={headerAgent?.isDefault} agent={headerAgent ?? { name: soloAgentParticipant.displayName }} size={32} />
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-(--surface-muted) text-(--muted)">
      <RoomHeaderIcon conversationType={conversationType} otherCount={otherCount} size={15} surfacePlatform={surfacePlatform} />
    </span>
  )
}

export function RoomHeaderActions({
  vm,
  roster,
  collab,
  roomActions,

  headerActions,
  roomPanel,
  setRoomPanel,
  menuOpen,
  setMenuOpen,
  menuTriggerRef,
  onShare,
}: {
  vm: ReturnType<typeof useRoomViewModels>
  roster: ReturnType<typeof useRoomRoster>
  collab: ReturnType<typeof useRoomCollaboration>
  roomActions: ReturnType<typeof useRoomActions>

  headerActions: ReactNode
  roomPanel: RoomPanelKind | null
  setRoomPanel: Dispatch<SetStateAction<RoomPanelKind | null>>
  menuOpen: boolean
  setMenuOpen: Dispatch<SetStateAction<boolean>>
  menuTriggerRef: React.RefObject<HTMLButtonElement | null>
  onShare: () => void
}) {
  const { currentParticipant } = vm
  const { updateState: onUpdateState, archiveMenuAction: onArchive } = roomActions
  return (
    <div className="relative flex items-center gap-1">
      <FloatingMenu
        kind="menu"
        trigger={
          <Button
            ref={menuTriggerRef}
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Conversation options"
            className="h-8 w-8 rounded-md text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)"
          >
            <MoreHorizontal size={15} />
          </Button>
        }
        anchorRef={menuTriggerRef}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        align="end"
        className="w-48 p-1"
      >
        {currentParticipant?.role === 'moderator' ? (
          <MenuButton
            icon={Share2}
            label="Share"
            onClick={() => {
              setMenuOpen(false)
              onShare()
            }}
          />
        ) : null}
        {collab.pins.length > 0 ? (
          <MenuButton
            icon={Pin}
            label="Pinned messages"
            onClick={() => {
              setMenuOpen(false)
              setRoomPanel((current) => (current === 'pinned' ? null : 'pinned'))
            }}
          />
        ) : null}
        <MenuButton
          icon={currentParticipant?.notificationLevel === 'muted' ? Bell : BellOff}
          label={currentParticipant?.notificationLevel === 'muted' ? 'Unmute' : 'Mute'}
          onClick={() => {
            setMenuOpen(false)
            void onUpdateState(
              {
                notificationLevel:
                  currentParticipant?.notificationLevel === 'muted' ? 'all' : 'muted',
              },
              currentParticipant?.notificationLevel === 'muted'
                ? 'Notifications on'
                : 'Conversation muted',
            )
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
      <Button
        variant="ghost"
        type="button"
        onClick={() => setRoomPanel((current) => (current === 'people' ? null : 'people'))}
        aria-pressed={roomPanel === 'people'}
        title="People in this room"
        className={`h-8 gap-1.5 rounded-md px-2 text-xs font-normal transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) ${
          roomPanel === 'people' ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted)'
        }`}
      >
        <UsersRound size={14} />
        {roster.participants.length}
      </Button>
      {headerActions}
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
  hideToolbar,
}: {
  message: OptimisticMessage
  ctx: RoomMessageContext
  inThread?: boolean
  grouped?: boolean
  hideToolbar?: boolean
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
    authorPhotoUrl: author?.principalType === 'human' ? author.photoUrl : undefined,
    authorColor: authorAgent?.avatarColor,
    authorShape: authorAgent?.avatarShape,
    authorIsDefault: authorAgent?.isDefault,
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
  return <RoomMessageItem {...itemProps} hideToolbar={hideToolbar} remoteStatus={view.streaming && view.remoteRun
    ? <RemoteRunLiveness key={view.remoteRun.runId} conversationId={ctx.conversationId} runId={view.remoteRun.runId}
        workspaceId={ctx.participants.find(participant => participant.principalId === ctx.currentPrincipalId)?.workspaceId} />
    : null} />
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
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-(--surface-muted) text-(--muted)">
        {conversationType === 'channel' ? <Hash size={20} /> : <UsersRound size={20} />}
      </span>
      <h2 className="mt-4 text-base font-medium text-(--foreground)">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-(--muted)">
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
  ctx,
  footer,
  hideScrollbar,
  guided,
}: {
  transcript: ReturnType<typeof useRoomTranscript>
  readMarkers: ReturnType<typeof useReadMarkers>
  navigation: ReturnType<typeof useMessageNavigation>
  vm: ReturnType<typeof useRoomViewModels>
  conversationType: 'dm' | 'channel'
  title: string
  channelTopic: string | undefined
  ctx: RoomMessageContext
  footer?: ReactNode
  hideScrollbar?: boolean
  /** Guided onboarding: plain messages without action toolbars. */
  guided?: boolean
}) {
  const {
    listRef,
    handleTranscriptScroll: onScroll,
    stickToBottom,
    hasMoreMessages,
    loadingOlderMessages,
    loadOlderMessages,
    loading,
  } = transcript
  const { newMessageCount } = readMarkers
  const { jumpToLatest: onJumpToLatest } = navigation
  const { mainMessages, unreadBoundaryMessageId } = vm
  const onLoadOlder = () => void loadOlderMessages()
  return (
    <div className="overlay-chat-surface relative min-h-0 flex-1">
      {newMessageCount > 0 && !stickToBottom ? (
        <Button
          variant="ghost"
          type="button"
          onClick={onJumpToLatest}
          data-testid="jump-to-latest"
          className="absolute bottom-4 left-1/2 z-10 h-auto -translate-x-1/2 rounded-full bg-(--surface-elevated) px-3 py-1.5 text-xs font-medium text-(--foreground) shadow-lg transition-colors hover:bg-(--surface-subtle)"
        >
          {newMessageCount} new {newMessageCount === 1 ? 'message' : 'messages'} ↓
        </Button>
      ) : null}
      <div
        ref={listRef}
        onScroll={onScroll}
        className={`h-full min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 sm:px-4 sm:py-4 ${hideScrollbar ? '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : ''}`}
      >
        <div data-chat-transcript className={`mx-auto flex min-h-full w-full min-w-0 max-w-4xl flex-col gap-1 sm:gap-1.5 ${!loading && mainMessages.length === 0 ? 'justify-center' : 'justify-end'}`}>
          {hasMoreMessages ? (
            <Button
              variant="ghost"
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlderMessages}
              className="mx-auto my-2 h-auto rounded-lg bg-(--surface-subtle) px-3 py-1.5 text-xs font-normal text-(--muted) hover:bg-(--surface-muted) disabled:opacity-60"
            >
              {loadingOlderMessages ? 'Loading older messages…' : 'Load older messages'}
            </Button>
          ) : null}
          {loading ? (
            <div className="space-y-3 py-4" aria-label="Loading messages">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-12 animate-pulse rounded-lg bg-(--surface-subtle)" />
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
                    <div className="flex items-center gap-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">
                      <span className="h-px flex-1 bg-(--border)" />
                      <span>{roomDayLabel(message.createdAt)}</span>
                      <span className="h-px flex-1 bg-(--border)" />
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
                    message={message}
                    ctx={ctx}
                    grouped={grouped}
                    hideToolbar={guided}
                  />
                </div>
              )
            })
          )}
          {footer}
        </div>
      </div>
    </div>
  )
}

export function RoomSidePanel({
  roomPanel,
  conversationType,
  title,

  roster,
  vm,
  thread,
  navigation,
  actions,
  sendMessage,
  onAddPeople,
  onClosePanel,
  ctx,
  readOnlyNotice,
}: {
  roomPanel: RoomPanelKind | null
  conversationType: 'dm' | 'channel'
  title: string

  roster: ReturnType<typeof useRoomRoster>
  vm: ReturnType<typeof useRoomViewModels>
  thread: ReturnType<typeof useThreadPanel>
  navigation: ReturnType<typeof useMessageNavigation>
  actions: ReturnType<typeof useMessageActions>
  sendMessage: RoomMessageContext['sendMessage']
  onAddPeople: () => void
  onClosePanel: () => void
  ctx: RoomMessageContext
  /** Replaces the thread composer for surface-mirrored rooms. */
  readOnlyNotice?: string
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
        onAddPeople={onAddPeople}
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
        readOnlyNotice={readOnlyNotice}
        onClose={() => {
          onClosePanel()
          setThreadRootId(null)
        }}
        messages={[
          ...[threadRoot, ...threadReplies].map((message) => (
            <RoomMessage
              key={roomMessageRowKey(message)}
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

export function surfaceReadOnlyNotice(surfacePlatform: string): string {
  return `Mirrored from ${surfacePlatform === 'slack' ? 'Slack' : surfacePlatform} — reply in the original thread.`
}

/** Stands in for the composer: surface-mirrored rooms are read-only in Overlay. */
export function SurfaceReadOnlyComposer({ surfacePlatform }: { surfacePlatform: string }) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-center gap-2 text-xs text-(--muted)">
        {surfacePlatform === 'slack' ? <Slack size={13} /> : <Hash size={13} />}
        <span>{surfaceReadOnlyNotice(surfacePlatform)}</span>
      </div>
    </div>
  )
}

export type GuidedRoomComposer = {
  value: string
  onChange(value: string): void
  onSubmit(): void
  placeholder: string
  disabled: boolean
  revision: number
  focusRevision?: number
  /** Shown but not typable, for steps answered with the controls above it. */
  locked?: boolean
}

export function RoomComposer({
  conversationId,
  composer,
  mentionCategories,
  agentCommands,
  capabilities,
  participantsHaveAgent,
  memoryEnabled,
  setMemoryEnabled,
  setMentions,
  onOpenAttachmentPreview,
  onOpenFilePreview,
  guided,
}: {
  conversationId: string
  composer: ReturnType<typeof useRoomComposer>
  mentionCategories: MentionCategory[]
  agentCommands: import('./collaboration/room-message-view').RemoteAgentCommand[]
  capabilities: CapabilityCheck
  participantsHaveAgent: boolean
  memoryEnabled: boolean
  setMemoryEnabled: Dispatch<SetStateAction<boolean>>
  setMentions: Dispatch<SetStateAction<MentionItem[]>>
  onOpenAttachmentPreview: RoomMessageContext['onOpenAttachmentPreview']
  onOpenFilePreview: (name: string, fileIds: string[]) => void | Promise<void>
  guided?: GuidedRoomComposer
}) {
  useEffect(() => {
    if (guided?.focusRevision) composer.composerRef.current?.focus()
  }, [guided?.focusRevision, composer.composerRef])
  const locked = Boolean(guided?.locked)
  return (
    <div inert={locked} aria-disabled={locked || undefined} className={locked ? 'pointer-events-none opacity-50 transition-opacity' : 'transition-opacity'}>
    <ChatComposer
      mode="chat"
      surface={{
        hideModeMenu: true,
        hideGenerationModes: true,
        placeholder: guided?.placeholder ?? 'What do you want to get done?',
        mentionCategories: guided ? [] : mentionCategories,
        agentCommands: guided ? [] : agentCommands,
        textOnly: Boolean(guided),
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
        composerNotice: null,
        isSendBlocked: guided?.disabled ?? false,
        isActiveLoading: false,
        isTemporaryChat: false,
        blockedComposerContent: null,
      }}
      inputState={{
        draftIdentity: conversationId,
        onAppendText: text => composer.setInput(previous => appendDictatedText(previous, text)),
        replyContext: composer.replyContext,
        setReplyContext: composer.setReplyContext,
        textareaRef: composer.composerRef,
        input: guided?.value ?? composer.input,
        inputRevision: guided?.revision ?? composer.inputRevision,
        onInputChange: guided?.onChange ?? composer.onComposerInput,
        onMentionsChange: setMentions,
        onPaste: guided ? () => {} : composer.handlePaste,
        hasComposerText: guided ? Boolean(guided.value.trim()) : composer.hasComposerText,
      }}
      toolState={{
        showAttachMenu: composer.showAttachMenu,
        setShowAttachMenu: composer.setShowAttachMenu,
        attachMenuRef: composer.attachMenuRef,
        selectedToolIds: [],
        memoryEnabled: guided ? false : memoryEnabled,
        capabilities: !guided && participantsHaveAgent
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
        onSend: guided ? () => { if (!guided.disabled) guided.onSubmit() } : () => void composer.handleSend(),
      }}
    />
    </div>
  )
}

export function RoomDialogs({
  panels,
  roomActions,
  activeWorkspaceId,
  isWorkspaceOwner,
  shareOpen,
  onShareClose,
  addPeopleOpen,
  onAddPeopleOpenChange,
  conversationId,
  conversationType,
  title,
  currentParticipant,
  participants,
  router,
  onParticipantsAdded,
}: {
  panels: ReturnType<typeof useRoomPanels>
  roomActions: ReturnType<typeof useRoomActions>
  activeWorkspaceId: string | null | undefined
  isWorkspaceOwner: boolean
  shareOpen: boolean
  onShareClose: () => void
  addPeopleOpen: boolean
  onAddPeopleOpenChange: (open: boolean) => void
  conversationId: string
  conversationType: 'dm' | 'channel'
  title: string
  currentParticipant: ConversationParticipant | undefined
  participants: ConversationParticipant[]
  router: ReturnType<typeof useRouter>
  onParticipantsAdded: () => void
}) {
  const buildWorkspaceHref = useWorkspaceHref()
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

      {addPeopleOpen ? (
        <NewDirectMessageDialog
          open
          workspaceId={currentParticipant?.workspaceId ?? ''}
          addToConversationId={conversationId}
          addToConversationType={conversationType}
          excludedPrincipalIds={participants.map((participant) => participant.principalId)}
          onOpenChange={onAddPeopleOpenChange}
          onCreated={({ id, title: createdTitle, agentId }) => {
            if (agentId) {
              router.push(agentThreadHref(buildWorkspaceHref(activeWorkspaceId ?? null, '/app/agents'), agentId, id))
              return
            }
            const view = conversationType === 'channel' ? 'channels' : 'dms'
            router.push(buildWorkspaceHref(
              activeWorkspaceId ?? null,
              `/app/chat?${new URLSearchParams({ view, id, ...(conversationType === 'dm' ? { draft: '1' } : {}), title: createdTitle }).toString()}`,
              'workspace',
            ))
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

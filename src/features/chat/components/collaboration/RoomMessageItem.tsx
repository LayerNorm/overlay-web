'use client'

/* eslint-disable @next/next/no-img-element -- room attachments mirror the chat transcript renderer */

import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Bookmark,
  Check,
  FileText,
  Flag,
  Link2,
  MessageSquareReply,
  Pencil,
  Pin,
  SmilePlus,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import type { AssistantVisualBlock } from '@overlay/chat-core'
import { RemoteRunDeadline } from './RemoteRunDeadline'
import { FlashCopyIconButton } from '@overlay/chat-react/draft-review-modal'
import { UserMessageBubble } from '@overlay/chat-react/user-message-bubble'
import { AssistantVisualBlocks, messageActionVisibilityClass } from '@overlay/chat-react/transcript'
import type { AttachmentPreview, ChatMessageMention } from '@overlay/chat-react'
import { Button, Input, Select, Textarea, Toggle } from '@overlay/ui/primitives'
import { MarkdownMessage } from '@overlay/chat-react'
import { AgentCreature } from '@/components/orb/Creature'
import { MAX_AGENT_HOPS } from '@/shared/agents/agent-lineage'
import { useOptionalAppSettings } from '@/components/providers/AppSettingsProvider'
import { unstyledButton } from '@overlay/ui/control-reset'
import { roomMessageDomId } from './room-message-view'
import type { DriveSyncStatus } from '@layernorm/overlay-agent-bridge-protocol'
import { RemoteDriveStatus, useSavedDriveLinkResolver } from './RemoteDriveStatus'
import { RemoteRunTrace } from './RemoteRunTrace'

export type RoomMessageReaction = {
  emoji: string
  count: number
  reactedByCurrentPrincipal: boolean
}

export type RoomMessageAttachment = {
  url: string
  name: string
  mediaType?: string
}

export type RoomThreadTeaser = {
  authorName: string
  text: string
  createdAt: number
}

export type RoomMessageView = {
  id: string
  /** Sent by the signed-in principal — rendered as the right-hand user bubble. */
  mine: boolean
  authorName: string
  authorKind: 'human' | 'agent' | 'model' | 'system'
  authorColor?: string
  /** Creature body shape for agent authors; absent means circle. */
  authorShape?: string
  /** Present for messages imported from Slack: shown in the author detail card. */
  authorEmail?: string
  authorStatus?: 'member' | 'invited' | 'not_invited'
  createdAt: number
  eventSequence?: number
  editedAt?: number
  editHistory?: Array<{ content: string; editedAt: number }>
  deletedAt?: number
  delivery?: 'sending' | 'failed'
  /** Plain text used for copy, edit, and quote-reply. */
  text: string
  /** Ordered tool/text/file blocks for messages rendered as agent output. */
  blocks: AssistantVisualBlock[]
  images: RoomMessageAttachment[]
  documentNames: string[]
  /** Room members named in the body, so `@name` renders as a chip. */
  mentions: ChatMessageMention[]
  streaming?: boolean
  /** Set when this message is one agent's question to another, on a person's behalf: who asked, and how far down the chain it is. */
  askedBy?: { name: string; hop: number; parentConversationId?: string }
  remoteQueue?: { runId: string; environmentName: string; queueExpiresAt: number }
  remoteRequest?: { pendingDelivery?: boolean; expiresAt?: number; machineCostContinues?: boolean; runId: string; requestKey: string; kind: 'permission' | 'elicitation'; prompt: string;
    options: Array<{ id: string; label: string }>; requestedSchema?: Record<string, unknown> }
  remoteRun?: { runId: string; state: string; retryable: boolean; retryClass?: string; hardDeadlineAt?: number; recovered?: boolean }
  remoteDrive?: DriveSyncStatus
  /** Persisted turn time for agent messages (assistant row createdAt→updatedAt). */
  workedDurationMs?: number
}

export type RoomMessageItemProps = {
  remoteStatus?: ReactNode
  /** Hides reactions, edit, pin and the other message actions (guided onboarding). */
  hideToolbar?: boolean
  message: RoomMessageView
  reactions: RoomMessageReaction[]
  replyCount: number
  /** Latest reply preview for Slack-style thread entry under the message. */
  threadTeaser?: RoomThreadTeaser | null
  pinned: boolean
  saved: boolean
  editing: boolean
  editingContent: string
  onEditingContentChange: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onStartEdit: () => void
  onDelete: () => void
  onReport: () => void
  onToggleReaction: (emoji: string) => void
  onTogglePinned: () => void
  onToggleSaved: () => void
  onOpenThread: () => void
  onQuoteReply: () => void
  onRetrySend: () => void
  onOpenAttachmentPreview: (preview: AttachmentPreview) => void
  onCopyPermalink: () => void
  onControlRemoteQueue?: (runId: string, action: 'cancel' | 'retry' | 'resume' | 'start_fresh') => void
  onResolveRemoteRequest?: (request: NonNullable<RoomMessageView['remoteRequest']>, decision: string, response?: Record<string, unknown>) => void
  /** Present only while an agent response is generating — stops that run. */
  onStopResponse?: () => void
  /** Briefly outlines the message after a jump from the pinned or thread list. */
  highlighted?: boolean
  /** Consecutive messages from the same author use a compact transcript row. */
  grouped?: boolean
  /**
   * Direct messages match personal chat: no row hover background, and the
   * action row sits under the message instead of a floating rail on top.
   */
  personalChatStyle?: boolean
}

/** Rooms do not surface draft review; agent drafts are handled in personal chat. */
const NOOP_DRAFT = () => {}



function authorInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
}

const AUTHOR_STATUS_META = {
  member: { label: 'In workspace', className: 'bg-green-500/10 text-green-600' },
  invited: { label: 'Invited', className: 'bg-amber-500/10 text-amber-600' },
  not_invited: { label: 'Not invited', className: 'bg-(--surface-subtle) text-(--muted)' },
} as const

/** Agent mention chips carry the creature avatar; other types keep their icon. */
const renderMentionAvatar = (mention: ChatMessageMention) =>
  mention.type === 'agent' ? (
    <AgentCreature
      agent={{ name: mention.name, avatarColor: mention.avatarColor, avatarShape: mention.avatarShape }}
      size={14}
    />
  ) : undefined

type AuthorStatus = keyof typeof AUTHOR_STATUS_META

/**
 * Wraps an author avatar or name so clicking it reveals a small identity card
 * (name, email, workspace status). Used for imported Slack messages whose
 * author is not necessarily an Overlay participant. When there is no detail to
 * show, the trigger renders inert so ordinary messages are unaffected.
 */
function AuthorIdentityPopover({
  name,
  email,
  status,
  triggerClassName,
  children,
}: {
  name: string
  email?: string
  status?: AuthorStatus
  triggerClassName?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Ordinary messages carry no imported-author detail — render the trigger inert.
  if (!status && !email) return <>{children}</>
  const statusMeta = status ? AUTHOR_STATUS_META[status] : null

  return (
    <span ref={ref} className="relative inline-flex isolate">
      <Button
        variant="ghost"
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`h-auto p-0 text-left font-normal text-inherit outline-hidden hover:bg-transparent hover:text-current focus-visible:ring-2 focus-visible:ring-(--foreground) ${triggerClassName ?? ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {children}
      </Button>
      {open ? (
        // Anchored author popover — a native <dialog> cannot anchor below the trigger.
        // react-doctor-disable-next-line react-doctor/prefer-html-dialog
        <div
          role="dialog"
          aria-label={name ? `${name} profile` : 'Message author'}
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-60 rounded-xl bg-(--surface-elevated) p-3 shadow-xl"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--surface-muted) text-[13px] font-semibold text-(--foreground)">
              {authorInitial(name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className='block truncate text-sm font-semibold text-(--foreground)'>
                {name}
              </span>
              <span className='block truncate text-[11px] text-(--muted)'>
                {email ?? 'No email on file'}
              </span>
            </span>
          </div>
          {statusMeta ? (
            <div className="mt-2.5 flex items-center justify-between pt-2.5">
              <span className="text-[11px] text-(--muted)">Workspace</span>
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.className}`}
              >
                {statusMeta.label}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  )
}

/**
 * One message in a shared room.
 *
 * - **Yours:** right-aligned personal-chat bubble (unchanged).
 * - **Received:** Slack-style flat row (avatar · name · time · body, no bubble).
 * - **Agents:** full-width assistant blocks with the same meta chrome.
 */
export function RoomMessageItem({
  message,
  reactions,
  replyCount,
  threadTeaser = null,
  pinned,
  saved,
  editing,
  editingContent,
  onEditingContentChange,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onDelete,
  onReport,
  onToggleReaction,
  onTogglePinned,
  onToggleSaved,
  onOpenThread,
  onQuoteReply,
  onRetrySend,
  onOpenAttachmentPreview,
  onCopyPermalink,
  onControlRemoteQueue,
  onResolveRemoteRequest,
  onStopResponse,
  highlighted = false,
  grouped = false,
  personalChatStyle = false,
  remoteStatus,
  hideToolbar = false,
}: RoomMessageItemProps) {
  const { mine } = message
  const isAgent =
    message.authorKind === 'agent' || message.authorKind === 'model'
  // Locale pinned to 'en-US' — SSR and client output are identical.
  // react-doctor-disable-next-line react-doctor/no-locale-format-in-render
  const timeLabel = new Date(message.createdAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
  const rootProps = {
    id: roomMessageDomId(message.id),
    'data-room-message': message.id,
    // Links in a room message follow the open-in-Overlay preference.
    'data-overlay-link-scope': '',
  }
  const highlightClass = highlighted
    ? 'rounded-xl ring-2 ring-(--foreground) ring-offset-4 ring-offset-(--background)'
    : ''

  // A connected agent's run is stopped by cancelling it; a native agent's response by stopping the response.
  const activeRemoteRun = message.remoteRun && !['completed', 'cancelled', 'failed', 'recoverable'].includes(message.remoteRun.state)
    ? message.remoteRun
    : null
  const stopHandler = activeRemoteRun && onControlRemoteQueue
    ? () => onControlRemoteQueue(activeRemoteRun.runId, 'cancel')
    : message.streaming ? onStopResponse : undefined

  const toolbar = hideToolbar ? null : (
    <RoomMessageToolbar
      alignEnd={mine}
      floating={!personalChatStyle}
      copyText={message.text}
      canEdit={mine}
      canReport={!mine}
      pinned={pinned}
      saved={saved}
      disabled={Boolean(message.delivery)}
      onStop={stopHandler}
      onStartEdit={onStartEdit}
      onDelete={onDelete}
      onReport={onReport}
      onSelectReaction={onToggleReaction}
      onOpenThread={onOpenThread}
      onQuoteReply={onQuoteReply}
      onTogglePinned={onTogglePinned}
      onToggleSaved={onToggleSaved}
      onCopyPermalink={onCopyPermalink}
      diagnostics={message.remoteRun ? <RemoteRunTrace runId={message.remoteRun.runId} messageId={message.id} state={message.remoteRun.state} /> : undefined}
    />
  )

  const content: RoomMessageContentProps = {
    remoteStatus,
    message,
    reactions,
    replyCount,
    threadTeaser,
    editing,
    editingContent,
    onEditingContentChange,
    onSaveEdit,
    onCancelEdit,
    onOpenAttachmentPreview,
    onToggleReaction,
    onOpenThread,
    personalChatStyle,
  }

  if (message.deletedAt) {
    return (
      <DeletedRoomMessage
        rootProps={rootProps}
        mine={mine}
        personalChatStyle={personalChatStyle}
        highlightClass={highlightClass}
        message={message}
      />
    )
  }

  // ── Sent (yours): right gray bubble, with no redundant identity chrome. ──
  if (mine && !isAgent) {
    return (
      <SentRoomMessage
        rootProps={rootProps}
        highlightClass={highlightClass}
        toolbar={toolbar}
        content={content}
        onRetrySend={onRetrySend}
      />
    )
  }

  // ── Received human / agent: Slack flat row with avatar on every message ──
  return (
    <ReceivedRoomMessage
      rootProps={rootProps}
      highlightClass={highlightClass}
      toolbar={toolbar}
      content={content}
      isAgent={isAgent}
      timeLabel={timeLabel}
      grouped={grouped}
      pinned={pinned}
      onControlRemoteQueue={onControlRemoteQueue}
      onResolveRemoteRequest={onResolveRemoteRequest}
    />
  )
}

type RoomMessageRootProps = {
  id: string
  'data-room-message': string
  'data-overlay-link-scope': string
}

/** Props shared by the sent and received message rows. */
type RoomMessageContentProps = {
  remoteStatus?: ReactNode
  message: RoomMessageView
  reactions: RoomMessageReaction[]
  replyCount: number
  threadTeaser: RoomThreadTeaser | null
  editing: boolean
  editingContent: string
  onEditingContentChange: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onOpenAttachmentPreview: (preview: AttachmentPreview) => void
  onToggleReaction: (emoji: string) => void
  onOpenThread: () => void
  personalChatStyle: boolean
}

function RoomMessageAvatar({ message }: { message: RoomMessageView }) {
  const isAgent = message.authorKind === 'agent' || message.authorKind === 'model'
  if (isAgent) {
    return (
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center"
        aria-hidden
      >
        <AgentCreature
          agent={{ name: message.authorName, avatarColor: message.authorColor, avatarShape: message.authorShape }}
          size={32}
          animated={message.streaming}
        />
      </span>
    )
  }
  return (
    <AuthorIdentityPopover
      name={message.authorName}
      email={message.authorEmail}
      status={message.authorStatus}
      triggerClassName="rounded-lg"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--surface-muted) text-[13px] font-semibold text-(--foreground)"
        aria-hidden
      >
        {authorInitial(message.mine ? 'You' : message.authorName)}
      </span>
    </AuthorIdentityPopover>
  )
}

/** Human and agent messages share the same safe GFM renderer. */
function HumanMessageText({ message }: { message: RoomMessageView }) {
  if (!message.text) return null
  return (
    <div className="text-[15px] leading-relaxed text-(--foreground)">
      <MarkdownMessage text={message.text} isStreaming={false} mentions={message.mentions} renderMentionAvatar={renderMentionAvatar} />
    </div>
  )
}

function SentMessageContent({ message }: { message: RoomMessageView }) {
  if (!message.text) return null
  return (
    <UserMessageBubble className="ml-auto max-w-full" contentClassName="whitespace-normal">
      <MarkdownMessage text={message.text} isStreaming={false} mentions={message.mentions} renderMentionAvatar={renderMentionAvatar} />
    </UserMessageBubble>
  )
}

function DeletedRoomMessage({ rootProps, mine, personalChatStyle, highlightClass, message }: {
  rootProps: RoomMessageRootProps
  mine: boolean
  personalChatStyle: boolean
  highlightClass: string
  message: RoomMessageView
}) {
  if (mine) {
    return (
      <div
        {...rootProps}
        className={`group/exchange relative -mx-1 flex scroll-mt-6 justify-end gap-2.5 rounded-lg px-1 py-1 message-appear transition-colors ${personalChatStyle ? '' : 'hover:bg-(--surface-subtle)'} ${highlightClass}`}
      >
        <div className="relative flex min-w-0 max-w-[min(92%,36rem)] flex-col items-end gap-1 sm:max-w-[75%]">
          <UserMessageBubble className="ml-auto max-w-full" contentClassName="whitespace-normal">
            <span className="italic text-(--muted)">Message deleted</span>
          </UserMessageBubble>
        </div>
      </div>
    )
  }

  return (
    <div
      {...rootProps}
      className={`group/exchange relative -mx-1 flex scroll-mt-6 gap-2.5 rounded-lg px-1 py-1 ${highlightClass}`}
    >
      <RoomMessageAvatar message={message} />
      <p className="self-center text-sm italic text-(--muted-light)">Message deleted</p>
    </div>
  )
}

function RoomMessageAttachments({ message, onOpenAttachmentPreview }: {
  message: RoomMessageView
  onOpenAttachmentPreview: (preview: AttachmentPreview) => void
}) {
  return (
    <>
      {message.images.length > 0 ? (
        <div className={`flex w-full flex-wrap gap-1.5 ${message.mine ? 'justify-end' : ''}`}>
          {message.images.map((attachment) => (
            <Button
              variant="ghost"
              key={attachment.url}
              type="button"
              onClick={() => onOpenAttachmentPreview({
                name: attachment.name,
                content: attachment.url,
                url: attachment.url,
              })}
              className="group h-auto rounded-xl p-0 outline-hidden transition-transform hover:bg-transparent hover:text-current hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-(--foreground)"
              title="Open attachment"
            >
              <img
                src={attachment.url}
                alt={attachment.name}
                className="max-h-[200px] max-w-[200px] rounded-xl object-cover transition-opacity group-hover:opacity-90"
              />
            </Button>
          ))}
        </div>
      ) : null}
      {message.documentNames.length > 0 ? (
        <div className={`flex w-full flex-wrap gap-1.5 ${message.mine ? 'justify-end' : ''}`}>
          {message.documentNames.map((name) => (
            <div
              key={name}
              className="flex max-w-[220px] items-center gap-1.5 rounded-xl bg-(--surface-elevated) px-2.5 py-1.5 text-xs text-(--muted)"
            >
              <FileText size={13} className="shrink-0 text-(--muted)" />
              <span className='truncate font-medium text-(--foreground)'>
                {name}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

function RoomMessageEditor({ editingContent, onEditingContentChange, onSaveEdit, onCancelEdit }: {
  editingContent: string
  onEditingContentChange: (value: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}) {
  return (
    <div className="mt-1 flex w-full gap-2">
      <Textarea
        autoFocus
        rows={3}
        value={editingContent}
        onChange={(event) => onEditingContentChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSaveEdit()
          }
          if (event.key === 'Escape') onCancelEdit()
        }}
        className="min-h-20 flex-1 resize-y"
      />
      <Button
        variant="primary"
        size="icon"
        type="button"
        onClick={onSaveEdit}
        aria-label="Save edit"
        className="shrink-0"
      >
        <Check size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={onCancelEdit}
        aria-label="Cancel edit"
        className="h-9 w-9 shrink-0 rounded-lg p-0 text-(--muted) hover:bg-(--surface-subtle)"
      >
        <X size={14} />
      </Button>
    </div>
  )
}

function RoomReactionRow({ reactions, alignEnd, onToggleReaction }: {
  reactions: RoomMessageReaction[]
  alignEnd: boolean
  onToggleReaction: (emoji: string) => void
}) {
  if (reactions.length === 0) return null
  return (
    <div className={`flex flex-wrap items-center gap-1 ${alignEnd ? 'justify-end' : ''}`}>
      {reactions.map((reaction) => (
        <Button
          variant="ghost"
          key={reaction.emoji}
          type="button"
          onClick={() => onToggleReaction(reaction.emoji)}
          className={`h-6 gap-1 rounded-full px-2 text-[11px] font-normal text-inherit transition-colors ${
            reaction.reactedByCurrentPrincipal
              ? 'bg-(--surface-muted) text-(--foreground)'
              : 'bg-(--surface-subtle) hover:bg-(--surface-muted)'
          }`}
        >
          <span>{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </Button>
      ))}
    </div>
  )
}

function RoomThreadEntry({ mine, replyCount, threadTeaser, onOpenThread }: {
  mine: boolean
  replyCount: number
  threadTeaser: RoomThreadTeaser | null
  onOpenThread: () => void
}) {
  if (!mine && replyCount > 0) {
    return (
      <Button
        variant="ghost"
        type="button"
        onClick={onOpenThread}
        data-testid="thread-teaser"
        className="group/thread mt-0.5 h-auto max-w-xl items-start justify-start gap-2 rounded-md px-1 py-1 text-left font-normal text-(--foreground) transition-colors hover:bg-(--surface-subtle)"
      >
        <MessageSquareReply size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-(--muted)" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-(--foreground)">
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </span>
          {threadTeaser?.text ? (
            <span className="mt-0.5 block truncate text-[12px] text-(--muted)">
              <span className="font-medium text-(--foreground)">{threadTeaser.authorName}</span>
              {': '}
              {threadTeaser.text}
            </span>
          ) : null}
        </span>
      </Button>
    )
  }
  if (replyCount > 0) {
    return (
      <Button
        variant="ghost"
        type="button"
        onClick={onOpenThread}
        data-testid="thread-teaser"
        className={`h-auto w-auto gap-1 p-0 text-[11px] font-medium text-(--muted) transition-colors hover:bg-transparent hover:text-(--foreground) ${mine ? 'self-end' : ''}`}
      >
        <MessageSquareReply size={12} strokeWidth={1.75} />
        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
      </Button>
    )
  }
  return null
}

function RoomMessageMetaRow({ message, timeLabel, grouped, pinned }: {
  message: RoomMessageView
  timeLabel: string
  grouped: boolean
  pinned: boolean
}) {
  return (
    <div className="mb-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <AuthorIdentityPopover
        name={message.authorName}
        email={message.authorEmail}
        status={message.authorStatus}
      >
        <span className="truncate text-[13px] font-bold text-(--foreground) hover:underline">
          {message.authorName}
        </span>
      </AuthorIdentityPopover>
      {message.authorStatus && message.authorStatus !== 'member' ? (
        <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${AUTHOR_STATUS_META[message.authorStatus].className}`}>
          {AUTHOR_STATUS_META[message.authorStatus].label}
        </span>
      ) : null}
      {!grouped ? <time className="shrink-0 text-[11px] text-(--muted-light)">{timeLabel}</time> : null}
      {message.editedAt ? <span className="text-[11px] text-(--muted-light)">edited</span> : null}
      {pinned ? <Pin size={11} className="shrink-0 text-(--muted-light)" /> : null}
    </div>
  )
}

function AgentMessageBody({ message, onOpenAttachmentPreview, onControlRemoteQueue, onResolveRemoteRequest, remoteStatus }: {
  remoteStatus?: ReactNode
  message: RoomMessageView
  onOpenAttachmentPreview: RoomMessageItemProps['onOpenAttachmentPreview']
  onControlRemoteQueue: RoomMessageItemProps['onControlRemoteQueue']
  onResolveRemoteRequest: RoomMessageItemProps['onResolveRemoteRequest']
}) {
  const collapseAgentWork = useOptionalAppSettings()?.settings.collapseAgentWork !== false
  const resolveFileHref = useSavedDriveLinkResolver(message.remoteDrive)
  return (
    <>
      {message.askedBy ? (
        <p className="mb-1 text-[11px] text-(--muted)">
          Agent question · step {message.askedBy.hop} of {MAX_AGENT_HOPS}
          {message.askedBy.parentConversationId ? (
            <>
              {' · '}
              <a
                href={`/app/chat?id=${encodeURIComponent(message.askedBy.parentConversationId)}`}
                className="underline underline-offset-2 hover:text-(--foreground)"
              >
                see where it came from
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <AssistantVisualBlocks
        blocks={message.blocks}
        blockKeyPrefix={message.id}
        markdownKeyPrefix={message.id}
        workedDurationMs={message.workedDurationMs}
        foldWorkIntoSummary={collapseAgentWork && !['cancelled', 'failed', 'recoverable'].includes(message.remoteRun?.state ?? '')}
        isStreaming={Boolean(message.streaming)}
        isTextStreaming={Boolean(message.streaming)}
        suppressTypingIndicator
        resolveFileHref={resolveFileHref}
        onOpenDraft={NOOP_DRAFT}
        onCreateAutomationDraft={NOOP_DRAFT}
        onOpenAttachmentPreview={onOpenAttachmentPreview}
      />
      {message.remoteDrive ? <RemoteDriveStatus status={message.remoteDrive} /> : null}
      {message.streaming ? (
        <div className="flex items-center gap-1 py-1" aria-label={`${message.authorName} is responding`}>
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--muted-light)"
              style={{ animationDelay: `${dot * 120}ms` }}
            />
          ))}
          {message.remoteRun?.state !== 'finalizing' ? remoteStatus : null}
        </div>
      ) : null}
      {message.remoteQueue && onControlRemoteQueue ? (
        <RemoteQueueControls queue={message.remoteQueue} onControl={onControlRemoteQueue} />
      ) : null}
      {message.remoteRun ? <RemoteRunDeadline deadlineAt={message.remoteRun.hardDeadlineAt} state={message.remoteRun.state} /> : null}
      {message.remoteRun?.recovered ? <p className="mt-1 text-xs text-(--muted)" role="status">Recovered</p> : null}
      {message.remoteRun?.state === 'cancelled' ? <p className='mt-2 text-xs text-(--muted)' role='status'>Cancelled</p> : null}
      {message.remoteRequest && onResolveRemoteRequest ? (
        <RemoteRequestControls key={message.remoteRequest.requestKey} request={message.remoteRequest} onResolve={onResolveRemoteRequest} />
      ) : null}
      {message.remoteRun && onControlRemoteQueue && message.remoteRun.state !== 'waiting' ? (
        <RemoteRunControls run={message.remoteRun} onControl={onControlRemoteQueue} />
      ) : null}
    </>
  )
}

function SentRoomMessage({ rootProps, highlightClass, toolbar, content, onRetrySend }: {
  rootProps: RoomMessageRootProps
  highlightClass: string
  toolbar: ReactNode
  content: RoomMessageContentProps
  onRetrySend: () => void
}) {
  const { message, personalChatStyle } = content
  return (
    <div
      {...rootProps}
      className={`group/exchange relative -mx-1 flex scroll-mt-6 justify-end gap-2.5 rounded-lg px-1 py-1 message-appear transition-colors ${personalChatStyle ? '' : 'hover:bg-(--surface-subtle)'} ${highlightClass}`}
    >
      <div className="relative flex min-w-0 max-w-[min(92%,36rem)] flex-col items-end gap-1 sm:max-w-[75%]">
        {!personalChatStyle && toolbar}
        <RoomMessageAttachments message={message} onOpenAttachmentPreview={content.onOpenAttachmentPreview} />
        {content.editing ? (
          <RoomMessageEditor
            editingContent={content.editingContent}
            onEditingContentChange={content.onEditingContentChange}
            onSaveEdit={content.onSaveEdit}
            onCancelEdit={content.onCancelEdit}
          />
        ) : (
          <SentMessageContent message={message} />
        )}
        {message.delivery === 'failed' ? (
          <Button variant="ghost" type="button" className="h-auto p-0 text-[11px] font-medium text-red-500 hover:bg-transparent hover:text-red-500 hover:underline" onClick={onRetrySend}>
            Failed to send · Retry
          </Button>
        ) : null}
        <RoomReactionRow reactions={content.reactions} alignEnd onToggleReaction={content.onToggleReaction} />
        <RoomThreadEntry mine replyCount={content.replyCount} threadTeaser={content.threadTeaser} onOpenThread={content.onOpenThread} />
        {personalChatStyle && toolbar}
      </div>
    </div>
  )
}

function ReceivedRoomMessage({ rootProps, highlightClass, toolbar, content, isAgent, timeLabel, grouped, pinned, onControlRemoteQueue, onResolveRemoteRequest }: {
  rootProps: RoomMessageRootProps
  highlightClass: string
  toolbar: ReactNode
  content: RoomMessageContentProps
  isAgent: boolean
  timeLabel: string
  grouped: boolean
  pinned: boolean
  onControlRemoteQueue: RoomMessageItemProps['onControlRemoteQueue']
  onResolveRemoteRequest: RoomMessageItemProps['onResolveRemoteRequest']
}) {
  const { message, personalChatStyle } = content
  return (
    <div
      {...rootProps}
      className={`group/exchange relative -mx-1 flex scroll-mt-6 gap-2.5 rounded-lg px-1 py-1 message-appear transition-colors ${personalChatStyle ? '' : 'hover:bg-(--surface-subtle)'} ${highlightClass}`}
    >
      <RoomMessageAvatar message={message} />
      <div className="relative min-w-0 flex-1">
        {!personalChatStyle && toolbar}
        <RoomMessageMetaRow message={message} timeLabel={timeLabel} grouped={grouped} pinned={pinned} />
        <RoomMessageAttachments message={message} onOpenAttachmentPreview={content.onOpenAttachmentPreview} />
        {content.editing ? (
          <RoomMessageEditor
            editingContent={content.editingContent}
            onEditingContentChange={content.onEditingContentChange}
            onSaveEdit={content.onSaveEdit}
            onCancelEdit={content.onCancelEdit}
          />
        ) : isAgent ? (
          <AgentMessageBody
            remoteStatus={content.remoteStatus}
            message={message}
            onOpenAttachmentPreview={content.onOpenAttachmentPreview}
            onControlRemoteQueue={onControlRemoteQueue}
            onResolveRemoteRequest={onResolveRemoteRequest}
          />
        ) : (
          <HumanMessageText message={message} />
        )}
        <RoomReactionRow reactions={content.reactions} alignEnd={message.mine} onToggleReaction={content.onToggleReaction} />
        <RoomThreadEntry mine={message.mine} replyCount={content.replyCount} threadTeaser={content.threadTeaser} onOpenThread={content.onOpenThread} />
        {personalChatStyle && toolbar}
      </div>
    </div>
  )
}

function RemoteRequestControls({ request, onResolve }: {
  request: NonNullable<RoomMessageView['remoteRequest']>
  onResolve: NonNullable<RoomMessageItemProps['onResolveRemoteRequest']>
}) {
  const { properties, required } = useMemo(
    () => ({
      properties:
        request.requestedSchema?.properties &&
        typeof request.requestedSchema.properties === 'object'
          ? (request.requestedSchema.properties as Record<
              string,
              {
                title?: string
                type?: string
                enum?: unknown[]
                oneOf?: Array<{ const?: unknown; title?: string }>
              }
            >)
          : {},
      required: Array.isArray(request.requestedSchema?.required)
        ? request.requestedSchema.required.filter(
            (key): key is string => typeof key === 'string',
          )
        : [],
    }),
    [request],
  )
  const requiredSet = new Set(required)
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialElicitationValues(properties, required),
  )
  return (
    <div className="mt-3 max-w-xl rounded-lg bg-(--surface-subtle) p-3">
      <p className='text-xs font-medium text-(--foreground)'>
        {request.pendingDelivery ? 'Decision pending delivery' : request.kind === 'permission'
          ? 'Permission requested'
          : 'Input requested'}
      </p>
      <p className='mt-1 text-xs leading-5 text-(--muted)'>
        {request.prompt}
      </p>
      {request.expiresAt ? <p className='mt-1 text-xs text-(--muted)'>Expires {new Date(request.expiresAt).toLocaleString()}</p> : null}
      {request.machineCostContinues ? <p className='mt-1 text-xs text-(--muted)'>Machine time continues to be billed while waiting.</p> : null}
      {request.pendingDelivery ? <p className='mt-2 text-xs text-(--muted)'>Waiting for the agent to accept your decision.</p> : null}
      {!request.pendingDelivery && request.kind === 'elicitation'
        ? Object.entries(properties).map(([key, property]) =>
        property.type === 'boolean' ? (
          <div key={key} className="mt-2 flex items-center gap-3">
            <span className="flex-1 text-[11px] text-(--muted)">
                  {property.title ?? key}
                  {requiredSet.has(key) ? ' *' : ''}
            </span>
            <Toggle
              checked={values[key] === true}
                  onCheckedChange={(next) =>
                    setValues((current) => ({ ...current, [key]: next }))
                  }
                  aria-label={
                    typeof (property.title ?? key) === 'string'
                      ? ((property.title ?? key) as string)
                      : key
                  }
            />
          </div>
        ) : (
          <label key={key} className="mt-2 block text-[11px] text-(--muted)">
            <span>{property.title ?? key}{requiredSet.has(key) ? ' *' : ''}</span>
            {elicitationOptions(property).length > 0 ? (
              <Select
                aria-label={key}
                value={String(values[key] ?? '')}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [key]: elicitationFieldValue(property.type, event.target.value),
                  }))
                }
                className="mt-1 h-8 w-full rounded-md bg-(--surface) px-2 text-xs text-(--foreground)"
              >
                <option value="">Select…</option>
                {elicitationOptions(property).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input type={property.type === 'number' || property.type === 'integer' ? 'number' : 'text'}
                aria-label={key}
                value={String(values[key] ?? '')}
                onChange={(event) => setValues((current) => ({ ...current, [key]: elicitationFieldValue(property.type, event.target.value) }))}
                className="mt-1 h-8 w-full rounded-md bg-(--surface) px-2 text-xs text-(--foreground)" />
            )}
          </label>
        ),
        )
        : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {request.pendingDelivery ? null : request.kind === 'permission' ? (
          request.options.map((option) => (
            <Button
              variant="ghost"
              key={option.id}
              type='button'
              onClick={() => onResolve(request, option.id)}
              className='h-auto rounded-md bg-(--surface) px-2 py-1 text-xs font-normal text-(--foreground) hover:bg-(--surface-muted)'
            >
              {option.label}
            </Button>
          ))
        ) : (
          <>
            <Button
              variant="ghost"
              type='button'
              onClick={() => onResolve(request, 'accept', values)}
              className='h-auto rounded-md bg-(--surface) px-2 py-1 text-xs font-normal text-(--foreground) hover:bg-(--surface-muted)'
            >
              Submit
            </Button>
            <Button
              variant="ghost"
              type='button'
              onClick={() => onResolve(request, 'decline')}
              className='h-auto rounded-md px-2 py-1 text-xs font-normal text-(--muted) hover:bg-(--surface)'
            >
              Decline
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function initialElicitationValues(
  properties: Record<string, { type?: string }>,
  required: string[],
) {
  return Object.fromEntries(required.flatMap((key) => properties[key]?.type === 'boolean' ? [[key, false]] : []))
}

function elicitationFieldValue(type: string | undefined, value: string): unknown {
  if (type === 'number' || type === 'integer') return value === '' ? '' : Number(value)
  if (type === 'boolean') return value === 'true'
  if (type === 'array')
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  return value
}

function elicitationOptions(property: { enum?: unknown[]; oneOf?: Array<{ const?: unknown; title?: string }> }) {
  if (Array.isArray(property.enum)) return property.enum.map((value) => ({ value: String(value), label: String(value) }))
  if (Array.isArray(property.oneOf)) return property.oneOf.flatMap((option) => option.const === undefined
    ? [] : [{ value: String(option.const), label: option.title ?? String(option.const) }])
  return []
}

function RemoteRunControls({ run, onControl }: {
  run: NonNullable<RoomMessageView['remoteRun']>
  onControl: NonNullable<RoomMessageItemProps['onControlRemoteQueue']>
}) {
  if (['completed', 'cancelled', 'failed'].includes(run.state)) return null
  if (run.state === 'recovering') return <p className='mt-2 text-xs text-(--muted)' role='status'>Resuming…</p>
  if (run.state === 'cancelling') return <p className='mt-2 text-xs text-(--muted)' role='status'>Cancellation requested. Waiting for execution to stop.</p>
  if (run.state === 'needs_attention') return (
    <div className="mt-2 flex items-center gap-2 text-xs text-(--muted)">
      <p role="status">Execution needs attention. Stop or isolate the original process before starting fresh.</p>
      <Button variant="ghost" type="button" className={unstyledButton("shrink-0 rounded-md bg-(--surface-subtle) px-2 py-1 text-(--foreground) hover:bg-(--surface-muted)")}
        onClick={() => {
          if (window.confirm('Confirm that you inspected and stopped or isolated the original process. Starting fresh creates a new attempt and does not resume the old process.'))
            onControl(run.runId, 'start_fresh')
        }}>Start fresh</Button>
    </div>
  )
  if (run.state === 'recoverable') return (
    <div className="mt-2 flex items-center gap-2 text-xs text-(--muted)">
        <span>
          {run.retryClass === 'host_offline'
            ? 'The environment went offline.'
            : 'This run can be recovered.'}
        </span>
        <Button
          variant="ghost"
          type='button'
          onClick={() => onControl(run.runId, 'resume')}
          className='h-auto rounded-md bg-(--surface-subtle) px-2 py-1 font-normal text-(--foreground) hover:bg-(--surface-muted)'
        >
          Resume
        </Button>
        <Button
          variant="ghost"
          type='button'
          onClick={() => onControl(run.runId, 'start_fresh')}
          className='h-auto rounded-md px-2 py-1 font-normal text-inherit hover:bg-(--surface-subtle)'
        >
          Start fresh
        </Button>
    </div>
  )
  // Cancelling an active run is the Stop button in the message toolbar.
  return null
}

function RemoteQueueControls({
  queue,
  onControl,
}: {
  queue: NonNullable<RoomMessageView['remoteQueue']>
  onControl: NonNullable<RoomMessageItemProps['onControlRemoteQueue']>
}) {
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    const refresh = () => setElapsed(Date.now() >= queue.queueExpiresAt)
    refresh()
    const timeout = window.setTimeout(refresh, Math.max(0, queue.queueExpiresAt - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [queue.queueExpiresAt])

  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-(--muted)">
      <span>
        {elapsed
          ? 'The 2-minute waiting window elapsed.'
          : 'Waiting up to 2 minutes for the environment to reconnect.'}
      </span>
      <Button
        variant="ghost"
        type='button'
        onClick={() => onControl(queue.runId, 'cancel')}
        className='h-auto rounded-md px-2 py-1 font-normal text-inherit hover:bg-(--surface-subtle) hover:text-(--foreground)'
      >
        Cancel
      </Button>
      <Button
        variant="ghost"
        type='button'
        onClick={() => onControl(queue.runId, 'retry')}
        className='h-auto rounded-md bg-(--surface-subtle) px-2 py-1 font-normal text-(--foreground) hover:bg-(--surface-muted)'
      >
        Retry
      </Button>
    </div>
  )
}

const QUICK_REACTIONS = [
  '👍', '🎉', '❤️', '😄', '🙌', '👀', '🔥', '✅',
  '🙏', '😮', '😢', '🤔', '🚀', '💡', '👏', '⚠️',
  '💯', '🤝', '📌', '☕', '🐛', '✨', '❓', '❌',
]

function toolbarRailClass(floating: boolean, pickerOpen: boolean, alignEnd: boolean) {
  return floating
    ? `absolute -top-3 right-0 z-20 flex items-center gap-0.5 rounded-lg bg-(--surface-elevated) p-0.5 shadow-md ${messageActionVisibilityClass(pickerOpen)}`
    : `chat-exchange-actions--hover flex items-center gap-1 px-1 pt-0.5 ${messageActionVisibilityClass(pickerOpen)} ${alignEnd ? 'justify-end' : ''}`
}

function ToolbarIconButton({ buttonClass, onClick, disabled, ariaLabel, title, children }: {
  buttonClass: string
  onClick: () => void
  disabled: boolean
  ariaLabel: string
  title?: string
  children: ReactNode
}) {
  return (
    <Button variant="ghost" size="icon" type="button" onClick={onClick} disabled={disabled} className={`h-auto w-auto ${buttonClass}`} aria-label={ariaLabel} title={title}>
      {children}
    </Button>
  )
}

function PinMessageButton({ buttonClass, pinned, disabled, onTogglePinned }: {
  buttonClass: string
  pinned: boolean
  disabled: boolean
  onTogglePinned: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      onClick={onTogglePinned}
      disabled={disabled}
      className={`h-auto w-auto ${buttonClass} ${pinned ? 'bg-(--surface-subtle)' : ''}`}
      aria-label={pinned ? 'Unpin message' : 'Pin message'}
      aria-pressed={pinned}
    >
      <Pin size={14} strokeWidth={1.75} className={pinned ? 'fill-current' : undefined} />
    </Button>
  )
}

function SaveMessageButton({ buttonClass, saved, disabled, onToggleSaved }: {
  buttonClass: string
  saved: boolean
  disabled: boolean
  onToggleSaved: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      onClick={onToggleSaved}
      disabled={disabled}
      className={`h-auto w-auto ${buttonClass} ${saved ? 'bg-(--surface-subtle)' : ''}`}
      aria-label={saved ? 'Remove from saved' : 'Save message'}
      aria-pressed={saved}
    >
      <Bookmark size={14} strokeWidth={1.75} className={saved ? 'fill-current' : undefined} />
    </Button>
  )
}

function EditDeleteButtons({ buttonClass, disabled, onStartEdit, onDelete }: {
  buttonClass: string
  disabled: boolean
  onStartEdit: () => void
  onDelete: () => void
}) {
  return (
    <>
      <ToolbarIconButton buttonClass={buttonClass} onClick={onStartEdit} disabled={disabled} ariaLabel="Edit message">
        <Pencil size={14} strokeWidth={1.75} />
      </ToolbarIconButton>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className={`h-auto w-auto ${buttonClass.replace('hover:text-(--foreground)', 'hover:text-red-500')}`}
        aria-label="Delete message"
      >
        <Trash2 size={14} strokeWidth={1.75} />
      </Button>
    </>
  )
}

function RoomMessageToolbar({
  diagnostics,
  alignEnd,
  floating,
  copyText,
  canEdit,
  canReport,
  pinned,
  saved,
  disabled,
  onStop,
  onStartEdit,
  onDelete,
  onReport,
  onSelectReaction,
  onOpenThread,
  onQuoteReply,
  onTogglePinned,
  onToggleSaved,
  onCopyPermalink,
}: {
  diagnostics?: ReactNode
  alignEnd: boolean
  floating: boolean
  copyText: string
  canEdit: boolean
  canReport: boolean
  pinned: boolean
  saved: boolean
  disabled: boolean
  onStop?: () => void
  onStartEdit: () => void
  onDelete: () => void
  onReport: () => void
  onSelectReaction: (emoji: string) => void
  onOpenThread: () => void
  onQuoteReply: () => void
  onTogglePinned: () => void
  onToggleSaved: () => void
  onCopyPermalink: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const buttonClass =
    'rounded-md p-1.5 text-(--muted) transition-[color,background-color,transform] hover:bg-(--surface-subtle) hover:text-(--foreground) active:scale-90 active:bg-(--border) disabled:cursor-not-allowed disabled:opacity-30'

  const railClass = toolbarRailClass(floating, pickerOpen || Boolean(onStop), alignEnd)

  return (
    <div className={railClass}>
      {diagnostics}
      {onStop ? (
        <ToolbarIconButton buttonClass={buttonClass} onClick={onStop} disabled={disabled} ariaLabel="Stop response" title="Stop response">
          <Square size={13} strokeWidth={1.75} className="fill-current" />
        </ToolbarIconButton>
      ) : null}
      <EmojiPickerButton
        alignEnd={alignEnd || floating}
        disabled={disabled}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onSelectReaction}
        buttonClass={buttonClass}
      />
      <ToolbarIconButton buttonClass={buttonClass} onClick={onOpenThread} disabled={disabled} ariaLabel="Reply in thread">
        <MessageSquareReply size={14} strokeWidth={1.75} />
      </ToolbarIconButton>
      <ToolbarIconButton buttonClass={buttonClass} onClick={onQuoteReply} disabled={disabled} ariaLabel="Quote in reply">
        <MessageSquareReply size={14} strokeWidth={1.75} className="rotate-180" />
      </ToolbarIconButton>
      <FlashCopyIconButton copyText={copyText} disabled={disabled || copyText.length === 0} ariaLabel="Copy message" />
      <ToolbarIconButton buttonClass={buttonClass} onClick={onCopyPermalink} disabled={disabled} ariaLabel="Copy message link" title="Copy message link">
        <Link2 size={14} strokeWidth={1.75} />
      </ToolbarIconButton>
      <PinMessageButton buttonClass={buttonClass} pinned={pinned} disabled={disabled} onTogglePinned={onTogglePinned} />
      <SaveMessageButton buttonClass={buttonClass} saved={saved} disabled={disabled} onToggleSaved={onToggleSaved} />
      {canReport ? (
        <ToolbarIconButton buttonClass={buttonClass} onClick={onReport} disabled={disabled} ariaLabel="Report message">
          <Flag size={14} strokeWidth={1.75} />
        </ToolbarIconButton>
      ) : null}
      {canEdit ? (
        <EditDeleteButtons buttonClass={buttonClass} disabled={disabled} onStartEdit={onStartEdit} onDelete={onDelete} />
      ) : null}
    </div>
  )
}

function EmojiPickerButton({
  alignEnd,
  disabled,
  open,
  onOpenChange,
  onSelect,
  buttonClass,
}: {
  alignEnd: boolean
  disabled: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (emoji: string) => void
  buttonClass: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const setOpen = onOpenChange

  const onPointerDown = useEffectEvent((event: MouseEvent) => {
    if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
  })
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') onOpenChange(false)
  })

  useEffect(() => {
    if (!open) return
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={`h-auto w-auto ${buttonClass} ${open ? 'bg-(--surface-subtle)' : ''}`}
        aria-label="Add reaction"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <SmilePlus size={14} strokeWidth={1.75} />
      </Button>
      {open ? (
        // Anchored reaction picker — a native <dialog> cannot anchor above the trigger.
        // react-doctor-disable-next-line react-doctor/prefer-html-dialog
        <div
          role="dialog"
          aria-label="Pick a reaction"
          className={`overlay-pop-in absolute bottom-full z-30 mb-1.5 w-64 rounded-xl bg-(--surface-elevated) p-2 shadow-lg ${
            alignEnd ? 'right-0' : 'left-0'
          }`}
        >
          <div className="grid grid-cols-8 gap-0.5">
            {QUICK_REACTIONS.map((emoji) => (
              <Button
                variant="ghost"
                size="icon"
                key={emoji}
                type="button"
                onClick={() => {
                  onSelect(emoji)
                  setOpen(false)
                }}
                className="h-7 w-7 rounded-md p-0 text-base hover:bg-(--surface-muted)"
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

'use client'

/* eslint-disable @next/next/no-img-element -- room attachments mirror the chat transcript renderer */

import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import {
  Bookmark,
  FileText,
  Flag,
  Link2,
  MessageSquareReply,
  Pencil,
  Pin,
  RotateCcw,
  SmilePlus,
  Square,
  Trash2,
} from 'lucide-react'
import type { AssistantVisualBlock } from '@overlay/chat-core'
import { AgentResponsePending } from './AgentResponsePending'
import { usePublicTrace } from '../chat/usePublicTrace'
import { FlashCopyIconButton } from '@overlay/chat-react/draft-review-modal'
import { UserMessageBubble } from '@overlay/chat-react/user-message-bubble'
import { AssistantVisualBlocks, ExchangeActions, isRecentMessage, messageActionVisibilityClass, useMessageEntrance } from '@overlay/chat-react/transcript'
import type { AttachmentPreview, ChatMessageMention } from '@overlay/chat-react'
import { Avatar, AvatarFallback, AvatarImage, Button, Textarea } from '@overlay/ui/primitives'
import { MarkdownMessage } from '@overlay/chat-react'
import { AgentCreature } from '@/components/orb/Creature'
import { PrincipalAvatar } from '@/components/identity/PrincipalAvatar'
import { useOptionalAppSettings } from '@/components/providers/AppSettingsProvider'
import { roomMessageDomId } from './room-message-view'
import { roomMessageTime } from './room-message-time'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import { NativeAgentApprovalCard } from './NativeAgentApprovalCard'
import type { RunPlanPhase, RunPlanStep } from '@overlay/chat-react/exchange'
import { NativeAgentInputCard } from './NativeAgentInputCard'
import type { NativeAgentApproval } from '@/shared/agents/native-agent-approval'
import type { NativeAgentInput } from '@/shared/agents/native-agent-input'
import type { FolderSavesData } from '@/shared/agents/folder-saves'
import { FolderSavesCard } from '../thread-work/FolderSavesCard'

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
  authorPhotoUrl?: string
  authorKind: 'human' | 'agent' | 'model' | 'system'
  authorColor?: string
  /** Creature body shape for agent authors; absent means circle. */
  authorShape?: string
  authorIsDefault?: boolean
  /** Present for messages imported from Slack: shown in the author detail card. */
  authorEmail?: string
  authorStatus?: 'member' | 'invited' | 'not_invited'
  createdAt: number
  eventSequence?: number
  editedAt?: number
  editHistory?: Array<{ content: string; editedAt: number }>
  deletedAt?: number
  delivery?: 'sending' | 'failed'
  deliveryError?: string
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
  nativeApproval?: NativeAgentApproval
  nativeInput?: NativeAgentInput
  /** What the run saved back to Files and the pull requests it opened. */
  folderSaves?: FolderSavesData
  plan?: readonly RunPlanStep[]
  planPhase?: RunPlanPhase
  generationError?: string
  /** Persisted turn time for agent messages (assistant row createdAt→updatedAt). */
  workedDurationMs?: number
}

export type RoomMessageItemProps = {
  readOnly?: boolean
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
  /** Agent threads use the personal-chat response actions instead of channel actions. */
  chatActions?: RoomChatActions
}

export type RoomChatActions = {
  onRegenerate?: () => void
  retryDisabled: boolean
  /** True while the reply's own turn is still running, so it cannot be deleted. */
  actionsLocked: boolean
  onDeleteTurn: () => void
  onReply: () => void
  onBranch?: () => void
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

/** Agent mention chips carry the creature avatar and person chips the account photo; other types keep their icon. */
const renderMentionAvatar = (mention: ChatMessageMention) =>
  mention.type === 'agent' || mention.type === 'person'
    ? <PrincipalAvatar principal={{ ...mention, principalType: mention.type === 'agent' ? 'agent' : 'human' }} size={14} />
    : undefined

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
  readOnly = false,
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
  onStopResponse,
  highlighted = false,
  grouped = false,
  personalChatStyle = false,
  hideToolbar = false,
  chatActions,
}: RoomMessageItemProps) {
  recordRender('RoomMessageItem')
  const { mine } = message
  const isAgent =
    message.authorKind === 'agent' || message.authorKind === 'model'
  const timeLabel = roomMessageTime(message.createdAt)
  const rootProps = {
    id: roomMessageDomId(message.id),
    'data-room-message': message.id,
    // Links in a room message follow the open-in-Overlay preference.
    'data-overlay-link-scope': '',
  }
  const highlightClass = highlighted
    ? 'rounded-xl ring-2 ring-(--foreground) ring-offset-4 ring-offset-(--background)'
    : ''

  const stopHandler = message.streaming ? onStopResponse : undefined

  const toolbar = hideToolbar ? null : chatActions ? (
    <RoomChatMessageActions message={message} isAgent={isAgent} actions={chatActions} />
  ) : (
    <RoomMessageToolbar
      alignEnd={mine}
      floating={!personalChatStyle}
      copyText={message.text}
      canEdit={mine && !readOnly}
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
    />
  )

  const content: RoomMessageContentProps = {
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
    readOnly,
    chatActions: Boolean(chatActions),
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
        readOnly={readOnly}
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
  readOnly: boolean
  chatActions: boolean
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
          isDefault={message.authorIsDefault}
          agent={{ name: message.authorName, avatarColor: message.authorColor, avatarShape: message.authorShape }}
          size={32}
          animated={message.streaming}
          working={message.streaming}
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
      <Avatar className="h-9 w-9 shrink-0 rounded-lg bg-(--surface-muted)">
        <AvatarImage src={message.authorPhotoUrl} alt="" />
        <AvatarFallback className="rounded-lg text-[13px] font-semibold">
          {authorInitial(message.mine ? 'You' : message.authorName)}
        </AvatarFallback>
      </Avatar>
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
  const entranceClass = useMessageEntrance(isRecentMessage(message.createdAt))
  if (mine) {
    return (
      <div
        {...rootProps}
        className={`group/exchange relative -mx-1 flex scroll-mt-6 justify-end gap-2.5 rounded-lg px-1 py-1 ${entranceClass} transition-colors ${personalChatStyle ? '' : 'hover:bg-(--surface-subtle)'} ${highlightClass}`}
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
    <div className="mt-1 w-full">
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
        className="w-full resize-none"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancelEdit} aria-label="Cancel edit">
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="button" onClick={onSaveEdit} aria-label="Save edit">
          Save
        </Button>
      </div>
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

function AgentMessageBody({ message, readOnly, onOpenAttachmentPreview }: {
  message: RoomMessageView
  readOnly: boolean
  onOpenAttachmentPreview: RoomMessageItemProps['onOpenAttachmentPreview']
}) {
  const collapseAgentWork = useOptionalAppSettings()?.settings.collapseAgentWork !== false
  const trace = usePublicTrace({ messageId: message.id, enabled: !message.streaming && (!message.planPhase || message.planPhase === 'ended'),
    blocks: message.blocks, terminalState: message.generationError ? 'error' : 'completed' })
  return (
    <>
      <AgentResponsePending key={message.id} message={message} />
      {message.askedBy ? (
        <p className="mb-1 text-[11px] text-(--muted)">
          Agent question · step {message.askedBy.hop}
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
        blocks={trace.blocks}
        onWorkExpandedChange={trace.onWorkExpandedChange}
        workDetails={trace.workDetails}
        blockKeyPrefix={message.id}
        markdownKeyPrefix={message.id}
        workedDurationMs={message.workedDurationMs}
        plan={message.plan}
        planPhase={message.planPhase}
        foldWorkIntoSummary={collapseAgentWork}
        isStreaming={Boolean(message.streaming)}
        isTextStreaming={Boolean(message.streaming)}
        suppressTypingIndicator
        onOpenDraft={NOOP_DRAFT}
        onCreateAutomationDraft={NOOP_DRAFT}
        onOpenAttachmentPreview={onOpenAttachmentPreview}
        generatedUiReadOnly={readOnly}
      />
      {/* The avatar beside the name shows activity; no second indicator under the reply. */}
      {message.nativeApproval ? <NativeAgentApprovalCard key={message.nativeApproval.token} approval={message.nativeApproval} /> : null}
      {message.nativeInput ? <NativeAgentInputCard key={message.nativeInput.token} request={message.nativeInput} /> : null}
      {message.folderSaves ? <FolderSavesCard data={message.folderSaves} /> : null}
      {message.generationError ? <p className="mt-2 text-sm text-destructive" role="alert">{message.generationError}</p> : null}
    </>
  )
}

function SentRoomMessage({ rootProps, highlightClass, toolbar, content, onRetrySend, readOnly }: {
  readOnly: boolean
  rootProps: RoomMessageRootProps
  highlightClass: string
  toolbar: ReactNode
  content: RoomMessageContentProps
  onRetrySend: () => void
}) {
  const { message, personalChatStyle } = content
  const entranceClass = useMessageEntrance(isRecentMessage(message.createdAt))
  return (
    <div
      {...rootProps}
      className={`group/exchange relative -mx-1 flex scroll-mt-6 justify-end gap-2.5 rounded-lg px-1 py-1 ${entranceClass} transition-colors ${personalChatStyle ? '' : 'hover:bg-(--surface-subtle)'} ${highlightClass}`}
    >
      <div className={`relative flex min-w-0 max-w-[min(92%,36rem)] flex-col items-end gap-1 sm:max-w-[75%] ${content.editing ? 'w-full' : ''}`}>
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
          readOnly ? <p className="text-[11px] text-(--muted)">{message.deliveryError ?? 'Could not send this message.'}</p> : (
          <Button variant="ghost" type="button" className="h-auto p-0 text-[11px] font-medium text-red-500 hover:bg-transparent hover:text-red-500 hover:underline" onClick={onRetrySend}>
            {message.deliveryError ?? 'Failed to send'} · Retry
          </Button>
          )
        ) : null}
        {content.chatActions ? null : (
          <>
            <RoomReactionRow reactions={content.reactions} alignEnd onToggleReaction={content.onToggleReaction} />
            <RoomThreadEntry mine replyCount={content.replyCount} threadTeaser={content.threadTeaser} onOpenThread={content.onOpenThread} />
          </>
        )}
        {personalChatStyle && toolbar}
      </div>
    </div>
  )
}

function ReceivedRoomMessage({ rootProps, highlightClass, toolbar, content, isAgent, timeLabel, grouped, pinned }: {
  rootProps: RoomMessageRootProps
  highlightClass: string
  toolbar: ReactNode
  content: RoomMessageContentProps
  isAgent: boolean
  timeLabel: string
  grouped: boolean
  pinned: boolean
}) {
  const { message, personalChatStyle } = content
  const entranceClass = useMessageEntrance(isRecentMessage(message.createdAt))
  return (
    <div
      {...rootProps}
      className={`group/exchange relative -mx-1 flex scroll-mt-6 gap-2.5 rounded-lg px-1 py-1 ${entranceClass} transition-colors ${personalChatStyle ? '' : 'hover:bg-(--surface-subtle)'} ${highlightClass}`}
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
            message={message}
            readOnly={content.readOnly}
            onOpenAttachmentPreview={content.onOpenAttachmentPreview}
          />
        ) : (
          <HumanMessageText message={message} />
        )}
        {content.chatActions ? null : (
          <>
            <RoomReactionRow reactions={content.reactions} alignEnd={message.mine} onToggleReaction={content.onToggleReaction} />
            <RoomThreadEntry mine={message.mine} replyCount={content.replyCount} threadTeaser={content.threadTeaser} onOpenThread={content.onOpenThread} />
          </>
        )}
        {personalChatStyle && toolbar}
      </div>
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
    : `chat-exchange-actions--hover flex items-center gap-1 -ml-1.5 pt-0.5 ${messageActionVisibilityClass(pickerOpen)} ${alignEnd ? 'justify-end' : ''}`
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

function RoomChatMessageActions({ message, isAgent, actions }: {
  message: RoomMessageView
  isAgent: boolean
  actions: RoomChatActions
}) {
  if (!isAgent) {
    return (
      <div className={`chat-exchange-actions--hover flex justify-end ${messageActionVisibilityClass()}`}>
        <FlashCopyIconButton copyText={message.text} disabled={message.text.length === 0} ariaLabel="Copy message" />
      </div>
    )
  }
  if (message.streaming) return null
  return (
    <ExchangeActions
      copyPlainText={message.text}
      isExiting={false}
      onRetry={actions.onRegenerate}
      retryDisabled={actions.retryDisabled}
      onDeleteTurn={actions.onDeleteTurn}
      onReply={actions.onReply}
      onBranch={actions.onBranch}
      turnIdForActions={message.id}
      actionsLocked={actions.actionsLocked}
      sources={[]}
      userMsgId={message.id}
      isSourcesOpenForThis={false}
      modelLabel=""
      showModelLabel={false}
      actionVisibility="hover"
    />
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
  onRetry,
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
  onRetry?: () => void
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

  const railClass = toolbarRailClass(floating, pickerOpen, alignEnd)

  return (
    <div className={railClass}>
      {diagnostics}
      {onStop ? (
        <ToolbarIconButton buttonClass={buttonClass} onClick={onStop} disabled={disabled} ariaLabel="Stop response" title="Stop response">
          <Square size={13} strokeWidth={1.75} className="fill-current" />
        </ToolbarIconButton>
      ) : null}
      {onRetry ? (
        <ToolbarIconButton buttonClass={buttonClass} onClick={onRetry} disabled={disabled} ariaLabel="Retry connection" title="Retry connection">
          <RotateCcw size={14} strokeWidth={1.75} />
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
          data-side="top"
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

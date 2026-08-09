'use client'

/* eslint-disable @next/next/no-img-element -- room attachments mirror the chat transcript renderer */

import { useEffect, useRef, useState } from 'react'
import {
  Bookmark,
  Bot,
  Check,
  FileText,
  Flag,
  Link2,
  MessageSquareReply,
  Pencil,
  Pin,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react'
import type { AssistantVisualBlock } from '@overlay/chat-core'
import { FlashCopyIconButton } from '@overlay/chat-react/draft-review-modal'
import { UserMessageBubble } from '@overlay/chat-react/user-message-bubble'
import { AssistantVisualBlocks } from '@overlay/chat-react/transcript'
import type { AttachmentPreview } from '@overlay/chat-react'
import { Textarea } from '@overlay/ui/primitives'
import { MarkdownMessage } from '../MarkdownMessage'

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
  mentions: Array<{ type: string; id: string; name: string }>
  streaming?: boolean
}

export type RoomMessageItemProps = {
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
  /** Briefly outlines the message after a jump from the pinned or thread list. */
  highlighted?: boolean
  /** Consecutive messages from the same author use a compact transcript row. */
  grouped?: boolean
}

/** Rooms do not surface draft review; agent drafts are handled in personal chat. */
const NOOP_DRAFT = () => {}

/** The scroll target for pin and thread jumps. */
export function roomMessageDomId(messageId: string): string {
  return `room-message-${messageId}`
}

function authorInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?'
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
  highlighted = false,
  grouped = false,
}: RoomMessageItemProps) {
  const [editHistoryOpen, setEditHistoryOpen] = useState(false)
  const { mine } = message
  const isAgent = message.authorKind === 'agent' || message.authorKind === 'model'
  const timeLabel = new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const rootProps = {
    id: roomMessageDomId(message.id),
    'data-room-message': message.id,
  }
  const highlightClass = highlighted
    ? 'rounded-xl ring-2 ring-[var(--foreground)] ring-offset-4 ring-offset-[var(--background)]'
    : ''

  const avatarNode = isAgent ? (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
      style={{ backgroundColor: message.authorColor ?? '#64748b' }}
      aria-hidden
    >
      <Bot size={16} strokeWidth={1.75} />
    </span>
  ) : (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-[13px] font-semibold text-[var(--foreground)]"
      aria-hidden
    >
      {authorInitial(mine ? 'You' : message.authorName)}
    </span>
  )

  /** Human and agent messages share the same safe GFM renderer. */
  const humanBody = message.text ? (
    <div className="text-[15px] leading-relaxed text-[var(--foreground)]">
      <MarkdownMessage text={message.text} isStreaming={false} mentions={message.mentions} />
    </div>
  ) : null

  if (message.deletedAt) {
    return (
      <div
        {...rootProps}
        className={`group/exchange relative -mx-1 flex scroll-mt-6 gap-2.5 rounded-lg px-1 py-1 ${highlightClass}`}
      >
        {avatarNode}
        <p className="self-center text-sm italic text-[var(--muted-light)]">Message deleted</p>
      </div>
    )
  }

  const attachments = (
    <>
      {message.images.length > 0 ? (
        <div className={`flex w-full flex-wrap gap-1.5 ${mine ? 'justify-end' : ''}`}>
          {message.images.map((attachment, index) => (
            <button
              key={`${attachment.url}-${index}`}
              type="button"
              onClick={() => onOpenAttachmentPreview({
                name: attachment.name,
                content: attachment.url,
                url: attachment.url,
              })}
              className="group rounded-xl outline-none transition-transform hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-[var(--foreground)]"
              title="Open attachment"
            >
              <img
                src={attachment.url}
                alt={attachment.name}
                className="max-h-[200px] max-w-[200px] rounded-xl border border-transparent object-cover transition-colors group-hover:border-[var(--border)]"
              />
            </button>
          ))}
        </div>
      ) : null}
      {message.documentNames.length > 0 ? (
        <div className={`flex w-full flex-wrap gap-1.5 ${mine ? 'justify-end' : ''}`}>
          {message.documentNames.map((name) => (
            <div
              key={name}
              className="flex max-w-[220px] items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs text-[var(--muted)] shadow-sm"
            >
              <FileText size={13} className="shrink-0 text-[var(--muted)]" />
              <span className="truncate font-medium text-[var(--foreground)]">{name}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )

  const editor = (
    <div className="mt-1 flex w-full gap-2">
      <Textarea
        autoFocus
        rows={2}
        value={editingContent}
        onChange={(event) => onEditingContentChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSaveEdit()
          }
          if (event.key === 'Escape') onCancelEdit()
        }}
        className="min-h-12 max-h-32 flex-1 resize-y"
      />
      <button
        type="button"
        onClick={onSaveEdit}
        aria-label="Save edit"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)]"
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        onClick={onCancelEdit}
        aria-label="Cancel edit"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-subtle)]"
      >
        <X size={14} />
      </button>
    </div>
  )

  const reactionRow = reactions.length > 0 ? (
    <div className={`flex flex-wrap items-center gap-1 ${mine ? 'justify-end' : ''}`}>
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          onClick={() => onToggleReaction(reaction.emoji)}
          className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors ${
            reaction.reactedByCurrentPrincipal
              ? 'border-[var(--foreground)] bg-[var(--surface-subtle)]'
              : 'border-[var(--border)] hover:bg-[var(--surface-subtle)]'
          }`}
        >
          <span>{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </button>
      ))}
    </div>
  ) : null

  const threadEntry = !mine && replyCount > 0 ? (
    <button
      type="button"
      onClick={onOpenThread}
      data-testid="thread-teaser"
      className="group/thread mt-0.5 flex max-w-xl items-start gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-[var(--surface-subtle)]"
    >
      <MessageSquareReply size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--muted)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-[var(--foreground)]">
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </span>
        {threadTeaser?.text ? (
          <span className="mt-0.5 block truncate text-[12px] text-[var(--muted)]">
            <span className="font-medium text-[var(--foreground)]">{threadTeaser.authorName}</span>
            {': '}
            {threadTeaser.text}
          </span>
        ) : null}
      </span>
    </button>
  ) : replyCount > 0 ? (
    <button
      type="button"
      onClick={onOpenThread}
      data-testid="thread-teaser"
      className={`inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)] ${mine ? 'self-end' : ''}`}
    >
      <MessageSquareReply size={12} strokeWidth={1.75} />
      {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
    </button>
  ) : null

  const editHistory = message.editedAt ? (
    <div className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        onClick={() => setEditHistoryOpen((open) => !open)}
        aria-expanded={editHistoryOpen}
        className="text-[11px] text-[var(--muted-light)] transition-colors hover:text-[var(--foreground)] hover:underline"
      >
        edited
      </button>
      {editHistoryOpen ? (
        <div
          className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2.5 text-left shadow-sm"
          data-testid="message-edit-history"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Previous versions</p>
          {message.editHistory?.length ? (
            <ol className="space-y-2">
              {[...message.editHistory].reverse().map((version, index) => (
                <li key={`${version.editedAt}-${index}`} className="border-t border-[var(--border)] pt-2 first:border-t-0 first:pt-0">
                  <MarkdownMessage text={version.content} isStreaming={false} mentions={message.mentions} />
                  <time className="mt-1 block text-[10px] text-[var(--muted-light)]">
                    {new Date(version.editedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-[var(--muted)]">No previous version is available for this older edit.</p>
          )}
        </div>
      ) : null}
    </div>
  ) : null
  const toolbar = (
    <RoomMessageToolbar
      alignEnd={mine}
      floating
      copyText={message.text}
      canEdit={mine}
      canReport={!mine}
      pinned={pinned}
      saved={saved}
      disabled={Boolean(message.delivery)}
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

  // ── Sent (yours): right gray bubble, with no redundant identity chrome. ──
  if (mine && !isAgent) {
    return (
      <div
        {...rootProps}
        className={`group/exchange relative -mx-1 flex scroll-mt-6 justify-end gap-2.5 rounded-lg px-1 py-1 message-appear transition-colors hover:bg-[var(--surface-subtle)] ${highlightClass}`}
      >
        <div className="relative flex min-w-0 max-w-[min(92%,36rem)] flex-col items-end gap-1 sm:max-w-[75%]">
          {toolbar}
          {attachments}
          {editing ? editor : message.text ? (
            <UserMessageBubble className="ml-auto max-w-full" contentClassName="whitespace-normal">
              <MarkdownMessage text={message.text} isStreaming={false} mentions={message.mentions} />
            </UserMessageBubble>
          ) : null}
          {message.delivery === 'failed' ? (
            <button type="button" className="text-[11px] font-medium text-red-500 hover:underline" onClick={onRetrySend}>
              Failed to send · Retry
            </button>
          ) : null}
          {editHistory}
          {reactionRow}
          {threadEntry}
        </div>
      </div>
    )
  }

  // ── Received human / agent: Slack flat row with avatar on every message ──
  return (
    <div
      {...rootProps}
      className={`group/exchange relative -mx-1 flex scroll-mt-6 gap-2.5 rounded-lg px-1 py-1 message-appear transition-colors hover:bg-[var(--surface-subtle)] ${highlightClass}`}
    >
      {avatarNode}
      <div className="relative min-w-0 flex-1">
        {toolbar}
        <div className="mb-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-[13px] font-bold text-[var(--foreground)]">
            {message.authorName}
          </span>
          {!grouped ? <time className="shrink-0 text-[11px] text-[var(--muted-light)]">{timeLabel}</time> : null}
          {pinned ? <Pin size={11} className="shrink-0 text-[var(--muted-light)]" /> : null}
        </div>
        {attachments}
        {editing ? editor : isAgent ? (
          <>
            <AssistantVisualBlocks
              blocks={message.blocks}
              blockKeyPrefix={message.id}
              markdownKeyPrefix={message.id}
              isStreaming={Boolean(message.streaming)}
              isTextStreaming={Boolean(message.streaming)}
              onOpenDraft={NOOP_DRAFT}
              onCreateAutomationDraft={NOOP_DRAFT}
              onOpenAttachmentPreview={onOpenAttachmentPreview}
            />
            {message.streaming && message.blocks.length === 0 ? (
              <div className="flex items-center gap-1 py-1" aria-label={`${message.authorName} is responding`}>
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted-light)]"
                    style={{ animationDelay: `${dot * 120}ms` }}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          humanBody
        )}
        {editHistory}
        {reactionRow}
        {threadEntry}
      </div>
    </div>
  )
}

const QUICK_REACTIONS = [
  '👍', '🎉', '❤️', '😄', '🙌', '👀', '🔥', '✅',
  '🙏', '😮', '😢', '🤔', '🚀', '💡', '👏', '⚠️',
  '💯', '🤝', '📌', '☕', '🐛', '✨', '❓', '❌',
]

function RoomMessageToolbar({
  alignEnd,
  floating,
  copyText,
  canEdit,
  canReport,
  pinned,
  saved,
  disabled,
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
  alignEnd: boolean
  floating: boolean
  copyText: string
  canEdit: boolean
  canReport: boolean
  pinned: boolean
  saved: boolean
  disabled: boolean
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
    'rounded-md p-1.5 text-[var(--muted)] transition-all hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-90 active:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-30'

  const railClass = floating
    ? `absolute -top-3 right-0 z-20 flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5 shadow-md transition-opacity focus-within:opacity-100 group-hover/exchange:opacity-100 ${
        pickerOpen ? 'opacity-100' : 'opacity-0'
      }`
    : `chat-exchange-actions--hover flex items-center gap-1 px-1 pt-0.5 transition-opacity focus-within:opacity-100 group-hover/exchange:opacity-100 ${
        pickerOpen ? 'opacity-100' : 'opacity-0'
      } ${alignEnd ? 'justify-end' : ''}`

  return (
    <div className={railClass}>
      <EmojiPickerButton
        alignEnd={alignEnd || floating}
        disabled={disabled}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={onSelectReaction}
        buttonClass={buttonClass}
      />
      <button type="button" onClick={onOpenThread} disabled={disabled} className={buttonClass} aria-label="Reply in thread">
        <MessageSquareReply size={14} strokeWidth={1.75} />
      </button>
      <button type="button" onClick={onQuoteReply} disabled={disabled} className={buttonClass} aria-label="Quote in reply">
        <MessageSquareReply size={14} strokeWidth={1.75} className="rotate-180" />
      </button>
      <FlashCopyIconButton copyText={copyText} disabled={disabled || copyText.length === 0} ariaLabel="Copy message" />
      <button
        type="button"
        onClick={onCopyPermalink}
        disabled={disabled}
        aria-label="Copy message link"
        title="Copy message link"
        className={buttonClass}
      >
        <Link2 size={14} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onTogglePinned}
        disabled={disabled}
        className={`${buttonClass} ${pinned ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
        aria-label={pinned ? 'Unpin message' : 'Pin message'}
        aria-pressed={pinned}
      >
        <Pin size={14} strokeWidth={1.75} className={pinned ? 'fill-current' : undefined} />
      </button>
      <button
        type="button"
        onClick={onToggleSaved}
        disabled={disabled}
        className={`${buttonClass} ${saved ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
        aria-label={saved ? 'Remove from saved' : 'Save message'}
        aria-pressed={saved}
      >
        <Bookmark size={14} strokeWidth={1.75} className={saved ? 'fill-current' : undefined} />
      </button>
      {canReport ? (
        <button type="button" onClick={onReport} disabled={disabled} className={buttonClass} aria-label="Report message">
          <Flag size={14} strokeWidth={1.75} />
        </button>
      ) : null}
      {canEdit ? (
        <>
          <button type="button" onClick={onStartEdit} disabled={disabled} className={buttonClass} aria-label="Edit message">
            <Pencil size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            className={`${buttonClass} hover:text-red-500`}
            aria-label="Delete message"
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        </>
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

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onOpenChange, open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={`${buttonClass} ${open ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
        aria-label="Add reaction"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <SmilePlus size={14} strokeWidth={1.75} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Pick a reaction"
          className={`overlay-pop-in absolute bottom-full z-30 mb-1.5 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-2 shadow-lg ${
            alignEnd ? 'right-0' : 'left-0'
          }`}
        >
          <div className="grid grid-cols-8 gap-0.5">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onSelect(emoji)
                  setOpen(false)
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-base transition-colors hover:bg-[var(--surface-muted)]"
                aria-label={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

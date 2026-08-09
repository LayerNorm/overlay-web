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
import { FlashCopyIconButton, UserMessageBubble } from '@overlay/chat-react'
import { AssistantVisualBlocks } from '@overlay/chat-react/transcript'
import type { AttachmentPreview } from '@overlay/chat-react'
import { Textarea } from '@overlay/ui/primitives'
import { SafeHumanMarkdown } from './SafeHumanMarkdown'

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

/**
 * One message in a shared room. People render as attributed chat bubbles (yours
 * on the right, everyone else's on the left) and agents render through the
 * shared assistant block renderer, so markdown, tool calls, and attachments look
 * the same as they do in personal chat. Collaboration-only operations (thread,
 * react, pin, save, report) sit in the same hover row as the transcript's
 * actions.
 */
export function RoomMessageItem({
  message,
  reactions,
  replyCount,
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

  if (message.deletedAt) {
    return (
      <div {...rootProps} className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
        <p className="px-1 text-sm italic text-[var(--muted-light)]">Message deleted</p>
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

  const footer = (
    <RoomMessageToolbar
      alignEnd={mine}
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

  /**
   * Every room message names its author. Anonymous bubbles read as first person
   * even when a teammate wrote them, which is exactly the confusion a shared
   * room cannot afford.
   */
  const meta = grouped ? (
    <time className={`px-1 text-[10px] text-[var(--muted-light)] opacity-0 transition-opacity group-hover/exchange:opacity-100 ${mine ? 'text-right' : 'text-left'}`}>
      {timeLabel}
    </time>
  ) : (
    <div className={`flex items-center gap-2 px-1 ${mine ? 'justify-end' : ''}`}>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
        {isAgent ? (
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: message.authorColor ?? '#64748b' }}
          >
            <Bot size={11} strokeWidth={1.75} />
          </span>
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[10px] text-[var(--muted)]">
            {message.authorName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="truncate">{mine ? 'You' : message.authorName}</span>
      </span>
      <time className="shrink-0 text-[10px] text-[var(--muted-light)]">{timeLabel}</time>
      {message.editedAt ? <span className="text-[10px] text-[var(--muted-light)]">edited</span> : null}
      {message.delivery === 'sending' ? <span className="text-[10px] text-[var(--muted-light)]">sending</span> : null}
      {pinned ? <Pin size={11} className="shrink-0 text-[var(--muted-light)]" /> : null}
    </div>
  )

  const reactionRow = (reactions.length > 0 || replyCount > 0) ? (
    <div className={`flex flex-wrap items-center gap-1.5 px-1 ${mine ? 'justify-end' : ''}`}>
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
      {replyCount > 0 ? (
        <button
          type="button"
          onClick={onOpenThread}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          <MessageSquareReply size={12} strokeWidth={1.75} />
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </button>
      ) : null}
    </div>
  ) : null

  if (!isAgent) {
    return (
      <div
        {...rootProps}
        className={`group/exchange relative flex scroll-mt-6 flex-col gap-2 message-appear ${highlightClass}`}
      >
        {meta}
        <div className={`flex min-w-0 ${mine ? 'justify-end' : 'justify-start'}`}>
          <div className={`flex min-w-0 max-w-[min(92%,36rem)] flex-col gap-2 sm:max-w-[75%] ${mine ? 'items-end' : 'items-start'}`}>
            {attachments}
            {editing ? editor : message.text ? (
              <UserMessageBubble
                tone={mine ? 'room-self' : 'default'}
                className={`max-w-full ${mine ? 'ml-auto' : 'mr-auto rounded-bl-sm rounded-br-2xl'}`}
              >
                <SafeHumanMarkdown text={message.text} isStreaming={false} mentions={message.mentions} />
              </UserMessageBubble>
            ) : null}
          </div>
        </div>
        {message.delivery === 'failed' ? (
          <button
            type="button"
            className={`px-1 text-[11px] font-medium text-red-500 hover:underline ${mine ? 'text-right' : 'text-left'}`}
            onClick={onRetrySend}
          >
            Failed to send · Retry
          </button>
        ) : null}
        {reactionRow}
        {footer}
      </div>
    )
  }

  return (
    <div
      {...rootProps}
      className={`group/exchange relative flex scroll-mt-6 flex-col gap-2 message-appear ${highlightClass}`}
    >
      {meta}
      {attachments}
      {editing ? editor : (
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
      )}
      {message.streaming && message.blocks.length === 0 ? (
        <div className="flex items-center gap-1 px-1" aria-label={`${message.authorName} is responding`}>
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted-light)]"
              style={{ animationDelay: `${dot * 120}ms` }}
            />
          ))}
        </div>
      ) : null}
      {reactionRow}
      {message.streaming ? null : footer}
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

  return (
    <div
      className={`chat-exchange-actions--hover flex items-center gap-1 px-1 pt-0.5 transition-opacity focus-within:opacity-100 group-hover/exchange:opacity-100 ${
        // The row stays put while the picker is open, or choosing an emoji
        // would mean chasing a control that fades out from under the cursor.
        pickerOpen ? 'opacity-100' : 'opacity-0'
      } ${alignEnd ? 'justify-end' : ''}`}
    >
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
      <EmojiPickerButton
        alignEnd={alignEnd}
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

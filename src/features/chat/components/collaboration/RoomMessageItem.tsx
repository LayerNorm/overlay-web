'use client'

/* eslint-disable @next/next/no-img-element -- room attachments mirror the chat transcript renderer */

import {
  Bookmark,
  Bot,
  Check,
  FileText,
  Flag,
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
import { Input } from '@overlay/ui/primitives'

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
  editedAt?: number
  deletedAt?: number
  delivery?: 'sending' | 'failed'
  /** Plain text used for copy, edit, and quote-reply. */
  text: string
  /** Ordered tool/text/file blocks for messages rendered as agent output. */
  blocks: AssistantVisualBlock[]
  images: RoomMessageAttachment[]
  documentNames: string[]
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
}

/** Rooms do not surface draft review; agent drafts are handled in personal chat. */
const NOOP_DRAFT = () => {}

/**
 * One message in a shared room. Own messages use the same right-aligned bubble
 * as personal chat; everyone else's (people and agents) render through the
 * shared assistant block renderer so markdown, tool calls, and attachments look
 * identical across surfaces. Collaboration-only operations (thread, react, pin,
 * save, report) sit in the same hover row as the chat transcript's actions.
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
}: RoomMessageItemProps) {
  const { mine } = message
  const timeLabel = new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  if (message.deletedAt) {
    return (
      <div className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`} data-room-message={message.id}>
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
      <Input
        autoFocus
        value={editingContent}
        onChange={(event) => onEditingContentChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSaveEdit()
          if (event.key === 'Escape') onCancelEdit()
        }}
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
      onQuickReaction={() => onToggleReaction('👍')}
      onOpenThread={onOpenThread}
      onQuoteReply={onQuoteReply}
      onTogglePinned={onTogglePinned}
      onToggleSaved={onToggleSaved}
    />
  )

  const meta = (
    <div className={`flex items-baseline gap-2 px-1 ${mine ? 'justify-end' : ''}`}>
      {!mine ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
          {message.authorKind === 'agent' || message.authorKind === 'model' ? (
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: message.authorColor ?? '#64748b' }}
            >
              <Bot size={11} strokeWidth={1.75} />
            </span>
          ) : (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[10px] text-[var(--muted)]">
              {message.authorName.slice(0, 1).toUpperCase()}
            </span>
          )}
          {message.authorName}
        </span>
      ) : null}
      <time className="text-[10px] text-[var(--muted-light)]">{timeLabel}</time>
      {message.editedAt ? <span className="text-[10px] text-[var(--muted-light)]">edited</span> : null}
      {message.delivery === 'sending' ? <span className="text-[10px] text-[var(--muted-light)]">sending</span> : null}
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
          className="text-[11px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </button>
      ) : null}
    </div>
  ) : null

  if (mine) {
    return (
      <div
        className="group/exchange relative flex flex-col gap-2 message-appear"
        data-room-message={message.id}
      >
        {meta}
        <div className="flex min-w-0 justify-end">
          <div className="flex min-w-0 max-w-[min(92%,36rem)] flex-col items-end gap-2 sm:max-w-[75%]">
            {attachments}
            {editing ? editor : message.text ? (
              <UserMessageBubble className="ml-auto max-w-full">{message.text}</UserMessageBubble>
            ) : null}
          </div>
        </div>
        {message.delivery === 'failed' ? (
          <button
            type="button"
            className="px-1 text-right text-[11px] font-medium text-red-500 hover:underline"
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
      className="group/exchange relative flex flex-col gap-2 message-appear"
      data-room-message={message.id}
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
      {reactionRow}
      {footer}
    </div>
  )
}

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
  onQuickReaction,
  onOpenThread,
  onQuoteReply,
  onTogglePinned,
  onToggleSaved,
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
  onQuickReaction: () => void
  onOpenThread: () => void
  onQuoteReply: () => void
  onTogglePinned: () => void
  onToggleSaved: () => void
}) {
  const buttonClass =
    'rounded-md p-1.5 text-[var(--muted)] transition-all hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-90 active:bg-[var(--border)] disabled:cursor-not-allowed disabled:opacity-30'

  return (
    <div
      className={`chat-exchange-actions--hover flex items-center gap-1 px-1 pt-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/exchange:opacity-100 ${
        alignEnd ? 'justify-end' : ''
      }`}
    >
      <FlashCopyIconButton copyText={copyText} disabled={disabled || copyText.length === 0} ariaLabel="Copy message" />
      <button type="button" onClick={onQuickReaction} disabled={disabled} className={buttonClass} aria-label="Add reaction">
        <SmilePlus size={14} strokeWidth={1.75} />
      </button>
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
        className={`${buttonClass} ${pinned ? 'text-[var(--foreground)]' : ''}`}
        aria-label={pinned ? 'Unpin message' : 'Pin message'}
        aria-pressed={pinned}
      >
        <Pin size={14} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onToggleSaved}
        disabled={disabled}
        className={`${buttonClass} ${saved ? 'text-[var(--foreground)]' : ''}`}
        aria-label={saved ? 'Remove from saved' : 'Save message'}
        aria-pressed={saved}
      >
        <Bookmark size={14} strokeWidth={1.75} />
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

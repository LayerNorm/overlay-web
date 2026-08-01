'use client'

import type { ReactNode } from 'react'
import { Pin, Send, UserPlus } from 'lucide-react'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'
import type { ConversationParticipant, ConversationPresence } from '@overlay/workspace-contracts'

/**
 * Rooms open People, Thread, and Pinned through the shell's right panel slot —
 * the same docked surface, slide-in motion, and header treatment the sources
 * panel uses. Nothing here positions itself; the shell owns placement.
 */
export type RoomPanelKind = 'people' | 'thread' | 'pinned'

export function RoomPeoplePanel({
  participants,
  presence,
  currentPrincipalId,
  onAddPeople,
  onClose,
}: {
  participants: ConversationParticipant[]
  presence: ConversationPresence[]
  currentPrincipalId: string
  onAddPeople?: () => void
  onClose: () => void
}) {
  return (
    <AppScreenSidePanel title="People" description={`${participants.length} in this room`} onClose={onClose}>
      <div className="space-y-1 p-3">
        {participants.map((participant) => (
          <div key={participant.principalId} className="flex items-center gap-3 rounded-lg px-3 py-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)] text-xs">
              {participant.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {participant.principalId === currentPrincipalId ? 'You' : participant.displayName}
              </span>
              <span className="block text-[11px] capitalize text-[var(--muted-light)]">
                {participant.principalType === 'agent' ? 'Agent' : participant.role}
              </span>
            </span>
            <span className={`h-2 w-2 rounded-full ${
              presence.find((row) => row.principalId === participant.principalId)?.status === 'online'
                ? 'bg-emerald-500'
                : 'bg-[var(--border)]'
            }`} />
          </div>
        ))}
        {onAddPeople ? (
          <button
            type="button"
            onClick={onAddPeople}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-[var(--border)]">
              <UserPlus size={14} />
            </span>
            Add people
          </button>
        ) : null}
      </div>
    </AppScreenSidePanel>
  )
}

export function RoomThreadPanel({
  roomLabel,
  replyCount,
  messages,
  input,
  onInputChange,
  onSubmit,
  onClose,
}: {
  roomLabel: string
  replyCount: number
  messages: ReactNode
  input: string
  onInputChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}) {
  return (
    <AppScreenSidePanel
      title="Thread"
      description={`${roomLabel} · ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
      onClose={onClose}
      bodyClassName="flex flex-col"
    >
      <div className="overlay-chat-surface min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">{messages}</div>
      </div>
      <form
        className="m-3 flex shrink-0 items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-2 focus-within:border-[var(--muted-light)]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          rows={1}
          placeholder="Reply…"
          aria-label="Reply in thread"
          className="min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[var(--muted-light)]"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label="Send thread reply"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] disabled:opacity-30"
        >
          <Send size={14} />
        </button>
      </form>
    </AppScreenSidePanel>
  )
}

export type PinnedMessageSummary = {
  messageId: string
  authorName: string
  preview: string
  createdAt: number
}

export function RoomPinnedPanel({
  pinned,
  onJump,
  onUnpin,
  onClose,
}: {
  pinned: PinnedMessageSummary[]
  onJump: (messageId: string) => void
  onUnpin: (messageId: string) => void
  onClose: () => void
}) {
  return (
    <AppScreenSidePanel
      title="Pinned"
      description={pinned.length ? `${pinned.length} pinned in this room` : undefined}
      onClose={onClose}
    >
      {pinned.length === 0 ? (
        <p className="px-4 py-6 text-xs text-[var(--muted)]">
          Nothing pinned yet. Pin a message to keep it at hand for everyone in the room.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 p-2">
          {pinned.map((item) => (
            <li key={item.messageId} className="group/pin flex items-start gap-1">
              <button
                type="button"
                onClick={() => onJump(item.messageId)}
                className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--surface-subtle)]"
              >
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-xs font-medium text-[var(--foreground)]">{item.authorName}</span>
                  <time className="shrink-0 text-[10px] text-[var(--muted-light)]">
                    {new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </time>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--muted)]">{item.preview}</span>
              </button>
              <button
                type="button"
                onClick={() => onUnpin(item.messageId)}
                aria-label={`Unpin ${item.authorName}'s message`}
                className="mt-2 shrink-0 rounded-md p-1.5 text-[var(--muted-light)] opacity-0 transition-opacity hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] focus-visible:opacity-100 group-hover/pin:opacity-100"
              >
                <Pin size={13} strokeWidth={1.75} className="fill-current" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </AppScreenSidePanel>
  )
}

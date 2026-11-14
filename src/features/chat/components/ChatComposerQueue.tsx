'use client'

import { CornerDownLeft, ListEnd, Pencil, X } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { QueuedMessage } from '@/shared/chat/conversation-queue'
import { DelayedTooltip } from './DelayedTooltip'

export type ChatComposerQueueControls = {
  /** A response is running, so Enter queues and Cmd/Ctrl+Enter steers. */
  running: boolean
  items: QueuedMessage[]
  paused: boolean
  onQueueDraft: () => void
  onSteerDraft: () => void
  onSteerItem: (id: string) => void
  onEditItem: (id: string) => void
  onRemoveItem: (id: string) => void
}

export function steerShortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'
}

function trayStatus(queue: ChatComposerQueueControls): string {
  if (queue.running) return 'Sends when the response finishes'
  if (queue.paused) return 'Paused because the response was stopped'
  return 'Sending'
}

export function ComposerQueueTray({ queue, canEdit }: { queue: ChatComposerQueueControls; canEdit: boolean }) {
  if (queue.items.length === 0) return null
  return (
    <div
      data-composer-queue
      aria-label="Queued messages"
      className="mx-3 rounded-t-xl border border-b-0 border-(--border) bg-(--surface-subtle) px-1.5 pt-1.5 pb-1"
    >
      <div className="flex items-center gap-1.5 px-1.5 pb-1 text-[11px] text-(--muted)">
        <ListEnd size={13} strokeWidth={1.75} />
        <span>{queue.items.length} queued</span>
        <span className="ml-auto truncate text-(--muted-light) max-sm:hidden">{trayStatus(queue)}</span>
      </div>
      <ol className="m-0 list-none p-0">
        {queue.items.map((item, index) => (
          <li
            key={item.id}
            className="group/queued flex min-h-8 items-center gap-1.5 rounded-lg py-0.5 pr-0.5 pl-1.5 hover:bg-(--surface-elevated)"
          >
            <span className="w-4 shrink-0 text-[11px] text-(--muted-light)">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-(--foreground)">{item.text}</span>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/queued:opacity-100 group-focus-within/queued:opacity-100 [@media(hover:none)]:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className="h-7 gap-1 px-2 text-xs font-normal text-(--muted)"
                onClick={() => queue.onSteerItem(item.id)}
              >
                <CornerDownLeft size={13} strokeWidth={1.75} />
                {queue.running ? 'Steer now' : 'Send now'}
              </Button>
              <DelayedTooltip label={canEdit ? 'Edit' : 'Clear the composer to edit'} side="top">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label="Edit queued message"
                  disabled={!canEdit}
                  className="size-7 text-(--muted)"
                  onClick={() => queue.onEditItem(item.id)}
                >
                  <Pencil size={13} strokeWidth={1.75} />
                </Button>
              </DelayedTooltip>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label="Remove queued message"
                className="size-7 text-(--muted)"
                onClick={() => queue.onRemoveItem(item.id)}
              >
                <X size={13} strokeWidth={1.75} />
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@overlay/ui/primitives'
import type { RemoteAgentCommand } from '@/features/chat/components/collaboration/room-message-view'

/**
 * Slash-command picker for connected agents. Renders the commands the agent
 * advertised over ACP while the composer input is a bare `/token`; selecting
 * one fills the input with `/name ` (ACP unstructured semantics: the agent
 * parses the command and its trailing input from the prompt text).
 */
export function AgentSlashMenu({
  commands,
  highlightedIndex,
  onSelect,
}: {
  commands: RemoteAgentCommand[]
  highlightedIndex: number
  onSelect(command: RemoteAgentCommand): void
}) {
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const item = listRef.current?.children[highlightedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  return (
    <div
      role="listbox"
      aria-label="Agent commands"
      ref={listRef}
      className="absolute inset-x-3 bottom-full z-20 mb-1.5 max-h-56 overflow-y-auto rounded-xl border border-(--border) bg-(--surface-elevated) p-1 shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
    >
      {commands.map((command, index) => (
        <Button
          variant="ghost"
          key={command.name}
          type="button"
          role="option"
          aria-selected={index === highlightedIndex}
          onMouseDown={(event) => {
            event.preventDefault()
            onSelect(command)
          }}
          onMouseEnter={() => undefined}
          className={`h-auto w-full items-start justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left font-normal text-(--foreground) transition-colors hover:bg-transparent ${index === highlightedIndex ? 'bg-(--surface-subtle)' : ''}`}
        >
          <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-(--border) text-[11px] font-semibold leading-none text-(--muted)">/</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-(--foreground)">/{command.name}</span>
            {command.description ? (
              <span className="mt-0.5 block truncate text-[11px] leading-4 text-(--muted)">{command.description}</span>
            ) : null}
          </span>
          {command.inputHint ? (
            <span className="mt-0.5 shrink-0 truncate rounded-sm border border-(--border) px-1.5 py-0.5 text-[10px] leading-4 text-(--muted)">{command.inputHint}</span>
          ) : null}
        </Button>
      ))}
    </div>
  )
}

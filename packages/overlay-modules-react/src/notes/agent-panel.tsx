'use client'

import type { ReactNode } from 'react'
import type { NotebookAgentUiItem } from '@overlay/app-core'
import { Send } from 'lucide-react'
import { AppScreenSidePanel } from '../shell'

export interface NotebookAgentPanelProps {
  items: readonly NotebookAgentUiItem[]
  running?: boolean
  header?: ReactNode
  logo?: ReactNode
  composer: ReactNode
  renderMarkdownMessage: (text: string, isStreaming: boolean) => ReactNode
}

export function NotebookAgentPanel({
  items,
  running,
  header,
  logo,
  composer,
  renderMarkdownMessage,
}: NotebookAgentPanelProps) {
  return (
    <AppScreenSidePanel
      className="overlay-chat-surface bg-[var(--sidebar-surface)]"
      bodyClassName="flex min-h-0 flex-col overflow-hidden"
      aria-label="Note assistant"
    >
      {header}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
        {items.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--muted)]">Ask about this note or describe edits...</p>
          </div>
        )}
        {items.map((item, idx) => {
          if (item.type === 'user') {
            return (
              <div key={idx} className="flex justify-end">
                <div className="chat-user-bubble min-w-0 max-w-[min(92%,36rem)] break-words select-text rounded-2xl rounded-br-sm border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5 text-sm leading-relaxed text-[var(--foreground)] sm:max-w-[75%]">
                  <span className="whitespace-pre-wrap">{item.text}</span>
                </div>
              </div>
            )
          }
          if (item.type === 'thinking') {
            return (
              <div key={idx} className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <span
                  className="overlay-stream-marker overlay-stream-marker--standalone h-4 w-4"
                  aria-label={item.text}
                  role="img"
                />
              </div>
            )
          }
          if (item.type === 'tool_call') {
            const toolLabel = item.tool === 'search_knowledge' ? 'Searching knowledge' :
              item.tool === 'read_note' ? 'Reading note' :
              item.tool === 'propose_edit' ? 'Proposing edit' :
              item.tool === 'finish' ? 'Done' : item.tool
            const isRunning = running && idx === items.length - 1
            return (
              <div key={idx} className="flex w-full max-w-[min(100%,36rem)] items-stretch gap-2.5 py-1 text-[13px] leading-snug">
                <div className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  <div className="relative z-[1] shrink-0 rounded-full bg-[var(--background)] p-px">
                    {logo}
                  </div>
                </div>
                <span className={isRunning ? 'tool-line-shimmer' : 'text-[var(--tool-line-label)]'}>
                  {toolLabel}
                </span>
              </div>
            )
          }
          if (item.type === 'text') {
            return (
              <div key={idx} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {renderMarkdownMessage(item.text ?? '', Boolean(running && idx === items.length - 1))}
                </div>
              </div>
            )
          }
          return (
            <div key={idx} className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
              {item.text}
            </div>
          )
        })}
      </div>
      <div className="shrink-0 bg-[var(--sidebar-surface)] p-3">{composer}</div>
    </AppScreenSidePanel>
  )
}

export interface NotebookAgentComposerProps {
  input: ReactNode
  running?: boolean
  canSend?: boolean
  onSend: () => void
  onStop: () => void
}

export function NotebookAgentComposer({
  input,
  running,
  canSend,
  onSend,
  onStop,
}: NotebookAgentComposerProps) {
  return (
    <div className="overflow-visible rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="p-2.5">
        {input}
        <div className="mt-2 flex min-h-9 items-center justify-end gap-2">
          {running ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-colors hover:opacity-80"
              aria-label="Stop"
            >
              <div className="h-3.5 w-3.5 rounded-sm bg-[var(--background)]" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--background)] transition-colors hover:opacity-80 disabled:opacity-40"
              aria-label="Send"
            >
              <Send size={17} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

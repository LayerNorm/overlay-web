'use client'
import { Button } from '@overlay/ui/primitives'
import type { ReactNode } from 'react'
import type { NotebookAgentUiItem } from '@overlay/app-core'
import { TraceLine, TraceTitle } from '@overlay/ui/ai'
import { Send } from 'lucide-react'
import { AppScreenSidePanel } from '../shell'

const NOTE_EDIT_TOOLS = new Set(['edit_note', 'replace_note_section', 'append_to_note', 'update_note'])

export interface NotebookAgentPanelProps {
  items: readonly NotebookAgentUiItem[]
  /**
   * The note conversation rendered by the host. It replaces the items list; the panel
   * still shows errors from the latest send, which never reached the conversation.
   */
  transcript?: ReactNode
  running?: boolean
  header?: ReactNode
  /** Shown below the latest response, e.g. Accept all / Reject all for the turn's edits. */
  footer?: ReactNode
  composer: ReactNode
  renderMarkdownMessage: (text: string, isStreaming: boolean) => ReactNode
}

export function NotebookAgentEmptyState() {
  return (
    <div className="text-center py-8">
      <p className='text-sm text-(--muted)'>
        Ask about this note or describe edits...
      </p>
    </div>
  )
}

function NotebookAgentError({ text }: { text: string }) {
  return (
    <div className='rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300'>
      {text}
    </div>
  )
}

/** Errors after the latest user message: the current send's failures. */
function latestSendErrors(items: readonly NotebookAgentUiItem[]) {
  const lastUser = items.map((item) => item.type).lastIndexOf('user')
  return items.slice(lastUser + 1).flatMap((item) => item.type === 'error' ? [item.text] : [])
}

export function NotebookAgentPanel({
  items,
  transcript,
  running,
  header,
  footer,
  composer,
  renderMarkdownMessage,
}: NotebookAgentPanelProps) {
  return (
    <AppScreenSidePanel
      className="overlay-chat-surface bg-(--sidebar-surface)"
      bodyClassName="flex min-h-0 flex-col overflow-hidden"
      header={header}
      aria-label="Note assistant"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
        {transcript !== undefined ? (
          <>
            {transcript}
            {latestSendErrors(items).map((text, idx) => (
              // Append-only stream items have no id; index is the stable identity.
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key
              <NotebookAgentError key={idx} text={text} />
            ))}
          </>
        ) : items.length === 0 ? <NotebookAgentEmptyState /> : items.map((item, idx) => {
          if (item.type === 'user') {
            // Append-only stream items have no id; index is the stable identity.
            return (
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key
              <div key={idx} className="flex justify-end">
                <div className="chat-user-bubble min-w-0 max-w-[min(92%,36rem)] wrap-break-word select-text rounded-2xl rounded-br-sm bg-(--surface-subtle) px-3 py-2.5 text-sm leading-relaxed text-(--foreground) sm:max-w-[75%]">
                  <span className="whitespace-pre-wrap">{item.text}</span>
                </div>
              </div>
            )
          }
          if (item.type === 'tool_call') {
            const toolLabel = item.tool === 'search_knowledge' ? 'Searching knowledge' :
              item.tool === 'get_note' || item.tool === 'read_note' ? 'Reading note' :
              NOTE_EDIT_TOOLS.has(item.tool) ? 'Editing note' : item.tool
            const isRunning = running && idx === items.length - 1
            return (
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key
              <div key={idx} className="w-full max-w-[min(100%,36rem)] px-1 py-0.5">
                <TraceLine status={isRunning ? 'running' : undefined} className="py-1">
                  <TraceTitle className="whitespace-normal">{toolLabel}</TraceTitle>
                </TraceLine>
              </div>
            )
          }
          if (item.type === 'text') {
            return (
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key
              <div key={idx} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {renderMarkdownMessage(item.text ?? '', Boolean(running && idx === items.length - 1))}
                </div>
              </div>
            )
          }
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key
          return <NotebookAgentError key={idx} text={item.text} />
        })}
        {footer}
      </div>
      <div className="shrink-0 bg-(--sidebar-surface) p-3">{composer}</div>
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
    <div className="overflow-visible rounded-2xl bg-(--surface-elevated)">
      <div className="p-2.5">
        {input}
        <div className="mt-2 flex min-h-9 items-center justify-end gap-2">
          {running ? (
            <Button variant="primary" size="icon" className="shrink-0"
              type="button"
              onClick={onStop}
              aria-label="Stop"
            >
              <div className="h-3.5 w-3.5 rounded-xs bg-(--background)" />
            </Button>
          ) : (
            <Button variant="primary" size="icon" className="shrink-0"
              type="button"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send"
            >
              <Send size={17} strokeWidth={1.75} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'
import type {
  ActiveRunState,
  ConversationMessage,
  ConversationMessagePart,
  MessageFilePart,
  MessageReasoningPart,
  MessageSourcePart,
  MessageTextPart,
  MessageToolPart,
} from '@overlay/extension-contracts'
import {
  BrowserSessionToolBlock,
  ReasoningBlock,
  SingleToolCallRow,
  ToolCallsCollapsedGroup,
  WebSearchToolBlock,
} from './tools'
import { MarkdownMessage } from './MarkdownMessage'

interface MessageListProps {
  messages: ConversationMessage[]
  activeRun?: ActiveRunState | null
  appBaseUrl?: string | null
}

type AssistantSegment =
  | { kind: 'text'; part: MessageTextPart; key: string }
  | { kind: 'reasoning'; part: MessageReasoningPart; key: string }
  | { kind: 'tools'; parts: MessageToolPart[]; key: string }
  | { kind: 'source'; part: MessageSourcePart; key: string }
  | { kind: 'file'; part: MessageFilePart; key: string }
  | { kind: 'other'; part: ConversationMessagePart; key: string }

function assistantSegments(parts: ConversationMessagePart[]): AssistantSegment[] {
  const segments: AssistantSegment[] = []

  for (const part of parts) {
    if (part.type === 'tool') {
      const last = segments[segments.length - 1]
      if (last?.kind === 'tools') {
        last.parts.push(part)
      } else {
        segments.push({ kind: 'tools', parts: [part], key: part.id })
      }
      continue
    }

    if (part.type === 'text') {
      segments.push({ kind: 'text', part, key: part.id })
      continue
    }

    if (part.type === 'reasoning') {
      segments.push({ kind: 'reasoning', part, key: part.id })
      continue
    }

    if (part.type === 'source') {
      segments.push({ kind: 'source', part, key: part.id })
      continue
    }

    if (part.type === 'file') {
      segments.push({ kind: 'file', part, key: part.id })
      continue
    }

    segments.push({ kind: 'other', part, key: part.id })
  }

  return segments
}

function formatMetadata(message: ConversationMessage): string | null {
  const metadata = message.metadata
  if (!metadata) return null
  if (typeof metadata.statusLabel === 'string' && metadata.statusLabel.trim()) return metadata.statusLabel.trim()
  if (typeof metadata.legacyMeta === 'string' && metadata.legacyMeta.trim()) return metadata.legacyMeta.trim()
  if (typeof metadata.routedModelId === 'string' && metadata.routedModelId.trim()) {
    return `Routed to ${metadata.routedModelId}`
  }
  return null
}

function isBrowserTool(p: MessageToolPart): boolean {
  return p.toolName === 'browser_run_task' || p.toolName === 'interactive_browser_session'
}

function isWebSearchTool(p: MessageToolPart): boolean {
  return p.toolName === 'perplexity_search'
}

function renderToolParts(parts: MessageToolPart[]): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  while (i < parts.length) {
    const p = parts[i]!
    if (isWebSearchTool(p)) {
      out.push(<WebSearchToolBlock key={p.id} part={p} connectTop={false} connectBottom={false} />)
      i += 1
      continue
    }
    if (isBrowserTool(p)) {
      out.push(<BrowserSessionToolBlock key={p.id} part={p} connectTop={false} connectBottom={false} />)
      i += 1
      continue
    }
    const group: MessageToolPart[] = []
    while (i < parts.length && !isWebSearchTool(parts[i]!) && !isBrowserTool(parts[i]!)) {
      group.push(parts[i]!)
      i += 1
    }
    if (group.length === 1) {
      out.push(
        <SingleToolCallRow key={group[0]!.id} part={group[0]!} connectTop={false} connectBottom={false} />,
      )
    } else {
      out.push(
        <ToolCallsCollapsedGroup
          key={group.map((g) => g.id).join('-')}
          tools={group}
          connectTop={false}
          connectBottom={false}
        />,
      )
    }
  }
  return out
}

function AssistantMessageBody({
  message,
  activeRun,
  appBaseUrl,
}: {
  message: ConversationMessage
  activeRun?: ActiveRunState | null
  appBaseUrl?: string | null
}) {
  const segments = assistantSegments(message.parts)
  const metadata = formatMetadata(message)
  const isStreamingMessage = activeRun?.assistantMessageId === message.id

  return (
    <div className="max-w-[min(100%,36rem)] space-y-1">
      {segments.map((segment) => {
        if (segment.kind === 'text') {
          if (!segment.part.text.trim()) return null
          return (
            <div key={segment.key} className="message-appear w-full px-1 py-1 text-sm leading-relaxed text-[var(--foreground)]">
              <MarkdownMessage
                text={segment.part.text}
                isStreaming={isStreamingMessage}
                appBaseUrl={appBaseUrl}
                suppressTypingIndicator
              />
            </div>
          )
        }

        if (segment.kind === 'reasoning') {
          if (segment.part.state !== 'streaming' && !segment.part.text.trim()) return null
          return (
            <ReasoningBlock
              key={segment.key}
              text={segment.part.text}
              streaming={segment.part.state === 'streaming'}
              connectTop={false}
              connectBottom={false}
            />
          )
        }

        if (segment.kind === 'tools') {
          return <div key={segment.key}>{renderToolParts(segment.parts)}</div>
        }

        if (segment.kind === 'source') {
          const href = segment.part.url
          return (
            <div key={segment.key} className="px-1 pt-0.5 text-xs text-[var(--muted)]">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {segment.part.title || href}
                </a>
              ) : (
                <span>{segment.part.title || segment.part.filename || 'Source'}</span>
              )}
            </div>
          )
        }

        if (segment.kind === 'file') {
          const url = segment.part.url
          const isVideo = segment.part.mediaType.startsWith('video/')
          return (
            <div key={segment.key} className="message-appear w-full max-w-[min(100%,36rem)] px-1 py-1">
              {isVideo ? (
                <video
                  src={url}
                  controls
                  className="max-h-[min(70vh,28rem)] w-full rounded-xl border border-[var(--border)] bg-black/5"
                />
              ) : (
                <img
                  src={url}
                  alt=""
                  className="max-h-[min(70vh,28rem)] w-full rounded-xl border border-[var(--border)] object-contain"
                />
              )}
            </div>
          )
        }

        return null
      })}
      {metadata ? <p className="px-1 pt-1 text-[11px] text-[var(--muted-light)]">{metadata}</p> : null}
    </div>
  )
}

export function MessageList({ messages, activeRun, appBaseUrl }: MessageListProps) {
  const streaming =
    activeRun?.status === 'streaming' || activeRun?.status === 'executing_tool' ? activeRun : null

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
      {messages.map((message) => {
        const user = message.role === 'user'
        const rowActiveRun =
          !user && streaming && streaming.assistantMessageId === message.id ? streaming : null

        return (
          <div key={message.id} className={`flex ${user ? 'justify-end' : 'justify-start'}`}>
            {user ? (
              <div className="message-appear chat-user-bubble ml-auto min-w-0 max-w-[min(92%,36rem)] break-words select-text rounded-2xl rounded-br-sm border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5 text-sm leading-relaxed text-[var(--foreground)] sm:max-w-[75%] sm:px-4">
                <span className="whitespace-pre-wrap">
                  {message.parts
                    .filter((part): part is MessageTextPart => part.type === 'text')
                    .map((part) => part.text)
                    .join('')}
                </span>
              </div>
            ) : (
              <AssistantMessageBody message={message} activeRun={rowActiveRun} appBaseUrl={appBaseUrl} />
            )}
          </div>
        )
      })}
    </div>
  )
}

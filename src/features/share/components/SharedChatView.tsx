'use client'

/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { isGeneratedUiPart } from '@overlay/chat-core/generated-ui'
import { MarkdownMessage } from '@overlay/chat-react'
import type { SharedConversation } from '@/shared/chat/shared-conversation'

type Message = SharedConversation['messages'][number]

const GeneratedUiCard = dynamic(
  () => import('@overlay/chat-react/generated-ui-card').then((mod) => ({ default: mod.GeneratedUiCard })),
)

type AnyPart = {
  type: string
  text?: string
  url?: string
  mediaType?: string
  fileName?: string
  id?: string
  dataType?: string
  data?: unknown
  transient?: boolean
  toolInvocation?: { toolName: string; state?: string }
}

function asParts(message: Message): AnyPart[] {
  return (message.parts ?? []) as unknown as AnyPart[]
}

function isTextPart(p: AnyPart): boolean {
  return p.type !== 'tool-invocation' && typeof p.text === 'string'
}

function isImagePart(p: AnyPart): boolean {
  if (p.type === 'tool-invocation') return false
  if (!p.url) return false
  return p.type === 'image' || (typeof p.mediaType === 'string' && p.mediaType.startsWith('image/'))
}

function isFilePart(p: AnyPart): boolean {
  if (p.type === 'tool-invocation') return false
  if (isImagePart(p)) return false
  return p.type === 'file' || Boolean(p.fileName)
}

function joinUserText(message: Message): string {
  if (message.content?.trim()) return message.content
  const chunks: string[] = []
  for (const part of asParts(message)) {
    if (isTextPart(part) && part.text) chunks.push(part.text)
  }
  return chunks.join('\n\n')
}

function UserMessage({ message }: { message: Message }) {
  const text = joinUserText(message)
  const parts = asParts(message)
  const imageParts = parts.filter(isImagePart)
  const fileParts = parts.filter(isFilePart)
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] flex-col items-end gap-2">
        {imageParts.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {imageParts.map((part, idx) => (
              <img
                key={idx}
                src={part.url}
                alt=""
                className="max-h-60 max-w-full rounded-lg border border-[var(--border)] object-cover"
              />
            ))}
          </div>
        )}
        {fileParts.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {fileParts.map((part, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs text-[var(--muted)]"
              >
                {part.fileName ?? 'Attachment'}
              </span>
            ))}
          </div>
        )}
        {text.trim().length > 0 && (
          <div className="rounded-2xl bg-[var(--surface-elevated)] px-4 py-2.5 text-sm leading-relaxed text-[var(--foreground)]">
            <div className="whitespace-pre-wrap">{text}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantMessage({ message }: { message: Message }) {
  const parts = asParts(message)
  const hasRenderableParts = parts.some((part) => (
    isTextPart(part) ||
    isImagePart(part) ||
    isGeneratedUiPart(part)
  ))
  const fallbackText = hasRenderableParts ? '' : message.content?.trim() ?? ''
  return (
    <div className="flex justify-start">
      <div className="flex w-full max-w-[100%] flex-col gap-3">
        {fallbackText ? <MarkdownMessage text={fallbackText} isStreaming={false} /> : null}
        {hasRenderableParts ? parts.map((part, idx) => {
          if (isTextPart(part) && part.text?.trim()) {
            return <MarkdownMessage key={idx} text={part.text} isStreaming={false} />
          }
          if (isGeneratedUiPart(part)) {
            return <GeneratedUiCard key={part.id} part={part} readOnly />
          }
          if (isImagePart(part)) {
            return (
              <img
                key={idx}
                src={part.url}
                alt=""
                className="max-h-96 max-w-full rounded-lg border border-[var(--border)] object-contain"
              />
            )
          }
          return null
        }) : null}
      </div>
    </div>
  )
}

export function SharedChatView({ conversation }: { conversation: SharedConversation }) {
  const sharedAt = new Date(conversation.sharedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">{conversation.title}</h1>
            <p className="text-[11px] text-[var(--muted)]">Shared {sharedAt} · Read-only</p>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
          >
            Open Overlay
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        {conversation.messages.length === 0 ? (
          <p className="text-center text-sm text-[var(--muted)]">This conversation is empty.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Group by turn so multi-variant Ask responses stack under the user prompt */}
            {(() => {
              const blocks: { user: Message | null; assistants: Message[] }[] = []
              for (const m of conversation.messages) {
                if (m.role === 'user') {
                  blocks.push({ user: m, assistants: [] })
                } else {
                  if (blocks.length === 0) blocks.push({ user: null, assistants: [] })
                  blocks[blocks.length - 1].assistants.push(m)
                }
              }
              return blocks.map((block, idx) => (
                <div key={idx} className="flex flex-col gap-4">
                  {block.user && <UserMessage message={block.user} />}
                  {block.assistants.map((m) => (
                    <AssistantMessage key={m._id} message={m} />
                  ))}
                </div>
              ))
            })()}
          </div>
        )}
      </main>

      <footer className="mx-auto max-w-3xl px-5 pb-10">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-xs text-[var(--muted)]">
          This is a read-only snapshot shared from{' '}
          <Link href="/" className="font-medium text-[var(--foreground)] hover:underline">
            Overlay
          </Link>
          .
        </div>
      </footer>
    </div>
  )
}

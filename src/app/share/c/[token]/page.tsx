import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SharedChatView } from '@/features/share/components/SharedChatView'
import { loadSharedConversation } from '@/server/conversations/load-shared-conversation'
import type { SharedConversation } from '@/shared/chat/shared-conversation'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

async function loadShared(token: string): Promise<SharedConversation | null> {
  return await loadSharedConversation(token)
}

function firstUserSnippet(conv: SharedConversation): string {
  const firstUser = conv.messages.find((m) => m.role === 'user')
  if (!firstUser) return ''
  const fromContent = firstUser.content?.trim()
  if (fromContent) return fromContent
  for (const part of firstUser.parts ?? []) {
    if (part.type === 'tool-invocation') continue
    const text = (part as { text?: string }).text
    if (typeof text === 'string' && text.trim()) return text.trim()
  }
  return ''
}

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params
  const conv = await loadShared(token)
  if (!conv) {
    return { title: 'Shared chat — Overlay', robots: { index: false } }
  }
  const description = firstUserSnippet(conv).slice(0, 200) || 'A conversation shared from Overlay.'
  return {
    title: `${conv.title} — Overlay`,
    description,
    openGraph: {
      title: conv.title,
      description,
      type: 'article',
      siteName: 'Overlay',
    },
    twitter: {
      card: 'summary_large_image',
      title: conv.title,
      description,
    },
  }
}

export default async function SharedChatPage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const conv = await loadShared(token)
  if (!conv) notFound()
  return <SharedChatView conversation={conv} />
}

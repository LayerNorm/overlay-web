import { ImageResponse } from 'next/og'
import { loadSharedConversation } from '@/server/conversations/load-shared-conversation'

export const alt = 'Shared chat — Overlay'
export const contentType = 'image/png'
export const size = { width: 1200, height: 630 }

type SharedConversation = {
  title: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    parts: Array<{ type: string; text?: string }> | null
  }>
}

function firstUserSnippet(conv: SharedConversation): string {
  const firstUser = conv.messages.find((m) => m.role === 'user')
  if (!firstUser) return ''
  if (firstUser.content?.trim()) return firstUser.content.trim()
  for (const part of firstUser.parts ?? []) {
    if (part.type === 'tool-invocation') continue
    if (typeof part.text === 'string' && part.text.trim()) return part.text.trim()
  }
  return ''
}

export default async function OpengraphImage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const conv = await loadSharedConversation(token) as SharedConversation | null
  const title = conv?.title || 'Shared chat'
  const snippet = conv ? firstUserSnippet(conv).slice(0, 220) : ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background:
            'linear-gradient(135deg, #0a0a0a 0%, #111418 50%, #0a0a0a 100%)',
          color: 'white',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'white',
              color: '#0a0a0a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            o
          </div>
          <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: -0.5 }}>
            overlay
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 600,
              lineHeight: 1.1,
              letterSpacing: -1.5,
              maxWidth: 1000,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </div>
          {snippet && (
            <div
              style={{
                fontSize: 28,
                color: '#a1a1aa',
                lineHeight: 1.4,
                maxWidth: 1000,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {snippet}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 22,
            color: '#71717a',
          }}
        >
          <span>Shared conversation</span>
          <span>getoverlay.io</span>
        </div>
      </div>
    ),
    { ...size },
  )
}

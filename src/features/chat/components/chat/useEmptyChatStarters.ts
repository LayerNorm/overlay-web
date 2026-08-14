'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_CHAT_SUGGESTIONS } from '@/shared/chat/chat-suggestions-defaults'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { sanitizeEmptyChatStarters } from '@overlay/chat-core'
import { coalesceRequest } from '@/shared/observability/request-coalescer'

type ChatSuggestionsResponse = { prompts?: string[]; stale?: boolean }

function fetchChatSuggestions(): Promise<ChatSuggestionsResponse> {
  return coalesceRequest('chat-suggestions', async () => {
    const response = await overlayAppClient.chat.suggestionsResponse({ credentials: 'same-origin' })
    return await response.json() as ChatSuggestionsResponse
  })
}

const DEFAULT_AUTOMATE_SUGGESTIONS = [
  'Email me a daily digest of my top priorities',
  'Monitor a website and alert me when it changes',
  'Summarize my unread Slack messages every morning',
  'Run a weekly report and send it to my team',
]

export function useEmptyChatStarters({
  firstName,
  mode,
  userId,
}: {
  firstName?: string
  mode: 'chat' | 'automate'
  userId: string | null
}) {
  const [emptyChatStarters, setEmptyChatStarters] = useState<string[]>(() =>
    mode === 'automate'
      ? DEFAULT_AUTOMATE_SUGGESTIONS
      : sanitizeEmptyChatStarters([...DEFAULT_CHAT_SUGGESTIONS], firstName)
  )

  useEffect(() => {
    let cancelled = false
    let refetchTimer: number | undefined

    const apply = (data: ChatSuggestionsResponse) => {
      if (cancelled) return
      if (Array.isArray(data.prompts) && data.prompts.length === 4) {
        setEmptyChatStarters(sanitizeEmptyChatStarters(data.prompts, firstName))
      }
      if (data.stale) {
        refetchTimer = window.setTimeout(() => {
          if (cancelled) return
          void fetchChatSuggestions()
            .then((payload: ChatSuggestionsResponse) => {
              if (cancelled) return
              if (Array.isArray(payload.prompts) && payload.prompts.length === 4) {
                setEmptyChatStarters(sanitizeEmptyChatStarters(payload.prompts, firstName))
              }
            })
            .catch(() => {
              /* keep current */
            })
        }, 4500)
      }
    }

    fetchChatSuggestions()
      .then(apply)
      .catch(() => {
        /* keep defaults */
      })

    return () => {
      cancelled = true
      if (refetchTimer !== undefined) window.clearTimeout(refetchTimer)
    }
  }, [userId, firstName])

  return emptyChatStarters
}

'use client'

import { useEffect, useState, type ComponentProps } from 'react'
import { useSearchParams } from 'next/navigation'
import ChatExperience from './ChatExperience'
import { DirectMessageExperience } from './DirectMessageExperience'

type SoftChatRoute = {
  conversationId: string | null
  view: string | null
}

/**
 * Soft chat switches use `history.pushState` (see ChatInlinePanel) so the app
 * shell does not remount. Next's `useSearchParams` does not observe that, so
 * DMs/channels re-read `window.location` whenever soft navigation fires.
 */
function readBrowserChatRoute(): SoftChatRoute {
  if (typeof window === 'undefined') return { conversationId: null, view: null }
  const params = new URLSearchParams(window.location.search)
  return {
    conversationId: params.get('id'),
    view: params.get('view'),
  }
}

export function ConversationExperienceRouter(props: ComponentProps<typeof ChatExperience>) {
  const searchParams = useSearchParams()
  const searchConversationId = searchParams?.get('id') ?? null
  const searchView = searchParams?.get('view') ?? null
  // Bumped only from browser soft-nav / popstate so we re-read window.location.
  const [browserRouteVersion, setBrowserRouteVersion] = useState(0)

  useEffect(() => {
    function bumpBrowserRoute() {
      setBrowserRouteVersion((value) => value + 1)
    }
    window.addEventListener('overlay:chat-route-selected', bumpBrowserRoute)
    window.addEventListener('popstate', bumpBrowserRoute)
    return () => {
      window.removeEventListener('overlay:chat-route-selected', bumpBrowserRoute)
      window.removeEventListener('popstate', bumpBrowserRoute)
    }
  }, [])

  void browserRouteVersion
  const browserRoute = readBrowserChatRoute()
  // Prefer the live browser URL after soft navigation; fall back to Next params
  // for the first paint / SSR where window is not available yet.
  const conversationId = browserRoute.conversationId ?? searchConversationId
  const view = browserRoute.view ?? searchView

  if (view === 'dms' && conversationId) {
    return (
      <DirectMessageExperience
        key={`dm:${conversationId}`}
        conversationId={conversationId}
        showcase={Boolean(props.publicShowcaseSnapshots)}
      />
    )
  }
  if (view === 'channels' && conversationId) {
    return (
      <DirectMessageExperience
        key={`channel:${conversationId}`}
        conversationId={conversationId}
        conversationType="channel"
        showcase={Boolean(props.publicShowcaseSnapshots)}
      />
    )
  }
  return <ChatExperience {...props} />
}

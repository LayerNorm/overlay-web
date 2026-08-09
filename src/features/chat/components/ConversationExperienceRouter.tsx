'use client'

import { Hash, Mail } from 'lucide-react'
import { useEffect, useState, type ComponentProps } from 'react'
import { useSearchParams } from 'next/navigation'
import ChatExperience from './ChatExperience'
import { DirectMessageExperience } from './DirectMessageExperience'
import { resolveSoftChatRoute, type SoftChatRoute } from '@/shared/chat/chat-view-navigation'

/**
 * Soft chat switches use `history.pushState` (see ChatInlinePanel) so the app
 * shell does not remount. Next's `useSearchParams` does not observe that, so
 * DMs/channels re-read `window.location` whenever soft navigation fires.
 */
function readBrowserChatRoute(): SoftChatRoute | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return {
    conversationId: params.get('id'),
    view: params.get('view'),
  }
}

function CollaborationViewEmptyState({ view }: { view: 'dms' | 'channels' }) {
  const Icon = view === 'dms' ? Mail : Hash
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon size={19} strokeWidth={1.7} />
        </span>
        <h2 className="text-base font-medium text-foreground">
          {view === 'dms' ? 'Select a direct message' : 'Select a channel'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {view === 'dms'
            ? 'Choose a conversation from the sidebar or start a new message.'
            : 'Choose a channel from the sidebar or create a new one.'}
        </p>
      </div>
    </div>
  )
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
  const { conversationId, view } = resolveSoftChatRoute(browserRoute, {
    conversationId: searchConversationId,
    view: searchView,
  })

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
  if (view === 'dms' || view === 'channels') {
    return <CollaborationViewEmptyState view={view} />
  }
  return <ChatExperience {...props} />
}

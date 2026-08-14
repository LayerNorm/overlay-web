'use client'

import { Hash, Mail } from 'lucide-react'
import { useEffect, useState, type ComponentProps } from 'react'
import { useSearchParams } from 'next/navigation'
import ChatExperience from './ChatExperience'
import { DirectMessageExperience } from './DirectMessageExperience'
import { resolveSoftChatRoute, type SoftChatRoute } from '@/shared/chat/chat-view-navigation'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { PersonalCollaborationBoundary } from '@/features/workspaces/components/PersonalCollaborationBoundary'

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
    <div className="flex min-h-[100dvh] w-full items-center justify-center px-6 pb-16 text-center">
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
  const { activeWorkspace } = useWorkspace()
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
  const searchRoute = {
    conversationId: searchConversationId,
    view: searchView,
  }
  // When router.push() fires, useSearchParams updates before
  // window.location.search. If the two disagree, the Next params are
  // more recent — use them. Otherwise prefer the browser URL (authoritative
  // for soft navigation via history.pushState).
  const browserView = browserRoute?.view ?? null
  const route = browserView === searchView
    ? resolveSoftChatRoute(browserRoute, searchRoute)
    : searchRoute
  const { conversationId, view } = route

  if (activeWorkspace?.kind === 'personal' && view === 'channels') {
    return <PersonalCollaborationBoundary className="min-h-[100dvh] px-6 pb-16" />
  }

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

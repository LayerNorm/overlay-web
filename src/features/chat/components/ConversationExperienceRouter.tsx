'use client'

import { Hash, Mail } from 'lucide-react'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import ChatExperience from './ChatExperience'
import { ChatSurfaceEmptyState } from './ChatSurfaceEmptyState'
import { DirectMessageExperience } from './DirectMessageExperience'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { resolveSoftChatRoute, type SoftChatRoute } from '@/shared/chat/chat-view-navigation'
import {
  legacyWorkspaceScopeForRoute,
  normalizeChatViewForScope,
  readWorkspacePathScope,
} from '@/shared/workspaces/routing'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import {
  ConversationDetailScopeGate,
  conversationDetailRouteKey,
  startConversationDetailScopeProbe,
  type ConversationDetailScopeStatus,
  type ConversationScopeDetail,
} from './conversationScopeVerification'

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
    <ChatSurfaceEmptyState
      icon={Icon}
      title={view === 'dms' ? 'Select a direct message' : 'Select a channel'}
      description={view === 'dms'
        ? 'Choose a conversation from the sidebar or start a new message.'
        : 'Choose a channel from the sidebar or create a new one.'}
    />
  )
}

export function ConversationExperienceRouter(props: ComponentProps<typeof ChatExperience>) {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const buildWorkspaceHref = useWorkspaceHref()
  const pathScope = readWorkspacePathScope(pathname)
  const searchParams = useSearchParams()
  const searchConversationId = searchParams?.get('id') ?? null
  const searchView = searchParams?.get('view') ?? null
  const draft = searchParams?.get('draft') === '1'
  const draftTitle = searchParams?.get('title') ?? undefined
  const browserRoute = readBrowserChatRoute()
  const searchRoute = {
    conversationId: searchConversationId,
    view: searchView,
  }
  const browserView = browserRoute?.view ?? null
  const route = browserView === searchView
    ? resolveSoftChatRoute(browserRoute, searchRoute)
    : searchRoute
  const conversationId = route.conversationId
  // Bumped only from browser soft-nav / popstate so we re-read window.location.
  const [browserRouteVersion, setBrowserRouteVersion] = useState(0)
  const [scopeRouteStatus, setScopeRouteStatus] = useState<ConversationDetailScopeStatus | null>(null)

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

  const resourceRouteKey = conversationDetailRouteKey({
    pathScope,
    conversationId,

  })
  useEffect(() => {
    if (!resourceRouteKey || !conversationId || !pathScope) return
    return startConversationDetailScopeProbe({
      routeKey: resourceRouteKey,
      conversationId,
      pathScope,
      pathname,
      getConversation: (id) => overlayAppClient.conversations.get<ConversationScopeDetail>({ conversationId: id }),
      getLocation: () => ({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      }),
      buildWorkspaceHref,
      replace: (destination) => router.replace(destination),
      setStatus: setScopeRouteStatus,
    })
  }, [browserRouteVersion, conversationId, searchView, pathScope, resourceRouteKey, buildWorkspaceHref, pathname, router])

  void browserRouteVersion
  const selectedScope = pathScope ?? legacyWorkspaceScopeForRoute(
    'chat',
    new URLSearchParams(searchParams?.toString() ?? ''),
  )
  const view = selectedScope ? normalizeChatViewForScope(selectedScope, route.view) : route.view

  let content: ReactNode
  if (view === 'dms' && conversationId) {
    content = (
      <DirectMessageExperience
        key={`dm:${conversationId}`}
        conversationId={conversationId}
        draft={draft}
        draftTitle={draftTitle}

      />
    )
  } else if (view === 'channels' && conversationId) {
    content = (
      <DirectMessageExperience
        key={`channel:${conversationId}`}
        conversationId={conversationId}
        conversationType="channel"
        draft={draft}
        draftTitle={draftTitle}

      />
    )
  } else if (view === 'dms' || view === 'channels') {
    content = <CollaborationViewEmptyState view={view} />
  } else {
    content = <ChatExperience {...props} />
  }
  return (
    <ConversationDetailScopeGate
      routeKey={resourceRouteKey}
      status={scopeRouteStatus}
      fallback={(
        <ChatSurfaceEmptyState
          icon={Mail}
          title="Conversation unavailable"
          description="This conversation could not be opened."
        />
      )}
    >
      {content}
    </ConversationDetailScopeGate>
  )
}

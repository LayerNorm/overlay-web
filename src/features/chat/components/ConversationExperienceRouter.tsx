'use client'

import { Hash, Mail } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import ChatExperience from './ChatExperience'
import { ChatSurfaceEmptyState } from './ChatSurfaceEmptyState'
import { DirectMessageExperience } from './DirectMessageExperience'
import { useConvex } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { isConvexIdShape } from '@/components/providers/usePersonalChatTranscript'
import { resolveSoftChatRoute, type SoftChatRoute } from '@/shared/chat/chat-view-navigation'
import {
  legacyWorkspaceScopeForRoute,
  normalizeChatViewForScope,
  readWorkspacePathScope,
} from '@/shared/workspaces/routing'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { usePersonalChatDirectory } from '@/components/providers/PersonalChatProvider'
import {
  ConversationDetailScopeGate,
  conversationDetailRouteKey,
  isConversationScopeVerified,
  isKnownNativePersonalChat,
  markConversationScopeVerified,
  startConversationDetailScopeProbe,
  type ConversationDetailScopeStatus,
  type ConversationScopeDetail,
} from './conversationScopeVerification'

/**
 * Soft chat switches use `history.pushState` (see ChatInlinePanel) so the app
 * shell does not remount. Next's `useSearchParams` does not observe that, so
 * DMs/channels subscribe to `window.location.search` directly. A store
 * subscription also re-checks the URL after each commit, which catches
 * `router.push`: Next writes history only after the render that receives the
 * new search params, so that render can still see the previous URL.
 */
function subscribeBrowserChatRoute(onChange: () => void) {
  window.addEventListener('overlay:chat-route-selected', onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    window.removeEventListener('overlay:chat-route-selected', onChange)
    window.removeEventListener('popstate', onChange)
  }
}

function readBrowserSearch(): string {
  return window.location.search
}

function readServerSearch(): string | null {
  return null
}

function parseBrowserChatRoute(search: string | null): (SoftChatRoute & { draft: boolean; title?: string }) | null {
  if (search === null) return null
  const params = new URLSearchParams(search)
  return {
    conversationId: params.get('id'),
    view: params.get('view'),
    draft: params.get('draft') === '1',
    title: params.get('title') ?? undefined,
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
  const browserSearch = useSyncExternalStore(subscribeBrowserChatRoute, readBrowserSearch, readServerSearch)
  const browserRoute = parseBrowserChatRoute(browserSearch)
  const searchRoute = {
    conversationId: searchConversationId,
    view: searchView,
  }
  const browserView = browserRoute?.view ?? null
  const useBrowserRoute = browserView === searchView
  const route = useBrowserRoute
    ? resolveSoftChatRoute(browserRoute, searchRoute)
    : searchRoute
  const conversationId = route.conversationId
  // Draft flags travel with the route that picked the conversation.
  const draft = useBrowserRoute && browserRoute ? browserRoute.draft : searchParams?.get('draft') === '1'
  const draftTitle = useBrowserRoute && browserRoute ? browserRoute.title : searchParams?.get('title') ?? undefined
  const [scopeRouteStatus, setScopeRouteStatus] = useState<ConversationDetailScopeStatus | null>(null)

  const resourceRouteKey = conversationDetailRouteKey({
    pathScope,
    conversationId,

  })
  const personalChat = usePersonalChatDirectory()
  const convex = useConvex()
  const knownNativeChat = isKnownNativePersonalChat(personalChat, pathScope, conversationId)
  if (knownNativeChat && pathScope && conversationId) markConversationScopeVerified(pathScope, conversationId)
  useEffect(() => {
    if (!resourceRouteKey || !conversationId || !pathScope || isConversationScopeVerified(resourceRouteKey)) return
    return startConversationDetailScopeProbe({
      routeKey: resourceRouteKey,
      conversationId,
      pathScope,
      pathname,
      getConversation: (id) => readConversationScope(convex, personalChat.workspaceId, id),
      getLocation: () => ({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      }),
      buildWorkspaceHref,
      replace: (destination) => router.replace(destination),
      setStatus: setScopeRouteStatus,
    })
  }, [browserSearch, conversationId, convex, knownNativeChat, personalChat.workspaceId, searchView, pathScope, resourceRouteKey, buildWorkspaceHref, pathname, router])

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

/** A chat link's type and scope from Convex: an AI chat the person owns, or a room they belong to. Throws when neither. */
async function readConversationScope(
  convex: ReturnType<typeof useConvex>,
  workspaceId: string | null,
  id: string,
): Promise<ConversationScopeDetail> {
  if (!workspaceId || !isConvexIdShape(id)) throw new Error('Conversation not found')
  const conversationId = id as Id<'conversations'>
  const chat = await convex.query(api.chat.personal.getSummary, { workspaceId, conversationId })
  if (chat) return { conversationType: 'personal', scope: chat.scope }
  const room = await convex.query(api.collaboration.rooms.scope, { workspaceId, conversationId })
  if (room) return room
  throw new Error('Conversation not found')
}

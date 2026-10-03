'use client'

import { Hash, Mail } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { useSearchParams } from 'next/navigation'
import ChatExperience from './ChatExperience'
import { ChatSurfaceEmptyState } from './ChatSurfaceEmptyState'
import { DirectMessageExperience } from './DirectMessageExperience'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
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
  const searchParams = useSearchParams()
  const searchConversationId = searchParams?.get('id') ?? null
  const searchView = searchParams?.get('view') ?? null
  const draft = searchParams?.get('draft') === '1'
  const draftTitle = searchParams?.get('title') ?? undefined
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

  // A link to a direct message or channel with no view (an agent's question, a shared URL) would open it as a personal
  // chat. Ask what the conversation is and move the route to the view that renders it. A personal chat has no
  // participants to find, so it is left alone.
  const probedId = useRef<string | null>(null)
  useEffect(() => {
    const route = readBrowserChatRoute()
    const id = route?.conversationId
    if (!id || (route?.view && route.view !== 'personal') || probedId.current === id || props.publicShowcaseSnapshots) return
    probedId.current = id
    void (async () => {
      try {
        const { participants } = await overlayAppClient.conversations.participants(id)
        if (participants.filter((participant) => participant.status === 'active').length < 2) return
        const isChannel = (await overlayAppClient.conversations.channels().catch((_error) => ({ channels: [] })))
          .channels.some((channel) => channel.conversationId === id)
        const params = new URLSearchParams(window.location.search)
        if (params.get('id') !== id) return
        params.set('view', isChannel ? 'channels' : 'dms')
        window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
        window.dispatchEvent(new CustomEvent('overlay:chat-route-selected', { detail: { chatId: id, view: isChannel ? 'channels' : 'dms' } }))
      } catch (_error) {
        // Not a conversation with other participants: it stays a personal chat.
      }
    })()
  }, [browserRouteVersion, searchConversationId, searchView, props.publicShowcaseSnapshots])

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

  if (view === 'dms' && conversationId) {
    return (
      <DirectMessageExperience
        key={`dm:${conversationId}`}
        conversationId={conversationId}
        draft={draft}
        draftTitle={draftTitle}
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
        draft={draft}
        draftTitle={draftTitle}
        showcase={Boolean(props.publicShowcaseSnapshots)}
      />
    )
  }
  if (view === 'dms' || view === 'channels') {
    return <CollaborationViewEmptyState view={view} />
  }
  return <ChatExperience {...props} />
}

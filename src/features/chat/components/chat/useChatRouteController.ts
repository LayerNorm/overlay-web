'use client'

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { usePathname, type ReadonlyURLSearchParams } from 'next/navigation'
import { normalizeAutomationDetailTab } from '@overlay/app-core/automations'
import type { AutomationDetail } from '@overlay/app-core'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { usePanelScope } from '@/hooks/use-panel-scope'
import { readWorkspacePathScope } from '@/shared/workspaces/routing'
import { parsePanelScope } from '@/shared/workspaces/panel-scope'
import { resetRuntimeState } from './conversation-runtime-utils'
import type { ConversationRuntime, ConversationUiState } from '../chat-interface/types'
import type { PendingFirstSendState } from './chat-send-pending-first'

type LoadChat = (chatId: string, options?: { replaceUrl?: boolean }) => Promise<void>

export function useChatRouteController({
  activeChatId,
  activeChatIdRef,
  applyDefaultChatModelsToView,
  applyUiStateToView,
  chatPrefsHydrated,
  clearTransientComposerState,
  emptyRuntimeRef,
  hideSidebar,
  mode,
  pendingTitleRef,
  pendingFirstSendRef,
  persistActiveRuntimeUiState,
  resetComposerToolIds,
  routerReplace,
  searchParams,
  selectedAutomation,
  setActiveChatId,
  setActiveChatTitle,
  setActiveViewer,
  setInterruptedExchangeIdx,
  setIsTemporaryChat,
  setPendingRunConversationId,
  setRuntimeHydrationVersion,
  setSourcesPanel,
}: {
  activeChatId: string | null
  activeChatIdRef: MutableRefObject<string | null>
  applyDefaultChatModelsToView: (ui: Partial<ConversationUiState>) => ConversationUiState
  applyUiStateToView: (ui: ConversationUiState) => void
  chatPrefsHydrated: boolean
  clearTransientComposerState: () => void
  emptyRuntimeRef: MutableRefObject<ConversationRuntime>
  hideSidebar?: boolean
  mode: 'chat' | 'automate'
  pendingTitleRef: MutableRefObject<{ chatId: string; title: string } | null>
  pendingFirstSendRef: MutableRefObject<PendingFirstSendState | null>
  persistActiveRuntimeUiState: () => void
  resetComposerToolIds: (temporary: boolean) => void
  routerReplace: (href: string) => void
  searchParams: ReadonlyURLSearchParams | null
  selectedAutomation: AutomationDetail | null
  setActiveChatId: Dispatch<SetStateAction<string | null>>
  setActiveChatTitle: Dispatch<SetStateAction<string | null>>
  setActiveViewer: (chatId: string | null) => void
  setInterruptedExchangeIdx: Dispatch<SetStateAction<number | null>>
  setIsTemporaryChat: Dispatch<SetStateAction<boolean>>
  setPendingRunConversationId: (conversationId: string | null) => void
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  setSourcesPanel: (panel: null) => void
}) {
  const pathname = usePathname() ?? ''
  const buildWorkspaceHref = useWorkspaceHref()
  const rememberedScope = usePanelScope()
  const loadChatRef = useRef<LoadChat | null>(null)
  const invalidateLoadChatRequestRef = useRef<(() => void) | null>(null)

  const idParam = searchParams?.get('id') ?? null
  const automationIdParam = mode === 'automate' ? searchParams?.get('automationId') ?? null : null
  const automationDetailTab = normalizeAutomationDetailTab(searchParams?.get('tab'))
  // Only the automation-owned thread — sourceConversationId is provenance.
  const automationConversationId = selectedAutomation?.conversationId || null
  const hasAutomationContext = mode === 'automate' && Boolean(automationIdParam)
  const showAutomationChatTab = !hasAutomationContext || automationDetailTab === 'chat'
  const showAutomationHeaderControls = mode === 'automate'
  const viewParam = searchParams?.get('view')
  const viewScope = viewParam === 'dms' || viewParam === 'channels' || viewParam === 'workspace-chats'
    ? 'workspace'
    : viewParam === 'personal' ? 'personal' : null
  const routeScope = readWorkspacePathScope(pathname)
    ?? parsePanelScope(searchParams?.get('scope'))
    ?? viewScope
    ?? rememberedScope

  const syncStandaloneChatUrl = useCallback((chatId: string | null, options: { replaceUrl?: boolean } = {}) => {
    if (hideSidebar || options.replaceUrl === false) return
    const replaceUrl = (href: string) => {
      routerReplace(href)
    }
    if (mode === 'automate') {
      const params = new URLSearchParams()
      if (chatId) params.set('id', chatId)
      const liveSearchParams = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : null
      const automationId = automationIdParam ?? liveSearchParams?.get('automationId')
      if (automationId) params.set('automationId', automationId)
      const tab = normalizeAutomationDetailTab(
        liveSearchParams?.get('tab') ?? searchParams?.get('tab'),
      )
      if (tab !== 'chat') params.set('tab', tab)
      const query = params.toString()
      replaceUrl(buildWorkspaceHref(null, `/app/automations${query ? `?${query}` : ''}`, routeScope))
      return
    }
    const params = new URLSearchParams()
    if (searchParams?.get('showcase') === '1') params.set('showcase', '1')
    if (viewParam && ['personal', 'workspace-chats', 'dms', 'channels'].includes(viewParam)) params.set('view', viewParam)
    if (chatId) params.set('id', chatId)
    const query = params.toString()
    replaceUrl(buildWorkspaceHref(null, `/app/chat${query ? `?${query}` : ''}`, routeScope))
  }, [automationIdParam, buildWorkspaceHref, hideSidebar, mode, routeScope, routerReplace, searchParams, viewParam])

  const resetToBlankChatSurface = useCallback((options: { temporary: boolean }) => {
    invalidateLoadChatRequestRef.current?.()
    persistActiveRuntimeUiState()
    activeChatIdRef.current = null
    pendingTitleRef.current = null
    pendingFirstSendRef.current = null
    setPendingRunConversationId(null)
    setActiveViewer(null)
    setActiveChatId(null)
    setInterruptedExchangeIdx(null)
    setSourcesPanel(null)
    setIsTemporaryChat(options.temporary)
    resetComposerToolIds(options.temporary)
    setActiveChatTitle(options.temporary ? 'Temporary chat' : null)
    const defaultUi = applyDefaultChatModelsToView({
      activeChatTitle: options.temporary ? 'Temporary chat' : null,
      isFirstMessage: true,
    })
    resetRuntimeState(emptyRuntimeRef.current, defaultUi)
    emptyRuntimeRef.current.hydrated = true
    applyUiStateToView(emptyRuntimeRef.current.ui)
    clearTransientComposerState()
    setRuntimeHydrationVersion((value) => value + 1)
    syncStandaloneChatUrl(null)
  }, [
    activeChatIdRef,
    applyDefaultChatModelsToView,
    applyUiStateToView,
    clearTransientComposerState,
    emptyRuntimeRef,
    pendingTitleRef,
    pendingFirstSendRef,
    persistActiveRuntimeUiState,
    resetComposerToolIds,
    setActiveChatId,
    setActiveChatTitle,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
    setPendingRunConversationId,
    setRuntimeHydrationVersion,
    setSourcesPanel,
    syncStandaloneChatUrl,
  ])

  useEffect(() => {
    if (hideSidebar) return
    const browserIdParam =
      typeof window === 'undefined'
        ? idParam
        : new URLSearchParams(window.location.search).get('id')
    const effectiveIdParam = idParam ?? browserIdParam
    const shouldResetToEmptySurface =
      (mode === 'chat' && !effectiveIdParam) ||
      (mode === 'automate' && !effectiveIdParam && !automationIdParam)
    if (!shouldResetToEmptySurface) return
    if (!activeChatIdRef.current && !activeChatId) return

    persistActiveRuntimeUiState()
    activeChatIdRef.current = null
    pendingTitleRef.current = null
    pendingFirstSendRef.current = null
    setPendingRunConversationId(null)
    setIsTemporaryChat(false)
    resetComposerToolIds(false)
    setActiveChatId(null)
    setActiveChatTitle(null)
    setInterruptedExchangeIdx(null)
    setSourcesPanel(null)
    setActiveViewer(null)
    applyUiStateToView(applyDefaultChatModelsToView({
      activeChatTitle: null,
      isFirstMessage: true,
    }))
    clearTransientComposerState()
  }, [
    activeChatId,
    activeChatIdRef,
    applyDefaultChatModelsToView,
    applyUiStateToView,
    automationIdParam,
    clearTransientComposerState,
    hideSidebar,
    idParam,
    mode,
    pendingTitleRef,
    pendingFirstSendRef,
    persistActiveRuntimeUiState,
    resetComposerToolIds,
    setActiveChatId,
    setActiveChatTitle,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
    setPendingRunConversationId,
    setSourcesPanel,
  ])

  useEffect(() => {
    if (!chatPrefsHydrated) return
    // Automation URLs can contain a legacy or stale conversation id. The
    // automation detail loader validates its linked conversation before the
    // canonical automationConversationId effect below is allowed to hydrate it.
    if (mode === 'automate' && automationIdParam) return
    if (!idParam || activeChatIdRef.current === idParam) return
    void loadChatRef.current?.(idParam)
  }, [activeChatIdRef, automationIdParam, chatPrefsHydrated, idParam, mode])

  useEffect(() => {
    function handleChatRouteSelected(event: Event) {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId
      if (!chatId || activeChatIdRef.current === chatId) return
      void loadChatRef.current?.(chatId, { replaceUrl: false })
    }
    window.addEventListener('overlay:chat-route-selected', handleChatRouteSelected)
    return () => window.removeEventListener('overlay:chat-route-selected', handleChatRouteSelected)
  }, [activeChatIdRef])

  useEffect(() => {
    if (mode !== 'automate' || !automationConversationId) return
    if (activeChatIdRef.current === automationConversationId) return
    void loadChatRef.current?.(automationConversationId)
  }, [activeChatIdRef, automationConversationId, mode])

  useEffect(() => {
    if (mode !== 'automate' || !automationIdParam || !selectedAutomation) return
    if (automationConversationId || !activeChatIdRef.current) return
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent
    resetToBlankChatSurface({ temporary: false })
  }, [
    activeChatIdRef,
    automationConversationId,
    automationIdParam,
    mode,
    resetToBlankChatSurface,
    selectedAutomation,
  ])

  const replaceActiveChatRoute = useCallback(() => {
    if (hideSidebar) return
    const params = new URLSearchParams()
    const view = searchParams?.get('view')
    if (view && ['personal', 'workspace-chats', 'dms', 'channels'].includes(view)) params.set('view', view)
    if (searchParams?.get('showcase') === '1') params.set('showcase', '1')
    const query = params.toString()
    const href = buildWorkspaceHref(null, `/app/chat${query ? `?${query}` : ''}`, routeScope)
    routerReplace(href)
  }, [buildWorkspaceHref, hideSidebar, routeScope, routerReplace, searchParams])

  return {
    automationConversationId,
    automationDetailTab,
    automationIdParam,
    hasAutomationContext,
    idParam,
    invalidateLoadChatRequestRef,
    loadChatRef,
    replaceActiveChatRoute,
    resetToBlankChatSurface,
    showAutomationChatTab,
    showAutomationHeaderControls,
    syncStandaloneChatUrl,
  }
}

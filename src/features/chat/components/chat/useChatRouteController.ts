'use client'

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ReadonlyURLSearchParams } from 'next/navigation'
import { normalizeAutomationDetailTab } from '@overlay/app-core/automations'
import type { AutomationDetail } from '@overlay/app-core'
import { resetRuntimeState } from './conversation-runtime-utils'
import type { ConversationRuntime, ConversationUiState } from '../chat-interface/types'

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
  setRuntimeHydrationVersion: Dispatch<SetStateAction<number>>
  setSourcesPanel: (panel: null) => void
}) {
  const loadChatRef = useRef<LoadChat | null>(null)
  const invalidateLoadChatRequestRef = useRef<(() => void) | null>(null)

  const idParam = searchParams?.get('id') ?? null
  const automationIdParam = mode === 'automate' ? searchParams?.get('automationId') ?? null : null
  const automationDetailTab = normalizeAutomationDetailTab(searchParams?.get('tab'))
  const automationConversationId =
    selectedAutomation?.sourceConversationId || selectedAutomation?.conversationId || null
  const hasAutomationContext = mode === 'automate' && Boolean(automationIdParam)
  const showAutomationChatTab = !hasAutomationContext || automationDetailTab === 'chat'
  const showAutomationHeaderControls = mode === 'automate'

  const syncStandaloneChatUrl = useCallback((chatId: string | null, options: { replaceUrl?: boolean } = {}) => {
    if (hideSidebar || options.replaceUrl === false) return
    const replaceUrl = (href: string) => {
      window.history.replaceState(null, '', href)
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
      replaceUrl(`/app/automations${query ? `?${query}` : ''}`)
      return
    }
    const basePath = '/app/chat'
    const params = new URLSearchParams()
    if (searchParams?.get('showcase') === '1') params.set('showcase', '1')
    if (chatId) params.set('id', chatId)
    const query = params.toString()
    replaceUrl(query ? `${basePath}?${query}` : basePath)
  }, [automationIdParam, hideSidebar, mode, searchParams])

  const resetToBlankChatSurface = useCallback((options: { temporary: boolean }) => {
    invalidateLoadChatRequestRef.current?.()
    persistActiveRuntimeUiState()
    activeChatIdRef.current = null
    pendingTitleRef.current = null
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
    persistActiveRuntimeUiState,
    resetComposerToolIds,
    setActiveChatId,
    setActiveChatTitle,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
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
    persistActiveRuntimeUiState,
    resetComposerToolIds,
    setActiveChatId,
    setActiveChatTitle,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
    setSourcesPanel,
  ])

  useEffect(() => {
    if (!chatPrefsHydrated) return
    if (!idParam || activeChatIdRef.current === idParam) return
    void loadChatRef.current?.(idParam)
  }, [activeChatIdRef, chatPrefsHydrated, idParam])

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

  const replaceActiveChatRoute = useCallback(() => {
    if (!hideSidebar) routerReplace('/app/chat')
  }, [hideSidebar, routerReplace])

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

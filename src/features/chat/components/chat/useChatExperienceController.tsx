'use client'

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { toast } from '@overlay/ui/primitives'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { AutomationDetail } from '@overlay/app-core'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { useChatListEventSync } from './useChatListEventSync'
import { useChatAttachments } from '../useChatAttachments'
import { useChatBillingControls } from './useChatBillingControls'
import { useDraftReviewActions } from './useDraftReviewActions'
import { useChatPreferences } from './useChatPreferences'
import { useChatPanels } from './useChatPanels'
import { useChatConversationLoader } from './useChatConversationLoader'
import { useConversationUiState } from './useConversationUiState'
import { useChatListController } from './useChatListController'
import { useChatModelSelectionController } from './useChatModelSelectionController'
import { useChatRetryController } from './useChatRetryController'
import { useChatRouteController } from './useChatRouteController'
import {
  TEMPORARY_CHAT_ID,
  useChatSendController,
} from './useChatSendController'
import { useChatStopController } from './useChatStopController'
import { useChatTitleController } from './useChatTitleController'
import { useLiveConversationSync } from './useLiveConversationSync'
import { useAgentRunLifecycle } from './useAgentRunLifecycle'
import { resolveAgentRunNotice, type AgentRunNoticePrevious } from './agent-run-notice'
import { useChatRuntimes } from './useChatRuntimes'
import { useComposerTextState } from './useComposerTextState'
import {
  type ChatListPageInfo,
} from '@/shared/chat/chat-list-cache'
import {
  tryLogTtftClientFirstText,
} from '@/shared/chat/ttft-client-debug'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { shouldLoadGatewayModelCatalog } from '@/shared/ai/gateway/catalog-access'
import { useByokModels } from '@/components/providers/useByokModels'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import { useAuth } from '@/contexts/AuthContext'
import { useConvexAuthToken } from '@/components/providers/ConvexAuthProvider'
import { useGeneratedUiConnectorActions } from './useGeneratedUiConnectorActions'
import { useChatMentions } from '../use-chat-mentions'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import type { Conversation } from '../chat-interface/types'
import type { MentionInputHandle } from '../chat-interface/MentionInput'
import type { ConversationLoadSnapshot } from './chatTransport'
import type { PendingFirstSendState } from './chat-send-pending-first'
import { useChatTemporaryState } from './useChatTemporaryState'
import { useComposerTools } from './useComposerTools'
import { useChatModelDefaults } from './useChatModelDefaults'
import { useConversationBottomVisibility, usePendingTurnScroll } from './useConversationScroll'
import { useAutomationDetail } from './useAutomationDetail'
import { useChatTurnActions } from './useChatTurnActions'
import { useWorkApproval } from './useWorkApproval'
import { useComposerActions } from './useComposerActions'
import { buildChatDerivedView } from './chatDerivedView'

export type ChatExperienceProps = {
  userId: string | null
  firstName?: string
  hideSidebar?: boolean
  projectName?: string
  mode?: 'chat' | 'automate'
  hideHeader?: boolean
  belowEmptyComposer?: React.ReactNode
  initialChats?: Conversation[]
  initialChatPageInfo?: ChatListPageInfo
  publicShowcaseSnapshots?: Readonly<Record<string, ConversationLoadSnapshot>>
}

export function useChatExperienceController({
  userId,
  firstName,
  hideSidebar,
  projectName,
  mode = 'chat',
  hideHeader = false,
  belowEmptyComposer,
  initialChats,
  initialChatPageInfo,
  publicShowcaseSnapshots,
}: ChatExperienceProps) {
  recordRender('ChatExperience')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const buildWorkspaceHref = useWorkspaceHref()
  const isPublicShowcase = Boolean(publicShowcaseSnapshots)
  const { settings, updateSettings } = useAppSettings()
  const { user: authUser, isLoading: authLoading } = useAuth()
  const gatewayCatalogEnabled = shouldLoadGatewayModelCatalog({
    isAuthenticated: Boolean(authUser),
    isAuthLoading: authLoading,
    isPublicShowcase,
  })
  const { appDataCapabilities, capabilities } = useOverlayCapabilities()
  const {
    models: gatewayCatalogModels,
    isLoading: gatewayModelsLoading,
    revision: gatewayCatalogRevision,
  } = useGatewayModelCatalog({ enabled: gatewayCatalogEnabled })
  const { activeWorkspaceId } = useWorkspace()
  const { connections: byokConnections, isLoading: byokModelsLoading } = useByokModels({
    enabled: gatewayCatalogEnabled && capabilities.modelRouting,
  })
  const modelCatalogVersion = useMemo(
    () => `${gatewayCatalogRevision}:${byokConnections.map((connection) => [
      connection._id,
      connection.status,
      connection.discoveredAt ?? 0,
      connection.enabledModelIds.join(','),
    ].join(':')).join('|')}`,
    [byokConnections, gatewayCatalogRevision],
  )
  const billingEnabled = capabilities.billing
  const convexLiveSyncEnabled = !isPublicShowcase &&
    appDataCapabilities.requiresConvexClient && appDataCapabilities.supportsRealtime
  const titleGenerationEnabled = !isPublicShowcase && appDataCapabilities.supportsChatPersistence
  const generatedOutputsEnabled = !isPublicShowcase
  const convexAccessToken = useConvexAuthToken()
  const { startSession, completeSession, markRead, setActiveViewer, sessions } = useAsyncSessions()
  const activeChatIdRef = useRef<string | null>(null)
  const {
    isTemporaryChat,
    setIsTemporaryChat,
    isTemporaryChatRef,
  } = useChatTemporaryState()
  const composerMode: 'chat' | 'automate' = isTemporaryChat ? 'chat' : mode
  // Stores the pending title so loadChats() never overwrites it before the PATCH lands
  const pendingTitleRef = useRef<{ chatId: string; title: string } | null>(null)

  // Clear active viewer + ref when this tab unmounts so any in-flight .then() sees isActive=false
  useEffect(() => {
    return () => {
      activeChatIdRef.current = null
      setActiveViewer(null)
    }
  }, [setActiveViewer])

  const { chats, loadChats, setChats } = useChatListController({
    initialChatPageInfo,
    initialChats,
    pendingTitleRef,
    useSeededGuestData: isPublicShowcase,
    userId,
  })
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const {
    runtimesRef,
    emptyRuntimeRef,
    ensureConversationRuntime,
    replaceConversationRuntime,
    activeRuntime,
    chat0,
    actChat,
    chat0Ref,
    actChatRef,
    chatInstances,
  } = useChatRuntimes(activeChatId)
  const [, forceLiveSyncRender] = useState(0)
  const [runtimeHydrationVersion, setRuntimeHydrationVersion] = useState(0)
  const [pendingRunConversationId, setPendingRunConversationId] = useState<string | null>(null)
  const pendingFirstSendRef = useRef<PendingFirstSendState | null>(null)
  const {
    attachmentPreview,
    attachmentPreviewMode,
    closeAttachmentPreview,
    closeLinkPreview,
    closeSourcesPanel,
    linkPreview,
    openAttachmentPreview,
    openFilePreview,
    openLinkPreview,
    openSourcesPanel,
    panelPresentation,
    panelWidth,
    setPanelPresentation,
    setPanelWidth,
    setAttachmentPreviewMode,
    setSourcesPanel,
    sourcesPanel,
  } = useChatPanels()

  /** Exchange index where the user pressed Stop; cleared on chat switch / new chat. */
  const [interruptedExchangeIdx, setInterruptedExchangeIdx] = useState<number | null>(null)
  const userAskModelOverrideRef = useRef(false)
  const {
    selectedActModel,
    setSelectedActModel,
    selectedModels,
    setSelectedModels,
    chatPrefsHydrated,
    hasStoredTextModelSelection,
    generationMode,
    setGenerationMode,
    personalChatMode,
    setPersonalChatMode,
    generationChip,
    setGenerationChip,
    selectedImageModels,
    setSelectedImageModels,
    selectedVideoModels,
    setSelectedVideoModels,
    videoSubMode,
    setVideoSubMode,
    lastGeneratedImageUrlRef,
    reasoning,
    setReasoning,
  } = useChatPreferences()
  const [, setIsSwitchingChat] = useState(false)
  const generatedUiConnectorActions = useGeneratedUiConnectorActions({ enabled: !isPublicShowcase })

  const [isDragging, setIsDragging] = useState(false)
  const {
    handleComposerInputChange,
    hasComposerText,
    input,
    inputRef,
    inputRevision,
    setInput,
    subscribeToInput,
  } = useComposerTextState()

  // Restore guest draft after hydration so server/client initial renders match
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const draft = sessionStorage.getItem('overlay:guest-draft')
      if (draft) {
        sessionStorage.removeItem('overlay:guest-draft')
        setInput(draft)
      }
    } catch { /* ignore */ }
  }, [setInput])

  const [isOptimisticLoading, setIsOptimisticLoading] = useState(false)
  const [composerNotice, setComposerNotice] = useState<string | null>(null)
  const previousAgentRunRef = useRef<AgentRunNoticePrevious | null>(null)
  const {
    attachedImages,
    setAttachedImages,
    pendingChatDocuments,
    setPendingChatDocuments,
    attachmentError,
    setAttachmentError,
    fileInputRef,
    docInputRef,
    dragCounterRef,
    removePendingDocument,
    queueDocumentUpload,
    addDocumentsFromPicker,
    addImages,
    handlePaste,
  } = useChatAttachments()

  const {
    showAttachMenu,
    setShowAttachMenu,
    showModeMenu,
    setShowModeMenu,
    selectedToolIds,
    setSelectedToolIds,
    memoryEnabled,
    setMemoryEnabled,
    replyContext,
    setReplyContext,
    attachMenuRef,
    modeMenuRef,
    clearTransientComposerState,
    resetComposerToolIds,
    toggleComposerTool,
    removeComposerTool,
  } = useComposerTools({
    setPendingChatDocuments,
    setAttachmentError,
    setComposerNotice,
  })
  const {
    isBudgetExhaustedPaid,
    isFreeTier,
    isSendBlocked,
    loadSubscription,
    selectableTextModels,
  } = useChatBillingControls({
    activeChatId,
    activeWorkspaceId,
    billingEnabled,
    catalogRevision: gatewayCatalogRevision,
    modelCatalogVersion,
    modelCatalogReady: !byokModelsLoading,
    chatPrefsHydrated,
    onlyAllowZdrModels: settings.onlyAllowZdrModels,
    pathname,
    router,
    searchParams,
    selectedActModel,
    selectedModels,
    setComposerNotice,
    setSelectedActModel,
    setSelectedModels,
  })
  const {
    applyDefaultChatModelsToView,
  } = useChatModelDefaults({
    settings,
    billingEnabled,
    isFreeTier,
    hasStoredTextModelSelection,
    selectedActModel,
    selectedModels,
    setSelectedActModel,
    setSelectedModels,
    userAskModelOverrideRef,
    chatPrefsHydrated,
    activeChatId,
    isTemporaryChat,
  })
  /** User turn ids currently playing the delete (fade-out) animation */
  const [exitingTurnIds, setExitingTurnIds] = useState<string[]>([])
  const [, setDeletingChatIds] = useState<string[]>([])
  const [activeChatDeleting, setActiveChatDeleting] = useState(false)
  const [selectedAutomation, setSelectedAutomation] = useState<AutomationDetail | null>(null)
  const [selectedAutomationLoading, setSelectedAutomationLoading] = useState(false)
  const {
    draftModalState,
    isDraftSaving,
    saveSkillDraft,
    setDraftModalState,
  } = useDraftReviewActions()

  useEffect(() => {
    setExitingTurnIds([])
    if (
      !pendingScrollTurnIdRef.current ||
      (pendingScrollChatIdRef.current && pendingScrollChatIdRef.current !== activeChatId)
    ) {
      pendingScrollTurnIdRef.current = null
      pendingScrollChatIdRef.current = null
    }
  }, [activeChatId])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const shouldScrollRef = useRef(false)
  const pendingScrollTurnIdRef = useRef<string | null>(null)
  const pendingScrollChatIdRef = useRef<string | null>(null)
  const textareaRef = useRef<MentionInputHandle>(null)
  const {
    mentions,
    setMentions,
    handleMentionsChange,
    personalMentionConfirmationOpen,
    setPersonalMentionConfirmationOpen,
    mentionCategories,
    personMentions,
  } = useChatMentions({ activeWorkspaceId, isPublicShowcase })
  const wasStreamingRef = useRef(false)

  const replaceActiveChatRoute = useCallback(() => {
    if (hideSidebar) return
    const params = new URLSearchParams()
    const view = searchParams.get('view')
    if (view && ['personal', 'workspace-chats', 'dms', 'channels'].includes(view)) params.set('view', view)
    if (searchParams.get('showcase') === '1') params.set('showcase', '1')
    const query = params.toString()
    router.replace(buildWorkspaceHref(activeWorkspaceId, `/app/chat${query ? `?${query}` : ''}`))
  }, [activeWorkspaceId, buildWorkspaceHref, hideSidebar, router, searchParams])

  const {
    activeChatTitle,
    applyUiStateToView,
    exchangeGenTypes,
    exchangeModels,
    exchangeModes,
    generationResults,
    isFirstMessage,
    persistActiveRuntimeUiState,
    resetActiveChatAfterDelete,
    setActiveChatTitle,
    setIsFirstMessage,
    updateRuntimeUiState,
  } = useConversationUiState({
    activeChatId,
    activeChatIdRef,
    applyDefaultChatModelsToView,
    clearTransientComposerState,
    ensureConversationRuntime,
    lastGeneratedImageUrlRef,
    pendingTitleRef,
    replaceActiveChatRoute,
    resetComposerToolIds,
    runtimesRef,
    selectedActModel,
    selectedModels,
    setActiveChatId,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
    setSelectedActModel,
    setSelectedModels,
    setSourcesPanel,
  })

  const {
    automationConversationId,
    automationDetailTab,
    automationIdParam,
    hasAutomationContext,
    idParam,
    invalidateLoadChatRequestRef,
    loadChatRef,
    resetToBlankChatSurface,
    showAutomationChatTab,
    showAutomationHeaderControls,
    syncStandaloneChatUrl,
  } = useChatRouteController({
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
    routerReplace: router.replace,
    searchParams,
    selectedAutomation,
    pendingFirstSendRef,
    setActiveChatId,
    setActiveChatTitle,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
    setPendingRunConversationId,
    setRuntimeHydrationVersion,
    setSourcesPanel,
  })

  useChatListEventSync({
    activeChatIdRef,
    resetActiveChatAfterDelete,
    setActiveChatDeleting,
    setActiveChatTitle,
    setChats,
    setDeletingChatIds,
    updateRuntimeUiState,
  })

  useEffect(() => {
    persistActiveRuntimeUiState()
  }, [persistActiveRuntimeUiState])

  const onRuntimeMessagesChanged = useCallback(() => {
    forceLiveSyncRender((value) => value + 1)
  }, [])

  const activeAskChats = activeRuntime.askChats
  const localStreamActive =
    activeAskChats.some((chat) => chat.status === 'streaming' || chat.status === 'submitted') ||
    actChat.status === 'streaming' ||
    actChat.status === 'submitted'
  const runConversationId = activeChatId ?? pendingRunConversationId
  const agentRunLifecycle = useAgentRunLifecycle({
    conversationId: runConversationId,
    enabled: !isPublicShowcase && Boolean(authUser),
    localStreamActive,
    convexAccessToken,
    enableConvexLiveSync: convexLiveSyncEnabled,
    userId: authUser?.id,
  })
  const {
    liveQueryBridge,
  } = useLiveConversationSync({
    activeChatId,
    activeChatIdRef,
    actChat,
    authUserId: authUser?.id,
    chatInstances,
    completeSession,
    convexAccessToken,
    enableConvexLiveSync: convexLiveSyncEnabled,
    loadChats,
    onRuntimeMessagesChanged,
    runtimeHydrationVersion,
    runActive: agentRunLifecycle.active,
    runtimesRef,
    sessions,
    shouldSyncMessages: agentRunLifecycle.shouldSyncMessages,
  })

  const isActiveLoading = localStreamActive || agentRunLifecycle.active

  useEffect(() => {
    setIsOptimisticLoading(false)
  }, [activeChatId])

  useEffect(() => {
    const run = agentRunLifecycle.run
    const { announce, notice } = resolveAgentRunNotice(previousAgentRunRef.current, run)
    previousAgentRunRef.current = run ? { id: run.id, status: run.status } : null
    if (announce && notice) {
      setComposerNotice(notice)
      return
    }
    setComposerNotice((current) => (
      current === 'Work stopped.' || current?.startsWith('Work failed:')
        ? null
        : current
    ))
  }, [agentRunLifecycle.run])

  // When loadChat finishes it bumps runtimeHydrationVersion. Explicitly sync the
  // runtime's loaded messages to the current useChat instances so the greeting
  // disappears immediately. Using refs avoids stale closures from loadChat.
  useEffect(() => {
    if (!activeChatId || isPublicShowcase) return
    const runtime = runtimesRef.current.get(activeChatId)
    if (!runtime) return
    if (chat0Ref.current.messages !== runtime.askChats[0].messages) {
      chat0Ref.current.setMessages([...runtime.askChats[0].messages] as UIMessage[])
    }
    if (actChatRef.current.messages !== runtime.actChat.messages) {
      actChatRef.current.setMessages([...runtime.actChat.messages] as UIMessage[])
    }
  }, [activeChatId, actChatRef, chat0Ref, isPublicShowcase, runtimeHydrationVersion, runtimesRef])

  const {
    beginHeaderChatRename,
    cancelChatRename,
    commitChatRename,
    editingChatId,
    editingChatTitle,
    headerTitleInputRef,
    markChatModified,
    setEditingChatTitle,
    prefetchFirstMessageTitle,
    startFirstMessageRename,
  } = useChatTitleController({
    activeChatId,
    activeChatIdRef,
    activeChatTitle,
    chats,
    loadChats,
    pendingTitleRef,
    setActiveChatTitle,
    setChats,
    titleGenerationEnabled,
    updateRuntimeUiState,
  })

  const handleGeneratedUiChange = useCallback((messageId: string, partId: string, data: GeneratedUiData) => {
    const patchMessages = (messages: UIMessage[]): { changed: boolean; messages: UIMessage[] } => {
      let changed = false
      const nextMessages = messages.map((message) => {
        const current = message as unknown as { id?: string; parts?: Array<Record<string, unknown>> }
        if (current.id !== messageId || !Array.isArray(current.parts)) return message
        let partsChanged = false
        const nextParts = current.parts.map((part) => {
          if (
            part.type === 'data' &&
            part.id === partId &&
            part.dataType === 'overlay.generated_ui'
          ) {
            partsChanged = true
            return { ...part, data }
          }
          return part
        })
        if (!partsChanged) return message
        changed = true
        return { ...message, parts: nextParts } as UIMessage
      })
      return { changed, messages: changed ? nextMessages : messages }
    }

    const targetChatId = isTemporaryChatRef.current ? TEMPORARY_CHAT_ID : activeChatIdRef.current
    const runtime = isTemporaryChatRef.current
      ? emptyRuntimeRef.current
      : targetChatId
        ? runtimesRef.current.get(targetChatId)
        : null
    if (!runtime) return

    let changed = false
    const actPatch = patchMessages(runtime.actChat.messages as UIMessage[])
    if (actPatch.changed) {
      runtime.actChat.messages = actPatch.messages as never
      changed = true
    }
    const askPatch = patchMessages(runtime.askChats[0].messages as UIMessage[])
    if (askPatch.changed) {
      runtime.askChats[0].messages = askPatch.messages as never
      changed = true
    }
    if (changed) {
      if (isTemporaryChatRef.current || (targetChatId && activeChatIdRef.current === targetChatId)) {
        actChatRef.current.setMessages([...runtime.actChat.messages] as UIMessage[])
        chat0Ref.current.setMessages([...runtime.askChats[0]!.messages] as UIMessage[])
      }
      forceLiveSyncRender((value) => value + 1)
    }

    if (isPublicShowcase || isTemporaryChatRef.current || !targetChatId || targetChatId === TEMPORARY_CHAT_ID) return
    void overlayAppClient.conversations.updateMessageUiPartResponse({
      conversationId: targetChatId,
      messageId,
      partId,
      data,
    }).then((res) => {
      if (res.ok) return
      toast.error('Could not save draft edits.')
    }).catch(() => {
      toast.error('Could not save draft edits.')
    })
  }, [actChatRef, chat0Ref, emptyRuntimeRef, forceLiveSyncRender, isPublicShowcase, isTemporaryChatRef, runtimesRef])

  /** Hide header rename until `loadChat` has applied messages/meta (`runtime.hydrated`). */
  const activeChatHydrated = Boolean(
    activeChatId && runtimesRef.current.get(activeChatId)?.hydrated,
  )

  useEffect(() => {
    if (authLoading) return
    if (initialChats === undefined || (!userId && authUser?.id)) void loadChats()
    if (!isPublicShowcase) void loadSubscription()
  }, [authLoading, authUser?.id, initialChats, isPublicShowcase, loadChats, loadSubscription, userId])

  useEffect(() => {
    if (!activeChatId || isPublicShowcase) return
    const t = window.setTimeout(() => {
      const normalized = normalizeChatModelSelection({
        askModelIds: selectedModels,
        actModelId: selectedActModel,
      })
      void overlayAppClient.conversations.updateResponse({
        conversationId: activeChatId,
        lastMode: 'act',
        askModelIds: normalized.askModelIds,
        actModelId: normalized.actModelId,
      })
    }, 600)
    return () => clearTimeout(t)
  }, [selectedModels, selectedActModel, activeChatId, isPublicShowcase])

  const {
    refreshSelectedAutomation,
    selectAutomationDetailTab,
    saveAutomationHeaderModel,
    automationHeaderModelId,
  } = useAutomationDetail({
    mode,
    automationIdParam,
    activeChatIdRef,
    activeChatId,
    pathname,
    router,
    searchParams,
    selectedAutomation,
    setSelectedAutomation,
    setSelectedAutomationLoading,
    selectedActModel,
    setSelectedActModel,
    setSelectedModels,
    userAskModelOverrideRef,
  })

  const { invalidateLoadChatRequest, loadChat } = useChatConversationLoader({
    activeChatIdRef,
    applyUiStateToView,
    chats,
    clearTransientComposerState,
    conversationSnapshots: publicShowcaseSnapshots,
    ensureConversationRuntime,
    emptyRuntimeRef,
    hasAutomationContext,
    isTemporaryChatRef,
    loadGeneratedOutputs: generatedOutputsEnabled,
    markRead,
    pendingTitleRef,
    persistActiveRuntimeUiState,
    resetComposerToolIds,
    runtimesRef,
    selectedActModel,
    selectedModels,
    setActiveChatId,
    setActiveChatTitle,
    setActiveViewer,
    setChats,
    setComposerNotice,
    setInterruptedExchangeIdx,
    setIsSwitchingChat,
    setIsTemporaryChat,
    setRuntimeHydrationVersion,
    setSourcesPanel,
    shouldScrollRef,
    syncStandaloneChatUrl,
  })

  useEffect(() => {
    loadChatRef.current = loadChat
    invalidateLoadChatRequestRef.current = invalidateLoadChatRequest
  }, [invalidateLoadChatRequest, loadChat, invalidateLoadChatRequestRef, loadChatRef])

  useEffect(() => {
    if (wasStreamingRef.current && !isActiveLoading && chat0.messages.length > 0) {
      loadSubscription()
    }
    wasStreamingRef.current = isActiveLoading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActiveLoading, chat0.messages.length])

  const [prevActiveLoading, setPrevActiveLoading] = useState(isActiveLoading)
  if (prevActiveLoading !== isActiveLoading) {
    setPrevActiveLoading(isActiveLoading)
    if (isActiveLoading) setIsOptimisticLoading(false)
  }

  useEffect(() => {
    if (!isActiveLoading) return
    const lastAssistant = [...actChat.messages].reverse().find((m) => m.role === 'assistant')
    if (!lastAssistant) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = (lastAssistant as any).parts as Array<{ type: string; text?: string }> | undefined
    const hasText = parts?.some((p) => p.type === 'text' && (p.text?.trim().length ?? 0) > 0)
    if (!hasText) return
    tryLogTtftClientFirstText()
  }, [isActiveLoading, actChat.messages, selectedActModel])

  const { isConversationBottomVisible, scrollToConversationBottom } = useConversationBottomVisibility({
    messagesScrollRef,
    messagesEndRef,
    activeChatId,
    actChat,
    chat0,
    isActiveLoading,
    isOptimisticLoading,
    runtimeHydrationVersion,
    isTemporaryChat,
    showAutomationChatTab,
  })
  usePendingTurnScroll({
    messagesScrollRef,
    pendingScrollTurnIdRef,
    pendingScrollChatIdRef,
    shouldScrollRef,
    activeChatId,
    chat0,
    actChat,
    exchangeModesLength: exchangeModes.length,
    generationResultsSize: generationResults.size,
    isActiveLoading,
    isOptimisticLoading,
    runtimeHydrationVersion,
    scrollToConversationBottom,
  })

  const {
    handleModeChange,
    headerModelProps,
    setShowModelPicker,
  } = useChatModelSelectionController({
    activeChatId,
    chatPrefsHydrated,
    gatewayCatalogModels,
    gatewayModelsLoading,
    generationMode,
    isActiveLoading,
    isFreeTier,
    isTemporaryChat,
    reasoning,
    onReasoningChange: setReasoning,
    selectableTextModels,
    selectedActModel,
    selectedImageModels,
    selectedModels,
    selectedVideoModels,
    setGenerationChip,
    setGenerationMode,
    setSelectedActModel,
    setSelectedImageModels,
    setSelectedModels,
    setSelectedVideoModels,
    setVideoSubMode,
    updateSettings,
    userAskModelOverrideRef,
    videoSubMode,
  })

  const { handleRetryExchange } = useChatRetryController({
    activeChatId,
    activeChatIdRef,
    activeChatTitle,
    automationIdParam,
    completeSession,
    ensureConversationRuntime,
    isActiveLoading,
    loadChats,
    loadSubscription,
    mode,
    selectedActModel,
    shouldScrollRef,
    startSession,
  })

  const effectiveGenType = generationChip ?? (generationMode !== 'text' ? generationMode : null)

  const { requireAuth } = useGuestGate()

  const {
    createNewChat,
    handleSend,
  } = useChatSendController({
    activeChatId,
    activeChatIdRef,
    activeChatTitle,
    applyUiStateToView,
    attachedImages,
    authUser,
    automationIdParam,
    clearTransientComposerState,
    completeSession,
    effectiveGenType,
    emptyRuntimeRef,
    ensureConversationRuntime,
    inputRef,
    invalidateLoadChatRequest,
    isActiveLoading,
    isBudgetExhaustedPaid,
    isFirstMessage,
    isFreeTier,
    isSendBlocked,
    isTemporaryChat,
    isTemporaryChatRef,
    loadChats,
    loadSubscription,
    markChatModified,
    memoryEnabled,
    mentions,
    mode,
    pendingChatDocuments,
    pendingScrollChatIdRef,
    pendingScrollTurnIdRef,
    pendingFirstSendRef,
    personalChatMode,
    persistActiveRuntimeUiState,
    refreshSelectedAutomation,
    replaceConversationRuntime,
    replyContext,
    requireAuth,
    resetComposerToolIds,
    reasoning,
    selectedActModel,
    selectedImageModels,
    selectedModels,
    selectedToolIds,
    selectedVideoModels,
    setActiveChatId,
    setActiveViewer,
    setAttachedImages,
    setAttachmentError,
    setChats,
    setComposerNotice,
    setGenerationChip,
    setInput,
    setInterruptedExchangeIdx,
    setIsFirstMessage,
    setIsOptimisticLoading,
    setIsTemporaryChat,
    setMentions,
    setPendingChatDocuments,
    setPendingRunConversationId,
    setReplyContext,
    setRuntimeHydrationVersion,
    prefetchFirstMessageTitle,
    startFirstMessageRename,
    startSession,
    syncStandaloneChatUrl,
    textareaRef,
    updateRuntimeUiState,
    userId,
    videoSubMode,
  })

  const {
    getResponseForExchange,
    beginReplyToAssistantText,
    beginReplyToMediaPrompt,
    jumpToReplyTarget,
    handleTemporaryChatToggle,
    handleBranchConversationAtTurn,
    handleDeleteTurnById,
  } = useChatTurnActions({
    activeRuntime,
    isActiveLoading,
    setReplyContext,
    textareaRef,
    ensureConversationRuntime,
    activeChatIdRef,
    chatInstances,
    actChat,
    applyUiStateToView,
    setRuntimeHydrationVersion,
    resetToBlankChatSurface,
    isTemporaryChat,
    activeChatId,
    setIsSwitchingChat,
    createNewChat,
    loadChat,
    runtimesRef,
    activeChatTitle,
    setExitingTurnIds,
  })

  const { workApprovalContent } = useWorkApproval({
    agentRunLifecycle,
    activeChatId: runConversationId,
  })

  const {
    activeChat,
    primaryMessages,
    hasHistory,
    showChatLoadingState,
    showCenteredEmptyChat,
    reserveLatestExchangeStartSpace,
    showScrollToBottomControl,
    latestExchIdx,
    greetingLine,
    emptyComposerContent,
    usageExhaustedNotice,
    headerTitleLabel,
  } = buildChatDerivedView({
    chats,
    activeChatId,
    activeRuntime,
    generationResults,
    idParam,
    automationConversationId,
    showAutomationChatTab,
    activeChatHydrated,
    isActiveLoading,
    isOptimisticLoading,
    isConversationBottomVisible,
    composerMode,
    firstName,
    mode,
    selectedAutomation,
    belowEmptyComposer,
    isBudgetExhaustedPaid,
    isTemporaryChat,
    activeChatTitle,
  })

  const {
    effectiveHandleSend,
    handlePersonalChatModeChange,
    handleGenerationModeChange,
    handleGenerationChipChange,
    handleEmptySuggestion,
    handleAutomateSuggestion,
    handleCreateAutomationDraftViaChat,
  } = useComposerActions({
    isPublicShowcase,
    requireAuth,
    personMentions,
    setPersonalMentionConfirmationOpen,
    handleSend,
    setDraftModalState,
    setGenerationMode,
    setGenerationChip,
    setInput,
    textareaRef,
    personalChatMode,
    setPersonalChatMode,
    handleModeChange,
    setSelectedToolIds,
    autoContinueEnabled: settings.autoContinue,
    activeChatId,
    primaryMessages,
    isActiveLoading,
    setShowModelPicker,
  })

  const getActiveRuntimeForStop = useCallback(() => activeRuntime, [activeRuntime])
  const {
    handleContinue,
    stopActiveChat,
  } = useChatStopController({
    activeAskChats,
    activeChatId,
    activeChatIdRef,
    actChat,
    chat0,
    forceLiveSyncRender: onRuntimeMessagesChanged,
    getActiveRuntime: getActiveRuntimeForStop,
    isActiveLoading,
    onSend: effectiveHandleSend,
    primaryMessages,
    replaceConversationRuntime,
    runtimesRef,
    setInput,
    setInterruptedExchangeIdx,
  })

  return {
    chats,
    favoriteScope: authUser?.id ?? userId,
    activeChatId,
    activeChatHydrated,
    idParam,
    automationConversationId,
    automationIdParam,
    hasAutomationContext,
    showAutomationChatTab,
    showAutomationHeaderControls,
    automationDetailTab,
    isTemporaryChat,
    isPublicShowcase,
    mode,
    composerMode,
    generationMode,
    generationChip,
    personalChatMode,
    selectedModels,
    selectedImageModels,
    selectedVideoModels,
    automationHeaderModelId,
    automationHeaderModels: selectableTextModels,
    saveAutomationHeaderModel,
    selectAutomationDetailTab,
    headerModelProps,
    selectedAutomation,
    selectedAutomationLoading,
    setSelectedAutomation,
    actChat,
    chatInstances,
    exchangeGenTypes,
    exchangeModels,
    exchangeModes,
    generationResults,
    activeChatTitle,
    editingChatId,
    editingChatTitle,
    setEditingChatTitle,
    commitChatRename,
    cancelChatRename,
    headerTitleInputRef,
    beginHeaderChatRename,
    isActiveLoading,
    isOptimisticLoading,
    interruptedExchangeIdx,
    exitingTurnIds,
    isConversationBottomVisible,
    scrollToConversationBottom,
    messagesEndRef,
    messagesScrollRef,
    activeChat,
    primaryMessages,
    hasHistory,
    showChatLoadingState,
    showCenteredEmptyChat,
    reserveLatestExchangeStartSpace,
    showScrollToBottomControl,
    latestExchIdx,
    greetingLine,
    emptyComposerContent,
    usageExhaustedNotice,
    headerTitleLabel,
    input,
    inputRef,
    inputRevision,
    handleComposerInputChange,
    hasComposerText,
    textareaRef,
    setQuestionnaireDraft: (value: string) => { setInput(value); textareaRef.current?.focus() },
    subscribeToInput,
    replyContext,
    setReplyContext,
    composerNotice,
    showAttachMenu,
    setShowAttachMenu,
    attachMenuRef,
    showModeMenu,
    setShowModeMenu,
    modeMenuRef,
    selectedToolIds,
    memoryEnabled,
    setMemoryEnabled,
    toggleComposerTool,
    removeComposerTool,
    mentionCategories,
    personalMentionConfirmationOpen,
    setPersonalMentionConfirmationOpen,
    personMentions,
    handleMentionsChange,
    activeWorkspaceId,
    attachedImages,
    setAttachedImages,
    pendingChatDocuments,
    removePendingDocument,
    attachmentError,
    fileInputRef,
    docInputRef,
    addImages,
    addDocumentsFromPicker,
    queueDocumentUpload,
    handlePaste,
    dragCounterRef,
    isDragging,
    setIsDragging,
    isFreeTier,
    isBudgetExhaustedPaid,
    isSendBlocked,
    workApprovalContent,
    draftModalState,
    isDraftSaving,
    setDraftModalState,
    saveSkillDraft,
    effectiveHandleSend,
    handlePersonalChatModeChange,
    handleGenerationModeChange,
    handleGenerationChipChange,
    handleEmptySuggestion,
    handleAutomateSuggestion,
    handleCreateAutomationDraftViaChat,
    getResponseForExchange,
    jumpToReplyTarget,
    beginReplyToMediaPrompt,
    beginReplyToAssistantText,
    handleBranchConversationAtTurn,
    handleTemporaryChatToggle,
    handleDeleteTurnById,
    handleRetryExchange,
    handleContinue,
    stopActiveChat,
    handleGeneratedUiChange,
    requireAuth,
    shellPanelInputs: {
      attachmentPreview,
      attachmentPreviewMode,
      closeAttachmentPreview,
      closeLinkPreview,
      closeSourcesPanel,
      linkPreview,
      panelPresentation,
      panelWidth,
      setPanelWidth,
      setPanelPresentation,
      setAttachmentPreviewMode,
      sourcesPanel,
    },
    sourcesPanel,
    openSourcesPanel,
    attachmentPreview,
    attachmentPreviewMode,
    setAttachmentPreviewMode,
    closeAttachmentPreview,
    openAttachmentPreview,
    openFilePreview,
    openLinkPreview,
    router,
    pathname,
    searchParams,
    settings,
    capabilities,
    agentRunLifecycle,
    liveQueryBridge,
    activeChatDeleting,
    generatedUiConnectorActions,
    hideSidebar,
    projectName,
    hideHeader,
    belowEmptyComposer,
  }
}

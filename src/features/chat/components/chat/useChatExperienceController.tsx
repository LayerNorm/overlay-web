'use client'

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import { toast } from '@overlay/ui/primitives'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { AutomationDetail } from '@overlay/app-core'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { isTextModelLocked as isWorkspaceTextModelLocked } from '@/components/providers/useWorkspaceTextModelAccess'
import type { ChatModel } from '@/shared/ai/gateway/model-types'
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
import { useNativeThreadSafety } from './useNativeThreadSafety'
import { saveGeneratedUiChange } from './generated-ui-mutation'
import { useChatRouteController } from './useChatRouteController'
import { nativeChatTitleForDisplay } from '@/features/chat/lib/persist-native-chat-title'
import {
  TEMPORARY_CHAT_ID,
  PENDING_FIRST_CHAT_ID,
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
import { usePersonalChat, type PersonalChatSummary } from '@/components/providers/PersonalChatProvider'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import { clearDraft, readDraft, writeDraft } from '@/shared/chat/conversation-drafts'
import { buildNativeThreadHandoff } from '@/shared/chat/native-thread-handoff'
import { agentConversationRedirect } from '@/shared/chat/chat-view-navigation'
import {
  legacyWorkspaceScopeForRoute,
  readWorkspacePathScope,
} from '@/shared/workspaces/routing'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import type { Conversation, ConversationRuntime } from '../chat-interface/types'
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
import { isWorkspaceBillingError } from './usage-exhausted-error'
import {
  showUsageExhaustedToast,
} from './usage-exhausted-toast'

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

}

function isNativePersonalRoute(pathname: string | null, searchParams: Pick<URLSearchParams, 'get' | 'toString'>) {
  const routeScope = readWorkspacePathScope(pathname ?? '') ?? legacyWorkspaceScopeForRoute(
    'chat',
    new URLSearchParams(searchParams.toString()),
  )
  return routeScope !== 'workspace'
    && !['workspace-chats', 'dms', 'channels'].includes(searchParams.get('view') ?? '')
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

}: ChatExperienceProps) {
  recordRender('ChatExperience')
  const router = useRouter()
  const onUsageExhaustedError = useCallback((message: string) => {
    if (!isWorkspaceBillingError(message)) return false
    showUsageExhaustedToast(router)
    return true
  }, [router])
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const buildWorkspaceHref = useWorkspaceHref()

  const { settings, updateSettings } = useAppSettings()
  const { user: authUser, isLoading: authLoading } = useAuth()
  const gatewayCatalogEnabled = shouldLoadGatewayModelCatalog({
    isAuthenticated: Boolean(authUser),
    isAuthLoading: authLoading,

  })
  const { appDataCapabilities, capabilities } = useOverlayCapabilities()
  const {
    models: gatewayCatalogModels,
    isLoading: gatewayModelsLoading,
    revision: gatewayCatalogRevision,
  } = useGatewayModelCatalog({ enabled: gatewayCatalogEnabled })
  const { activeWorkspaceId } = useWorkspace()
  const nativePersonal = usePersonalChat()
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
  const convexLiveSyncEnabled = appDataCapabilities.requiresConvexClient && appDataCapabilities.supportsRealtime
  const titleGenerationEnabled = appDataCapabilities.supportsChatPersistence
  const generatedOutputsEnabled = true
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
  const nativePersonalEnabled = nativePersonal.configured
    && (Boolean(userId) || authLoading)
    && mode === 'chat'
  const nativePersonalRoute = nativePersonalEnabled && isNativePersonalRoute(pathname, searchParams)

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
    nativePersonalChats: nativePersonal.active.rows,
    nativeSelectedSummary: nativePersonal.selectedSummary,
    nativePersonalEnabled,
    nativePersonalRoute,
    allowLegacyMixedList: searchParams.get('view') === 'all',
    workspaceId: nativePersonal.configured ? nativePersonal.workspaceId : activeWorkspaceId,
    userId,
  })
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const nativePersonalChatIds = useMemo(() => new Set<string>([
    ...nativePersonal.active.rows.map((chat) => chat._id),
    ...nativePersonal.archived.rows.map((chat) => chat._id),
    ...(nativePersonal.selectedSummary ? [nativePersonal.selectedSummary._id] : []),
  ]), [nativePersonal.active.rows, nativePersonal.archived.rows, nativePersonal.selectedSummary])
  const isNativePersonalChat = useCallback((chatId: string) => (
    nativePersonalChatIds.has(chatId)
    || (
      nativePersonalRoute
      && searchParams.get('id') === chatId
      && (
        nativePersonal.selectedConversationId !== chatId
        || nativePersonal.selectedSummary !== null
      )
    )
  ), [
    nativePersonal.selectedConversationId,
    nativePersonal.selectedSummary,
    nativePersonalChatIds,
    nativePersonalRoute,
    searchParams,
  ])
  const getNativePersonalSummary = useCallback((chatId: string) => (
    nativePersonal.selectedSummary?._id === chatId
      ? nativePersonal.selectedSummary
      : nativePersonal.active.rows.find((chat) => chat._id === chatId)
        ?? nativePersonal.archived.rows.find((chat) => chat._id === chatId)
  ), [nativePersonal.active.rows, nativePersonal.archived.rows, nativePersonal.selectedSummary])
  const setNativePersonalRead = nativePersonal.setRead
  const markNativePersonalRead = useCallback((
    summary: PersonalChatSummary,
    throughMessageId: string,
  ) => {
    if (!summary.unread) return
    void setNativePersonalRead(
      summary,
      false,
      throughMessageId as Id<'conversationMessages'>,
    ).catch(() => toast.error('Could not mark chat as read.'))
  }, [setNativePersonalRead])
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
    generationChip,
    setGenerationChip,
    selectedImageModels,
    setSelectedImageModels,
    selectedVideoModels,
    setSelectedVideoModels,
    videoSubMode,
    setVideoSubMode,
    lastGeneratedImageUrlRef,
    reasoningByModel,
    setReasoning,
    onModelReasoningChange,
  } = useChatPreferences({ activeChatId, activeWorkspaceId, isTemporaryChat })
  const [, setIsSwitchingChat] = useState(false)
  const generatedUiConnectorActions = useGeneratedUiConnectorActions({ enabled: capabilities.integrations })

  const [isDragging, setIsDragging] = useState(false)
  const nativeThreadSafety = useNativeThreadSafety({
    conversationId: isTemporaryChat || activeChatId === PENDING_FIRST_CHAT_ID ? null : activeChatId,
    workspaceId: activeWorkspaceId,
  })
  const {
    handleComposerInputChange,
    hasComposerText,
    input,
    inputRef,
    inputRevision,
    setInput,
    subscribeToInput,
  } = useComposerTextState(nativeThreadSafety.readOnly)

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
  const [upgradeModel, setUpgradeModel] = useState<Pick<ChatModel, 'name'> | null>(null)
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
    connectionUnavailable,
    isBudgetExhaustedPaid,
    isModelAccessRestricted,
    isSendBlocked,
    loadSubscription,
    premiumModelBlocked,
    pickerTextModels,
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
  const isPickerTextModelLocked = useCallback(
    (modelId: string) => isWorkspaceTextModelLocked(modelId, isModelAccessRestricted),
    [isModelAccessRestricted],
  )
  const {
    applyDefaultChatModelsToView,
  } = useChatModelDefaults({
    settings,
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
  } = useChatMentions({ activeWorkspaceId,  })
  const wasStreamingRef = useRef(false)

  const replaceActiveChatRoute = useCallback(() => {
    if (hideSidebar) return
    const params = new URLSearchParams()
    const view = searchParams.get('view')
    if (view && ['personal', 'workspace-chats', 'dms', 'channels'].includes(view)) params.set('view', view)

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
    canonicalChatTitle: nativePersonalRoute ? nativePersonal.selectedSummary : null,
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

  const displayedActiveChatTitle = activeChatId
    ? nativeChatTitleForDisplay(
      isNativePersonalChat(activeChatId),
      getNativePersonalSummary(activeChatId)?.title,
      activeChatTitle,
    )
    : activeChatTitle

  useEffect(() => {
    const summary = nativePersonal.selectedSummary
    if (!nativePersonalRoute || !summary || summary._id !== activeChatId
      || !summary.unread || !summary.lastMessageId) return
    const runtime = runtimesRef.current.get(summary._id)
    if (!runtime) return
    const loadedMessages = [
      ...runtime.askChats[0].messages,
      ...runtime.actChat.messages,
    ]
    if (loadedMessages.some((message) => message.id === summary.lastMessageId)) {
      markNativePersonalRead(summary, summary.lastMessageId)
    }
  }, [
    activeChatId,
    markNativePersonalRead,
    nativePersonal.selectedSummary,
    nativePersonalRoute,
    runtimeHydrationVersion,
    runtimesRef,
  ])

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
    nativePersonalIds: nativePersonalChatIds,
    nativePersonalRoute,
    isNativePersonalChat,
    nativePersonalEnabled,
    workspaceId: nativePersonal.configured ? nativePersonal.workspaceId : activeWorkspaceId,
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
    enabled: Boolean(authUser),
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
    if (!activeChatId) return
    const runtime = runtimesRef.current.get(activeChatId)
    if (!runtime) return
    if (chat0Ref.current.messages !== runtime.askChats[0].messages) {
      chat0Ref.current.setMessages([...runtime.askChats[0].messages] as UIMessage[])
    }
    if (actChatRef.current.messages !== runtime.actChat.messages) {
      actChatRef.current.setMessages([...runtime.actChat.messages] as UIMessage[])
    }
  }, [activeChatId, actChatRef, chat0Ref,  runtimeHydrationVersion, runtimesRef])

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
    activeChatTitle: displayedActiveChatTitle,
    chats,
    isNativePersonalChat,
    loadChats,
    renameNative: nativePersonal.rename,
    pendingTitleRef,
    setActiveChatTitle,
    setChats,
    titleGenerationEnabled,
    updateRuntimeUiState,
  })

  const isRuntimeCurrent = useCallback((chatId: string, runtime: ConversationRuntime) => (
    runtimesRef.current.get(chatId) === runtime
  ), [runtimesRef])

  const handleGeneratedUiChange = useCallback(async (messageId: string, partId: string, data: GeneratedUiData) => {
    if (nativeThreadSafety.readOnly) return
    const targetChatId = isTemporaryChatRef.current ? TEMPORARY_CHAT_ID : activeChatIdRef.current
    const runtime = isTemporaryChatRef.current
      ? emptyRuntimeRef.current
      : targetChatId
        ? runtimesRef.current.get(targetChatId)
        : null
    if (!runtime) return

    let changed = false
    try {
      changed = await saveGeneratedUiChange({
        conversationId: targetChatId === TEMPORARY_CHAT_ID ? null : targetChatId,
        runtime, messageId, partId, data,
        isCurrent: () => targetChatId === TEMPORARY_CHAT_ID
          ? emptyRuntimeRef.current === runtime
          : Boolean(targetChatId && runtimesRef.current.get(targetChatId) === runtime),
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save draft edits.')
      return
    }
    if (changed) {
      if (targetChatId === (isTemporaryChatRef.current ? TEMPORARY_CHAT_ID : activeChatIdRef.current)) {
        actChatRef.current.setMessages([...runtime.actChat.messages] as UIMessage[])
        chat0Ref.current.setMessages([...runtime.askChats[0]!.messages] as UIMessage[])
      }
      forceLiveSyncRender((value) => value + 1)
    }

  }, [actChatRef, chat0Ref, emptyRuntimeRef, forceLiveSyncRender, isTemporaryChatRef, nativeThreadSafety.readOnly, runtimesRef])

  /** Hide header rename until `loadChat` has applied messages/meta (`runtime.hydrated`). */
  const activeChatHydrated = Boolean(
    activeChatId && runtimesRef.current.get(activeChatId)?.hydrated,
  )
  useEffect(() => {
    if (
      searchParams.get('handoff') !== '1'
      || !activeChatId
      || !activeChatHydrated
      || !authUser
      || nativeThreadSafety.status !== 'writable'
      || !nativeThreadSafety.isCurrentScope()
      || inputRef.current.trim()
    ) return
    const draftScope = { workspaceId: activeWorkspaceId, conversationId: activeChatId }
    const handoff = readDraft(draftScope)
    if (handoff) {
      setInput(handoff)
      textareaRef.current?.focus()
      clearDraft(draftScope)
    }
    const params = new URLSearchParams(searchParams.toString())
    params.delete('handoff')
    router.replace(`${pathname}?${params.toString()}`)
  }, [
    activeChatHydrated,
    activeChatId,
    activeWorkspaceId,
    authUser,
    nativeThreadSafety,
    pathname,
    router,
    searchParams,
    setInput,
  ])

  useEffect(() => {
    if (authLoading) return
    if (initialChats === undefined || (!userId && authUser?.id)) void loadChats()
    void loadSubscription()
  }, [authLoading, authUser?.id, initialChats,  loadChats, loadSubscription, userId])

  useEffect(() => {
    if (!activeChatId) return
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
  }, [selectedModels, selectedActModel, activeChatId, ])

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
    ensureConversationRuntime,
    emptyRuntimeRef,
    getNativeSummary: getNativePersonalSummary,
    hasAutomationContext,
    isNativePersonalChat,
    isTemporaryChatRef,
    loadGeneratedOutputs: generatedOutputsEnabled,
    markRead,
    markNativeRead: markNativePersonalRead,
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
    isTemporaryChat,
    reasoningByModel,
    onReasoningChange: setReasoning,
    onModelReasoningChange,
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
    nativeThreadReadOnly: nativeThreadSafety.readOnly,
    ensureWritable: nativeThreadSafety.ensureWritable,
    isCurrentScope: nativeThreadSafety.isCurrentScope,
    isRuntimeCurrent,
    activeChatId,
    activeChatIdRef,
    activeChatTitle: displayedActiveChatTitle,
    automationIdParam,
    completeSession,
    ensureConversationRuntime,
    isActiveLoading,
    loadChats,
    loadSubscription,
    mode,
    onUsageExhaustedError,
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
    nativeThreadReadOnly: nativeThreadSafety.readOnly,
    ensureWritable: nativeThreadSafety.ensureWritable,
    isCurrentScope: nativeThreadSafety.isCurrentScope,
    activeChatId,
    activeChatIdRef,
    activeChatTitle: displayedActiveChatTitle,
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
    isSendBlocked,
    connectionUnavailable,
    premiumModelBlocked,
    isTemporaryChat,
    isTemporaryChatRef,
    loadChats,
    loadSubscription,
    nativePersonalEnabled,
    onUsageExhaustedError,
    markChatModified,
    memoryEnabled,
    mentions,
    mode,
    pendingChatDocuments,
    pendingScrollChatIdRef,
    pendingScrollTurnIdRef,
    pendingFirstSendRef,
    persistActiveRuntimeUiState,
    refreshSelectedAutomation,
    replaceConversationRuntime,
    replyContext,
    requireAuth,
    resetComposerToolIds,
    reasoningByModel,
    reasoningModels: pickerTextModels,
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
    workspaceId: nativePersonal.configured ? nativePersonal.workspaceId : activeWorkspaceId,
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
    nativeThreadReadOnly: nativeThreadSafety.readOnly,
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
    activeChatTitle: displayedActiveChatTitle,
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
    activeChatTitle: displayedActiveChatTitle,
  })

  const {
    effectiveHandleSend,
    handleGenerationModeChange,
    handleGenerationChipChange,
    handleEmptySuggestion,
    handleAutomateSuggestion,
    handleCreateAutomationDraftViaChat,
  } = useComposerActions({

    requireAuth,
    personMentions,
    setPersonalMentionConfirmationOpen,
    handleSend,
    setDraftModalState,
    setGenerationMode,
    setGenerationChip,
    setInput,
    textareaRef,
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
    activeChatId: runConversationId,
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

  const startNewNativeThread = useCallback(async () => {
    if (!nativeThreadSafety.readOnly) {
      resetToBlankChatSurface({ temporary: false })
      setInput('')
      textareaRef.current?.focus()
      return
    }
    if (nativeThreadSafety.status !== 'retired') return
    const sourceConversationId = activeChatIdRef.current
    const sourceMessages = sourceConversationId ? primaryMessages : []
    const outputIds = [...generationResults.values()]
      .flat()
      .filter((result) => result.status === 'completed' && result.outputId)
      .map((result) => result.outputId!)
    const handoff = buildNativeThreadHandoff({
      conversationId: sourceConversationId ?? 'temporary',
      messages: sourceMessages,
      files: outputIds.map((id) => ({ id })),
    })
    const agentId = nativeThreadSafety.agentId
    if (agentId && activeWorkspaceId) {
      const { thread: next } = await overlayAppClient.agents.createThread(activeWorkspaceId, agentId, {})
      if (!nativeThreadSafety.isCurrentScope()) return
      writeDraft({ workspaceId: activeWorkspaceId, conversationId: next.conversationId }, handoff)
      dispatchChatCreated({ chat: {
        _id: next.conversationId, title: next.title, lastModified: Date.now(), conversationType: 'dm',
      } })
      const params = new URLSearchParams(window.location.search)
      params.set('id', next.conversationId)
      params.set('handoff', '1')
      params.delete('message')
      params.delete('draft')
      const agentRoute = agentConversationRedirect({
        pathname,
        workspaceId: activeWorkspaceId,
        agentId,
        conversationId: next.conversationId,
        guided: false,
      })
      if (agentRoute) {
        const target = new URL(agentRoute, window.location.origin)
        target.searchParams.set('handoff', '1')
        router.push(`${target.pathname}?${target.searchParams.toString()}`)
      } else {
        router.push(`${pathname}?${params.toString()}`)
      }
      return
    }
    resetToBlankChatSurface({ temporary: false })
    setInput(handoff)
    textareaRef.current?.focus()
  }, [
    activeChatIdRef,
    activeWorkspaceId,
    generationResults,
    nativeThreadSafety,
    pathname,
    primaryMessages,
    resetToBlankChatSurface,
    router,
    setInput,
    textareaRef,
    ])

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

    mode,
    composerMode,
    generationMode,
    generationChip,
    selectedModels,
    selectedImageModels,
    selectedVideoModels,
    automationHeaderModelId,
    automationHeaderModels: selectableTextModels,
    pickerTextModels,
    isTextModelLocked: isPickerTextModelLocked,
    upgradeModel,
    setUpgradeModel,
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
    activeChatTitle: displayedActiveChatTitle,
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
    setInput,
    handleComposerInputChange,
    hasComposerText,
    textareaRef,
    setQuestionnaireDraft: (value: string) => { setInput(value); textareaRef.current?.focus() },
    subscribeToInput,
    replyContext,
    setReplyContext,
    composerNotice,
    nativeThreadSafety,
    startNewNativeThread,
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
    isBudgetExhaustedPaid,
    isSendBlocked,
    connectionUnavailable,
    premiumModelBlocked,
    workApprovalContent,
    draftModalState,
    isDraftSaving,
    setDraftModalState,
    saveSkillDraft,
    effectiveHandleSend,
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

'use client'

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  ChevronDown,
} from 'lucide-react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import {
  createConversationUiState,
  sameModelOrder,
} from '@overlay/chat-core'
import { UsageExhaustedNotice } from '@overlay/chat-react'
import type { AutomationDetail, AutomationDetailTab } from '@overlay/app-core'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import {
  DEFAULT_MODEL_ID,
  type GenerationMode,
} from '@/shared/ai/gateway/model-types'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'
import {
  defaultChatToolRequestIds,
  defaultMemoryEnabled,
  type ChatToolRequestId,
} from '@/shared/chat/tool-requests'
import { ChatExperienceView } from './ChatExperienceView'
import { useChatListEventSync } from './chat/useChatListEventSync'
import { usePostgresConversationEvents } from './chat/usePostgresConversationEvents'
import { useChatAttachments } from './useChatAttachments'
import { useChatBillingControls } from './chat/useChatBillingControls'
import { useDraftReviewActions } from './chat/useDraftReviewActions'
import type { EmptyAutomateSuggestionId, EmptyChatSuggestionId } from './ChatEmptyState'
import { useChatPreferences } from './chat/useChatPreferences'
import { safeSetLocalStorage } from './chat/model-selection-utils'
import { useChatPanels, type AttachmentPreview } from './chat/useChatPanels'
import { useChatShellPanels } from './chat/useChatShellPanels'
import { useChatConversationLoader } from './chat/useChatConversationLoader'
import { useConversationUiState } from './chat/useConversationUiState'
import { useChatListController } from './chat/useChatListController'
import { useChatModelSelectionController } from './chat/useChatModelSelectionController'
import { useChatRetryController } from './chat/useChatRetryController'
import { useChatRouteController } from './chat/useChatRouteController'
import {
  TEMPORARY_CHAT_ID,
  useChatSendController,
} from './chat/useChatSendController'
import { useChatStopController } from './chat/useChatStopController'
import { useChatTitleController } from './chat/useChatTitleController'
import { useLiveConversationSync } from './chat/useLiveConversationSync'
import { useAgentRunLifecycle } from './chat/useAgentRunLifecycle'
import {
  getResponseForExchangeForModel as selectResponseForExchangeForModel,
  removeTurnFromConversationRuntime,
} from './chat/chat-runtime-helpers'
import { useChatRuntimes } from './chat/useChatRuntimes'
import { useComposerTextState } from './chat/useComposerTextState'
import {
  type ChatListPageInfo,
} from '@/shared/chat/chat-list-cache'
import { TEMPORARY_CHAT_UI_EVENT } from '@/shared/chat/temporary-chat-ui'
import {
  tryLogTtftClientFirstText,
} from '@/shared/chat/ttft-client-debug'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'
import { DelayedTooltip } from './DelayedTooltip'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { shouldLoadGatewayModelCatalog } from '@/shared/ai/gateway/catalog-access'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { buildSharePageUrl } from '@/features/share/lib/share-url'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { createIdempotencyKey } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import { useAuth } from '@/contexts/AuthContext'
import { useConvexAuthToken } from '@/components/providers/ConvexAuthProvider'
import { useGeneratedUiConnectorActions } from './chat/useGeneratedUiConnectorActions'
import {
  CHAT_GEN_MODE_KEY,
  DEFAULT_CHAT_TITLE,
  PERSONAL_CHAT_MODE_KEY,
} from './chat-interface/constants'
import type { PersonalChatMode } from '@overlay/ui/chat'
import {
  assistantBlocksToPlainText,
  buildAssistantVisualSequence,
  chatGreetingLine,
} from '@overlay/chat-core'
import { scrollToExchangeTurn } from '@/features/chat/lib/scroll-to-exchange-turn'
import type {
  AskModelSelectionMode,
  Conversation,
  ConversationUiState,
} from './chat-interface/types'
import type { MentionInputHandle } from './chat-interface/MentionInput'
import type { MentionCategory, MentionItem } from '@/shared/knowledge/mention-types'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { PersonalMentionConversionPrompt } from './PersonalMentionConversionPrompt'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import type { ConversationLoadSnapshot } from './chat/chatTransport'

// Heavy, conditionally-rendered surfaces are code-split out of the initial chat
// bundle. They only mount on specific interactions (billing top-up, export,
// file/attachment preview, draft review, automation editing).
//
// Each MUST pass a `loading` option: next/dynamic only wraps the lazy component
// in its own <Suspense> boundary when `ssr: false` or `loading` is set
// (otherwise it uses a Fragment). Without a local boundary, the chunk's
// first-load suspension bubbles up to ChatSuspenseBoundary and replaces the
// entire chat with its (headerless) fallback — i.e. the chat appears to reload
// when you open an image or send the first message.
// NB: the options must be an inline object literal — next/dynamic's SWC
// transform rejects a shared/referenced options variable.
const FileViewerPanel = dynamic(
  () => import('@overlay/modules-react/knowledge').then((mod) => ({ default: mod.FileViewerPanel })),
  { loading: () => null },
)
const ExportMenu = dynamic(
  () => import('@/features/files/components/ExportMenu').then((mod) => ({ default: mod.ExportMenu })),
  { loading: () => null },
)
const EMPTY_UI_MESSAGES: UIMessage[] = []
// ─── main component ───────────────────────────────────────────────────────────

export default function ChatExperience({
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
}: {
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
}) {
  recordRender('ChatExperience')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isPublicShowcase = Boolean(publicShowcaseSnapshots)
  /** When chat is opened inside a project, files/docs attach to this project for search scoping. */
  const rawEmbedProjectId = hideSidebar ? searchParams?.get('projectId')?.trim() ?? null : null
  const embedProjectId =
    rawEmbedProjectId &&
    /^[a-z0-9]+$/i.test(rawEmbedProjectId) &&
    rawEmbedProjectId.length >= 16 &&
    rawEmbedProjectId.length <= 64
      ? rawEmbedProjectId
      : null
  const { settings, updateSettings } = useAppSettings()
  const { user: authUser, isLoading: authLoading } = useAuth()
  const gatewayCatalogEnabled = shouldLoadGatewayModelCatalog({
    isAuthenticated: Boolean(authUser),
    isAuthLoading: authLoading,
    isPublicShowcase,
  })
  const {
    models: gatewayCatalogModels,
    isLoading: gatewayModelsLoading,
    revision: gatewayCatalogRevision,
  } = useGatewayModelCatalog({ enabled: gatewayCatalogEnabled })
  const { appDataCapabilities, capabilities } = useOverlayCapabilities()
  const { activeWorkspaceId } = useWorkspace()
  const billingEnabled = capabilities.billing
  const convexLiveSyncEnabled = !isPublicShowcase &&
    appDataCapabilities.requiresConvexClient && appDataCapabilities.supportsRealtime
  const postgresLiveSyncEnabled = !isPublicShowcase &&
    appDataCapabilities.provider === 'postgres' && appDataCapabilities.supportsRealtime
  const titleGenerationEnabled = !isPublicShowcase && appDataCapabilities.supportsChatPersistence
  const generatedOutputsEnabled = !isPublicShowcase && appDataCapabilities.provider !== 'postgres'
  const convexAccessToken = useConvexAuthToken()
  const { startSession, completeSession, markRead, setActiveViewer, sessions } = useAsyncSessions()
  const activeChatIdRef = useRef<string | null>(null)
  const [isTemporaryChat, setIsTemporaryChat] = useState(false)
  const isTemporaryChatRef = useRef(false)
  isTemporaryChatRef.current = isTemporaryChat
  const composerMode: 'chat' | 'automate' = isTemporaryChat ? 'chat' : mode

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(TEMPORARY_CHAT_UI_EVENT, {
      detail: { active: isTemporaryChat },
    }))
  }, [isTemporaryChat])

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent(TEMPORARY_CHAT_UI_EVENT, {
        detail: { active: false },
      }))
    }
  }, [])
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
    chat1,
    chat2,
    chat3,
    actChat,
    chat0Ref,
    chat1Ref,
    chat2Ref,
    chat3Ref,
    actChatRef,
    chatInstances,
  } = useChatRuntimes(activeChatId)
  const [, forceLiveSyncRender] = useState(0)
  const [runtimeHydrationVersion, setRuntimeHydrationVersion] = useState(0)
  const {
    attachmentPreview,
    attachmentPreviewMode,
    closeAttachmentPreview,
    closeSourcesPanel,
    openAttachmentPreview,
    openFilePreview,
    openSourcesPanel,
    panelPresentation,
    setPanelPresentation,
    setAttachmentPreviewMode,
    setSourcesPanel,
    sourcesPanel,
  } = useChatPanels()

  /** Exchange index where the user pressed Stop; cleared on chat switch / new chat. */
  const [interruptedExchangeIdx, setInterruptedExchangeIdx] = useState<number | null>(null)
  /** When true, account default-model sync must not overwrite single/multi picker mode. */
  const userAskModelOverrideRef = useRef(false)
  const {
    selectedActModel,
    setSelectedActModel,
    selectedModels,
    setSelectedModels,
    askModelSelectionMode,
    setAskModelSelectionMode,
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
    imageModelSelectionMode,
    setImageModelSelectionMode,
    videoModelSelectionMode,
    setVideoModelSelectionMode,
    videoSubMode,
    setVideoSubMode,
    lastGeneratedImageUrlRef,
    reasoning,
    setReasoning,
  } = useChatPreferences()
  const askModelSelectionModeRef = useRef(askModelSelectionMode)
  askModelSelectionModeRef.current = askModelSelectionMode
  const [, setIsSwitchingChat] = useState(false)
  const generatedUiConnectorActions = useGeneratedUiConnectorActions({ enabled: !isPublicShowcase })

  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [selectedToolIds, setSelectedToolIds] = useState<ChatToolRequestId[]>(() =>
    defaultChatToolRequestIds({ temporary: false }),
  )
  const [memoryEnabled, setMemoryEnabled] = useState(() =>
    defaultMemoryEnabled({ temporary: false }),
  )
  const [isDragging, setIsDragging] = useState(false)
  const autoContinuedForMessageRef = useRef<Set<string>>(new Set())
  const {
    handleComposerInputChange,
    hasComposerText,
    input,
    inputRef,
    inputRevision,
    setInput,
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
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)
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
  } = useChatAttachments({ embedProjectId, setComposerNotice })

  const [replyContext, setReplyContext] = useState<{
    snippet: string
    bodyForModel: string
    replyToTurnId?: string
  } | null>(null)
  const clearTransientComposerState = useCallback(() => {
    setPendingChatDocuments([])
    setReplyContext(null)
    setAttachmentError(null)
    setComposerNotice(null)
  }, [setAttachmentError, setPendingChatDocuments])
  const resetComposerToolIds = useCallback((temporary: boolean) => {
    setSelectedToolIds(defaultChatToolRequestIds({ temporary }))
    setMemoryEnabled(defaultMemoryEnabled({ temporary }))
  }, [])
  const toggleComposerTool = useCallback((toolId: ChatToolRequestId) => {
    if (toolId === 'memory') {
      setMemoryEnabled((current) => !current)
      return
    }
    setSelectedToolIds((current) =>
      current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [...current, toolId],
    )
  }, [])
  const removeComposerTool = useCallback((toolId: ChatToolRequestId) => {
    setSelectedToolIds((current) => current.filter((id) => id !== toolId))
  }, [])
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
    chatPrefsHydrated,
    onlyAllowZdrModels: settings.onlyAllowZdrModels,
    enabledModelIds: settings.enabledChatModelIds,
    pathname,
    router,
    searchParams,
    selectedActModel,
    selectedModels,
    setAskModelSelectionMode,
    setComposerNotice,
    setSelectedActModel,
    setSelectedModels,
  })
  const resolveAppDefaultChatModels = useCallback(() => {
    return resolveDefaultChatModelSelection({
      defaultActModelId: settings.defaultActModelId,
      defaultAskModelIds: settings.defaultAskModelIds,
      isFreeTier: billingEnabled ? isFreeTier : false,
      onlyAllowZdrModels: settings.onlyAllowZdrModels,
    })
  }, [
    billingEnabled,
    isFreeTier,
    settings.defaultActModelId,
    settings.defaultAskModelIds,
    settings.onlyAllowZdrModels,
  ])
  const applyDefaultChatModelsToView = useCallback(
    (ui: Partial<ConversationUiState>): ConversationUiState => {
      const { askModelIds, actModelId } = resolveAppDefaultChatModels()
      return createConversationUiState({
        ...ui,
        selectedActModel: actModelId,
        selectedModels: askModelIds,
        askModelSelectionMode: askModelIds.length > 1 ? 'multiple' : 'single',
      })
    },
    [resolveAppDefaultChatModels],
  )
  // Apply account default models on new-chat surfaces when settings load or change,
  // but only if the user has no stored per-session text model preference. Stored
  // preferences win so a single-model user isn\'t forced back into multiple model
  // mode every time they return to personal chat.
  useEffect(() => {
    if (!chatPrefsHydrated || activeChatId || isTemporaryChat) return
    if (userAskModelOverrideRef.current) return
    if (hasStoredTextModelSelection) return

    const { askModelIds, actModelId } = resolveAppDefaultChatModels()
    const modeFromSettings: AskModelSelectionMode =
      askModelIds.length > 1 ? 'multiple' : 'single'
    const currentMode = askModelSelectionModeRef.current

    const modelsMatch =
      sameModelOrder(askModelIds, selectedModels) && actModelId === selectedActModel
    if (modelsMatch) {
      if (currentMode !== modeFromSettings) {
        setAskModelSelectionMode(modeFromSettings)
      }
      return
    }

    setSelectedModels(askModelIds)
    setSelectedActModel(actModelId)
    setAskModelSelectionMode(modeFromSettings)
    // selectedModels/selectedActModel are intentionally excluded: this effect applies
    // account defaults once when the new-chat surface mounts or settings change. Including
    // them creates a feedback loop because the effect itself sets those values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeChatId,
    chatPrefsHydrated,
    hasStoredTextModelSelection,
    isTemporaryChat,
    resolveAppDefaultChatModels,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

  useEffect(() => {
    if (activeChatId || isTemporaryChat) {
      userAskModelOverrideRef.current = false
    }
  }, [activeChatId, isTemporaryChat])
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
  } = useDraftReviewActions({
    embedProjectId,
    setComposerNotice,
  })

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
  const [isConversationBottomVisible, setIsConversationBottomVisible] = useState(true)
  const pendingScrollTurnIdRef = useRef<string | null>(null)
  const pendingScrollChatIdRef = useRef<string | null>(null)
  const textareaRef = useRef<MentionInputHandle>(null)
  const [mentions, setMentions] = useState<MentionItem[]>([])
  const [personalMentionConfirmationOpen, setPersonalMentionConfirmationOpen] = useState(false)
  const [mentionCategories, setMentionCategories] = useState<MentionCategory[]>([])
  // MentionInput emits a fresh mentions array on every keystroke. Bail out when the
  // value is unchanged so plain typing does not push new state / re-render the whole
  // chat experience on each character.
  const handleMentionsChange = useCallback((next: MentionItem[]) => {
    setMentions((prev) => {
      if (prev === next) return prev
      if (prev.length === next.length &&
        prev.every((m, i) => m.type === next[i]!.type && m.id === next[i]!.id && m.name === next[i]!.name)) {
        return prev
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!activeWorkspaceId || isPublicShowcase) {
      setMentionCategories([])
      return
    }
    let cancelled = false
    void Promise.allSettled([
      overlayAppClient.workspaces.management(activeWorkspaceId, 'people'),
      overlayAppClient.workspaces.management(activeWorkspaceId, 'chats-agents'),
      overlayAppClient.knowledgeBases.list(),
    ]).then(([peopleResult, agentsResult, knowledgeResult]) => {
      if (cancelled) return
      const people = peopleResult.status === 'fulfilled'
        ? peopleResult.value
        : { items: [], currentPrincipalId: undefined }
      const agents = agentsResult.status === 'fulfilled' ? agentsResult.value : { items: [] }
      const knowledgeBases = knowledgeResult.status === 'fulfilled'
        ? knowledgeResult.value.knowledgeBases
        : []
      const principals = new Map<string, MentionItem>()
      for (const item of [...people.items, ...agents.items]) {
        if (
          item.kind !== 'member' ||
          !item.principalId ||
          item.principalId === people.currentPrincipalId ||
          item.status !== 'active'
        ) continue
        principals.set(item.principalId, {
          type: 'person',
          id: item.principalId,
          name: item.name,
          description: item.principalType === 'agent' ? 'Agent' : 'Workspace member',
          icon: 'UsersRound',
        })
      }
      const items = [...principals.values()].sort((left, right) => left.name.localeCompare(right.name))
      const bases = knowledgeBases
        .map((base) => ({
          type: 'knowledge' as const,
          id: base.id,
          name: base.title,
          description: base.description || `${base.kind} knowledge base`,
          icon: 'BookOpen',
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
      setMentionCategories([
        ...(items.length ? [{
          type: 'person' as const,
          label: 'Members',
          icon: 'UsersRound',
          items,
        }] : []),
        ...(bases.length ? [{
          type: 'knowledge' as const,
          label: 'Knowledge Bases',
          icon: 'BookOpen',
          items: bases,
        }] : []),
      ])
    }).catch(() => {
      if (!cancelled) setMentionCategories([])
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, isPublicShowcase])

  const personMentions = useMemo(
    () => mentions.filter((mention) => mention.type === 'person'),
    [mentions],
  )

  useEffect(() => {
    if (personalMentionConfirmationOpen && personMentions.length === 0) {
      setPersonalMentionConfirmationOpen(false)
    }
  }, [personalMentionConfirmationOpen, personMentions.length])
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const wasStreamingRef = useRef(false)

  const replaceActiveChatRoute = useCallback(() => {
    if (!hideSidebar) router.replace('/app/chat')
  }, [hideSidebar, router])

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
    selectedTabPerExchange,
    setActiveChatTitle,
    setIsFirstMessage,
    setSelectedTabPerExchange,
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
    setAskModelSelectionMode,
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
    setActiveChatId,
    setActiveChatTitle,
    setActiveViewer,
    setInterruptedExchangeIdx,
    setIsTemporaryChat,
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
  const agentRunLifecycle = useAgentRunLifecycle({
    conversationId: activeChatId,
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
    const failedNotice = agentRunLifecycle.run?.status === 'failed'
      ? `Work failed: ${agentRunLifecycle.run.terminalError?.message ?? 'The run could not be completed.'}`
      : null
    const cancelledNotice = agentRunLifecycle.run?.status === 'cancelled'
      ? 'Work stopped.'
      : null
    if (failedNotice || cancelledNotice) {
      setComposerNotice(failedNotice ?? cancelledNotice)
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
    if (chat1Ref.current.messages !== runtime.askChats[1].messages) {
      chat1Ref.current.setMessages([...runtime.askChats[1].messages] as UIMessage[])
    }
    if (chat2Ref.current.messages !== runtime.askChats[2].messages) {
      chat2Ref.current.setMessages([...runtime.askChats[2].messages] as UIMessage[])
    }
    if (chat3Ref.current.messages !== runtime.askChats[3].messages) {
      chat3Ref.current.setMessages([...runtime.askChats[3].messages] as UIMessage[])
    }
    if (actChatRef.current.messages !== runtime.actChat.messages) {
      actChatRef.current.setMessages([...runtime.actChat.messages] as UIMessage[])
    }
  }, [activeChatId, actChatRef, chat0Ref, chat1Ref, chat2Ref, chat3Ref, isPublicShowcase, runtimeHydrationVersion, runtimesRef])

  const {
    beginHeaderChatRename,
    cancelChatRename,
    commitChatRename,
    editingChatId,
    editingChatTitle,
    headerTitleInputRef,
    markChatModified,
    setEditingChatTitle,
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
    runtime.askChats.forEach((chat) => {
      const patch = patchMessages(chat.messages as UIMessage[])
      if (patch.changed) {
        chat.messages = patch.messages as never
        changed = true
      }
    })
    if (changed) {
      if (isTemporaryChatRef.current || (targetChatId && activeChatIdRef.current === targetChatId)) {
        actChatRef.current.setMessages([...runtime.actChat.messages] as UIMessage[])
        chat0Ref.current.setMessages([...runtime.askChats[0]!.messages] as UIMessage[])
        chat1Ref.current.setMessages([...runtime.askChats[1]!.messages] as UIMessage[])
        chat2Ref.current.setMessages([...runtime.askChats[2]!.messages] as UIMessage[])
        chat3Ref.current.setMessages([...runtime.askChats[3]!.messages] as UIMessage[])
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
      setComposerNotice('Could not save draft edits.')
      window.setTimeout(() => setComposerNotice(null), 4000)
    }).catch(() => {
      setComposerNotice('Could not save draft edits.')
      window.setTimeout(() => setComposerNotice(null), 4000)
    })
  }, [actChatRef, chat0Ref, chat1Ref, chat2Ref, chat3Ref, emptyRuntimeRef, forceLiveSyncRender, isPublicShowcase, runtimesRef])

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

  const automationHeaderModelId = selectedAutomation?.modelId ?? selectedActModel ?? DEFAULT_MODEL_ID

  // Automations must always run with exactly one model. Collapse multi-model selection
  // whenever the user is working inside an automation surface so saved automations and
  // automation-chat runs never inherit a stale multi-model state.
  useEffect(() => {
    if (mode !== 'automate') return
    if (askModelSelectionMode !== 'multiple' && selectedModels.length <= 1) return
    const primary = selectedActModel || selectedModels[0] || DEFAULT_MODEL_ID
    setAskModelSelectionMode('single')
    setSelectedModels([primary])
    setSelectedActModel(primary)
  }, [
    askModelSelectionMode,
    mode,
    selectedActModel,
    selectedModels,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

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

  loadChatRef.current = loadChat

  const reloadActivePostgresConversation = useCallback(async (chatId: string) => {
    if (activeChatIdRef.current !== chatId) return
    await loadChatRef.current?.(chatId, { replaceUrl: false })
  }, [activeChatIdRef, loadChatRef])

  const hasActiveLocalStream = useCallback(() => (
    actChat.status === 'streaming' ||
    actChat.status === 'submitted' ||
    chatInstances.some((chat) => chat.status === 'streaming' || chat.status === 'submitted')
  ), [actChat.status, chatInstances])

  const stopRemotePostgresStream = useCallback(() => {
    actChat.stop()
    for (const chat of chatInstances) chat.stop()
  }, [actChat, chatInstances])

  usePostgresConversationEvents({
    activeChatIdRef,
    enabled: postgresLiveSyncEnabled,
    hasActiveLocalStream,
    loadChats,
    onRemoteStop: stopRemotePostgresStream,
    reloadActiveConversation: reloadActivePostgresConversation,
  })
  invalidateLoadChatRequestRef.current = invalidateLoadChatRequest

  const refreshSelectedAutomation = useCallback(async (options?: {
    showLoading?: boolean
    conversationId?: string
  }) => {
    if (mode !== 'automate') {
      setSelectedAutomation(null)
      setSelectedAutomationLoading(false)
      return
    }
    if (options?.showLoading !== false) setSelectedAutomationLoading(true)
    try {
      let automationId = automationIdParam
      if (!automationId) {
        const conversationId = options?.conversationId ?? activeChatIdRef.current
        if (conversationId) {
          const page = await overlayAppClient.automations.getPage<AutomationDetail>({ limit: 100 })
          const linked = (Array.isArray(page.data) ? page.data : []).find((automation) => (
            automation.sourceConversationId === conversationId
            || automation.conversationId === conversationId
          ))
          if (linked) {
            automationId = linked._id
            setSelectedAutomation(linked)
            const params = new URLSearchParams(searchParams?.toString() ?? '')
            params.set('automationId', linked._id)
            if (!params.get('id')) params.set('id', conversationId)
            const query = params.toString()
            router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
          }
        }
      }
      if (!automationId) {
        setSelectedAutomation(null)
        return
      }
      const res = await overlayAppClient.automations.getResponse({ automationId }, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Failed to load automation')
      const automation = await res.json() as AutomationDetail
      const candidates = [...new Set([
        automation.sourceConversationId,
        automation.conversationId,
      ].filter((value): value is string => Boolean(value)))]
      let resolvedConversationId: string | null = null
      for (const candidate of candidates) {
        const conversationResponse = await overlayAppClient.conversations.getResponse({
          conversationId: candidate,
        }, { cache: 'no-store' }).catch(() => null)
        if (conversationResponse?.ok) {
          resolvedConversationId = candidate
          break
        }
      }
      const validatedAutomation: AutomationDetail = {
        ...automation,
        sourceConversationId:
          resolvedConversationId === automation.sourceConversationId
            ? automation.sourceConversationId
            : undefined,
        conversationId:
          resolvedConversationId === automation.conversationId
            ? automation.conversationId
            : undefined,
      }
      setSelectedAutomation(validatedAutomation)
      const currentId = searchParams?.get('id')
      if (currentId !== resolvedConversationId) {
        const params = new URLSearchParams(searchParams?.toString() ?? '')
        if (resolvedConversationId) params.set('id', resolvedConversationId)
        else params.delete('id')
        params.set('automationId', automation._id)
        const query = params.toString()
        router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
      }
    } catch {
      setSelectedAutomation(null)
    } finally {
      setSelectedAutomationLoading(false)
    }
  }, [activeChatIdRef, automationIdParam, mode, pathname, router, searchParams])

  useEffect(() => {
    void refreshSelectedAutomation()
  }, [refreshSelectedAutomation])

  useEffect(() => {
    if (wasStreamingRef.current && !isActiveLoading && chat0.messages.length > 0) {
      snapshotCurrentAskThreadsForModelPicker()
      loadSubscription()
    }
    wasStreamingRef.current = isActiveLoading
    if (isActiveLoading) setIsOptimisticLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActiveLoading, chat0.messages.length])

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

  useLayoutEffect(() => {
    const turnId = pendingScrollTurnIdRef.current
    if (!turnId || !messagesScrollRef.current) return
    const pendingChatId = pendingScrollChatIdRef.current
    if (pendingChatId && activeChatId !== pendingChatId) return
    const scrollFrame = window.requestAnimationFrame(() => {
      const container = messagesScrollRef.current
      if (!container || pendingScrollTurnIdRef.current !== turnId) return
      const target = container.querySelector<HTMLElement>(
        `[data-exchange-turn="${CSS.escape(turnId)}"]`,
      )
      if (!target) return
      // The shared transcript hook performs the single top-alignment. These
      // refs only suppress the older send-to-bottom path until the optimistic
      // exchange is mounted; streaming updates must never move the viewport.
      pendingScrollTurnIdRef.current = null
      pendingScrollChatIdRef.current = null
    })
    return () => window.cancelAnimationFrame(scrollFrame)
  }, [
    activeChatId,
    chat0.messages,
    actChat.messages,
    exchangeModes.length,
    generationResults.size,
    isActiveLoading,
    isOptimisticLoading,
    runtimeHydrationVersion,
  ])

  const updateConversationBottomVisibility = useCallback(() => {
    const container = messagesScrollRef.current
    const endMarker = messagesEndRef.current
    if (!container || !endMarker) {
      setIsConversationBottomVisible(true)
      return
    }
    const containerRect = container.getBoundingClientRect()
    const markerRect = endMarker.getBoundingClientRect()
    const visible =
      markerRect.top <= containerRect.bottom + 24 &&
      markerRect.bottom >= containerRect.top - 24
    setIsConversationBottomVisible((current) => (current === visible ? current : visible))
  }, [])

  useEffect(() => {
    const container = messagesScrollRef.current
    if (!container) {
      setIsConversationBottomVisible(true)
      return
    }
    let frame = 0
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateConversationBottomVisibility()
      })
    }
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [
    activeChatId,
    isActiveLoading,
    isOptimisticLoading,
    isTemporaryChat,
    runtimeHydrationVersion,
    showAutomationChatTab,
    updateConversationBottomVisibility,
  ])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateConversationBottomVisibility)
    return () => window.cancelAnimationFrame(frame)
  }, [
    actChat.messages.length,
    chat0.messages.length,
    chat1.messages.length,
    chat2.messages.length,
    chat3.messages.length,
    isActiveLoading,
    isOptimisticLoading,
    runtimeHydrationVersion,
    updateConversationBottomVisibility,
  ])

  const scrollToConversationBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const endMarker = messagesEndRef.current
    if (endMarker) {
      endMarker.scrollIntoView({ behavior, block: 'end' })
      window.requestAnimationFrame(updateConversationBottomVisibility)
      return
    }
    const container = messagesScrollRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
    window.requestAnimationFrame(updateConversationBottomVisibility)
  }, [updateConversationBottomVisibility])

  useEffect(() => {
    if (shouldScrollRef.current) {
      if (pendingScrollTurnIdRef.current) {
        shouldScrollRef.current = false
        return
      }
      scrollToConversationBottom('smooth')
      shouldScrollRef.current = false
    }
  }, [chat0.messages.length, actChat.messages.length, scrollToConversationBottom])

  useEffect(() => {
    if (!showAttachMenu) return
    function handleOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node))
        setShowAttachMenu(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showAttachMenu])

  useEffect(() => {
    if (!showModeMenu) return
    function handleOutside(e: MouseEvent) {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node))
        setShowModeMenu(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showModeMenu])

  // Auto-resize is now handled internally by MentionInput

  // ── response lookup ────────────────────────────────────────────────────────

  const getResponseForExchangeForModel = useCallback((
    modelId: string,
    exchIdx: number,
    /** For Act multi-compare, slot order is the exchange's model list, not the global picker. */
    slotOrder?: string[],
  ): UIMessage | null => selectResponseForExchangeForModel({
    modelId,
    exchangeIndex: exchIdx,
    slotOrder,
    selectedModels,
    activeRuntime,
    activeAskChats,
    isActiveLoading,
  }), [activeAskChats, activeRuntime, isActiveLoading, selectedModels])

  // ── stable callbacks ───────────────────────────────────────────────────────

  const handleTabSelect = useCallback((exchIdx: number, tabIdx: number) => {
    setSelectedTabPerExchange((prev) => {
      const next = [...prev]
      next[exchIdx] = tabIdx
      return next
    })
  }, [])

  const beginReplyToAssistantText = useCallback((assistantText: string, targetUserTurnId: string | null) => {
    const t = assistantText.trim()
    if (!t) {
      textareaRef.current?.focus()
      return
    }
    setReplyContext({
      snippet: t.length > 160 ? `${t.slice(0, 160)}…` : t,
      bodyForModel: t.slice(0, 16000),
      ...(targetUserTurnId ? { replyToTurnId: targetUserTurnId } : {}),
    })
    textareaRef.current?.focus()
  }, [])

  const beginReplyToMediaPrompt = useCallback((prompt: string, kind: 'image' | 'video', targetUserTurnId: string | null) => {
    const t = prompt.trim()
    if (!t) {
      textareaRef.current?.focus()
      return
    }
    setReplyContext({
      snippet: t.length > 120 ? `${t.slice(0, 120)}…` : t,
      bodyForModel: `[Prior ${kind} generation request]\n${t.slice(0, 12000)}`,
      ...(targetUserTurnId ? { replyToTurnId: targetUserTurnId } : {}),
    })
    textareaRef.current?.focus()
  }, [])

  const jumpToReplyTarget = useCallback((turnId: string) => {
    scrollToExchangeTurn(turnId)
  }, [])

  const {
    handleModeChange,
    headerModelProps,
    snapshotCurrentAskThreadsForModelPicker,
    setShowModelPicker,
  } = useChatModelSelectionController({
    activeChatId,
    activeChatIdRef,
    activeRuntime,
    askModelSelectionMode,
    chatPrefsHydrated,
    exchangeGenTypes,
    exchangeModels,
    gatewayCatalogModels,
    gatewayModelsLoading,
    generationMode,
    hasAutomationContext,
    imageModelSelectionMode,
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
    setAskModelSelectionMode,
    setGenerationChip,
    setGenerationMode,
    setImageModelSelectionMode,
    setSelectedActModel,
    setSelectedImageModels,
    setSelectedModels,
    setSelectedVideoModels,
    setVideoModelSelectionMode,
    setVideoSubMode,
    updateSettings,
    userAskModelOverrideRef,
    videoModelSelectionMode,
    videoSubMode,
  })

  // ── chat management ────────────────────────────────────────────────────────

  function removeTurnFromRuntime(chatId: string, turnId: string) {
    const runtime = ensureConversationRuntime(chatId)
    const { removedExchangeIndex } = removeTurnFromConversationRuntime(runtime, turnId)

    runtime.askChats.forEach((chat, index) => {
      if (activeChatIdRef.current === chatId && chatInstances[index]) {
        chatInstances[index].setMessages([...chat.messages] as UIMessage[])
      }
    })
    if (activeChatIdRef.current === chatId) {
      actChat.setMessages([...runtime.actChat.messages] as UIMessage[])
    }

    if (removedExchangeIndex >= 0) {
      if (activeChatIdRef.current === chatId) applyUiStateToView(runtime.ui)
    }
    setRuntimeHydrationVersion((value) => value + 1)
  }

  function handleTemporaryChatToggle() {
    if (isActiveLoading) return
    resetToBlankChatSurface({ temporary: !isTemporaryChat })
  }

  async function handleBranchConversationAtTurn(turnId: string | null) {
    const sourceChatId = activeChatIdRef.current ?? activeChatId
    const targetTurnId = turnId?.trim()
    if (!sourceChatId || !targetTurnId || isActiveLoading) return
    try {
      setComposerNotice('Creating branch…')
      setIsSwitchingChat(true)
      const sourceRes = await overlayAppClient.conversations.getResponse({
        conversationId: sourceChatId,
        messages: true,
      })
      if (!sourceRes.ok) throw new Error('Could not load source chat')
      const sourceData = await sourceRes.json() as {
        messages?: Array<{
          turnId?: string
          mode?: 'ask' | 'act'
          role?: 'user' | 'assistant'
          contentType?: 'text' | 'image' | 'video'
          parts?: Array<{ type: string; text?: string; url?: string; mediaType?: string; fileName?: string }>
          model?: string
          variantIndex?: number
          replyToTurnId?: string
          replySnippet?: string
        }>
      }
      const rows: NonNullable<typeof sourceData.messages> = []
      for (const message of sourceData.messages ?? []) {
        rows.push(message)
        if (message.turnId === targetTurnId && message.role === 'assistant') {
          continue
        }
      }
      const targetIdx = rows.findLastIndex((message) => message.turnId === targetTurnId)
      if (targetIdx < 0) throw new Error('Could not find that turn')
      const branchRows = rows.slice(0, targetIdx + 1)
      const branchChatId = await createNewChat({ title: `${activeChatTitle || DEFAULT_CHAT_TITLE} branch` })
      if (!branchChatId) throw new Error('Could not create branch')
      const branchCopyRequestPrefix = createIdempotencyKey()
      for (const [messageIndex, message] of branchRows.entries()) {
        const content = (message.parts ?? [])
          .filter((part) => part.type === 'text' && part.text?.trim())
          .map((part) => part.text!.trim())
          .join('\n\n') || (message.role === 'assistant' ? '[Response]' : '[Message]')
        const parts = (message.parts ?? []).filter((part) => part.type === 'text' || part.type === 'file')
        const res = await overlayAppClient.conversations.addMessageResponse(
          {
            conversationId: branchChatId,
            turnId: message.turnId,
            mode: message.mode ?? 'act',
            role: message.role,
            content,
            parts,
            modelId: message.model,
            contentType: message.contentType ?? 'text',
            variantIndex: message.variantIndex,
            ...(message.replyToTurnId ? { replyToTurnId: message.replyToTurnId, replySnippet: message.replySnippet } : {}),
          },
          {
            idempotencyKey: [
              'branch-copy',
              branchCopyRequestPrefix,
              messageIndex,
              message.role ?? 'unknown',
              message.variantIndex ?? 0,
            ].join(':'),
          },
        )
        if (!res.ok) throw new Error('Could not copy branch messages')
      }
      const branchRuntime = runtimesRef.current.get(branchChatId)
      if (branchRuntime) branchRuntime.hydrated = false
      await loadChat(branchChatId)
      setComposerNotice('Branch created.')
      window.setTimeout(() => setComposerNotice(null), 2500)
    } catch (error) {
      setComposerNotice(error instanceof Error ? error.message : 'Could not create branch')
      window.setTimeout(() => setComposerNotice(null), 5000)
      setIsSwitchingChat(false)
    }
  }

  async function handleDeleteTurnById(turnId: string) {
    const cid = activeChatIdRef.current ?? activeChatId
    if (!cid || !turnId) {
      setComposerNotice('Cannot delete this message right now.')
      window.setTimeout(() => setComposerNotice(null), 4000)
      return
    }
    const EXIT_MS = 300
    setExitingTurnIds((prev) => (prev.includes(turnId) ? prev : [...prev, turnId]))
    await new Promise((r) => window.setTimeout(r, EXIT_MS))
    try {
      const res = await overlayAppClient.conversations.deleteMessageResponse({ conversationId: cid, turnId })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setComposerNotice(payload.error || 'Could not delete this turn.')
        window.setTimeout(() => setComposerNotice(null), 5000)
        return
      }
      removeTurnFromRuntime(cid, turnId)
    } catch {
      setComposerNotice('Could not delete this turn.')
      window.setTimeout(() => setComposerNotice(null), 5000)
    } finally {
      setExitingTurnIds((prev) => prev.filter((id) => id !== turnId))
    }
  }

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
    setComposerNotice,
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
    askModelSelectionMode,
    attachedImages,
    authUser,
    automationIdParam,
    clearTransientComposerState,
    completeSession,
    effectiveGenType,
    embedProjectId,
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
    personalChatMode,
    persistActiveRuntimeUiState,
    refreshSelectedAutomation,
    replaceConversationRuntime,
    replyContext,
    requireAuth,
    resetComposerToolIds,
    reasoning,
    refreshAgentRun: agentRunLifecycle.refresh,
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
    setReplyContext,
    setRuntimeHydrationVersion,
    startFirstMessageRename,
    startSession,
    syncStandaloneChatUrl,
    textareaRef,
    updateRuntimeUiState,
    userId,
    videoSubMode,
  })

  const effectiveHandleSend = useCallback(async () => {
    if (isPublicShowcase) {
      requireAuth('nav')
      return
    }
    if (personMentions.length > 0) {
      setPersonalMentionConfirmationOpen(true)
      return
    }
    await handleSend()
  }, [handleSend, isPublicShowcase, personMentions.length, requireAuth])

  const focusComposer = useCallback(() => {
    window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
  }, [])

  const handlePersonalChatModeChange = useCallback((nextMode: PersonalChatMode) => {
    setPersonalChatMode(nextMode)
    safeSetLocalStorage(PERSONAL_CHAT_MODE_KEY, nextMode)
  }, [setPersonalChatMode])

  const handleGenerationModeChange = useCallback((nextMode: GenerationMode) => {
    if (nextMode !== 'text' && personalChatMode === 'work') {
      handlePersonalChatModeChange('chat')
    }
    handleModeChange(nextMode)
  }, [handleModeChange, handlePersonalChatModeChange, personalChatMode])

  const handleGenerationChipChange = useCallback((chip: 'image' | 'video' | null) => {
    if (chip && personalChatMode === 'work') {
      handlePersonalChatModeChange('chat')
    }
    setGenerationChip(chip)
  }, [handlePersonalChatModeChange, personalChatMode, setGenerationChip])

  const submitWorkApproval = useCallback(async (approved: boolean) => {
    const run = agentRunLifecycle.run
    if (!activeChatId || !run?.approval || run.status !== 'waiting_for_approval') return
    setApprovalSubmitting(true)
    try {
      await overlayAppClient.conversations.submitRunApproval({
        conversationId: activeChatId,
        agentRunId: run.id,
        token: run.approval.token,
        approved,
      })
      await agentRunLifecycle.refresh()
    } catch (error) {
      setComposerNotice(error instanceof Error ? error.message : 'Could not submit approval.')
    } finally {
      setApprovalSubmitting(false)
    }
  }, [activeChatId, agentRunLifecycle])

  const workApprovalContent = agentRunLifecycle.run?.status === 'waiting_for_approval' && agentRunLifecycle.run.approval
    ? (
        <div className="mb-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 shadow-sm">
          <p className="text-sm font-medium text-[var(--foreground)]">Work needs your approval</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {agentRunLifecycle.run.approval.requests.map((request) => request.toolName).join(', ')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={approvalSubmitting}
              onClick={() => void submitWorkApproval(true)}
              className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={approvalSubmitting}
              onClick={() => void submitWorkApproval(false)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </div>
      )
    : undefined

  const handleEmptySuggestion = useCallback(
    (id: EmptyChatSuggestionId) => {
      if (id === 'image') {
        handleGenerationModeChange('image')
        handleGenerationChipChange('image')
        setInput('')
        focusComposer()
        return
      }
      if (id === 'write') {
        handleGenerationModeChange('text')
        setInput('Help me write or edit ')
        focusComposer()
        return
      }
      handleGenerationModeChange('text')
      setSelectedToolIds((current) =>
        current.includes('web_search') ? current : [...current, 'web_search'],
      )
      setInput('Look up ')
      focusComposer()
    },
    [focusComposer, handleGenerationChipChange, handleGenerationModeChange, setInput],
  )

  const handleAutomateSuggestion = useCallback(
    (id: EmptyAutomateSuggestionId) => {
      const prompts: Record<EmptyAutomateSuggestionId, string> = {
        workflow: 'Build a workflow that ',
        monitor: 'Monitor a website and alert me when it changes',
        schedule: 'Schedule a weekly report and send it to my team',
      }
      setInput(prompts[id])
      focusComposer()
    },
    [focusComposer, setInput],
  )

  const isActiveLoadingRef = useRef(isActiveLoading)
  isActiveLoadingRef.current = isActiveLoading

  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey

      if (meta && e.shiftKey && (e.key === '/' || e.key === '?')) {
        e.preventDefault()
        setShowModelPicker((v) => !v)
        return
      }

      if (meta && e.shiftKey && e.key === '.') {
        if (isActiveLoadingRef.current) return
        e.preventDefault()
        setGenerationMode((prev) => {
          const order: GenerationMode[] = ['text', 'image', 'video']
          const i = order.indexOf(prev)
          const next = order[(i + 1) % order.length]!
          safeSetLocalStorage(CHAT_GEN_MODE_KEY, next)
          return next
        })
        setGenerationChip(null)
        return
      }

      if (e.key === '/' && !meta && !e.altKey && !e.shiftKey) {
        const t = e.target as HTMLElement | null
        if (!t) return
        const editorEl = textareaRef.current?.getElement?.()
        if (editorEl && (t === editorEl || editorEl.contains(t))) return
        if (t.closest('input, textarea, select, [contenteditable="true"]')) return
        e.preventDefault()
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true)
  }, [setGenerationChip, setGenerationMode, setShowModelPicker])

  // ── derived values for header ─────────────────────────────────────────────

  const activeChat = chats.find((c) => c._id === activeChatId)

  // Read messages directly from the runtime Chat instance so the UI never lags
  // behind the loaded state (useChat's useSyncExternalStore can be one beat late).
  const primaryMessageSource =
    activeRuntime.askChats.find((chat) => chat.messages.some((message) => message.role === 'user')) ??
    (activeRuntime.actChat.messages.some((message) => message.role === 'user') ? activeRuntime.actChat : activeRuntime.askChats[0])
  const primaryMessages = (primaryMessageSource.messages as UIMessage[] | undefined) ?? EMPTY_UI_MESSAGES
  const hasRuntimeMessages =
    activeRuntime.actChat.messages.some((message) => message.role === 'user') ||
    activeRuntime.askChats.some((chat) => chat.messages.some((message) => message.role === 'user'))
  const hasHistory = hasRuntimeMessages || generationResults.size > 0
  const isExistingConversationView = Boolean(idParam || activeChatId || automationConversationId)
  const showChatLoadingState = showAutomationChatTab && isExistingConversationView && !hasHistory && !activeChatHydrated
  /** Empty chat (any modality): center composer + suggestions only on the true new-chat surface. */
  const showCenteredEmptyChat = !hasHistory && (!isExistingConversationView || activeChatHydrated)
  const reserveLatestExchangeStartSpace = showAutomationChatTab && hasHistory && (isActiveLoading || isOptimisticLoading)
  const showScrollToBottomControl =
    showAutomationChatTab &&
    hasHistory &&
    !showChatLoadingState &&
    !showCenteredEmptyChat &&
    !isConversationBottomVisible
  const userTurnCount = primaryMessages.filter((m) => m.role === 'user').length
  const latestExchIdx = userTurnCount > 0 ? userTurnCount - 1 : -1
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
    chat1,
    chat2,
    chat3,
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

  const handleSendRef = useRef(effectiveHandleSend)
  handleSendRef.current = effectiveHandleSend

  const handleCreateAutomationDraftViaChat = useCallback(async () => {
    if (isActiveLoadingRef.current) return
    setDraftModalState(null)
    setGenerationMode('text')
    setGenerationChip(null)
    setInput('Create automation')
    await new Promise<void>((resolve) => {
      window.setTimeout(() => {
        void handleSendRef.current().finally(resolve)
      }, 0)
    })
  }, [setDraftModalState, setGenerationChip, setGenerationMode, setInput])

  // Auto-continue: when the latest assistant message contains a timeout sentinel
  // and the user has enabled auto-continue, automatically send "continue".
  useEffect(() => {
    if (!settings.autoContinue || !activeChatId) return
    const latestAssistantMsg = [...primaryMessages].reverse().find((m) => {
      const um = m as unknown as { role?: string }
      return um.role === 'assistant'
    })
    if (!latestAssistantMsg) return
    const msgId = (latestAssistantMsg as unknown as { id?: string }).id
    if (!msgId || autoContinuedForMessageRef.current.has(msgId)) return

    const text = assistantBlocksToPlainText(
      buildAssistantVisualSequence(
        (latestAssistantMsg as unknown as { parts?: unknown[] }).parts,
      ),
    )
    if (!/\[Request timed out after \d+s\. Continue\?\]/.test(text)) return
    if ((latestAssistantMsg as unknown as { status?: string }).status !== 'completed') return

    autoContinuedForMessageRef.current.add(msgId)
    const timer = setTimeout(() => {
      setInput('continue')
      void handleSendRef.current()
    }, 1000)
    return () => clearTimeout(timer)
  }, [settings.autoContinue, activeChatId, primaryMessages, setInput])

  // Reset auto-continue tracking when switching chats.
  useEffect(() => {
    autoContinuedForMessageRef.current.clear()
  }, [activeChatId])

  const greetingLine = composerMode === 'automate' ? 'What are we automating today?' : chatGreetingLine(firstName)
  const automationChatIntro = showCenteredEmptyChat && selectedAutomation && !automationConversationId ? (
    <div className="mx-auto mt-5 w-full max-w-[36rem] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-left shadow-sm">
      <p className="text-sm font-medium text-[var(--foreground)]">{selectedAutomation.name || selectedAutomation.title || 'Saved automation'}</p>
      {selectedAutomation.description ? (
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{selectedAutomation.description}</p>
      ) : null}
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-light)]">Saved instructions</p>
        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--foreground)]">{selectedAutomation.instructions}</p>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">Send a message below to continue this automation conversation.</p>
    </div>
  ) : null
  const emptyComposerContent = (
    <>
      {automationChatIntro}
      {belowEmptyComposer}
    </>
  )
  const usageExhaustedNotice = isBudgetExhaustedPaid && !isActiveLoading
    ? <UsageExhaustedNotice />
    : null

  const creatingAutomationDraftRef = useRef(false)
  const selectAutomationDetailTab = useCallback(async (tab: AutomationDetailTab) => {
    // A brand-new automation has no saved doc yet. Switching to "edit" creates an
    // empty draft so the full editor can load and persist, then routes to it.
    if (tab === 'edit' && mode === 'automate' && !automationIdParam && !selectedAutomation) {
      if (creatingAutomationDraftRef.current) return
      creatingAutomationDraftRef.current = true
      try {
        const res = await overlayAppClient.automations.createResponse({
          name: 'New automation',
          description: 'Draft automation',
          instructions: 'Describe what this automation should do.',
          schedule: { kind: 'daily', hourUTC: 14, minuteUTC: 0 },
          modelId: selectedActModel,
          enabled: false,
          ...(embedProjectId ? { projectId: embedProjectId } : {}),
        })
        const payload = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
        if (!res.ok || !payload.id) {
          throw new Error(payload.error || 'Failed to create automation draft')
        }
        const params = new URLSearchParams(searchParams?.toString() ?? '')
        params.set('automationId', payload.id)
        params.set('tab', 'edit')
        router.replace(`${pathname}?${params.toString()}`)
      } catch (error) {
        setComposerNotice(error instanceof Error ? error.message : 'Failed to open automation editor.')
        window.setTimeout(() => setComposerNotice(null), 6000)
      } finally {
        creatingAutomationDraftRef.current = false
      }
      return
    }
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (tab === 'chat') {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    const query = params.toString()
    router.replace(`${pathname}${query ? `?${query}` : ''}`)
  }, [pathname, router, searchParams, mode, automationIdParam, selectedAutomation, selectedActModel, embedProjectId, setComposerNotice])

  const automationHeaderModels = selectableTextModels
  const saveAutomationHeaderModel = useCallback(async (modelId: string) => {
    // Mark the model as user-chosen so the new-chat-surface default-model effect
    // does not immediately reset it back to the account default.
    userAskModelOverrideRef.current = true
    // Always reflect the choice in local model state so a brand-new automation
    // (no saved doc yet) uses it when the automation is created from the first message.
    setSelectedActModel(modelId)
    setSelectedModels([modelId])
    if (!selectedAutomation) return
    const previousAutomation = selectedAutomation
    const nextAutomation = { ...selectedAutomation, modelId }
    setSelectedAutomation(nextAutomation)
    try {
      const res = await overlayAppClient.automations.updateResponse({
        automationId: selectedAutomation._id,
        modelId,
      })
      if (!res.ok) throw new Error('Failed to save automation model')
      if (activeChatId) {
        await overlayAppClient.conversations.updateResponse({
          conversationId: activeChatId,
          actModelId: modelId,
          askModelIds: [modelId],
          lastMode: 'act',
        })
      }
    } catch {
      setSelectedAutomation(previousAutomation)
      const fallbackModelId = previousAutomation.modelId ?? selectedActModel
      setSelectedActModel(fallbackModelId)
      setSelectedModels([fallbackModelId])
    }
  }, [selectedAutomation, activeChatId, selectedActModel, setSelectedActModel, setSelectedModels])

  const headerTitleLabel =
    selectedAutomation?.name ||
    (isTemporaryChat ? 'Temporary chat' : activeChatTitle || activeChat?.title || (mode === 'automate' ? 'New automation' : 'New conversation'))

  const renderExportMenu = useCallback(() => {
    if (selectedAutomation || primaryMessages.length === 0 || (!activeChatId && !isTemporaryChat)) {
      return null
    }
    return (
      <ExportMenu
        className="shrink-0"
        type="chat"
        title={isTemporaryChat ? 'Temporary chat' : activeChatTitle || activeChat?.title || 'New conversation'}
        content={primaryMessages.map((m) => ({
          role: m.role,
          content: (m.parts as Array<{ type: string; text?: string }>)?.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n') ?? '',
          parts: m.parts as Array<{ type: string; text?: string }>,
        }))}
        metadata={{
          createdAt: activeChat?.createdAt,
          updatedAt: activeChat?.updatedAt,
          modelIds: activeChat?.modelIds,
        }}
        resourceId={isTemporaryChat ? undefined : activeChatId ?? undefined}
        initialShareVisibility={activeChat?.shareVisibility ?? 'private'}
        initialShareUrl={
          !isTemporaryChat && activeChat?.shareVisibility === 'public' && activeChat?.shareToken
            ? buildSharePageUrl('chat', activeChat.shareToken)
            : null
        }
        renderShareDialog={(props) => <ShareDialog {...props} />}
      />
    )
  }, [
    activeChat,
    activeChatId,
    activeChatTitle,
    isTemporaryChat,
    primaryMessages,
    selectedAutomation,
  ])

  const renderAttachmentViewer = useCallback(
    ({
      preview,
      headerRight,
    }: {
      preview: AttachmentPreview
      headerRight: React.ReactNode
    }) => (
      <FileViewerPanel
        name={preview.name}
        content={preview.content}
        url={preview.url}
        headerRight={headerRight}
      />
    ),
    [],
  )

  const {
    shellRightPanel,
    shellRightPanelClose,
    shellRightPanelMode,
    shellRightPanelWidth,
  } = useChatShellPanels({
    attachmentPreview,
    attachmentPreviewMode,
    closeAttachmentPreview,
    closeSourcesPanel,
    panelPresentation,
    setPanelPresentation,
    setAttachmentPreviewMode,
    sourcesPanel,
    renderAttachmentViewer,
  })

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      {liveQueryBridge}
      <ChatExperienceView
      shell={{
        rightPanel: shellRightPanel,
        rightPanelOpen: Boolean(shellRightPanel),
        rightPanelWidth: shellRightPanelWidth,
        rightPanelMode: shellRightPanelMode,
        onRightPanelClose: shellRightPanelClose,
      }}
      main={{
        activeChatDeleting,
        isDragging,
        dragHandlers: {
          onDragEnter: (e) => {
            e.preventDefault()
            dragCounterRef.current++
            if (e.dataTransfer.types.includes('Files')) setIsDragging(true)
          },
          onDragOver: (e) => e.preventDefault(),
          onDragLeave: () => {
            dragCounterRef.current--
            if (dragCounterRef.current === 0) setIsDragging(false)
          },
          onDrop: (e) => {
            e.preventDefault()
            dragCounterRef.current = 0
            setIsDragging(false)
            const all = Array.from(e.dataTransfer.files)
            const images = all.filter((f) => f.type.startsWith('image/'))
            if (images.length > 0) addImages(images)
            const docExts =
              /^(pdf|docx|txt|md|markdown|csv|json|html|htm|xml|log|ts|tsx|js|jsx|css|yaml|yml|toml|py|go|rs)$/i
            const docs = all.filter((f) => {
              const ext = f.name.split('.').pop() ?? ''
              return (
                docExts.test(ext) ||
                f.type === 'application/pdf' ||
                f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                (f.type.startsWith('text/') && ext !== '')
              )
            })
            if (docs.length > 0) docs.forEach((f) => queueDocumentUpload(f))
          },
        },
      }}
      headerProps={{
        hideHeader,
        activeChatId,
        editingChatId,
        editingChatTitle,
        onEditingChatTitleChange: setEditingChatTitle,
        onCommitChatRename: commitChatRename,
        onCancelChatRename: cancelChatRename,
        headerTitleInputRef,
        showAutomationHeaderControls,
        titleLabel: headerTitleLabel,
        onBeginHeaderChatRename: beginHeaderChatRename,
        showRenameButton: Boolean(activeChatId && !selectedAutomation && !isPublicShowcase),
        projectName,
        showAutomationChatTab,
        appMode: mode,
        isTemporaryChat,
        isActiveLoading,
        onTemporaryChatToggle: handleTemporaryChatToggle,
        onGenerationModeChange: handleGenerationModeChange,
        generationMode,
        personalChatMode,
        onPersonalChatModeChange: handlePersonalChatModeChange,
        renderExportMenu,
        ...headerModelProps,
        automationHeaderModelId,
        automationHeaderModels,
        onSaveAutomationHeaderModel: saveAutomationHeaderModel,
        automationDetailTab,
        onSelectAutomationDetailTab: selectAutomationDetailTab,
      }}
      body={{
        hasAutomationContext,
        isTemporaryChat,
        selectedAutomationLoading,
        showAutomationChatTab,
      }}
      automationEditorProps={
        !showAutomationChatTab && selectedAutomation && automationDetailTab === 'edit'
          ? {
              automation: selectedAutomation,
              onSaved: setSelectedAutomation,
              onTested: (conversationId) => {
                const params = new URLSearchParams(searchParams?.toString() ?? '')
                params.set('id', conversationId)
                params.set('automationId', selectedAutomation._id)
                params.delete('tab')
                router.replace(`${pathname}?${params.toString()}`)
              },
              isFreeTier,
            }
          : null
      }
      messageListProps={
        showAutomationChatTab && (hasHistory || showChatLoadingState)
          ? {
              messagesScrollRef,
              messagesEndRef,
              floatingControl: showScrollToBottomControl ? (
                <DelayedTooltip label="Jump to latest" side="top">
                  <button
                    type="button"
                    aria-label="Jump to latest message"
                    onClick={() => scrollToConversationBottom('smooth')}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--muted)] shadow-sm transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
                  >
                    <ChevronDown size={17} strokeWidth={1.9} />
                  </button>
                </DelayedTooltip>
              ) : null,
              showLoadingState: showChatLoadingState,
              reserveLatestExchangeStartSpace,
              transcriptKey: activeChatId ?? (isTemporaryChat ? 'temporary-chat' : null),
              afterMessages: usageExhaustedNotice,
              state: {
                primaryMessages,
                latestExchangeIndex: latestExchIdx,
                generationResults,
                exchangeGenTypes,
                exchangeModels,
                selectedImageModels,
                selectedVideoModels,
                selectedTabPerExchange,
                selectedModels,
                exchangeModes,
              },
              runtime: {
                actChat,
                chatInstances,
                isActiveLoading,
                isOptimisticLoading,
                interruptedExchangeIdx,
                exitingTurnIds,
                sourcesPanel,
                getResponseForExchangeForModel,
              },
              actions: {
                onTabSelect: handleTabSelect,
                onJumpToReply: jumpToReplyTarget,
                onDeleteTurn: isPublicShowcase ? () => requireAuth('history') : handleDeleteTurnById,
                onReplyToMediaPrompt: beginReplyToMediaPrompt,
                onReplyToAssistantText: beginReplyToAssistantText,
                onBranch: isPublicShowcase ? () => requireAuth('history') : handleBranchConversationAtTurn,
                onOpenDraft: setDraftModalState,
                onCreateAutomationDraft: isPublicShowcase ? () => requireAuth('nav') : handleCreateAutomationDraftViaChat,
                onOpenSources: openSourcesPanel,
                onRetry: isPublicShowcase ? () => requireAuth('history') : handleRetryExchange,
                onOpenFilePreview: openFilePreview,
                onOpenAttachmentPreview: openAttachmentPreview,
                onContinue: handleContinue,
                onGeneratedUiChange: isPublicShowcase ? () => requireAuth('nav') : handleGeneratedUiChange,
                generatedUiConnectorActions,
              },
            }
          : null
      }
      composerProps={
        showAutomationChatTab
          ? {
              mode: composerMode,
              emptyState: {
                showCenteredEmptyChat,
                greetingLine,
                belowEmptyComposer: emptyComposerContent,
              },
              attachments: {
                attachedImages,
                setAttachedImages,
                pendingChatDocuments,
                removePendingDocument,
                attachmentError,
                fileInputRef,
                docInputRef,
                onAddImages: addImages,
                onAddDocumentsFromPicker: addDocumentsFromPicker,
                onOpenAttachmentPreview: openAttachmentPreview,
                onOpenFilePreview: openFilePreview,
              },
              runtime: {
                composerNotice,
                beforeComposerContent: personalMentionConfirmationOpen ? (
                  <PersonalMentionConversionPrompt
                    draft={inputRef.current ?? input}
                    mentions={personMentions}
                    sourceConversationId={activeChatId}
                    onCancel={() => setPersonalMentionConfirmationOpen(false)}
                  />
                ) : workApprovalContent,
                billingPromptContent: hasHistory ? null : usageExhaustedNotice,
                isSendBlocked,
                isActiveLoading,
                isTemporaryChat,
                blockedComposerContent: isBudgetExhaustedPaid ? null : (
                  <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-xs text-[var(--muted)]">
                    This model requires a paid plan. Switch to Auto or upgrade.
                  </div>
                ),
              },
              inputState: {
                replyContext,
                setReplyContext,
                textareaRef,
                input,
                inputRevision,
                onInputChange: handleComposerInputChange,
                onMentionsChange: handleMentionsChange,
                onPaste: handlePaste,
                hasComposerText,
              },
              toolState: {
                showAttachMenu,
                setShowAttachMenu,
                attachMenuRef,
                selectedToolIds,
                memoryEnabled,
                capabilities,
                onToggleTool: toggleComposerTool,
                onToggleMemory: () => setMemoryEnabled((current) => !current),
                onRemoveTool: removeComposerTool,
              },
              modeState: {
                onModeChange: handleGenerationModeChange,
                generationChip,
                setGenerationChip: handleGenerationChipChange,
                showModeMenu,
                setShowModeMenu,
                modeMenuRef,
                onNavigateMode: (nextMode) => {
                  router.push(nextMode === 'chat' ? '/app/chat' : '/app/automations')
                  setShowModeMenu(false)
                },
              },
              surface: {
                mentionCategories,
              },
              actions: {
                onStop: stopActiveChat,
                onSend: effectiveHandleSend,
                onEmptySuggestion: handleEmptySuggestion,
                onAutomateSuggestion: handleAutomateSuggestion,
              },
            }
          : null
      }
      draftReviewProps={{
        state: draftModalState,
        saving: isDraftSaving,
        onClose: () => {
          if (!isDraftSaving) setDraftModalState(null)
        },
        onSaveSkill: saveSkillDraft,
        onSaveAutomation: handleCreateAutomationDraftViaChat,
      }}
      attachmentPreviewProps={{
        open: Boolean(attachmentPreview && attachmentPreviewMode === 'dialog'),
        preview: attachmentPreview,
        onClose: closeAttachmentPreview,
        onModeChange: setAttachmentPreviewMode,
        renderViewer: renderAttachmentViewer,
      }}
      />
    </>
  )
}

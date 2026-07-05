'use client'

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import posthog from 'posthog-js'
import {
  FileText,
  ImageIcon,
  ArrowUp,
  ChevronDown,
} from 'lucide-react'
import type { UIMessage } from '@/shared/chat/ai-ui-message'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import {
  cloneConversationUiState,
  cloneGenerationResultsMap,
  cloneOrphanModelThreadsMap,
  cloneUiMessageThread,
  createConversationUiState,
  sameModelOrder,
} from '@overlay/chat-core'
import {
  AttachmentPreviewDialog,
  BudgetTopUpComposerPrompt,
  ChatExperienceHeader,
} from '@overlay/chat-react'
import type { AutomationDetail, AutomationDetailTab } from '@overlay/app-core'
import { AUTOMATIONS_UPDATED_EVENT, normalizeAutomationDetailTab } from '@overlay/app-core/automations'
import { useQuery } from '@/components/providers/convex-hooks'
import Link from 'next/link'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import {
  DEFAULT_MODEL_ID,
  isFreeTierChatModelId,
  type GenerationMode,
  type VideoSubMode,
} from '@/shared/ai/gateway/model-types'
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  getChatModelDisplayName,
  getModel,
  getVideoModelsBySubMode,
} from '@/shared/ai/gateway/model-data'
import { normalizeChatModelSelection } from '@/shared/chat/chat-model-prefs'
import { resolveDefaultChatModelSelection } from '@/shared/chat/default-chat-model'
import {
  defaultChatToolRequestIds,
  defaultMemoryEnabled,
  type ChatToolRequestId,
} from '@/shared/chat/tool-requests'
import { ChatComposer } from './ChatComposer'
import { ChatMessageList } from './ChatMessageList'
import {
  reportTextStreamError,
  startActRetryStream,
  startActTextStream,
} from './useChatTransport'
import { useChatListEventSync } from './chat/useChatListEventSync'
import { useChatAttachments } from './useChatAttachments'
import { useChatBillingControls } from './chat/useChatBillingControls'
import { useDraftReviewActions } from './chat/useDraftReviewActions'
import type { EmptyAutomateSuggestionId, EmptyChatSuggestionId } from './ChatEmptyState'
import { useChatPreferences } from './chat/useChatPreferences'
import { safeSetLocalStorage, toggleModelSelection } from './chat/model-selection-utils'
import { useChatPanels, type AttachmentPreview } from './chat/useChatPanels'
import { useChatShellPanels } from './chat/useChatShellPanels'
import { useChatConversationLoader } from './chat/useChatConversationLoader'
import { shouldResumeChatStreamIntoAskSlot } from './chat/chatStreamResume'
import { resetRuntimeState } from './chat/conversation-runtime-utils'
import {
  getResponseForExchangeForModel as selectResponseForExchangeForModel,
  prepareAskModelThreadsForTextTurn,
  readableModelId,
  removeTurnFromConversationRuntime,
  sameAssistantSnapshot,
} from './chat/chat-runtime-helpers'
import { useChatRuntimes } from './chat/useChatRuntimes'
import { useComposerTextState } from './chat/useComposerTextState'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'
import {
  dispatchChatCreated,
  dispatchChatModified,
  dispatchChatTitleUpdated,
  sanitizeChatTitle,
} from '@/shared/chat/chat-title'
import {
  fetchChatList,
  getCachedChatList,
  primeChatList,
  type ChatListPageInfo,
  upsertCachedChat,
} from '@/shared/chat/chat-list-cache'
import { TEMPORARY_CHAT_UI_EVENT } from '@/shared/chat/temporary-chat-ui'
import {
  beginTtftClientTurn,
  markTtftClientMilestone,
  setTtftClientTurnId,
  tryLogTtftClientFirstText,
} from '@/shared/chat/ttft-client-debug'
import { useAsyncSessions } from '@/components/providers/async-sessions-store'
import { DelayedTooltip } from './DelayedTooltip'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { buildSharePageUrl } from '@/features/share/lib/share-url'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { createIdempotencyKey } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import { useAuth } from '@/contexts/AuthContext'
import { useConvexWorkOSToken } from '@/components/providers/ConvexProviderWithWorkOS'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useGeneratedUiConnectorActions } from './chat/useGeneratedUiConnectorActions'
import {
  CHAT_GEN_MODE_KEY,
  DEFAULT_CHAT_TITLE,
  IMAGE_MODEL_SELECTION_MODE_KEY,
  SELECTED_IMAGE_MODELS_KEY,
  SELECTED_VIDEO_MODELS_KEY,
  VIDEO_MODEL_SELECTION_MODE_KEY,
  VIDEO_SUB_MODE_KEY,
} from './chat-interface/constants'
import {
  applyLiveMessageDeltaParts,
  assistantBlocksToPlainText,
  buildAssistantVisualSequence,
  chatGreetingLine,
  getUserTurnId,
  stripAssistantAfterUserTurn,
} from '@overlay/chat-core'
import { generateTitle } from '@/features/chat/lib/generate-title'
import { scrollToExchangeTurn } from '@/features/chat/lib/scroll-to-exchange-turn'
import type {
  AskModelSelectionMode,
  ChatMessageMetadata,
  Conversation,
  ConversationRuntime,
  ConversationUiState,
  GenerationResult,
  LiveConversationMessage,
  LiveMessageDelta,
} from './chat-interface/types'
import type { MentionInputHandle } from './chat-interface/MentionInput'
import type { MentionItem } from '@/shared/knowledge/mention-types'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'

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
const TopUpPreferenceControl = dynamic(
  () => import('@/features/billing/components/TopUpPreferenceControl').then((mod) => ({ default: mod.TopUpPreferenceControl })),
  { loading: () => null },
)
const FileViewerPanel = dynamic(
  () => import('@/features/files/components/FileViewer').then((mod) => ({ default: mod.FileViewerPanel })),
  { loading: () => null },
)
const ExportMenu = dynamic(
  () => import('@/features/files/components/ExportMenu').then((mod) => ({ default: mod.ExportMenu })),
  { loading: () => null },
)
const DraftReviewModal = dynamic(
  () => import('./chat-interface/Modals').then((mod) => ({ default: mod.DraftReviewModal })),
  { loading: () => null },
)
const AutomationEditorPanel = dynamic(
  () => import('./chat-interface/AutomationEditor').then((mod) => ({ default: mod.AutomationEditorPanel })),
  { loading: () => null },
)
// Loaded lazily with its own Suspense boundary (via `loading`) so a first-load
// suspension never bubbles up to an ancestor boundary and flashes the whole
// page/chat when the model dropdown is opened for the first time.
const loadModelQualitiesPanel = () => import('@overlay/chat-react/model-qualities-panel')

const EMPTY_UI_MESSAGES: UIMessage[] = []
const TEMPORARY_CHAT_ID = '__overlay_temporary_chat__'
const PENDING_FIRST_CHAT_ID = '__overlay_pending_first_chat__'

type PendingFirstSendState = {
  conversationClientId: string
  previewRuntime: ConversationRuntime
  streamDone: boolean
  realChatId: string | null
  wasFirst: boolean
  renameSeed: string
  activeChatTitleSnapshot: string | null
}

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
}) {
  recordRender('ChatExperience')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
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
  const {
    models: gatewayCatalogModels,
    isLoading: gatewayModelsLoading,
  } = useGatewayModelCatalog()
  const { capabilities } = useOverlayCapabilities()
  const billingEnabled = capabilities.billing
  const { user: authUser, isLoading: authLoading } = useAuth()
  const convexAccessToken = useConvexWorkOSToken()
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
  const liveGeneratingByChatRef = useRef(new Map<string, boolean>())
  const pendingFirstSendRef = useRef<PendingFirstSendState | null>(null)
  const appliedLiveDeltaIdsRef = useRef(new Set<string>())
  const resumedCloudflareStreamsRef = useRef(new Set<string>())

  // Clear active viewer + ref when this tab unmounts so any in-flight .then() sees isActive=false
  useEffect(() => {
    return () => {
      activeChatIdRef.current = null
      setActiveViewer(null)
    }
  }, [setActiveViewer])

  const [chats, setChats] = useState<Conversation[]>(() =>
    userId ? (initialChats ?? getCachedChatList() ?? []) : [],
  )
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const {
    runtimesRef,
    emptyRuntimeRef,
    ensureConversationRuntime,
    replaceConversationRuntime,
    activeRuntime,
    chatStreamRelayApi,
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
    setAttachmentPreviewMode,
    setSourcesPanel,
    sourcesPanel,
  } = useChatPanels()

  useEffect(() => {
    if (userId && initialChats) primeChatList(initialChats, initialChatPageInfo)
  }, [initialChatPageInfo, initialChats, userId])
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
    generationMode,
    setGenerationMode,
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
  } = useChatPreferences()
  const askModelSelectionModeRef = useRef(askModelSelectionMode)
  askModelSelectionModeRef.current = askModelSelectionMode
  const [, setIsSwitchingChat] = useState(false)
  const [exchangeModes, setExchangeModes] = useState<('ask' | 'act')[]>([])
  const generatedUiConnectorActions = useGeneratedUiConnectorActions()

  const [exchangeModels, setExchangeModels] = useState<string[][]>([])
  const [selectedTabPerExchange, setSelectedTabPerExchange] = useState<number[]>([])

  // Tracks the title of the active chat independently of the sidebar `chats` list.
  // Needed for project chats which are excluded from the global chats:list query.
  const [activeChatTitle, setActiveChatTitle] = useState<string | null>(null)

  const [generationResults, setGenerationResults] = useState<Map<number, GenerationResult[]>>(new Map())
  const [exchangeGenTypes, setExchangeGenTypes] = useState<('text' | 'image' | 'video')[]>([])

  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showVideoSubModePicker, setShowVideoSubModePicker] = useState(false)

  // Warm the lazy ModelQualitiesPanel chunk as soon as the picker opens so the
  // first row hover renders instantly (and never triggers a visible suspense).
  useEffect(() => {
    if (showModelPicker) void loadModelQualitiesPanel()
  }, [showModelPicker])
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null)
  /** Viewport position for the fixed model-qualities flyout (tracks hovered row). */
  const [modelQualitiesPos, setModelQualitiesPos] = useState<{ x: number; y: number } | null>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [selectedToolIds, setSelectedToolIds] = useState<ChatToolRequestId[]>(() =>
    defaultChatToolRequestIds({ temporary: false }),
  )
  const [memoryEnabled, setMemoryEnabled] = useState(() =>
    defaultMemoryEnabled({ temporary: false }),
  )
  const [isDragging, setIsDragging] = useState(false)
  const lastStreamChunkAtRef = useRef<number>(Date.now())
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

  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [isOptimisticLoading, setIsOptimisticLoading] = useState(false)
  const [composerNotice, setComposerNotice] = useState<string | null>(null)
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
    autoTopUpEnabledDraft,
    billingActionLoading,
    budgetRemainingCents,
    entitlements,
    handleSaveTopUpPreference,
    handleStartTopUp,
    isBudgetExhaustedPaid,
    isFreeTier,
    isSendBlocked,
    loadSubscription,
    selectableTextModels,
    setAutoTopUpEnabledDraft,
    setTopUpAmountDraftCents,
    topUpAmountDraftCents,
  } = useChatBillingControls({
    activeChatId,
    billingEnabled,
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
  // Apply account default models on new-chat surfaces when settings load or change.
  useEffect(() => {
    if (!chatPrefsHydrated || activeChatId || isTemporaryChat) return
    if (userAskModelOverrideRef.current) return

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
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingChatTitle, setEditingChatTitle] = useState('')
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
    appliedLiveDeltaIdsRef.current.clear()
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
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const videoSubModePickerRef = useRef<HTMLDivElement>(null)
  const modelPickerListScrollRef = useRef<HTMLDivElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)

  const syncModelQualitiesPosition = useCallback((modelId: string | null) => {
    if (typeof document === 'undefined' || !modelId || !modelPickerRef.current) {
      setModelQualitiesPos(null)
      return
    }
    const row = modelPickerRef.current.querySelector(`[data-model-row="${CSS.escape(modelId)}"]`)
    if (!row || !(row instanceof HTMLElement)) {
      setModelQualitiesPos(null)
      return
    }
    const r = row.getBoundingClientRect()
    setModelQualitiesPos({ x: r.left - 8, y: r.top + r.height / 2 })
  }, [])
  const wasStreamingRef = useRef(false)
  // Stores the pending title so loadChats() never overwrites it before the PATCH lands
  const pendingTitleRef = useRef<{ chatId: string; title: string } | null>(null)

  const applyUiStateToView = useCallback((ui: ConversationUiState) => {
    const normalizedTextModels = normalizeChatModelSelection({
      askModelIds: ui.selectedModels,
      actModelId: ui.selectedActModel,
    })
    setSelectedActModel(normalizedTextModels.actModelId)
    setSelectedModels([...normalizedTextModels.askModelIds])
    setAskModelSelectionMode(normalizedTextModels.askModelIds.length > 1 ? 'multiple' : 'single')
    setExchangeModes([...ui.exchangeModes])
    setExchangeModels(ui.exchangeModels.map((models) => [...models]))
    setSelectedTabPerExchange([...ui.selectedTabPerExchange])
    setActiveChatTitle(ui.activeChatTitle)
    setGenerationResults(cloneGenerationResultsMap(ui.generationResults))
    setExchangeGenTypes([...ui.exchangeGenTypes])
    setIsFirstMessage(ui.isFirstMessage)
    lastGeneratedImageUrlRef.current = ui.lastGeneratedImageUrl
  }, [
    lastGeneratedImageUrlRef,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

  const buildActiveUiStateSnapshot = useCallback((): ConversationUiState => {
    const activeRuntime = activeChatId ? ensureConversationRuntime(activeChatId) : null
    const normalizedTextModels = normalizeChatModelSelection({
      askModelIds: selectedModels,
      actModelId: selectedActModel,
    })
    return createConversationUiState({
      selectedActModel: normalizedTextModels.actModelId,
      selectedModels: normalizedTextModels.askModelIds,
      askModelSelectionMode: normalizedTextModels.askModelIds.length > 1 ? 'multiple' : 'single',
      exchangeModes,
      exchangeModels,
      selectedTabPerExchange,
      activeChatTitle,
      generationResults,
      exchangeGenTypes,
      isFirstMessage,
      orphanModelThreads: activeRuntime?.ui.orphanModelThreads,
      lastGeneratedImageUrl: lastGeneratedImageUrlRef.current,
    })
  }, [
    activeChatId,
    activeChatTitle,
    ensureConversationRuntime,
    exchangeGenTypes,
    exchangeModels,
    exchangeModes,
    generationResults,
    isFirstMessage,
    lastGeneratedImageUrlRef,
    selectedActModel,
    selectedModels,
    selectedTabPerExchange,
  ])

  const persistActiveRuntimeUiState = useCallback(() => {
    if (!activeChatId) return
    const runtime = ensureConversationRuntime(activeChatId)
    if (!runtime.hydrated) return
    runtime.ui = buildActiveUiStateSnapshot()
  }, [activeChatId, buildActiveUiStateSnapshot, ensureConversationRuntime])

  const updateRuntimeUiState = useCallback((
    chatId: string,
    updater: (prev: ConversationUiState) => ConversationUiState,
  ) => {
    const runtime = ensureConversationRuntime(chatId)
    runtime.ui = updater(cloneConversationUiState(runtime.ui))
    if (activeChatIdRef.current === chatId) {
      applyUiStateToView(runtime.ui)
    }
  }, [applyUiStateToView, ensureConversationRuntime])

  const resetActiveChatAfterDelete = useCallback((chatId: string) => {
    runtimesRef.current.delete(chatId)
    if (activeChatIdRef.current !== chatId) return

    activeChatIdRef.current = null
    pendingTitleRef.current = null
    setIsTemporaryChat(false)
    resetComposerToolIds(false)
    setActiveChatId(null)
    setActiveChatTitle(null)
    setInterruptedExchangeIdx(null)
    setSourcesPanel(null)
    applyUiStateToView(applyDefaultChatModelsToView({
      activeChatTitle: null,
      isFirstMessage: true,
    }))
    clearTransientComposerState()
    setActiveViewer(null)
    if (!hideSidebar) router.replace('/app/chat')
  }, [
    applyDefaultChatModelsToView,
    applyUiStateToView,
    clearTransientComposerState,
    hideSidebar,
    resetComposerToolIds,
    router,
    runtimesRef,
    setActiveViewer,
    setSourcesPanel,
  ])

  useChatListEventSync({
    activeChatIdRef,
    resetActiveChatAfterDelete,
    setActiveChatDeleting,
    setActiveChatTitle,
    setChats,
    setDeletingChatIds,
    updateRuntimeUiState,
  })

  const liveMessages = useQuery(
    api.chat.conversations.watchGeneratingMessages,
    activeChatId && authUser?.id && convexAccessToken
      ? {
          conversationId: activeChatId as Id<'conversations'>,
          userId: authUser.id,
          accessToken: convexAccessToken,
        }
      : 'skip',
  ) as Array<LiveConversationMessage> | undefined
  const liveMessageDeltas = useQuery(
    api.chat.conversations.watchGeneratingMessageDeltas,
    activeChatId && authUser?.id && convexAccessToken
      ? {
          conversationId: activeChatId as Id<'conversations'>,
          userId: authUser.id,
          accessToken: convexAccessToken,
        }
      : 'skip',
  ) as Array<LiveMessageDelta> | undefined

  const activeAskChats = activeRuntime.askChats
  const activePersistedGenerating =
    (liveMessages ?? []).some(
      (message) => message.role === 'assistant' && message.status === 'generating',
    ) ||
    activeRuntime.actChat.messages.some((message) => {
      const m = message as unknown as { role?: string; status?: string }
      return m.role === 'assistant' && m.status === 'generating'
    }) ||
    activeRuntime.askChats.some((chat) =>
      chat.messages.some((message) => {
        const m = message as unknown as { role?: string; status?: string }
        return m.role === 'assistant' && m.status === 'generating'
      }),
    )

  const isActiveLoading =
    activeAskChats.some((c) => c.status === 'streaming' || c.status === 'submitted') ||
    actChat.status === 'streaming' ||
    actChat.status === 'submitted' ||
    activePersistedGenerating

  useEffect(() => {
    if (!activeChatId || !chatStreamRelayApi) return
    const hasLocalHttpStream =
      actChat.status === 'streaming' ||
      actChat.status === 'submitted' ||
      chatInstances.some((chat) => chat.status === 'streaming' || chat.status === 'submitted')
    if (hasLocalHttpStream) return

    const targets = new Map<string, { turnId: string; variantIndex: number }>()
    const collect = (messages: UIMessage[]) => {
      for (const message of messages) {
        const m = message as unknown as {
          role?: string
          status?: string
          turnId?: string
          id?: string
          variantIndex?: number
        }
        if (m.role !== 'assistant' || m.status !== 'generating') continue
        const turnId = m.turnId?.trim() || ''
        if (!turnId) continue
        const variantIndex = m.variantIndex ?? 0
        targets.set(`${turnId}:${variantIndex}`, { turnId, variantIndex })
      }
    }

    for (const message of liveMessages ?? []) {
      if (message.role !== 'assistant' || message.status !== 'generating') continue
      const turnId = message.turnId?.trim() || ''
      if (!turnId) continue
      const variantIndex = message.variantIndex ?? 0
      targets.set(`${turnId}:${variantIndex}`, { turnId, variantIndex })
    }
    collect(activeRuntime.actChat.messages as UIMessage[])
    for (const chat of activeRuntime.askChats) collect(chat.messages as UIMessage[])

    const activeVariantCountByTurn = new Map<string, number>()
    for (const target of targets.values()) {
      activeVariantCountByTurn.set(
        target.turnId,
        (activeVariantCountByTurn.get(target.turnId) ?? 0) + 1,
      )
    }

    for (const target of targets.values()) {
      const key = `${activeChatId}:${target.turnId}:${target.variantIndex}`
      if (resumedCloudflareStreamsRef.current.has(key)) continue
      const slotChat = chatInstances[target.variantIndex]
      const resumeIntoAskSlot = shouldResumeChatStreamIntoAskSlot({
        runtime: activeRuntime,
        turnId: target.turnId,
        variantIndex: target.variantIndex,
        activeVariantCount: activeVariantCountByTurn.get(target.turnId) ?? 1,
      })
      const targetChat = resumeIntoAskSlot && slotChat ? slotChat : actChat
      console.info('[chat-stream] resume dispatch', {
        conversationId: activeChatId,
        turnId: target.turnId,
        variantIndex: target.variantIndex,
        targetRuntime: resumeIntoAskSlot && slotChat ? 'ask-slot' : 'act',
      })
      resumedCloudflareStreamsRef.current.add(key)
      void (async () => {
        try {
          await targetChat.resumeStream({
            body: {
              conversationId: activeChatId,
              turnId: target.turnId,
              variantIndex: target.variantIndex,
              multiModelSlotIndex: target.variantIndex,
            },
          })
          if (targetChat.status === 'error') {
            console.error('[chat-stream] resume failed', {
              conversationId: activeChatId,
              turnId: target.turnId,
              variantIndex: target.variantIndex,
              targetRuntime: resumeIntoAskSlot && slotChat ? 'ask-slot' : 'act',
              reason: targetChat.error?.message ?? 'Chat runtime entered an error state',
            })
            resumedCloudflareStreamsRef.current.delete(key)
          }
        } catch (error) {
          console.error('[chat-stream] resume failed', {
            conversationId: activeChatId,
            turnId: target.turnId,
            variantIndex: target.variantIndex,
            targetRuntime: resumeIntoAskSlot && slotChat ? 'ask-slot' : 'act',
            reason: error instanceof Error ? error.message : String(error),
          })
          resumedCloudflareStreamsRef.current.delete(key)
        }
      })()
    }
  }, [activeChatId, activeRuntime, actChat, chatInstances, chatStreamRelayApi, liveMessages])

  useEffect(() => {
    persistActiveRuntimeUiState()
  }, [persistActiveRuntimeUiState])

  // ── data loading ──────────────────────────────────────────────────────────

  // Snapshot pendingTitleRef before the async fetch so a concurrent PATCH completing mid-flight
  // can't clear the ref before we've applied the override to the incoming server chats.
  const loadChats = useCallback(async () => {
    try {
      const pending = pendingTitleRef.current
      const serverChats = await fetchChatList({ force: true })
      const nextChats = pending
        ? serverChats.map((c) => (c._id === pending.chatId ? { ...c, title: pending.title } : c))
        : serverChats
      setChats(nextChats)
      if (pending) {
        primeChatList(nextChats)
      }
      // Clear the ref once the server has confirmed the title
      if (pending && serverChats.some((c) => c._id === pending.chatId && c.title === pending.title)) {
        if (pendingTitleRef.current?.chatId === pending.chatId) pendingTitleRef.current = null
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!activeChatId || !liveMessages) return
    const hasLocalHttpStream =
      activeChatIdRef.current === activeChatId &&
      (
        actChat.status === 'streaming' ||
        actChat.status === 'submitted' ||
        [chat0, chat1, chat2, chat3].some((chat) => chat.status === 'streaming' || chat.status === 'submitted')
      )
    if (hasLocalHttpStream) return
    const liveGeneratingMessages = liveMessages.filter(
      (message) => message.role === 'assistant' && message.status === 'generating',
    )
    const hadGenerating = liveGeneratingByChatRef.current.get(activeChatId) === true
    liveGeneratingByChatRef.current.set(activeChatId, liveGeneratingMessages.length > 0)
    const runtime = runtimesRef.current.get(activeChatId)
    if (!runtime) {
      if (hadGenerating && liveGeneratingMessages.length === 0) {
        completeSession(activeChatId, activeChatIdRef.current === activeChatId)
        void loadChats()
      }
      return
    }

    let changed = false
    const patchList = (messages: UIMessage[], incoming: (typeof liveMessages)[number]) => {
      if (incoming.role !== 'assistant') return false
      const variant = incoming.variantIndex ?? 0
      const nextMessage = {
        id: incoming._id,
        role: 'assistant' as const,
        parts: incoming.parts?.length
          ? incoming.parts
          : [{ type: 'text', text: incoming.content ?? '' }],
        metadata: {
          ...(incoming.routedModelId ? { routedModelId: incoming.routedModelId } : {}),
        },
        turnId: incoming.turnId,
        mode: incoming.mode,
        model: incoming.modelId,
        variantIndex: incoming.variantIndex,
        status: incoming.status,
      } as unknown as UIMessage

      const existingIdx = messages.findIndex((message) => {
        const m = message as unknown as { id?: string; turnId?: string; role?: string; variantIndex?: number }
        return (
          m.id === incoming._id ||
          (m.role === 'assistant' &&
            m.turnId === incoming.turnId &&
            (m.variantIndex ?? 0) === variant)
        )
      })
      if (existingIdx >= 0) {
        // Only replace (and report a change) when the incoming snapshot actually
        // differs. Without this, every effect run rebuilds nextMessage and reports
        // "changed", calling setMessages → new useChat helper identities → the effect
        // (which depends on those helpers) re-runs → setMessages → an infinite render
        // loop that locks the page while a generating message exists in liveMessages.
        if (sameAssistantSnapshot(messages[existingIdx], nextMessage)) {
          return false
        }
        messages[existingIdx] = nextMessage
        return true
      }
      const userIdx = messages.findIndex((message) => {
        const m = message as unknown as { turnId?: string; id?: string; role?: string }
        return m.role === 'user' && (m.turnId === incoming.turnId || m.id === incoming.turnId)
      })
      if (userIdx >= 0) {
        messages.splice(userIdx + 1, 0, nextMessage)
        return true
      }
      return false
    }

    for (const incoming of liveMessages) {
      if (incoming.mode === 'act') {
        changed = patchList(runtime.actChat.messages as UIMessage[], incoming) || changed
        const slot = incoming.variantIndex ?? 0
        if (slot >= 0 && slot < runtime.askChats.length) {
          changed = patchList(runtime.askChats[slot]!.messages as UIMessage[], incoming) || changed
        }
      }
    }

    if (changed) {
      runtime.actChat.messages = [...runtime.actChat.messages]
      for (const chat of runtime.askChats) chat.messages = [...chat.messages]
      if (activeChatIdRef.current === activeChatId) {
        actChat.setMessages([...runtime.actChat.messages] as UIMessage[])
        chat0.setMessages([...runtime.askChats[0]!.messages] as UIMessage[])
        chat1.setMessages([...runtime.askChats[1]!.messages] as UIMessage[])
        chat2.setMessages([...runtime.askChats[2]!.messages] as UIMessage[])
        chat3.setMessages([...runtime.askChats[3]!.messages] as UIMessage[])
      }
      forceLiveSyncRender((value) => value + 1)
    }
    if (hadGenerating && liveGeneratingMessages.length === 0) {
      completeSession(activeChatId, activeChatIdRef.current === activeChatId)
      void loadChats()
    }
  }, [activeChatId, actChat, chat0, chat1, chat2, chat3, completeSession, liveMessages, loadChats, runtimeHydrationVersion, runtimesRef])

  useEffect(() => {
    if (!activeChatId || !liveMessageDeltas?.length) return
    const hasLocalHttpStream =
      activeChatIdRef.current === activeChatId &&
      (
        actChat.status === 'streaming' ||
        actChat.status === 'submitted' ||
        [chat0, chat1, chat2, chat3].some((chat) => chat.status === 'streaming' || chat.status === 'submitted')
      )
    if (hasLocalHttpStream) return
    const runtime = runtimesRef.current.get(activeChatId)
    if (!runtime) return

    let changed = false
    const applyDeltaToList = (messages: UIMessage[], delta: LiveMessageDelta) => {
      const existingIdx = messages.findIndex((message) => {
        const m = message as unknown as { id?: string; role?: string }
        return m.role === 'assistant' && m.id === delta.messageId
      })
      if (existingIdx < 0) return false
      const existing = messages[existingIdx] as unknown as {
        parts?: Array<Record<string, unknown>>
      }
      messages[existingIdx] = {
        ...messages[existingIdx],
        parts: applyLiveMessageDeltaParts(existing.parts ?? [], delta),
      } as UIMessage
      return true
    }

    for (const delta of liveMessageDeltas) {
      if (appliedLiveDeltaIdsRef.current.has(delta._id)) continue
      let applied = false
      applied = applyDeltaToList(runtime.actChat.messages as UIMessage[], delta) || applied
      for (const chat of runtime.askChats) {
        applied = applyDeltaToList(chat.messages as UIMessage[], delta) || applied
      }
      if (applied) {
        appliedLiveDeltaIdsRef.current.add(delta._id)
        changed = true
      }
    }

    if (!changed) return
    runtime.actChat.messages = [...runtime.actChat.messages]
    for (const chat of runtime.askChats) chat.messages = [...chat.messages]
    if (activeChatIdRef.current === activeChatId) {
      actChat.setMessages([...runtime.actChat.messages] as UIMessage[])
      chat0.setMessages([...runtime.askChats[0]!.messages] as UIMessage[])
      chat1.setMessages([...runtime.askChats[1]!.messages] as UIMessage[])
      chat2.setMessages([...runtime.askChats[2]!.messages] as UIMessage[])
      chat3.setMessages([...runtime.askChats[3]!.messages] as UIMessage[])
    }
    forceLiveSyncRender((value) => value + 1)
    lastStreamChunkAtRef.current = Date.now()
  }, [activeChatId, actChat, chat0, chat1, chat2, chat3, liveMessageDeltas, liveMessages, runtimesRef])

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
  }, [activeChatId, actChatRef, chat0Ref, chat1Ref, chat2Ref, chat3Ref, runtimeHydrationVersion, runtimesRef])

  useEffect(() => {
    if (!activeChatId) return
    const hasLocalHttpStream =
      activeChatIdRef.current === activeChatId &&
      (
        actChat.status === 'streaming' ||
        actChat.status === 'submitted' ||
        [chat0, chat1, chat2, chat3].some((chat) => chat.status === 'streaming' || chat.status === 'submitted')
      )
    if (hasLocalHttpStream) return
    const sessionIsStreaming = sessions[activeChatId]?.status === 'streaming'
    const liveQuerySawGenerating = liveGeneratingByChatRef.current.get(activeChatId) === true
    if (!sessionIsStreaming && !liveQuerySawGenerating && !activePersistedGenerating) return

    let cancelled = false
    const patchFromServer = async () => {
      try {
        const res = await overlayAppClient.conversations.getResponse({
          conversationId: activeChatId,
          messages: true,
        }, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!res.ok || cancelled || activeChatIdRef.current !== activeChatId) return
        const data = await res.json() as {
          messages?: Array<{
            id: string
            turnId?: string
            role: 'user' | 'assistant'
            mode?: 'ask' | 'act'
            parts?: Array<Record<string, unknown>>
            model?: string
            variantIndex?: number
            routedModelId?: string
            status?: 'generating' | 'completed' | 'error'
          }>
        }
        const runtime = runtimesRef.current.get(activeChatId)
        if (!runtime) return
        const assistantRows = (data.messages ?? []).filter((message) => message.role === 'assistant')
        let changed = false
        const patchList = (messages: UIMessage[], incoming: (typeof assistantRows)[number]) => {
          const variant = incoming.variantIndex ?? 0
          const nextMessage = {
            id: incoming.id,
            role: 'assistant' as const,
            parts: incoming.parts?.length ? incoming.parts : [{ type: 'text', text: '' }],
            metadata: {
              ...(incoming.routedModelId ? { routedModelId: incoming.routedModelId } : {}),
            },
            turnId: incoming.turnId,
            mode: incoming.mode ?? 'act',
            model: incoming.model,
            variantIndex: incoming.variantIndex,
            status: incoming.status,
          } as unknown as UIMessage
          const existingIdx = messages.findIndex((message) => {
            const m = message as unknown as { id?: string; turnId?: string; role?: string; variantIndex?: number }
            return (
              m.id === incoming.id ||
              (m.role === 'assistant' &&
                m.turnId === incoming.turnId &&
                (m.variantIndex ?? 0) === variant)
            )
          })
          if (existingIdx < 0) {
            const userIdx = messages.findIndex((message) => {
              const m = message as unknown as { id?: string; turnId?: string; role?: string }
              return m.role === 'user' && (m.turnId === incoming.turnId || m.id === incoming.turnId)
            })
            if (userIdx < 0) return false
            messages.splice(userIdx + 1, 0, nextMessage)
            return true
          }
          const existing = messages[existingIdx] as unknown as { parts?: unknown; status?: string }
          if (
            existing.status === incoming.status &&
            JSON.stringify(existing.parts ?? []) === JSON.stringify((nextMessage as unknown as { parts?: unknown }).parts ?? [])
          ) {
            return false
          }
          messages[existingIdx] = nextMessage
          return true
        }
        for (const incoming of assistantRows) {
          if ((incoming.mode ?? 'act') !== 'act') continue
          changed = patchList(runtime.actChat.messages as UIMessage[], incoming) || changed
          const slot = incoming.variantIndex ?? 0
          if (slot >= 0 && slot < runtime.askChats.length) {
            changed = patchList(runtime.askChats[slot]!.messages as UIMessage[], incoming) || changed
          }
        }
        if (!changed) return
        runtime.actChat.messages = [...runtime.actChat.messages]
        for (const chat of runtime.askChats) chat.messages = [...chat.messages]
        actChat.setMessages([...runtime.actChat.messages] as UIMessage[])
        chat0.setMessages([...runtime.askChats[0]!.messages] as UIMessage[])
        chat1.setMessages([...runtime.askChats[1]!.messages] as UIMessage[])
        chat2.setMessages([...runtime.askChats[2]!.messages] as UIMessage[])
        chat3.setMessages([...runtime.askChats[3]!.messages] as UIMessage[])
        forceLiveSyncRender((value) => value + 1)
        if (!assistantRows.some((message) => message.status === 'generating')) {
          liveGeneratingByChatRef.current.set(activeChatId, false)
          completeSession(activeChatId, true)
          void loadChats()
        }
      } catch {
        // Ignore transient reconnect failures; the next tick or Convex subscription can recover.
      }
    }

    void patchFromServer()
    const interval = window.setInterval(() => {
      void patchFromServer()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeChatId, actChat, activePersistedGenerating, chat0, chat1, chat2, chat3, completeSession, loadChats, mode, runtimesRef, sessions])

  // Update title in local state + pendingTitleRef immediately, then broadcast.
  const applyChatTitleUpdate = useCallback((chatId: string, title: string) => {
    const nextTitle = sanitizeChatTitle(title, DEFAULT_CHAT_TITLE)
    pendingTitleRef.current = { chatId, title: nextTitle }
    setChats((prev) => {
      const exists = prev.some((c) => c._id === chatId)
      if (!exists) {
        // Chat not yet in local state (edge case: generateTitle resolved before createNewChat state settled)
        return [{ _id: chatId, title: nextTitle, lastModified: Date.now() }, ...prev]
      }
      return prev.map((c) => (c._id === chatId ? { ...c, title: nextTitle } : c))
    })
    updateRuntimeUiState(chatId, (prev) => ({ ...prev, activeChatTitle: nextTitle }))
    if (activeChatIdRef.current === chatId) {
      setActiveChatTitle((prev) => prev !== null ? nextTitle : prev)
    }
    dispatchChatTitleUpdated({ chatId, title: nextTitle })
    return nextTitle
  }, [updateRuntimeUiState])

  const markChatModified = useCallback((chatId: string, title?: string | null) => {
    const existingTitle =
      title ||
      activeChatTitle ||
      chats.find((chat) => chat._id === chatId)?.title ||
      DEFAULT_CHAT_TITLE
    const chat = {
      _id: chatId,
      title: existingTitle,
      lastModified: Date.now(),
    }
    upsertCachedChat(chat)
    setChats((prev) => {
      const existing = prev.find((item) => item._id === chatId)
      const merged = { ...existing, ...chat, title: chat.title || existing?.title || DEFAULT_CHAT_TITLE }
      return [merged, ...prev.filter((item) => item._id !== chatId)]
    })
    dispatchChatModified({ chat })
  }, [activeChatTitle, chats])

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

    if (isTemporaryChatRef.current || !targetChatId || targetChatId === TEMPORARY_CHAT_ID) return
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
  }, [actChatRef, chat0Ref, chat1Ref, chat2Ref, chat3Ref, emptyRuntimeRef, forceLiveSyncRender, runtimesRef])

  const headerTitleInputRef = useRef<HTMLInputElement>(null)

  const beginHeaderChatRename = useCallback(() => {
    if (!activeChatId) return
    const title =
      activeChatTitle ??
      chats.find((c) => c._id === activeChatId)?.title ??
      DEFAULT_CHAT_TITLE
    setEditingChatId(activeChatId)
    setEditingChatTitle(title)
  }, [activeChatId, activeChatTitle, chats])

  useEffect(() => {
    if (!activeChatId || editingChatId !== activeChatId) return
    const el = headerTitleInputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [activeChatId, editingChatId])

  const cancelChatRename = useCallback(() => {
    setEditingChatId(null)
    setEditingChatTitle('')
  }, [])

  useEffect(() => {
    cancelChatRename()
  }, [activeChatId, cancelChatRename])

  const commitChatRename = useCallback(async (chatId: string) => {
    const previousTitle =
      chats.find((chat) => chat._id === chatId)?.title ??
      (activeChatIdRef.current === chatId ? activeChatTitle ?? DEFAULT_CHAT_TITLE : DEFAULT_CHAT_TITLE)
    const nextTitle = sanitizeChatTitle(editingChatTitle, previousTitle)

    cancelChatRename()
    if (nextTitle === previousTitle) return

    applyChatTitleUpdate(chatId, nextTitle)

    try {
      const res = await overlayAppClient.conversations.updateResponse({ conversationId: chatId, title: nextTitle })
      if (!res.ok) throw new Error('Failed to rename chat')
    } catch {
      applyChatTitleUpdate(chatId, previousTitle)
    } finally {
      void loadChats()
    }
  }, [activeChatTitle, applyChatTitleUpdate, cancelChatRename, chats, editingChatTitle, loadChats])

  /** Hide header rename until `loadChat` has applied messages/meta (`runtime.hydrated`). */
  const activeChatHydrated = Boolean(
    activeChatId && runtimesRef.current.get(activeChatId)?.hydrated,
  )

  // Called on the first message of a new chat. Titles come from the free title model;
  // avoid persisting first-word excerpts, which read as incomplete titles.
  const startFirstMessageRename = useCallback((chatId: string, text: string) => {
    void generateTitle(text).then(async (aiTitle) => {
      if (!aiTitle) return
      const finalTitle = applyChatTitleUpdate(chatId, aiTitle)
      try {
        const res = await overlayAppClient.conversations.updateResponse({ conversationId: chatId, title: finalTitle })
        if (res.ok) void loadChats()
      } catch { /* keep local title */ }
    })
  }, [applyChatTitleUpdate, loadChats])

  const isStreamChatActive = useCallback((
    chatId: string,
    temporaryChatSnapshot: boolean,
  ) => {
    if (temporaryChatSnapshot) {
      return chatId === TEMPORARY_CHAT_ID && isTemporaryChatRef.current
    }
    if (chatId === PENDING_FIRST_CHAT_ID) {
      return pendingFirstSendRef.current != null
    }
    return activeChatIdRef.current === chatId
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (initialChats === undefined || (!userId && authUser?.id)) void loadChats()
    void loadSubscription()
  }, [authLoading, authUser?.id, initialChats, loadChats, loadSubscription, userId])

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
  }, [selectedModels, selectedActModel, activeChatId])

  // Auto-load a specific chat when embedded in project view (`id` = conversation)
  const idParam = searchParams?.get('id') ?? null
  const automationIdParam = mode === 'automate' ? searchParams?.get('automationId') ?? null : null
  const automationDetailTab = normalizeAutomationDetailTab(searchParams?.get('tab'))
  const automationConversationId =
    selectedAutomation?.sourceConversationId || selectedAutomation?.conversationId || null
  const hasAutomationContext = mode === 'automate' && Boolean(automationIdParam)
  const showAutomationChatTab = !hasAutomationContext || automationDetailTab === 'chat'
  const showAutomationHeaderControls = mode === 'automate'
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

  const syncStandaloneChatUrl = useCallback((chatId: string | null, options: { replaceUrl?: boolean } = {}) => {
    if (hideSidebar || options.replaceUrl === false) return
    const replaceUrl = (href: string) => {
      window.history.replaceState(null, '', href)
    }
    if (mode === 'automate') {
      const params = new URLSearchParams()
      if (chatId) params.set('id', chatId)
      const automationId = searchParams?.get('automationId')
      if (automationId) params.set('automationId', automationId)
      const tab = normalizeAutomationDetailTab(searchParams?.get('tab'))
      if (tab !== 'chat') params.set('tab', tab)
      const query = params.toString()
      replaceUrl(`/app/automations${query ? `?${query}` : ''}`)
      return
    }
    const basePath = '/app/chat'
    replaceUrl(chatId ? `${basePath}?id=${encodeURIComponent(chatId)}` : basePath)
  }, [hideSidebar, mode, searchParams])

  const tryActivatePendingFirstSend = useCallback(() => {
    const pending = pendingFirstSendRef.current
    if (!pending?.realChatId || !pending.streamDone) return

    const realId = pending.realChatId
    const preview = pending.previewRuntime
    replaceConversationRuntime(
      realId,
      cloneConversationUiState(preview.ui),
      preview.askChats.map((chat) => [...chat.messages]),
      [...preview.actChat.messages],
    )
    markChatModified(realId, pending.activeChatTitleSnapshot)
    if (pending.wasFirst) {
      startFirstMessageRename(realId, pending.renameSeed)
    }
    activeChatIdRef.current = realId
    setActiveViewer(realId)
    setActiveChatId(realId)
    syncStandaloneChatUrl(realId)
    applyUiStateToView(preview.ui)
    resetRuntimeState(emptyRuntimeRef.current)
    pendingFirstSendRef.current = null
    setRuntimeHydrationVersion((value) => value + 1)
  }, [
    applyUiStateToView,
    emptyRuntimeRef,
    markChatModified,
    replaceConversationRuntime,
    setActiveViewer,
    startFirstMessageRename,
    syncStandaloneChatUrl,
  ])

  const { invalidateLoadChatRequest, loadChat } = useChatConversationLoader({
    activeChatIdRef,
    applyUiStateToView,
    chats,
    clearTransientComposerState,
    ensureConversationRuntime,
    emptyRuntimeRef,
    hasAutomationContext,
    isTemporaryChatRef,
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
    startSession,
    syncStandaloneChatUrl,
  })

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
    applyDefaultChatModelsToView,
    applyUiStateToView,
    automationIdParam,
    hideSidebar,
    idParam,
    mode,
    persistActiveRuntimeUiState,
    clearTransientComposerState,
    resetComposerToolIds,
    setActiveViewer,
    setSourcesPanel,
  ])

  // Skip reloading the same chat we just created/switched to locally; otherwise the
  // route update can race the optimistic first-turn state and snap the UI back to empty.
  useEffect(() => {
    if (!chatPrefsHydrated) return
    if (!idParam || activeChatIdRef.current === idParam) return
    void loadChat(idParam)
    // `loadChat` is intentionally excluded so this only reacts to route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPrefsHydrated, idParam])

  useEffect(() => {
    function handleChatRouteSelected(event: Event) {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId
      if (!chatId || activeChatIdRef.current === chatId) return
      void loadChat(chatId, { replaceUrl: false })
    }
    window.addEventListener('overlay:chat-route-selected', handleChatRouteSelected)
    return () => window.removeEventListener('overlay:chat-route-selected', handleChatRouteSelected)
    // `loadChat` is intentionally excluded so this listener does not churn on render-only state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshSelectedAutomation = useCallback(async (options?: { showLoading?: boolean }) => {
    if (mode !== 'automate' || !automationIdParam) {
      setSelectedAutomation(null)
      setSelectedAutomationLoading(false)
      return
    }
    if (options?.showLoading !== false) setSelectedAutomationLoading(true)
    try {
      const res = await overlayAppClient.automations.getResponse({ automationId: automationIdParam }, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Failed to load automation')
      setSelectedAutomation(await res.json() as AutomationDetail)
    } catch {
      setSelectedAutomation(null)
    } finally {
      setSelectedAutomationLoading(false)
    }
  }, [automationIdParam, mode])

  useEffect(() => {
    void refreshSelectedAutomation()
  }, [refreshSelectedAutomation])

  useEffect(() => {
    if (mode !== 'automate' || !automationConversationId) return
    if (activeChatIdRef.current === automationConversationId) return
    void loadChat(automationConversationId)
    // `loadChat` is intentionally excluded so this only reacts to selected automation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automationConversationId, mode])

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

      const containerRect = container.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const targetTop = targetRect.top - containerRect.top + container.scrollTop
      const desiredTop = Math.max(0, targetTop - 16)
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
      const nextTop = Math.min(desiredTop, maxTop)
      container.scrollTo({
        top: nextTop,
        behavior: 'smooth',
      })
      if (desiredTop <= maxTop + 2 || (!isActiveLoading && !isOptimisticLoading)) {
        pendingScrollTurnIdRef.current = null
        pendingScrollChatIdRef.current = null
      }
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
    if (!showModelPicker) {
      setHoveredModelId(null)
      setModelQualitiesPos(null)
      return
    }
    function handleOutside(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node))
        setShowModelPicker(false)
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowModelPicker(false)
    }
    document.addEventListener('mousedown', handleOutside, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showModelPicker])

  useLayoutEffect(() => {
    if (!showModelPicker || (!hasAutomationContext && generationMode !== 'text') || !hoveredModelId) {
      setModelQualitiesPos(null)
      return
    }
    syncModelQualitiesPosition(hoveredModelId)
  }, [
    showModelPicker,
    generationMode,
    hasAutomationContext,
    hoveredModelId,
    syncModelQualitiesPosition,
  ])

  useEffect(() => {
    const el = modelPickerListScrollRef.current
    if (!el || !showModelPicker || !hoveredModelId) return
    const onScroll = () => syncModelQualitiesPosition(hoveredModelId)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [showModelPicker, hoveredModelId, syncModelQualitiesPosition])

  useEffect(() => {
    if (!showModelPicker || !hoveredModelId) return
    const onResize = () => syncModelQualitiesPosition(hoveredModelId)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [showModelPicker, hoveredModelId, syncModelQualitiesPosition])

  useEffect(() => {
    function openPicker() { setShowModelPicker(true) }
    function closePicker() { setShowModelPicker(false) }
    window.addEventListener('overlay:tour:open-model-picker', openPicker)
    window.addEventListener('overlay:tour:close-model-picker', closePicker)
    return () => {
      window.removeEventListener('overlay:tour:open-model-picker', openPicker)
      window.removeEventListener('overlay:tour:close-model-picker', closePicker)
    }
  }, [])

  useEffect(() => {
    if (!showVideoSubModePicker) return
    function handleOutside(e: MouseEvent) {
      if (videoSubModePickerRef.current && !videoSubModePickerRef.current.contains(e.target as Node))
        setShowVideoSubModePicker(false)
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowVideoSubModePicker(false)
    }
    document.addEventListener('mousedown', handleOutside, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showVideoSubModePicker])

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

  const handleImageModelSelectionModeChange = useCallback(
    (next: AskModelSelectionMode) => {
      if (isActiveLoading || generationMode !== 'image') return
      if (next === imageModelSelectionMode) return
      if (isFreeTier && next === 'multiple') return
      safeSetLocalStorage(IMAGE_MODEL_SELECTION_MODE_KEY, next)
      setImageModelSelectionMode(next)
      if (next === 'single' && selectedImageModels.length > 1) {
        const one = [selectedImageModels[0]!]
        setSelectedImageModels(one)
        safeSetLocalStorage(SELECTED_IMAGE_MODELS_KEY, JSON.stringify(one))
      }
    },
    [
      generationMode,
      imageModelSelectionMode,
      isActiveLoading,
      isFreeTier,
      selectedImageModels,
      setImageModelSelectionMode,
      setSelectedImageModels,
    ],
  )

  const handleVideoModelSelectionModeChange = useCallback(
    (next: AskModelSelectionMode) => {
      if (isActiveLoading || generationMode !== 'video') return
      if (next === videoModelSelectionMode) return
      if (isFreeTier && next === 'multiple') return
      safeSetLocalStorage(VIDEO_MODEL_SELECTION_MODE_KEY, next)
      setVideoModelSelectionMode(next)
      if (next === 'single' && selectedVideoModels.length > 1) {
        const one = [selectedVideoModels[0]!]
        setSelectedVideoModels(one)
        safeSetLocalStorage(SELECTED_VIDEO_MODELS_KEY, JSON.stringify(one))
      }
    },
    [
      generationMode,
      isActiveLoading,
      isFreeTier,
      selectedVideoModels,
      setSelectedVideoModels,
      setVideoModelSelectionMode,
      videoModelSelectionMode,
    ],
  )

  function handleVideoSubModeChange(subMode: VideoSubMode) {
    if (isActiveLoading) return
    setVideoSubMode(subMode)
    safeSetLocalStorage(VIDEO_SUB_MODE_KEY, subMode)
    const models = getVideoModelsBySubMode(subMode)
    const first = models[0]?.id
    if (first && !models.some((m) => selectedVideoModels.includes(m.id))) {
      setSelectedVideoModels([first])
      safeSetLocalStorage(SELECTED_VIDEO_MODELS_KEY, JSON.stringify([first]))
    }
  }

  function toggleImageModelInPicker(modelId: string) {
    if (isActiveLoading) return
    const next = toggleModelSelection(selectedImageModels, modelId, imageModelSelectionMode)
    if (sameModelOrder(next, selectedImageModels)) return
    setSelectedImageModels(next)
    safeSetLocalStorage(SELECTED_IMAGE_MODELS_KEY, JSON.stringify(next))
    if (imageModelSelectionMode === 'single') setShowModelPicker(false)
  }

  function toggleVideoModelInPicker(modelId: string) {
    if (isActiveLoading) return
    const next = toggleModelSelection(selectedVideoModels, modelId, videoModelSelectionMode)
    if (sameModelOrder(next, selectedVideoModels)) return
    setSelectedVideoModels(next)
    safeSetLocalStorage(SELECTED_VIDEO_MODELS_KEY, JSON.stringify(next))
    if (videoModelSelectionMode === 'single') setShowModelPicker(false)
  }

  const isOnNewChatSurface = !activeChatId && !isTemporaryChat
  const persistNewChatAskModels = useCallback((ids: string[]) => {
    if (!isOnNewChatSurface) return
    const normalized = normalizeChatModelSelection({ askModelIds: ids })
    void updateSettings({
      defaultAskModelIds: normalized.askModelIds,
      defaultActModelId: normalized.actModelId,
    })
  }, [isOnNewChatSurface, updateSettings])
  const persistNewChatActModel = useCallback((id: string) => {
    if (!isOnNewChatSurface) return
    const normalized = normalizeChatModelSelection({ askModelIds: selectedModels, actModelId: id })
    void updateSettings({
      defaultAskModelIds: normalized.askModelIds,
      defaultActModelId: normalized.actModelId,
    })
  }, [isOnNewChatSurface, selectedModels, updateSettings])

  useEffect(() => {
    if (!chatPrefsHydrated) return
    if (
      userAskModelOverrideRef.current &&
      askModelSelectionMode === 'single' &&
      selectedModels.length === 1 &&
      selectedModels[0] === selectedActModel
    ) {
      return
    }
    const normalized = normalizeChatModelSelection({
      askModelIds:
        askModelSelectionMode === 'single'
          ? [selectedActModel]
          : selectedModels,
      actModelId: selectedActModel,
    })
    const resolvedAskIds =
      askModelSelectionMode === 'single'
        ? [normalized.actModelId]
        : normalized.askModelIds
    const selectionChanged =
      normalized.actModelId !== selectedActModel ||
      !sameModelOrder(resolvedAskIds, selectedModels)

    if (selectionChanged) {
      setSelectedModels(resolvedAskIds)
      setSelectedActModel(normalized.actModelId)
      if (askModelSelectionMode === 'multiple') {
        setAskModelSelectionMode(resolvedAskIds.length > 1 ? 'multiple' : 'single')
      }
    }
  }, [
    askModelSelectionMode,
    chatPrefsHydrated,
    selectedActModel,
    selectedModels,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

  const snapshotCurrentAskThreadsForModelPicker = useCallback(() => {
    if (!activeChatIdRef.current && !isTemporaryChat) return
    const latestTextIdx = (() => {
      for (let i = exchangeModels.length - 1; i >= 0; i--) {
        if ((exchangeGenTypes[i] ?? 'text') === 'text') return i
      }
      return -1
    })()
    const threadModelOrder =
      latestTextIdx >= 0 && exchangeModels[latestTextIdx]?.length
        ? exchangeModels[latestTextIdx]!
        : selectedModels
    const nextOrphans = cloneOrphanModelThreadsMap(activeRuntime.ui.orphanModelThreads)
    threadModelOrder.slice(0, 4).forEach((modelId, slotIdx) => {
      const messages = activeRuntime.askChats[slotIdx]?.messages as UIMessage[] | undefined
      if (messages?.length) {
        nextOrphans.set(modelId, cloneUiMessageThread(messages))
      }
    })
    activeRuntime.ui = createConversationUiState({
      ...activeRuntime.ui,
      orphanModelThreads: nextOrphans,
    })
  }, [activeRuntime, exchangeGenTypes, exchangeModels, isTemporaryChat, selectedModels])

  const handleTextModelSelectionModeChange = useCallback(
    (next: AskModelSelectionMode) => {
      if (generationMode !== 'text') return
      if (next === askModelSelectionMode) return
      if (isFreeTier && next === 'multiple') return
      if (hasAutomationContext && next === 'multiple') return
      userAskModelOverrideRef.current = true
      snapshotCurrentAskThreadsForModelPicker()
      setAskModelSelectionMode(next)
      if (next === 'single' && selectedModels.length > 1) {
        const one = [selectedModels[0]!]
        setSelectedModels(one)
        setSelectedActModel(one[0]!)
        persistNewChatAskModels(one)
        persistNewChatActModel(one[0]!)
      } else if (next === 'multiple' && selectedModels.length > 0) {
        setSelectedActModel(selectedModels[0]!)
        persistNewChatActModel(selectedModels[0]!)
      }
    },
    [
      generationMode,
      askModelSelectionMode,
      isFreeTier,
      hasAutomationContext,
      selectedModels,
      snapshotCurrentAskThreadsForModelPicker,
      persistNewChatAskModels,
      persistNewChatActModel,
      setAskModelSelectionMode,
      setSelectedActModel,
      setSelectedModels,
    ],
  )

  function toggleTextModelInPicker(modelId: string) {
    if (isOnNewChatSurface) {
      userAskModelOverrideRef.current = true
    }
    snapshotCurrentAskThreadsForModelPicker()
    if (askModelSelectionMode === 'single') {
      const next = toggleModelSelection(selectedModels, modelId, askModelSelectionMode)
      if (sameModelOrder(next, selectedModels) && selectedActModel === modelId) return
      setSelectedActModel(modelId)
      setSelectedModels(next)
      persistNewChatActModel(modelId)
      persistNewChatAskModels(next)
      setShowModelPicker(false)
      return
    }
    const next = toggleModelSelection(selectedModels, modelId, askModelSelectionMode)
    if (sameModelOrder(next, selectedModels)) return
    setSelectedModels(next)
    if (!next.includes(selectedActModel)) {
      setSelectedActModel(next[0]!)
      persistNewChatActModel(next[0]!)
    } else if (next.length === 1) {
      setSelectedActModel(modelId)
      persistNewChatActModel(modelId)
    }
    persistNewChatAskModels(next)
  }

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

  function resetToBlankChatSurface(options: { temporary: boolean }) {
    invalidateLoadChatRequest()
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
    const { askModelIds, actModelId } = resolveAppDefaultChatModels()
    resetRuntimeState(emptyRuntimeRef.current, {
      selectedActModel: actModelId,
      selectedModels: askModelIds,
      askModelSelectionMode: askModelIds.length > 1 ? 'multiple' : 'single',
      activeChatTitle: options.temporary ? 'Temporary chat' : null,
      isFirstMessage: true,
    })
    emptyRuntimeRef.current.hydrated = true
    applyUiStateToView(emptyRuntimeRef.current.ui)
    clearTransientComposerState()
    setRuntimeHydrationVersion((value) => value + 1)
    syncStandaloneChatUrl(null)
  }

  function handleTemporaryChatToggle() {
    if (isActiveLoading) return
    resetToBlankChatSurface({ temporary: !isTemporaryChat })
  }

  async function createNewChat(options: {
    title?: string
    clientId?: string
    deferActivation?: boolean
    prepareRuntime?: (args: {
      chatId: string
      runtime: ConversationRuntime
      selectedModels: string[]
      selectedActModel: string
      askModelSelectionMode: AskModelSelectionMode
    }) => void
  } = {}): Promise<string | null> {
    // Invalidate any in-flight loadChat request before this newly-created runtime
    // becomes active; otherwise an older load can repaint the view after send.
    invalidateLoadChatRequest()
    persistActiveRuntimeUiState()
    setIsTemporaryChat(false)
    resetComposerToolIds(false)
    const initialTitle = options.title ?? (mode === 'automate' ? 'New automation' : DEFAULT_CHAT_TITLE)
    const normalizedInitialSelection = normalizeChatModelSelection({
      askModelIds: askModelSelectionMode === 'single' ? [selectedActModel] : selectedModels.slice(0, 4),
      actModelId: selectedActModel,
    })
    const initialSelectedModels = normalizedInitialSelection.askModelIds
    const initialAskModelSelectionMode: AskModelSelectionMode = initialSelectedModels.length > 1 ? 'multiple' : 'single'
    const trimmedClientId = options.clientId?.trim()
    const res = await overlayAppClient.conversations.createResponse(
      {
        title: initialTitle,
        askModelIds: initialSelectedModels,
        actModelId: normalizedInitialSelection.actModelId,
        lastMode: 'act',
        ...(embedProjectId ? { projectId: embedProjectId } : {}),
        ...(trimmedClientId ? { clientId: trimmedClientId } : {}),
      },
      { idempotencyKey: trimmedClientId ?? createIdempotencyKey() },
    )
    if (res.ok) {
      const data = await res.json()
      setInterruptedExchangeIdx(null)
      const newChat: Conversation = {
        _id: data.id,
        title: initialTitle,
        lastModified: Date.now(),
        lastMode: 'act',
        askModelIds: initialSelectedModels,
        actModelId: normalizedInitialSelection.actModelId,
      }
      upsertCachedChat(newChat)
      setChats((prev) => [newChat, ...prev])
      dispatchChatCreated({ chat: newChat })
      posthog.capture('chat_new_chat_created', { mode: 'act' })

      if (options.deferActivation) {
        const pending = pendingFirstSendRef.current
        if (pending && trimmedClientId && pending.conversationClientId === trimmedClientId) {
          pending.realChatId = data.id
          if (pendingScrollTurnIdRef.current && !pendingScrollChatIdRef.current) {
            pendingScrollChatIdRef.current = data.id
          }
          tryActivatePendingFirstSend()
        }
        return data.id
      }

      const runtime = ensureConversationRuntime(data.id, {
        selectedActModel: normalizedInitialSelection.actModelId,
        selectedModels: initialSelectedModels,
        askModelSelectionMode: initialAskModelSelectionMode,
        activeChatTitle: initialTitle,
        isFirstMessage: true,
      })
      resetRuntimeState(runtime, {
        selectedActModel: normalizedInitialSelection.actModelId,
        selectedModels: initialSelectedModels,
        askModelSelectionMode: initialAskModelSelectionMode,
        activeChatTitle: initialTitle,
        isFirstMessage: true,
      })
      options.prepareRuntime?.({
        chatId: data.id,
        runtime,
        selectedModels: initialSelectedModels,
        selectedActModel: normalizedInitialSelection.actModelId,
        askModelSelectionMode: initialAskModelSelectionMode,
      })
      runtime.hydrated = true
      if (pendingScrollTurnIdRef.current && !pendingScrollChatIdRef.current) {
        pendingScrollChatIdRef.current = data.id
      }
      activeChatIdRef.current = data.id
      setActiveViewer(data.id)
      setActiveChatId(data.id)
      syncStandaloneChatUrl(data.id)
      applyUiStateToView(runtime.ui)
      setRuntimeHydrationVersion((value) => value + 1)
      resetRuntimeState(emptyRuntimeRef.current)
      clearTransientComposerState()
      return data.id
    }
    return null
  }

  const completeSessionForStream = useCallback((chatId: string, active: boolean) => {
    if (chatId === PENDING_FIRST_CHAT_ID) {
      const pending = pendingFirstSendRef.current
      if (pending) {
        pending.streamDone = true
        if (!pending.realChatId) {
          void createNewChat({
            clientId: pending.conversationClientId,
            deferActivation: true,
          }).catch(() => {
            setComposerNotice('Could not save chat. Your reply may still have streamed.')
            window.setTimeout(() => setComposerNotice(null), 4000)
          })
        }
      }
      completeSession(chatId, true)
      tryActivatePendingFirstSend()
      return
    }
    completeSession(chatId, active)
  }, [completeSession, tryActivatePendingFirstSend, setComposerNotice])

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

  const handleRetryExchange = useCallback(
    async (
      userMsg: UIMessage,
      exchIdx: number,
      isActExch: boolean,
      exchModelList: string[],
    ) => {
      const chatId = activeChatIdRef.current ?? activeChatId
      if (!chatId || isActiveLoading) return
      const turnId = getUserTurnId(userMsg)
      if (!turnId) return
      if (!isActExch) return

      posthog.capture('chat_response_retry_clicked', {
        exchange_index: exchIdx,
        mode: 'act',
      })

      const runtime = ensureConversationRuntime(chatId)
      shouldScrollRef.current = true

      runtime.askChats.forEach((c) => c.stop())
      runtime.actChat.stop()

      const meta = userMsg.metadata as ChatMessageMetadata | undefined
      const indexedFileNames = meta?.indexedDocuments ?? []
      const indexedAttachments = meta?.indexedAttachments ?? []
      const partsForModel =
        userMsg.parts?.filter((p) => p.type === 'text' || p.type === 'file') ?? []
      const replyExtra =
        meta?.replyToTurnId && meta?.replySnippet
          ? String(meta.replySnippet).slice(0, 16000)
          : undefined

      const normalizedRetrySelection = normalizeChatModelSelection({
        askModelIds: exchModelList.length > 0 ? exchModelList : [selectedActModel],
        actModelId: exchModelList[0] ?? selectedActModel,
      })
      const retryModelIds = normalizedRetrySelection.askModelIds
      const multiRetry = retryModelIds.length > 1
      const retrySlots = Math.min(4, retryModelIds.length)
      if (multiRetry) {
        for (let s = 0; s < retrySlots; s++) {
          runtime.askChats[s].messages = stripAssistantAfterUserTurn(
            runtime.askChats[s].messages,
            turnId,
          )
        }
        runtime.actChat.messages = stripAssistantAfterUserTurn(runtime.actChat.messages, turnId)
      } else {
        runtime.actChat.messages = stripAssistantAfterUserTurn(runtime.actChat.messages, turnId)
        runtime.askChats[0].messages = stripAssistantAfterUserTurn(runtime.askChats[0].messages, turnId)
      }
      const modelId = normalizedRetrySelection.actModelId
      const msgCountBeforeSend = runtime.askChats[0].messages.length
      startSession(chatId, 'act', activeChatTitle ?? '', msgCountBeforeSend)

      const baseBody = {
        conversationId: chatId,
        turnId,
        mode,
        automationMode: mode === 'automate',
        ...(mode === 'automate' && automationIdParam ? { automationId: automationIdParam } : {}),
        ...(indexedFileNames.length > 0 ? { indexedFileNames, indexedAttachments } : {}),
        ...(replyExtra ? { replyContextForModel: replyExtra } : {}),
      }

      startActRetryStream({
        chatId,
        targetRuntime: runtime,
        textModelsForTurn: multiRetry ? retryModelIds.slice(0, retrySlots) : [modelId],
        textSlotCount: retrySlots,
        selectedActModel: modelId,
        turnId,
        partsForModel: partsForModel as Array<{ type: string; text?: string; url?: string; mediaType?: string; fileName?: string }>,
        userMetadata: meta,
        commonBody: baseBody,
        isChatActive: (id) => activeChatIdRef.current === id,
        completeSession,
        loadChats,
        loadSubscription,
        onError: (error, fallbackMessage) => reportTextStreamError(setComposerNotice, error, fallbackMessage),
        logPrefix: multiRetry ? 'Act multi retry' : 'Act retry',
      })
    },
    [
      activeChatId,
      activeChatTitle,
      automationIdParam,
      ensureConversationRuntime,
      completeSession,
      loadChats,
      loadSubscription,
      selectedActModel,
      startSession,
      isActiveLoading,
      mode,
    ],
  )

  const effectiveGenType = generationChip ?? (generationMode !== 'text' ? generationMode : null)

  const { requireAuth } = useGuestGate()

  async function handleSend() {
    if (!userId && !authUser) {
      try { sessionStorage.setItem('overlay:guest-draft', inputRef.current) } catch { /* ignore */ }
      requireAuth('send')
      return
    }
    const replyCtxSnapshot = replyContext
    const text = inputRef.current.trim()
    const normalizedTextSelection = normalizeChatModelSelection({
      askModelIds: askModelSelectionMode === 'multiple' ? selectedModels.slice(0, 4) : [selectedActModel],
      actModelId: selectedActModel,
    })
    const selectedActModelSnapshot = normalizedTextSelection.actModelId
    const textModelsForTurn = normalizedTextSelection.askModelIds
    const activeChatTitleSnapshot = activeChatTitle
    const selectedImageModelsSnapshot = [...selectedImageModels]
    const selectedVideoModelsSnapshot = [...selectedVideoModels]
    const attachedImagesSnapshot = [...attachedImages]
    const pendingChatDocumentsSnapshot = [...pendingChatDocuments]
    const mentionsSnapshot = [...mentions]
    const temporaryChatSnapshot = isTemporaryChat
    const requestMode: 'chat' | 'automate' = temporaryChatSnapshot ? 'chat' : mode
    const selectedToolIdsSnapshot = [...selectedToolIds]
    const memoryEnabledSnapshot = memoryEnabled
    const hasReadyDocs = pendingChatDocumentsSnapshot.some((d) => d.status === 'ready')
    const clearSubmittedComposer = () => {
      textareaRef.current?.clear()
      setInput('')
      setMentions([])
      setAttachedImages([])
      setPendingChatDocuments([])
      setAttachmentError(null)
      setReplyContext(null)
      resetComposerToolIds(temporaryChatSnapshot)
    }
    if (isActiveLoading) return

    if (pendingChatDocumentsSnapshot.some((d) => d.status === 'uploading')) {
      setAttachmentError('Wait for documents to finish indexing.')
      return
    }
    if (pendingChatDocumentsSnapshot.some((d) => d.status === 'error')) {
      setAttachmentError('Remove failed documents before sending.')
      return
    }
    if (effectiveGenType === 'image' || effectiveGenType === 'video') {
      if (!text && attachedImagesSnapshot.length === 0) return
    } else if (attachedImagesSnapshot.length === 0 && !text && !hasReadyDocs) {
      return
    }
    if (isSendBlocked) {
      setComposerNotice(
        isBudgetExhaustedPaid
          ? 'Budget exhausted. Add a top-up to continue with paid models, or switch to Auto for free chat.'
          : 'This model requires a paid plan. Switch to Auto or upgrade.',
      )
      return
    }

    posthog.capture('chat_message_sent', {
      mode: 'act',
      generation_type: effectiveGenType,
      has_attachments: attachedImagesSnapshot.length > 0 || pendingChatDocumentsSnapshot.length > 0,
      is_first_message: isFirstMessage,
    })

    beginTtftClientTurn({
      model: selectedActModelSnapshot,
      isFirstMessage,
    })
    setIsOptimisticLoading(true)

    // ── Image / Video generation path ──────────────────────────────────────
    if (effectiveGenType === 'image' || effectiveGenType === 'video') {
      const mediaGenerationModule = import('./chat/chatMediaGeneration')
      const wasFirst = isFirstMessage
      const promptForModel =
        replyCtxSnapshot?.bodyForModel && text
          ? `${text}\n\n---\n[User is replying in thread to prior content]\n${replyCtxSnapshot.bodyForModel}`
          : text
      const mediaSessionMode = 'act'
      const mediaTurnId = crypto.randomUUID()
      const activeModels = effectiveGenType === 'image' ? selectedImageModelsSnapshot : selectedVideoModelsSnapshot
      const mediaUserMessageParts: { type: string; text?: string; url?: string; mediaType?: string; fileName?: string }[] = []
      if (text) mediaUserMessageParts.push({ type: 'text', text })
      for (const img of attachedImagesSnapshot) {
        mediaUserMessageParts.push({ type: 'file', url: img.dataUrl, mediaType: img.mimeType, fileName: img.name })
      }
      const mediaUserMessage = {
        id: mediaTurnId,
        role: 'user',
        parts: mediaUserMessageParts,
        ...(replyCtxSnapshot?.replyToTurnId
          ? {
              metadata: {
                replyToTurnId: replyCtxSnapshot.replyToTurnId,
                replySnippet: replyCtxSnapshot.snippet,
              },
            }
          : {}),
      }
      const mediaSlotCount = Math.max(1, activeModels.length)
      let exchIdx = 0
      let preparedFirstSendRuntime = false
      clearSubmittedComposer()
      setGenerationChip(null)

      const prepareMediaRuntime = (runtime: ConversationRuntime) => {
        const ui = runtime.ui
        exchIdx = ui.exchangeModels.length
        const nextGenerationResults = cloneGenerationResultsMap(ui.generationResults)
        nextGenerationResults.set(
          exchIdx,
          activeModels.map(() => ({ type: effectiveGenType as 'image' | 'video', status: 'generating' as const })),
        )
        runtime.ui = createConversationUiState({
          ...ui,
          exchangeModes: [...ui.exchangeModes, 'act'],
          exchangeModels: [...ui.exchangeModels, [...activeModels]],
          selectedTabPerExchange: [...ui.selectedTabPerExchange, 0],
          exchangeGenTypes: [...ui.exchangeGenTypes, effectiveGenType],
          generationResults: nextGenerationResults,
          isFirstMessage: false,
        })
        runtime.askChats.slice(0, mediaSlotCount).forEach((chat) => {
          chat.messages = [
            ...chat.messages,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mediaUserMessage as any,
          ]
        })
      }

      const existingChatId = temporaryChatSnapshot ? TEMPORARY_CHAT_ID : (activeChatIdRef.current ?? activeChatId)
      pendingScrollTurnIdRef.current = mediaTurnId
      pendingScrollChatIdRef.current = temporaryChatSnapshot ? null : existingChatId
      let chatId = existingChatId
      let targetRuntime: ConversationRuntime
      if (temporaryChatSnapshot) {
        targetRuntime = emptyRuntimeRef.current
        prepareMediaRuntime(targetRuntime)
        targetRuntime.hydrated = true
        applyUiStateToView(targetRuntime.ui)
        setIsFirstMessage(false)
        setRuntimeHydrationVersion((value) => value + 1)
      } else if (!existingChatId) {
        const previewRuntime = emptyRuntimeRef.current
        resetRuntimeState(previewRuntime, {
          selectedActModel,
          selectedModels: activeModels,
          askModelSelectionMode: activeModels.length > 1 ? 'multiple' : 'single',
          activeChatTitle: activeChatTitleSnapshot ?? null,
          isFirstMessage: false,
        })
        prepareMediaRuntime(previewRuntime)
        previewRuntime.hydrated = true
        applyUiStateToView(previewRuntime.ui)
        setIsFirstMessage(false)
        setRuntimeHydrationVersion((value) => value + 1)
        chatId = await createNewChat({
          prepareRuntime: ({ runtime }) => {
            prepareMediaRuntime(runtime)
            preparedFirstSendRuntime = true
          },
        })
      }
      if (!chatId) return
      if (!temporaryChatSnapshot) markChatModified(chatId, activeChatTitleSnapshot)
      if (!temporaryChatSnapshot) targetRuntime = ensureConversationRuntime(chatId)
      else targetRuntime = emptyRuntimeRef.current

      if (!temporaryChatSnapshot && !preparedFirstSendRuntime) {
        updateRuntimeUiState(chatId, (prev) => {
          exchIdx = prev.exchangeModels.length
          const nextGenerationResults = cloneGenerationResultsMap(prev.generationResults)
          nextGenerationResults.set(
            exchIdx,
            activeModels.map(() => ({ type: effectiveGenType as 'image' | 'video', status: 'generating' as const })),
          )
          return {
            ...prev,
            exchangeModes: [...prev.exchangeModes, 'act'],
            exchangeModels: [...prev.exchangeModels, [...activeModels]],
            selectedTabPerExchange: [...prev.selectedTabPerExchange, 0],
            exchangeGenTypes: [...prev.exchangeGenTypes, effectiveGenType],
            generationResults: nextGenerationResults,
            isFirstMessage: false,
          }
        })
        targetRuntime.askChats.slice(0, mediaSlotCount).forEach((chat) => {
          chat.messages = [
            ...chat.messages,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mediaUserMessage as any,
          ]
        })
      }

      setIsFirstMessage(false)
      if (!temporaryChatSnapshot) {
        void overlayAppClient.conversations.addMessageResponse(
          {
            conversationId: chatId,
            turnId: mediaTurnId,
            mode: 'act',
            role: 'user',
            content: text,
            parts: [{ type: 'text', text }],
            modelId: activeModels[0],
            ...(replyCtxSnapshot?.replyToTurnId
              ? { replyToTurnId: replyCtxSnapshot.replyToTurnId, replySnippet: replyCtxSnapshot.snippet }
              : {}),
          },
          { idempotencyKey: `${mediaTurnId}:user` },
        )
        if (wasFirst && text) startFirstMessageRename(chatId, text)
      }
      startSession(chatId, mediaSessionMode, temporaryChatSnapshot ? 'Temporary chat' : activeChatTitleSnapshot ?? '', targetRuntime.askChats[0].messages.length)
      const updateMediaRuntimeUiState = temporaryChatSnapshot
        ? (_chatId: string, updater: (prev: ConversationUiState) => ConversationUiState) => {
            targetRuntime.ui = updater(cloneConversationUiState(targetRuntime.ui))
            applyUiStateToView(targetRuntime.ui)
            setRuntimeHydrationVersion((value) => value + 1)
          }
        : updateRuntimeUiState

      // ── Block generation for free-tier users ───────────────────────────────
      if (isFreeTier) {
        const { scheduleMediaGenerationUpgradeFailure } = await mediaGenerationModule
        scheduleMediaGenerationUpgradeFailure({
          chatId,
          exchIdx,
          kind: effectiveGenType,
          activeModels,
          isChatActive: (id) => temporaryChatSnapshot ? (id === TEMPORARY_CHAT_ID && isTemporaryChatRef.current) : activeChatIdRef.current === id,
          updateRuntimeUiState: updateMediaRuntimeUiState,
          completeSession,
        })
        return
      }

      if (effectiveGenType === 'image') {
        const { runImageGenerationBatch } = await mediaGenerationModule
        // Prefer an explicitly attached reference image; fall back to the last generated image
        const imageUrl = attachedImagesSnapshot[0]?.dataUrl ?? targetRuntime.ui.lastGeneratedImageUrl
        runImageGenerationBatch({
          chatId,
          temporaryChat: temporaryChatSnapshot,
          turnId: mediaTurnId,
          exchIdx,
          promptForModel,
          userPromptText: text,
          activeModels,
          targetRuntime,
          mediaSlotCount,
          imageUrl,
          isChatActive: (id) => temporaryChatSnapshot ? (id === TEMPORARY_CHAT_ID && isTemporaryChatRef.current) : activeChatIdRef.current === id,
          updateRuntimeUiState: updateMediaRuntimeUiState,
          completeSession,
          loadChats: temporaryChatSnapshot ? (() => {}) : loadChats,
          loadSubscription,
        })
      } else {
        const { runVideoGenerationBatch } = await mediaGenerationModule
        runVideoGenerationBatch({
          chatId,
          temporaryChat: temporaryChatSnapshot,
          turnId: mediaTurnId,
          exchIdx,
          promptForModel,
          userPromptText: text,
          activeModels,
          targetRuntime,
          mediaSlotCount,
          videoSubMode,
          imageUrl: attachedImagesSnapshot[0]?.dataUrl ?? null,
          isChatActive: (id) => temporaryChatSnapshot ? (id === TEMPORARY_CHAT_ID && isTemporaryChatRef.current) : activeChatIdRef.current === id,
          updateRuntimeUiState: updateMediaRuntimeUiState,
          completeSession,
          loadChats: temporaryChatSnapshot ? (() => {}) : loadChats,
          loadSubscription,
        })
      }
      return
    }

    // ── Normal text chat path ─────────────────────────────────────────────
    const readyDocs = pendingChatDocumentsSnapshot.filter((d) => d.status === 'ready')
    const indexedAttachments = readyDocs.map((d) => ({ name: d.name, fileIds: d.fileIds }))
    const indexedFileNames = readyDocs.map((d) => d.name)

    // Capture before any await — isFirstMessage is true for the first message of a new/fresh chat
    const wasFirst = isFirstMessage
    const textTurnId = crypto.randomUUID()
    setTtftClientTurnId(textTurnId)

    type UiPart = { type: string; text?: string; url?: string; mediaType?: string; fileName?: string }
    const partsForModel: UiPart[] = []
    if (text.trim()) partsForModel.push({ type: 'text', text: text.trim() })
    for (const img of attachedImagesSnapshot) {
      partsForModel.push({ type: 'file', url: img.dataUrl, mediaType: img.mimeType, fileName: img.name })
    }
    const partsForPersist: UiPart[] = [...partsForModel]
    if (indexedFileNames.length > 0) {
      partsForPersist.push({
        type: 'text',
        text: `[Indexed documents: ${indexedFileNames.join(', ')}]`,
      })
    }

    const userMeta: ChatMessageMetadata = {}
    if (indexedFileNames.length > 0) {
      userMeta.indexedDocuments = indexedFileNames
      userMeta.indexedAttachments = indexedAttachments
    }
    if (replyCtxSnapshot?.replyToTurnId) {
      userMeta.replyToTurnId = replyCtxSnapshot.replyToTurnId
      userMeta.replySnippet = replyCtxSnapshot.snippet
    }
    if (mentionsSnapshot.length > 0) {
      userMeta.mentions = mentionsSnapshot.map((m) => ({
        type: m.type,
        id: m.id,
        name: m.name,
        ...(m.meta?.fileIds ? { fileIds: m.meta.fileIds as string[] } : {}),
      }))
    }
    const userMetadata = Object.keys(userMeta).length > 0 ? userMeta : undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userUIMessage: any = {
      id: textTurnId,
      role: 'user',
      parts: partsForModel,
      ...(userMetadata ? { metadata: userMetadata } : {}),
    }
    clearSubmittedComposer()

    const multiText = textModelsForTurn.length > 1
    const textSlotCount = Math.min(4, textModelsForTurn.length)
    let msgCountBeforeSend = 0
    let preparedFirstSendRuntime = false
    let textHistoryBaseModelId: string | undefined

    const prepareTextRuntime = (runtime: ConversationRuntime) => {
      textHistoryBaseModelId = prepareAskModelThreadsForTextTurn(runtime, textModelsForTurn).historyBaseModelId
      msgCountBeforeSend = runtime.askChats[0].messages.length
      const ui = runtime.ui
      runtime.ui = createConversationUiState({
        ...ui,
        exchangeModes: [...ui.exchangeModes, 'act'],
        exchangeModels: [...ui.exchangeModels, [...textModelsForTurn]],
        selectedTabPerExchange: [...ui.selectedTabPerExchange, 0],
        exchangeGenTypes: [...ui.exchangeGenTypes, 'text'],
        isFirstMessage: false,
      })
      for (let s = 0; s < textSlotCount; s++) {
        runtime.askChats[s]!.messages = [
          ...runtime.askChats[s]!.messages,
          userUIMessage as UIMessage,
        ]
      }
      if (!multiText) {
        runtime.actChat.messages = [
          ...runtime.actChat.messages,
          userUIMessage as UIMessage,
        ]
      }
    }

    const existingChatId = temporaryChatSnapshot ? TEMPORARY_CHAT_ID : (activeChatIdRef.current ?? activeChatId)
    pendingScrollTurnIdRef.current = textTurnId
    pendingScrollChatIdRef.current = temporaryChatSnapshot ? null : existingChatId
    let chatId = existingChatId
    let targetRuntime: ConversationRuntime
    if (temporaryChatSnapshot) {
      targetRuntime = emptyRuntimeRef.current
      prepareTextRuntime(targetRuntime)
      targetRuntime.hydrated = true
      applyUiStateToView(targetRuntime.ui)
      setIsFirstMessage(false)
      setRuntimeHydrationVersion((value) => value + 1)
    } else if (!existingChatId) {
      const previewRuntime = emptyRuntimeRef.current
      resetRuntimeState(previewRuntime, {
        selectedActModel: selectedActModelSnapshot,
        selectedModels: textModelsForTurn,
        askModelSelectionMode: textModelsForTurn.length > 1 ? 'multiple' : 'single',
        activeChatTitle: activeChatTitleSnapshot ?? null,
        isFirstMessage: false,
      })
      prepareTextRuntime(previewRuntime)
      previewRuntime.hydrated = true
      applyUiStateToView(previewRuntime.ui)
      setIsFirstMessage(false)
      setRuntimeHydrationVersion((value) => value + 1)

      const conversationClientId = crypto.randomUUID()
      pendingFirstSendRef.current = {
        conversationClientId,
        previewRuntime,
        streamDone: false,
        realChatId: null,
        wasFirst,
        renameSeed: text || indexedFileNames[0] || 'Documents',
        activeChatTitleSnapshot,
      }
      chatId = PENDING_FIRST_CHAT_ID
      targetRuntime = previewRuntime
      preparedFirstSendRuntime = true

      void createNewChat({
        clientId: conversationClientId,
        deferActivation: true,
      }).catch(() => {
        setComposerNotice('Could not create chat. Your reply may still stream.')
        window.setTimeout(() => setComposerNotice(null), 4000)
      })
      markTtftClientMilestone('create_started', { conversationClientId })
    } else {
      targetRuntime = ensureConversationRuntime(existingChatId)
    }
    if (!chatId) return
    if (!temporaryChatSnapshot && chatId !== PENDING_FIRST_CHAT_ID) {
      markChatModified(chatId, activeChatTitleSnapshot)
    }

    if (
      !temporaryChatSnapshot &&
      chatId !== PENDING_FIRST_CHAT_ID &&
      wasFirst &&
      (text || indexedFileNames.length > 0)
    ) {
      startFirstMessageRename(chatId, text || indexedFileNames[0] || 'Documents')
    }

    if (!temporaryChatSnapshot && chatId !== PENDING_FIRST_CHAT_ID) {
      activeChatIdRef.current = chatId
    }

    if (!temporaryChatSnapshot && !preparedFirstSendRuntime) {
      textHistoryBaseModelId = prepareAskModelThreadsForTextTurn(targetRuntime, textModelsForTurn).historyBaseModelId
      msgCountBeforeSend = targetRuntime.askChats[0].messages.length
      updateRuntimeUiState(chatId, (prev) => ({
        ...prev,
        exchangeModes: [...prev.exchangeModes, 'act'],
        exchangeModels: [...prev.exchangeModels, [...textModelsForTurn]],
        selectedTabPerExchange: [...prev.selectedTabPerExchange, 0],
        exchangeGenTypes: [...prev.exchangeGenTypes, 'text'],
        isFirstMessage: false,
      }))

      for (let s = 0; s < textSlotCount; s++) {
        targetRuntime.askChats[s]!.messages = [
          ...targetRuntime.askChats[s]!.messages,
          userUIMessage as UIMessage,
        ]
      }
      if (!multiText) {
        targetRuntime.actChat.messages = [
          ...targetRuntime.actChat.messages,
          userUIMessage as UIMessage,
        ]
      }
    }

    startSession(chatId, 'act', temporaryChatSnapshot ? 'Temporary chat' : activeChatTitleSnapshot ?? '', msgCountBeforeSend)

    setIsFirstMessage(false)

    const commonActBody = {
      ...(temporaryChatSnapshot
        ? { temporaryChat: true }
        : chatId === PENDING_FIRST_CHAT_ID
          ? {
              conversationClientId: pendingFirstSendRef.current!.conversationClientId,
              ...(embedProjectId ? { projectId: embedProjectId } : {}),
              askModelIds: textModelsForTurn,
            }
          : { conversationId: chatId }),
      turnId: textTurnId,
      mode: requestMode,
      automationMode: requestMode === 'automate',
      ...(requestMode === 'automate' && automationIdParam ? { automationId: automationIdParam } : {}),
      ...(indexedFileNames.length > 0
        ? { indexedFileNames, indexedAttachments: indexedAttachments }
        : {}),
      ...(replyCtxSnapshot?.bodyForModel ? { replyContextForModel: replyCtxSnapshot.bodyForModel } : {}),
      ...(userMeta.mentions && userMeta.mentions.length > 0 ? { mentions: userMeta.mentions } : {}),
      ...(textHistoryBaseModelId ? { historyBaseModelId: textHistoryBaseModelId } : {}),
      requestedToolIds: selectedToolIdsSnapshot,
      memoryEnabled: memoryEnabledSnapshot,
    }

    const refreshAfterActTextTurn = async () => {
      await loadSubscription()
      if (requestMode === 'automate' && automationIdParam) {
        await refreshSelectedAutomation({ showLoading: false })
        window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
      }
    }

    startActTextStream({
      chatId,
      targetRuntime,
      textModelsForTurn,
      textSlotCount,
      selectedActModel: selectedActModelSnapshot,
      turnId: textTurnId,
      partsForModel,
      userMetadata,
      commonBody: commonActBody,
      isChatActive: (id) => isStreamChatActive(id, temporaryChatSnapshot),
      completeSession: completeSessionForStream,
      loadChats: temporaryChatSnapshot ? (() => {}) : loadChats,
      loadSubscription: refreshAfterActTextTurn,
      onError: (error, fallbackMessage) => reportTextStreamError(setComposerNotice, error, fallbackMessage),
      logPrefix: multiText ? 'Act multi' : 'Act',
    })
  }

  const handleModeChange = useCallback((mode: GenerationMode) => {
    setGenerationMode(mode)
    setGenerationChip(null)
    safeSetLocalStorage(CHAT_GEN_MODE_KEY, mode)
  }, [setGenerationChip, setGenerationMode])

  const focusComposer = useCallback(() => {
    window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
  }, [])

  const handleEmptySuggestion = useCallback(
    (id: EmptyChatSuggestionId) => {
      if (id === 'image') {
        handleModeChange('image')
        setGenerationChip('image')
        setInput('')
        focusComposer()
        return
      }
      if (id === 'write') {
        handleModeChange('text')
        setInput('Help me write or edit ')
        focusComposer()
        return
      }
      handleModeChange('text')
      setSelectedToolIds((current) =>
        current.includes('web_search') ? current : [...current, 'web_search'],
      )
      setInput('Look up ')
      focusComposer()
    },
    [focusComposer, handleModeChange, setGenerationChip, setInput],
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
  }, [setGenerationChip, setGenerationMode])

  async function stopActiveChat() {
    if (!isActiveLoading) return
    const userTurns = primaryMessages.filter((m) => m.role === 'user').length
    const idx = userTurns > 0 ? userTurns - 1 : -1
    const chatId = activeChatIdRef.current ?? activeChatId
    const cloudflareStopTargets = new Map<string, { turnId: string; variantIndex: number }>()
    const collectCloudflareStopTargets = (messages: UIMessage[]) => {
      for (const message of messages) {
        const m = message as unknown as {
          role?: string
          status?: string
          turnId?: string
          id?: string
          variantIndex?: number
        }
        if (m.role === 'assistant' && m.status === 'generating' && m.turnId?.trim()) {
          const variantIndex = m.variantIndex ?? 0
          cloudflareStopTargets.set(`${m.turnId}:${variantIndex}`, {
            turnId: m.turnId,
            variantIndex,
          })
        }
      }
    }
    collectCloudflareStopTargets(activeRuntime.actChat.messages as UIMessage[])
    for (const chat of activeRuntime.askChats) {
      collectCloudflareStopTargets(chat.messages as UIMessage[])
    }
    if (cloudflareStopTargets.size === 0) {
      const lastUser = [...primaryMessages].reverse().find((message) => message.role === 'user') as
        | (UIMessage & { id?: string })
        | undefined
      const turnId = lastUser?.id?.trim()
      if (turnId) {
        cloudflareStopTargets.set(`${turnId}:0`, { turnId, variantIndex: 0 })
      }
    }

    // 1. Stop local streams immediately
    activeAskChats.forEach((chat) => chat.stop())
    activeRuntime.actChat.stop()

    // 2. Tell the backend to finalize the generating message before we clear
    //    local state, so patchFromServer doesn't race and restore the spinner.
    if (chatId) {
      if (chatStreamRelayApi && cloudflareStopTargets.size > 0) {
        await Promise.allSettled([...cloudflareStopTargets.values()].map((target) =>
          fetch(`${chatStreamRelayApi}/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              conversationId: chatId,
              turnId: target.turnId,
              variantIndex: target.variantIndex,
              multiModelSlotIndex: target.variantIndex,
            }),
          }),
        ))
      }
      try {
        await Promise.race([
          overlayAppClient.conversations.stopResponse({ conversationId: chatId }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 5000),
          ),
        ])
      } catch {
        // Backend call failed or timed out — proceed with local cleanup anyway
      }
    }

    // 3. Clear any stuck 'generating' status from local messages so
    //    activePersistedGenerating drops immediately.
    for (const chat of activeRuntime.askChats) {
      let changed = false
      for (const msg of chat.messages) {
        const m = msg as unknown as { role?: string; status?: string }
        if (m.role === 'assistant' && m.status === 'generating') {
          m.status = 'completed'
          changed = true
        }
      }
      if (changed) chat.messages = [...chat.messages]
    }
    let actChanged = false
    for (const msg of activeRuntime.actChat.messages) {
      const m = msg as unknown as { role?: string; status?: string }
      if (m.role === 'assistant' && m.status === 'generating') {
        m.status = 'completed'
        actChanged = true
      }
    }
    if (actChanged) activeRuntime.actChat.messages = [...activeRuntime.actChat.messages]

    // Sync useChat instances so the UI reflects the cleared state
    chat0.setMessages([...activeRuntime.askChats[0].messages] as UIMessage[])
    if (activeAskChats[1]) chat1.setMessages([...activeRuntime.askChats[1].messages] as UIMessage[])
    if (activeAskChats[2]) chat2.setMessages([...activeRuntime.askChats[2].messages] as UIMessage[])
    if (activeAskChats[3]) chat3.setMessages([...activeRuntime.askChats[3].messages] as UIMessage[])
    actChat.setMessages([...activeRuntime.actChat.messages] as UIMessage[])

    if (idx >= 0) setInterruptedExchangeIdx(idx)
    forceLiveSyncRender((v) => v + 1)

    // Nuclear option: if Chat.status itself is still stuck after 3s,
    // delete and recreate the runtime with fresh Chat objects.
    if (!chatId) return
    setTimeout(() => {
      const runtime = runtimesRef.current.get(chatId)
      if (!runtime) return
      const stillLoading =
        runtime.askChats.some((c) => c.status === 'streaming' || c.status === 'submitted') ||
        runtime.actChat.status === 'streaming' ||
        runtime.actChat.status === 'submitted'
      if (stillLoading) {
        const uiSnapshot = { ...runtime.ui }
        const oldAskMessages = runtime.askChats.map((c) => [...c.messages])
        const oldActMessages = [...runtime.actChat.messages]
        replaceConversationRuntime(chatId, uiSnapshot, oldAskMessages as UIMessage[][], oldActMessages as UIMessage[])
        forceLiveSyncRender((v) => v + 1)
      }
    }, 400)
  }

  const stopActiveChatRef = useRef(stopActiveChat)
  stopActiveChatRef.current = stopActiveChat

  function handleContinue() {
    setInput('continue')
    void handleSend()
  }

  // Stale-chat client-side guard: if the backend says a message is still generating
  // but no local HTTP stream has produced activity in >30s, force-stop the chat.
  useEffect(() => {
    if (!activeChatId) return
    const id = setInterval(() => {
      const runtime = runtimesRef.current.get(activeChatId)
      if (!runtime) return
      const hasLocalStream =
        runtime.askChats.some((c) => c.status === 'streaming' || c.status === 'submitted') ||
        runtime.actChat.status === 'streaming' ||
        runtime.actChat.status === 'submitted'
      if (hasLocalStream) {
        lastStreamChunkAtRef.current = Date.now()
        return
      }
      const hasPersistedGenerating = (liveMessages ?? []).some(
        (message) => message.role === 'assistant' && message.status === 'generating',
      )
      if (!hasPersistedGenerating) return
      if (Date.now() - lastStreamChunkAtRef.current > 30000) {
        stopActiveChatRef.current()
      }
    }, 5000)
    return () => clearInterval(id)
  }, [activeChatId, liveMessages, runtimesRef])

  // ── derived values for header ─────────────────────────────────────────────

  const activeChat = chats.find((c) => c._id === activeChatId)
  const selectedGatewayModelName = gatewayCatalogModels.find(
    (model) => model.id === selectedActModel || model.gatewayId === selectedActModel,
  )?.name
  const registeredModelName = getChatModelDisplayName(selectedActModel)
  const selectedTextModelName =
    selectedGatewayModelName ||
    (registeredModelName !== selectedActModel ? registeredModelName : readableModelId(selectedActModel))
  const modelPickerLabel = generationMode === 'image'
    ? (selectedImageModels.length === 1 ? (IMAGE_MODELS.find((m) => m.id === selectedImageModels[0])?.name ?? 'Select model') : `${selectedImageModels.length} models`)
    : generationMode === 'video'
    ? (selectedVideoModels.length === 1 ? (VIDEO_MODELS.find((m) => m.id === selectedVideoModels[0])?.name ?? 'Select model') : `${selectedVideoModels.length} models`)
    : (askModelSelectionMode === 'multiple' && selectedModels.length > 1
      ? `${selectedModels.length} models`
      : (selectedTextModelName || (gatewayModelsLoading ? 'Loading models…' : 'Select model')))

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

  const handleSendRef = useRef(handleSend)
  handleSendRef.current = handleSend

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
  const budgetTopUpPrompt = isBudgetExhaustedPaid && !isSendBlocked && !isActiveLoading ? (
    <BudgetTopUpComposerPrompt
      amountCents={topUpAmountDraftCents}
      remainingCents={budgetRemainingCents}
      checkoutLoading={billingActionLoading === 'checkout'}
      onStartTopUp={() => void handleStartTopUp()}
    />
  ) : null

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

  const onHoveredModelChange = useCallback((modelId: string | null, position: { x: number; y: number } | null) => {
    setHoveredModelId(modelId)
    setModelQualitiesPos(position)
  }, [])

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
    shellRightPanelWidth,
  } = useChatShellPanels({
    attachmentPreview,
    attachmentPreviewMode,
    closeAttachmentPreview,
    closeSourcesPanel,
    setAttachmentPreviewMode,
    sourcesPanel,
    renderAttachmentViewer,
  })

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
    <AppScreenShell
      className="min-w-0 overflow-x-hidden"
      contentClassName="flex min-h-0"
      rightPanel={shellRightPanel}
      rightPanelOpen={Boolean(shellRightPanel)}
      rightPanelWidth={shellRightPanelWidth}
      onRightPanelClose={shellRightPanelClose}
    >
      {/* Main area */}
      <div
        className={`relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden transition-opacity duration-200 ${
          activeChatDeleting ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
        onDragEnter={(e) => {
          e.preventDefault()
          dragCounterRef.current++
          if (e.dataTransfer.types.includes('Files')) setIsDragging(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragCounterRef.current--
          if (dragCounterRef.current === 0) setIsDragging(false)
        }}
        onDrop={(e) => {
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
        }}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[color:color-mix(in_srgb,var(--background)_72%,transparent)] p-4 backdrop-blur-sm">
            <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_92%,transparent)] px-6 py-5 text-center shadow-[0_18px_55px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.03] dark:shadow-[0_18px_55px_rgba(0,0,0,0.36)] dark:ring-white/[0.04]">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]">
                  <ImageIcon size={16} strokeWidth={1.75} />
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]">
                  <FileText size={16} strokeWidth={1.75} />
                </span>
              </div>
              <p className="text-sm font-medium text-[var(--foreground)]">Drop images or documents here</p>
              <p className="mt-1 text-xs text-[var(--muted)]">JPEG, PNG, PDF, Word, and text files</p>
            </div>
          </div>
        )}
        <ChatExperienceHeader
          hideHeader={hideHeader}
          activeChatId={activeChatId}
          editingChatId={editingChatId}
          editingChatTitle={editingChatTitle}
          onEditingChatTitleChange={setEditingChatTitle}
          onCommitChatRename={commitChatRename}
          onCancelChatRename={cancelChatRename}
          headerTitleInputRef={headerTitleInputRef}
          showAutomationHeaderControls={showAutomationHeaderControls}
          titleLabel={headerTitleLabel}
          onBeginHeaderChatRename={beginHeaderChatRename}
          showRenameButton={Boolean(activeChatId && !selectedAutomation)}
          projectName={projectName}
          showAutomationChatTab={showAutomationChatTab}
          appMode={mode}
          isTemporaryChat={isTemporaryChat}
          isActiveLoading={isActiveLoading}
          onTemporaryChatToggle={handleTemporaryChatToggle}
          onGenerationModeChange={handleModeChange}
          generationMode={generationMode}
          renderExportMenu={renderExportMenu}
          modelPickerRef={modelPickerRef}
          videoSubModePickerRef={videoSubModePickerRef}
          modelPickerListScrollRef={modelPickerListScrollRef}
          showModelPicker={showModelPicker}
          onToggleModelPicker={() => setShowModelPicker((value) => !value)}
          onSetShowModelPicker={setShowModelPicker}
          modelPickerLabel={modelPickerLabel}
          hoveredModelId={hoveredModelId}
          modelQualitiesPos={modelQualitiesPos}
          onHoveredModelChange={onHoveredModelChange}
          resolveModel={getModel}
          isFreeTier={isFreeTier}
          isFreeTierChatModelId={isFreeTierChatModelId}
          automationHeaderModelId={automationHeaderModelId}
          automationHeaderModels={automationHeaderModels}
          onSaveAutomationHeaderModel={saveAutomationHeaderModel}
          getChatModelDisplayName={getChatModelDisplayName}
          automationDetailTab={automationDetailTab}
          onSelectAutomationDetailTab={selectAutomationDetailTab}
          videoSubMode={videoSubMode}
          showVideoSubModePicker={showVideoSubModePicker}
          onToggleVideoSubModePicker={() => setShowVideoSubModePicker((value) => !value)}
          onSetShowVideoSubModePicker={setShowVideoSubModePicker}
          onVideoSubModeChange={handleVideoSubModeChange}
          imageModels={IMAGE_MODELS}
          selectedImageModels={selectedImageModels}
          imageModelSelectionMode={imageModelSelectionMode}
          onToggleImageModel={toggleImageModelInPicker}
          onImageModelSelectionModeChange={handleImageModelSelectionModeChange}
          videoModels={getVideoModelsBySubMode(videoSubMode)}
          selectedVideoModels={selectedVideoModels}
          videoModelSelectionMode={videoModelSelectionMode}
          onToggleVideoModel={toggleVideoModelInPicker}
          onVideoModelSelectionModeChange={handleVideoModelSelectionModeChange}
          selectableTextModels={selectableTextModels}
          textModelsLoading={gatewayModelsLoading}
          askModelSelectionMode={askModelSelectionMode}
          selectedActModel={selectedActModel}
          selectedModels={selectedModels}
          onToggleTextModel={toggleTextModelInPicker}
          onTextModelSelectionModeChange={handleTextModelSelectionModeChange}
          hasAutomationContext={hasAutomationContext}
        />


        <AppScreenBody
          padding="none"
          maxWidth="none"
          scroll="hidden"
          className={`flex min-h-0 flex-1 flex-col transition-[background-color,background-image] duration-300 ${
            isTemporaryChat ? 'temporary-chat-body-pattern' : ''
          }`}
        >
        {hasAutomationContext && !selectedAutomationLoading && !selectedAutomation && !showAutomationChatTab && (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6">
            <p className="text-sm text-[var(--muted)]">Automation not found.</p>
          </div>
        )}

        {!showAutomationChatTab && selectedAutomation && automationDetailTab === 'edit' && (
          <AutomationEditorPanel
            automation={selectedAutomation}
            onSaved={setSelectedAutomation}
            onTested={(conversationId) => {
              const params = new URLSearchParams(searchParams?.toString() ?? '')
              params.set('id', conversationId)
              params.set('automationId', selectedAutomation._id)
              params.delete('tab')
              router.replace(`${pathname}?${params.toString()}`)
            }}
            isFreeTier={isFreeTier}
          />
        )}

        {/* Messages — only after first exchange; existing chat loading reserves this area so the composer stays docked. */}
        {showAutomationChatTab && (hasHistory || showChatLoadingState) && (
          <ChatMessageList
            messagesScrollRef={messagesScrollRef}
            messagesEndRef={messagesEndRef}
            floatingControl={showScrollToBottomControl ? (
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
            ) : null}
            showLoadingState={showChatLoadingState}
            reserveLatestExchangeStartSpace={reserveLatestExchangeStartSpace}
            state={{
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
            }}
            runtime={{
              actChat,
              chatInstances,
              isActiveLoading,
              isOptimisticLoading,
              interruptedExchangeIdx,
              exitingTurnIds,
              sourcesPanel,
              getResponseForExchangeForModel,
            }}
            actions={{
              onTabSelect: handleTabSelect,
              onJumpToReply: jumpToReplyTarget,
              onDeleteTurn: handleDeleteTurnById,
              onReplyToMediaPrompt: beginReplyToMediaPrompt,
              onReplyToAssistantText: beginReplyToAssistantText,
              onBranch: handleBranchConversationAtTurn,
              onOpenDraft: setDraftModalState,
              onCreateAutomationDraft: handleCreateAutomationDraftViaChat,
              onOpenSources: openSourcesPanel,
              onRetry: handleRetryExchange,
              onOpenFilePreview: openFilePreview,
              onOpenAttachmentPreview: openAttachmentPreview,
              onContinue: handleContinue,
              onGeneratedUiChange: handleGeneratedUiChange,
              generatedUiConnectorActions,
            }}
          />
        )}
        {showAutomationChatTab && (
          <ChatComposer
            mode={composerMode}
            emptyState={{
              showCenteredEmptyChat,
              greetingLine,
              belowEmptyComposer,
            }}
            attachments={{
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
            }}
            runtime={{
              composerNotice,
              billingPromptContent: budgetTopUpPrompt,
              isSendBlocked,
              isActiveLoading,
              isTemporaryChat,
              blockedComposerContent: isBudgetExhaustedPaid ? (
                <TopUpPreferenceControl
                  variant="app"
                  title="No budget for paid models"
                  description="You can keep chatting with free models now. Add budget to use paid models and gated tools like web search, browser sessions, sandboxes, image generation, and video generation."
                  amountCents={topUpAmountDraftCents}
                  minAmountCents={entitlements?.topUpMinAmountCents ?? 800}
                  maxAmountCents={entitlements?.topUpMaxAmountCents ?? 20_000}
                  stepAmountCents={entitlements?.topUpStepAmountCents ?? 100}
                  onAmountChange={setTopUpAmountDraftCents}
                  autoTopUpEnabled={autoTopUpEnabledDraft}
                  onAutoTopUpEnabledChange={setAutoTopUpEnabledDraft}
                  checkboxDescription="If enabled, the same amount will recharge automatically whenever your cumulative budget reaches zero."
                  note={
                    <>
                      Your paid storage stays active. You can also manage budget from{' '}
                      <Link href="/account" className="font-medium underline underline-offset-4">
                        Account
                      </Link>
                      .
                    </>
                  }
                  footer={
                    <>
                      <button
                        type="button"
                        onClick={() => void handleStartTopUp()}
                        disabled={billingActionLoading === 'checkout'}
                        className="inline-flex items-center justify-center rounded-xl bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        {billingActionLoading === 'checkout'
                          ? 'Opening checkout...'
                          : `Add $${(topUpAmountDraftCents / 100).toFixed(0)} top-up`}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveTopUpPreference()}
                        disabled={billingActionLoading === 'save'}
                        className="inline-flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        {billingActionLoading === 'save' ? 'Saving...' : 'Save top-up preference'}
                      </button>
                    </>
                  }
                />
              ) : (
                <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-xs text-[var(--muted)]">
                  <ArrowUp size={13} className="shrink-0 text-amber-500" />
                  This model requires a paid plan. Switch to Auto or upgrade.
                </div>
              ),
            }}
            inputState={{
              replyContext,
              setReplyContext,
              textareaRef,
              input,
              inputRevision,
              onInputChange: handleComposerInputChange,
              onMentionsChange: handleMentionsChange,
              onPaste: handlePaste,
              hasComposerText,
            }}
            toolState={{
              showAttachMenu,
              setShowAttachMenu,
              attachMenuRef,
              selectedToolIds,
              memoryEnabled,
              capabilities,
              onToggleTool: toggleComposerTool,
              onToggleMemory: () => setMemoryEnabled((current) => !current),
              onRemoveTool: removeComposerTool,
            }}
            modeState={{
              onModeChange: handleModeChange,
              generationChip,
              setGenerationChip,
              showModeMenu,
              setShowModeMenu,
              modeMenuRef,
              onNavigateMode: (nextMode) => {
                router.push(nextMode === 'chat' ? '/app/chat' : '/app/automations')
                setShowModeMenu(false)
              },
            }}
            actions={{
              onStop: stopActiveChat,
              onSend: handleSend,
              onEmptySuggestion: handleEmptySuggestion,
              onAutomateSuggestion: handleAutomateSuggestion,
            }}
          />
        )}
        </AppScreenBody>

        <DraftReviewModal
          state={draftModalState}
          saving={isDraftSaving}
          onClose={() => {
            if (!isDraftSaving) setDraftModalState(null)
          }}
          onSaveSkill={saveSkillDraft}
          onSaveAutomation={handleCreateAutomationDraftViaChat}
        />

      </div>
    </AppScreenShell>

      <AttachmentPreviewDialog
        open={Boolean(attachmentPreview && attachmentPreviewMode === 'dialog')}
        preview={attachmentPreview}
        onClose={closeAttachmentPreview}
        onModeChange={setAttachmentPreviewMode}
        renderViewer={renderAttachmentViewer}
      />

    </>
  )
}

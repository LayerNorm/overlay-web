import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  PanelLeft,
  Keyboard,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  SquarePen,
  FolderTree
} from 'lucide-react'
import { usePanelTheme } from '../hooks/usePanelTheme'
import { ShortcutsMenu } from '../components/ShortcutsMenu'
import { FindBar } from '../components/ui/FindBar'
import { NativeProjectFileTreeHost } from '../components/ui/NativeProjectFileTreeHost'
import { Tab } from '../components/chat/ChatHeader'
import DockablePanel from '../components/DockablePanel'
import { useDockableDrag } from '../components/DockablePanelContext'
import { OptionDragOverlay } from '../components/OptionDragOverlay'
import { PanelSidebarFrame } from '../components/panel/PanelSidebarFrame'
import { PanelFrameBorder } from '../components/panel/PanelFrameBorder'
import { CUSTOM_AUTH_BASE_URL } from '../services/auth-service'

import {
  ChatHeader,
  ChatSidebar,
  ChatInputArea,
  ChatViewHeader,
  DesktopChatTranscript,
  DesktopAttachmentPreviewDialog,
  DesktopAttachmentPreviewPanel,
  useDesktopAttachmentPreview,
  DesktopSourcesPanel,
  EmptyState,
  ChatModel,
  Screenshot,
  Message,
  ChatMeta,
  ProviderResponse,
  MessageRenderPart,
  FolderView,
  AgentStep,
  Mention,
  type ChatInputAreaHandle,
  type ChatSendOptions,
  buildRequestedToolInstruction
} from '../components/chat'
import {
  cloneMessagesThroughTurn,
  messageIdsForTurnDeletion
} from '../components/chat/desktopTranscriptActions'
import {
  deriveDesktopProviderResponseStatus,
  isDesktopComposerStreaming,
  settleDesktopMessagesAsInterrupted
} from '../components/chat/desktopRuntimeStatus'
import { getChatFolderId, loadChatFolders } from '../utils/folderStorage'
import { analytics } from '../services/analytics'
import { generateCloudChatTitle, streamCloudActMessage } from '../services/cloud-chat-service'
import {
  mergeStreamingConversationParts,
  finalizeStreamingConversationParts,
  type GenerationResult,
  type WebSourceItem
} from '@overlay/chat-core'
import { useTranscriptScroll } from '@overlay/chat-react/transcript'
import { useAppBootstrap } from '../contexts/AppBootstrapContext'
import { filterToEnabledChatModels } from '../utils/enabledChatModels'
import { screenshotUrl } from '../utils/chatMediaPersistence'
import { migrateLegacyChatMedia } from '../utils/chatMediaPersistence'
import { runDesktopMediaGenerationBatch } from '../services/desktop-media-generation'
import {
  afterPanelFirstPaint,
  focusAfterPanelPaint,
  markPanelHydrateComplete,
  signalPanelShellReady
} from '../utils/panelLatency'
import {
  loadChatsMeta,
  listChatsMeta,
  loadChat,
  getChat,
  saveChat,
  deleteTurn,
  deleteChat as deleteChatFromStorage,
  getLastOpenedChatId,
  setLastOpenedChatId,
  createNewChat,
  createChatBranch,
  generateTempTitle,
  updateChatTitle
} from '../utils/chatStorage'
import {
  indexMentionReferences,
  indexStoredChatById,
  runAfterUi,
  runInBackground
} from '../utils/knowledgeIndexing'

const CONSENSUS_MODEL = 'moonshotai/kimi-k2-instruct-0905'
const PENDING_CHAT_ID_KEY = 'overlay-pending-chat-id'
const DESKTOP_ACT_SYSTEM_PROMPT = [
  'You are Overlay, a desktop AI assistant with access to tools through the cloud act endpoint.',
  'Every user turn is an act-capable turn. Decide silently whether tools are needed.',
  'Use tools when the user asks you to do something outside pure conversation, needs current information, references attached files or app data, asks for generated media, wants repeatable workflows, or asks you to interact with connected services.',
  'Do not use tools for ordinary conversation, explanation, drafting, summarization from already provided context, or questions you can answer directly.',
  'When using tools, use the real tool-calling channel only. Do not narrate tool names, raw JSON, or internal storage details.',
  'For third-party account actions, only act when the user explicitly requested that external service/account in this chat. If a required integration is not connected, guide the user to connect it.',
  'Keep final answers concise and specific about what was done or what information is still missing.'
].join('\n')

function buildTurnToolInstruction(options?: ChatSendOptions): string {
  const sections: string[] = []
  const requestedToolInstruction = buildRequestedToolInstruction(options?.requestedTools ?? [])
  if (requestedToolInstruction) sections.push(requestedToolInstruction)
  if (options && !options.memoryEnabled) {
    sections.push(
      '## Memory Disabled\nMemory is disabled for this turn. Do not search, read, save, or otherwise invoke memory tools while producing this response.'
    )
  }
  return sections.join('\n\n')
}
// groq/compound removed - search now uses tool-based approach with selected model
const HIDDEN_CHAT_MODEL_IDS = new Set<string>([
  'openai/gpt-oss-20b',
  'meta-llama/llama-4-scout-17b-16e-instruct'
])

// Inner component for draggable spacer - must be inside DockablePanel to access context
function DraggableSpacer(): React.ReactElement {
  const { startDrag } = useDockableDrag()
  return (
    <div
      onMouseDown={startDrag}
      style={
        {
          flex: 1,
          height: 36,
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties
      }
    />
  )
}

export function ChatPanel(): React.ReactElement {
  const { theme } = usePanelTheme()
  const { chatModels, bootstrap, refreshBootstrap } = useAppBootstrap()
  const [models, setModels] = useState<ChatModel[]>([])
  const [selectedModels, setSelectedModels] = useState<ChatModel[]>([])
  const [, setShowModelDropdown] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [screenshots, setScreenshots] = useState<Screenshot[]>([])
  const [folderScreenshots, setFolderScreenshots] = useState<Screenshot[]>([])
  const [mentions, setMentions] = useState<Mention[]>([])
  const [folderMentions, setFolderMentions] = useState<Mention[]>([])
  const [isVisible] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProtected, setIsProtected] = useState(() => {
    const saved = localStorage.getItem('chatPanel.isProtected')
    return saved === 'true'
  })
  const [panelOpacity, setPanelOpacity] = useState(() => {
    try {
      const saved = localStorage.getItem('overlay-settings')
      if (saved) {
        const settings = JSON.parse(saved)
        return settings.chatPanelOpacity ?? 95
      }
    } catch {
      // ignore malformed localStorage data
    }
    return 95
  })
  const [dynamicOpacity, setDynamicOpacity] = useState(() => {
    try {
      const saved = localStorage.getItem('overlay-settings')
      if (saved) {
        const settings = JSON.parse(saved)
        return settings.dynamicOpacity ?? false
      }
    } catch {
      // ignore malformed localStorage data
    }
    return false
  })
  const [showRetrievedMemories, setShowRetrievedMemories] = useState(() => {
    try {
      const saved = localStorage.getItem('overlay-settings')
      if (saved) {
        const settings = JSON.parse(saved)
        return settings.showRetrievedMemoriesInChat ?? false
      }
    } catch {
      // ignore malformed localStorage data
    }
    return false
  })
  const [showAddedMemories, setShowAddedMemories] = useState(() => {
    try {
      const saved = localStorage.getItem('overlay-settings')
      if (saved) {
        const settings = JSON.parse(saved)
        return settings.showAddedMemoriesInChat ?? true
      }
    } catch {
      // ignore malformed localStorage data
    }
    return true
  })
  const [isWindowFocused, setIsWindowFocused] = useState(true)
  const [headerLocked, setHeaderLocked] = useState(true)
  const [isPanelHovered, setIsPanelHovered] = useState(true)
  const [,] = useState<Set<string>>(new Set())
  const [consensusLoadingMessageId, setConsensusLoadingMessageId] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [isSidebarClosing, setIsSidebarClosing] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(200)
  const sidebarDefaultWidth = 200
  const sidebarCollapseThreshold = 80
  const sidebarCompactThreshold = 120
  const [showShortcutsMenu, setShowShortcutsMenu] = useState(false)
  const [showFindBar, setShowFindBar] = useState(false)
  const [chats, setChats] = useState<ChatMeta[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [openItemIds, setOpenItemIds] = useState<string[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [chatTitle, setChatTitle] = useState('New Chat')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [isOptionHeld, setIsOptionHeld] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [viewingFolderId, setViewingFolderId] = useState<string | null>(null)
  const [memoryEnabled, setMemoryEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('overlay-memory-enabled')
    return saved !== null ? saved === 'true' : true // default to on
  })
  const [searchEnabled, setSearchEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('overlay-search-enabled')
    return saved === 'true'
  })
  const [chatAccessTabsInSidebar, setChatAccessTabsInSidebar] = useState(() => {
    try {
      const saved = localStorage.getItem('overlay-settings')
      if (saved) {
        const settings = JSON.parse(saved)
        return settings.chatAccessTabsInSidebar ?? false
      }
    } catch {
      // ignore malformed localStorage data
    }
    return false
  })
  const agentModeEnabled = false
  const [workingFolder, setWorkingFolder] = useState<string | null>(null)
  const [showProjectSidebar, setShowProjectSidebar] = useState(false)
  const [isProjectSidebarClosing, setIsProjectSidebarClosing] = useState(false)
  const [sourcesPanel, setSourcesPanel] = useState<{
    turnId: string
    sources: WebSourceItem[]
  } | null>(null)
  const prepareAttachmentPreview = useCallback(() => {
    setSourcesPanel(null)
    setShowProjectSidebar(false)
  }, [])
  const attachmentPreview = useDesktopAttachmentPreview(prepareAttachmentPreview)
  const closeAttachmentPreview = attachmentPreview.close
  const [isBranching, setIsBranching] = useState(false)
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([])
  const modifiedFilesInSession = useMemo(
    () =>
      new Set(
        agentSteps
          .filter(
            (s) =>
              s.type === 'tool_result' &&
              (s.tool === 'code_edit_file' || s.tool === 'code_create_file')
          )
          .map((s) => (s.toolInput?.file_path as string | undefined) ?? '')
          .filter(Boolean)
      ),
    [agentSteps]
  )
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const [userInputRequest, setUserInputRequest] = useState<{
    requestId: string
    reason: string
  } | null>(null)
  // Memory candidates keyed by agent message ID
  const [agentMemoryCandidates, setAgentMemoryCandidates] = useState<
    Record<string, import('../components/chat/types').AgentMemoryCandidate[]>
  >({})
  // Make Skill dialog state
  const [makeSkillDialog, setMakeSkillDialog] = useState<{
    open: boolean
    title: string
    description: string
    triggers: string
    content: string
  }>({ open: false, title: '', description: '', triggers: '', content: '' })
  // Skill suggestion chips for agent mode
  const [skillSuggestions, setSkillSuggestions] = useState<Array<{ id: string; title: string }>>([])
  const agentCancelRef = useRef<(() => void) | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ChatInputAreaHandle>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const dragDepthRef = useRef(0)
  const isInitializedRef = useRef(false)
  const tabsRestoredRef = useRef(false)
  const currentChatIdRef = useRef<string | null>(null)
  const messagesRef = useRef<Message[]>([])
  const isLoadingRef = useRef(false)
  const branchingRef = useRef(false)
  const streamGenerationRef = useRef(0)
  const mediaAbortRef = useRef<AbortController | null>(null)
  const submitMessageRef = useRef<
    (
      message: string,
      messageScreenshots?: Screenshot[],
      messageMentions?: Mention[],
      options?: ChatSendOptions
    ) => void
  >(() => {})

  // Search now uses tool-based approach with selected model (no model switching)
  const activeModels = selectedModels
  const supportsVision = activeModels.length > 0 && activeModels.every((m) => m.supportsVision)
  const submittedTurnCount = useMemo(
    () => messages.filter((message) => message.role === 'user').length,
    [messages]
  )
  const transcriptActive = isLoading || isAgentRunning
  const { reservedSpace: transcriptReservedSpace } = useTranscriptScroll({
    containerRef: chatContainerRef,
    endRef: messagesEndRef,
    submittedTurnCount,
    active: transcriptActive,
    transcriptKey: currentChatId
  })

  const viewingFolderName = useMemo(() => {
    if (!viewingFolderId) return null
    return loadChatFolders().find((folder) => folder.id === viewingFolderId)?.name || 'Folder'
  }, [viewingFolderId])

  // Keep ref in sync with state
  useEffect(() => {
    currentChatIdRef.current = currentChatId
  }, [currentChatId])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  useEffect(() => {
    setSourcesPanel(null)
  }, [currentChatId, viewingFolderId])

  const clearActiveGenerationState = useCallback(() => {
    mediaAbortRef.current?.abort()
    mediaAbortRef.current = null
    streamGenerationRef.current += 1
    isLoadingRef.current = false
    setIsLoading(false)
  }, [])

  useEffect(() => {
    composerRef.current?.clear()
    setFolderScreenshots([])
    setFolderMentions([])
  }, [viewingFolderId])

  const indexCurrentChatForKnowledge = useCallback(
    async (chatId: string) => {
      if (currentChatIdRef.current === chatId) {
        const persistedChat = loadChat(chatId)
        if (!persistedChat) return
        const folderId = getChatFolderId(chatId) || undefined
        const chatSnapshot = {
          id: chatId,
          title: chatTitle,
          messages,
          modelId: persistedChat.modelId,
          folderId,
          createdAt: persistedChat.createdAt,
          updatedAt: Date.now()
        }
        saveChat(chatSnapshot)
        await indexStoredChatById(chatId, folderId)
        return
      }

      await indexStoredChatById(chatId)
    },
    [chatTitle, messages]
  )

  // Persist memory toggle
  useEffect(() => {
    localStorage.setItem('overlay-memory-enabled', String(memoryEnabled))
  }, [memoryEnabled])

  // Persist search toggle
  useEffect(() => {
    localStorage.setItem('overlay-search-enabled', String(searchEnabled))
  }, [searchEnabled])

  // Search toggle is always available (tool-based search works with any model)

  // Refresh chats list
  const refreshChatsList = useCallback(
    (skipIfLoaded = false) => {
      if (skipIfLoaded && chats.length > 0) return
      setChats(loadChatsMeta())
      void listChatsMeta()
        .then(setChats)
        .catch((error) => console.error('[ChatPanel] Failed to refresh chats:', error))
    },
    [chats.length]
  )

  const hydrateChatById = useCallback(async (id: string) => {
    // The list API only gives us conversation metadata. Always try the cloud detail
    // route first so opening an existing web chat hydrates its persisted messages.
    return (await getChat(id)) || loadChat(id)
  }, [])

  // Helper to close sidebar with animation
  const closeSidebarAnimated = useCallback(() => {
    setIsSidebarClosing(true)
    setTimeout(() => {
      setShowSidebar(false)
      setIsSidebarClosing(false)
    }, 150)
  }, [])

  // Load a chat by ID
  const loadChatById = useCallback(
    async (id: string) => {
      // Check if current chat is empty (no user messages) and delete it
      if (currentChatIdRef.current && currentChatIdRef.current !== id) {
        const hasUserMessages = messages.some((m) => m.role === 'user')
        if (!hasUserMessages) {
          void deleteChatFromStorage(currentChatIdRef.current)
        }
      }

      const chat = await hydrateChatById(id)
      if (chat) {
        setCurrentChatId(chat.id)
        setMessages(chat.messages)
        setLastOpenedChatId(chat.id)
      }
      closeSidebarAnimated()
      refreshChatsList()
    },
    [closeSidebarAnimated, hydrateChatById, messages, refreshChatsList]
  )

  // Delete a chat - startNewChat is defined after this, so we handle it inline
  const handleDeleteChat = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation()
      void deleteChatFromStorage(id)
      if (currentChatId === id) {
        const remainingChats = chats.filter((c) => c.id !== id)
        if (remainingChats.length > 0) {
          void loadChatById(remainingChats[0].id)
        } else {
          // Create new chat inline since startNewChat is defined later
          const chat = await createNewChat()
          setCurrentChatId(chat.id)
          setMessages([])
          composerRef.current?.clear()
          setScreenshots([])
        }
      }
      refreshChatsList()
    },
    [currentChatId, chats, loadChatById, refreshChatsList]
  )

  // Generate chat title using the free model (no credits consumed for titles)
  const generateChatTitleAsync = useCallback(
    async (userMessage: string, _assistantResponse: string, chatId: string, _modelId?: string) => {
      try {
        const result = await generateCloudChatTitle(userMessage)
        if (result) {
          const title = result.trim().slice(0, 50)
          void updateChatTitle(chatId, title)
          refreshChatsList()
        }
      } catch (error) {
        console.error('Failed to generate chat title:', error)
      }
    },
    [refreshChatsList]
  )

  // Save tabs to localStorage when they change (only after restoration is complete).
  // itemId windows show a single dedicated chat and must not overwrite the main panel's tab state.
  useEffect(() => {
    const isItemIdWindow = !!window.bridge?.getWindowItemId?.()
    if (!isItemIdWindow && tabs.length > 0 && tabsRestoredRef.current) {
      localStorage.setItem('overlay-chat-tabs', JSON.stringify(tabs))
      localStorage.setItem('overlay-chat-active-tab', currentChatId || '')
    }
  }, [tabs, currentChatId])

  // Initialize: load chats and determine which chat to open (after first paint)
  useEffect(() => {
    if (isInitializedRef.current) return
    isInitializedRef.current = true

    afterPanelFirstPaint(() => {
      void (async () => {
        let initialChats: ChatMeta[] = []
        try {
          initialChats = await listChatsMeta()
        } catch (error) {
          console.error('[ChatPanel] Failed to load chats during init:', error)
          window.setTimeout(() => refreshChatsList(), 2500)
          tabsRestoredRef.current = true
          markPanelHydrateComplete('chat')
          return
        }
        setChats(initialChats)
        const savedSettings = localStorage.getItem('overlay-settings')
        let settings: Record<string, unknown> = {}
        try {
          settings = savedSettings ? JSON.parse(savedSettings) : {}
        } catch {
          settings = {}
        }

        const itemId = window.bridge.getWindowItemId()

        if (itemId) {
          const chat = await hydrateChatById(itemId)
          if (chat) {
            setCurrentChatId(chat.id)
            setMessages(chat.messages)
            setChatTitle(chat.title || 'New Chat')
            const chatMeta = initialChats.find((c) => c.id === chat.id)
            setTabs([{ id: chat.id, title: chatMeta?.title || 'Chat' }])
            window.bridge.registerOpenItem('chat', chat.id)
            tabsRestoredRef.current = true
            markPanelHydrateComplete('chat')
            return
          }
        }

        let pendingChatId: string | null = null
        await navigator.locks.request('overlay-pending-chat-id', { steal: false }, async () => {
          pendingChatId = localStorage.getItem(PENDING_CHAT_ID_KEY)
          if (pendingChatId) localStorage.removeItem(PENDING_CHAT_ID_KEY)
        })
        if (pendingChatId) {
          const chat = await hydrateChatById(pendingChatId)
          if (chat) {
            setCurrentChatId(chat.id)
            setMessages(chat.messages)
            setChatTitle(chat.title || 'New Chat')
            setLastOpenedChatId(chat.id)
            const chatMeta = initialChats.find((c) => c.id === chat.id)
            setTabs([{ id: chat.id, title: chatMeta?.title || chat.title || 'Chat' }])
            tabsRestoredRef.current = true
            markPanelHydrateComplete('chat')
            return
          }
        }

        const savedTabsStr = localStorage.getItem('overlay-chat-tabs')
        const savedActiveTab = localStorage.getItem('overlay-chat-active-tab')

        if (savedTabsStr && !settings.openNewChatEveryTime) {
          try {
            const savedTabs = JSON.parse(savedTabsStr) as Tab[]
            if (savedTabs.length > 0) {
              const validTabs: Tab[] = []
              for (const tab of savedTabs) {
                const meta = initialChats.find((c) => c.id === tab.id)
                if (meta) {
                  validTabs.push({ id: meta.id, title: meta.title || tab.title || 'Chat' })
                }
              }
              if (validTabs.length > 0) {
                setTabs(validTabs)
                const activeTabId =
                  savedActiveTab && validTabs.some((t) => t.id === savedActiveTab)
                    ? savedActiveTab
                    : validTabs[0].id
                const chat = await hydrateChatById(activeTabId)
                if (chat) {
                  setCurrentChatId(chat.id)
                  setMessages(chat.messages)
                  setChatTitle(chat.title || 'New Chat')
                  tabsRestoredRef.current = true
                  void Promise.all(
                    validTabs
                      .filter((tab) => tab.id !== activeTabId)
                      .map(async (tab) => {
                        const hydrated = await hydrateChatById(tab.id)
                        if (!hydrated) {
                          setTabs((prev) => prev.filter((t) => t.id !== tab.id))
                        }
                      })
                  )
                  markPanelHydrateComplete('chat')
                  return
                }
              }
            }
          } catch (_e) {
            // Invalid saved tabs, continue with normal flow
          }
        }

        if (settings.openNewChatEveryTime) {
          const chat = await createNewChat(selectedModels[0]?.id)
          setCurrentChatId(chat.id)
          setMessages([])
          setTabs([{ id: chat.id, title: 'New Chat' }])
          tabsRestoredRef.current = true
        } else {
          const lastId = getLastOpenedChatId()
          if (lastId) {
            const chat = await hydrateChatById(lastId)
            if (chat) {
              setCurrentChatId(chat.id)
              setMessages(chat.messages)
              setChatTitle(chat.title || 'New Chat')
              const chatMeta = initialChats.find((c) => c.id === chat.id)
              setTabs([{ id: chat.id, title: chatMeta?.title || 'Chat' }])
              tabsRestoredRef.current = true
            } else {
              const newChat = await createNewChat(selectedModels[0]?.id)
              setCurrentChatId(newChat.id)
              setMessages([])
              setTabs([{ id: newChat.id, title: 'New Chat' }])
              tabsRestoredRef.current = true
            }
          } else {
            const newChat = await createNewChat(selectedModels[0]?.id)
            setCurrentChatId(newChat.id)
            setMessages([])
            setTabs([{ id: newChat.id, title: 'New Chat' }])
            tabsRestoredRef.current = true
          }
        }
        markPanelHydrateComplete('chat')
      })()
    })
    // Skip refresh since we just loaded chats above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    signalPanelShellReady('chat')
  }, [])

  // Focus input when panel becomes visible via hotkey toggle
  useEffect(() => {
    const unsubscribe = window.bridge?.onPanelVisibilityChanged?.((panelType, panelIsVisible) => {
      if (panelType === 'chat' && panelIsVisible) {
        focusAfterPanelPaint(() => {
          inputRef.current?.focus()
        })
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  // Load available models from bootstrap, limited to the user's enabled catalog
  useEffect(() => {
    try {
      const visibleModels = filterToEnabledChatModels(
        chatModels.filter((m) => !HIDDEN_CHAT_MODEL_IDS.has(m.id)),
        bootstrap?.uiSettings?.enabledChatModelIds
      )
      setModels(visibleModels)

      // Restore saved models from localStorage, filtering out disabled ones
      if (visibleModels.length > 0) {
        setSelectedModels((prevSelected) => {
          // First, try to restore from localStorage (plural - multi-model support)
          const savedModelIds = localStorage.getItem('chatPanel.selectedModelIds')
          if (savedModelIds) {
            try {
              const ids = JSON.parse(savedModelIds) as string[]
              const savedModels = ids
                .map((id) => visibleModels.find((m) => m.id === id))
                .filter((m): m is ChatModel => m !== undefined && !m.disabled)
              if (savedModels.length > 0) {
                return savedModels
              }
            } catch {
              // Invalid JSON, fall through
            }
          }

          // If we have valid previous selections, keep them
          if (prevSelected.length > 0) {
            const stillValidModels = prevSelected.filter((selected) => {
              const updatedModel = visibleModels.find((m) => m.id === selected.id)
              return updatedModel && !updatedModel.disabled
            })
            if (stillValidModels.length > 0) {
              return stillValidModels
            }
          }

          // Fall back to default model selection
          const enabledModels = visibleModels.filter((m) => !m.disabled)
          if (enabledModels.length > 0) {
            const defaultModel =
              enabledModels.find((m) => m.id === bootstrap?.defaults?.chatModelId) ||
              enabledModels.find((m: ChatModel) => m.supportsVision && m.provider === 'groq') ||
              enabledModels.find((m: ChatModel) => m.provider === 'groq') ||
              enabledModels[0]
            return defaultModel ? [defaultModel] : []
          }

          return []
        })
      }
    } catch (error) {
      console.error('Failed to load models:', error)
    }
  }, [chatModels, bootstrap?.defaults?.chatModelId, bootstrap?.uiSettings?.enabledChatModelIds])

  // Refresh bootstrap when the main process signals model availability changes
  useEffect(() => {
    const unsubscribe = window.bridge?.onChatModelsChanged?.(() => {
      console.log('[ChatPanel] Models changed notification received, refreshing bootstrap')
      refreshBootstrap()
    })
    return () => {
      unsubscribe?.()
    }
  }, [refreshBootstrap])

  // Persist selected models to localStorage
  useEffect(() => {
    if (selectedModels.length > 0) {
      localStorage.setItem(
        'chatPanel.selectedModelIds',
        JSON.stringify(selectedModels.map((m) => m.id))
      )
    }
  }, [selectedModels])

  // Persist content protection state to localStorage
  useEffect(() => {
    localStorage.setItem('chatPanel.isProtected', String(isProtected))
  }, [isProtected])

  // Apply saved content protection state on mount
  useEffect(() => {
    const savedProtection = localStorage.getItem('chatPanel.isProtected')
    if (savedProtection === 'true') {
      window.bridge.setContentProtection('chat', true)
    }
  }, [])

  // Listen for settings changes to update opacity and dynamic opacity
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent): void => {
      if (e.key === 'overlay-settings' && e.newValue) {
        let settings: Record<string, unknown> = {}
        try {
          settings = JSON.parse(e.newValue)
        } catch {
          return
        }
        setPanelOpacity((settings.chatPanelOpacity as number) ?? 95)
        setDynamicOpacity((settings.dynamicOpacity as boolean) ?? false)
        setShowRetrievedMemories((settings.showRetrievedMemoriesInChat as boolean) ?? false)
        setShowAddedMemories((settings.showAddedMemoriesInChat as boolean) ?? true)
        const newAccessTabsInSidebar = (settings.chatAccessTabsInSidebar as boolean) ?? false
        setChatAccessTabsInSidebar(newAccessTabsInSidebar)
        // When toggling accessTabsInSidebar, update sidebar visibility to match
        setShowSidebar(newAccessTabsInSidebar)
      }
    }
    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  // Handle window focus/blur for dynamic opacity
  useEffect(() => {
    const handleFocus = (): void => setIsWindowFocused(true)
    const handleBlur = (): void => setIsWindowFocused(false)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // Track Option key for Option+drag to move panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.altKey && !isOptionHeld) {
        setIsOptionHeld(true)
      }
    }
    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt' || !e.altKey) {
        setIsOptionHeld(false)
      }
    }
    const handleBlur = (): void => {
      setIsOptionHeld(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [isOptionHeld])

  // Clear screenshots when switching to non-vision model
  useEffect(() => {
    if (!supportsVision && screenshots.length > 0) {
      setScreenshots([])
    }
  }, [supportsVision, screenshots.length])

  // Auto-focus input field when panel opens - reduced delay
  useEffect(() => {
    const timer = setTimeout(() => {
      composerRef.current?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  // Listen for text sent from TranscriptionPanel (last opened chat)
  useEffect(() => {
    const handleInputText = (text: string): void => {
      const current = composerRef.current?.getValue() || ''
      composerRef.current?.setValue(current ? `${current}\n${text}` : text)
      setTimeout(() => {
        composerRef.current?.focus()
      }, 100)
    }

    const unsubscribe = window.bridge?.onChatInputText?.(handleInputText)
    return () => {
      unsubscribe?.()
    }
  }, [])

  // Listen for new chat with text from TranscriptionPanel
  useEffect(() => {
    const handleNewChatWithText = (text: string): void => {
      // Create a new chat and add the text
      void (async () => {
        const chat = await createNewChat(selectedModels[0]?.id)
        setCurrentChatId(chat.id)
        setMessages([])
        setScreenshots([])
        composerRef.current?.setValue(text)
        refreshChatsList()
        setTimeout(() => {
          composerRef.current?.focus()
        }, 100)
      })()
    }

    const unsubscribe = window.bridge?.onNewChatWithText?.(handleNewChatWithText)
    return () => {
      unsubscribe?.()
    }
  }, [selectedModels, refreshChatsList])

  // Track last closed chat for Cmd+Shift+T
  useEffect(() => {
    const handlePanelClosed = (
      panelType: string,
      itemId?: string,
      position?: { x: number; y: number; width: number; height: number }
    ): void => {
      if (panelType === 'chat' && itemId) {
        localStorage.setItem('overlay-last-closed-chat-id', itemId)
        if (position) {
          localStorage.setItem('overlay-last-closed-chat-position', JSON.stringify(position))
        }
      }
    }
    const unsubscribe = window.bridge?.onPanelClosed?.(handlePanelClosed)
    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      if (currentChatIdRef.current) {
        runInBackground(
          () => indexCurrentChatForKnowledge(currentChatIdRef.current!),
          'Failed to index chat on unload'
        )
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [indexCurrentChatForKnowledge])

  const startNewChat = useCallback(async () => {
    clearActiveGenerationState()
    const oldChatId = currentChatId
    if (oldChatId) {
      runInBackground(() => indexCurrentChatForKnowledge(oldChatId), 'Failed to index closed chat')
    }
    const chat = await createNewChat(selectedModels[0]?.id)
    analytics.increment('chats_created')
    setCurrentChatId(chat.id)
    setChatTitle('New Chat')
    setMessages([])
    // Preserve existing input text when starting new chat
    setScreenshots([])
    refreshChatsList()
    // Update the current tab to point to the new chat
    if (oldChatId) {
      setTabs((prev) =>
        prev.map((t) => (t.id === oldChatId ? { id: chat.id, title: 'New Chat' } : t))
      )
    }
  }, [
    clearActiveGenerationState,
    selectedModels,
    refreshChatsList,
    currentChatId,
    indexCurrentChatForKnowledge
  ])

  const startNewChatInNewWindow = useCallback(async () => {
    // Create a new chat first
    const chat = await createNewChat(selectedModels[0]?.id)
    analytics.increment('chats_created')
    refreshChatsList()
    // Open it in a new window
    await window.bridge.openInNewWindow('chat', chat.id)
  }, [selectedModels, refreshChatsList])

  // Start a new chat in a folder with an initial message
  const startNewChatInFolder = useCallback(
    (
      folderId: string,
      initialMessage: string,
      initialScreenshots: Screenshot[] = [],
      initialMentions: Mention[] = [],
      options?: ChatSendOptions
    ) => {
      // Create the chat and assign it to the folder
      void (async () => {
        const chat = await createNewChat(selectedModels[0]?.id, folderId)
        analytics.increment('chats_created')

        // Clear folder view and load the new chat
        setViewingFolderId(null)
        currentChatIdRef.current = chat.id
        setCurrentChatId(chat.id)
        setMessages([])
        setChatTitle('New Chat')
        refreshChatsList()

        // Replace the folder tab with the new chat tab
        const folderTabId = `folder-${folderId}`
        setTabs((prev) => {
          const folderTabIndex = prev.findIndex((t) => t.id === folderTabId)
          if (folderTabIndex !== -1) {
            // Replace folder tab with chat tab at same position
            const newTabs = [...prev]
            newTabs[folderTabIndex] = { id: chat.id, title: 'New Chat', type: 'chat' }
            return newTabs
          }
          // If folder tab not found, just add new chat tab
          return [...prev, { id: chat.id, title: 'New Chat', type: 'chat' }]
        })

        // If there's an initial message or screenshots, auto-send it
        if (initialMessage || initialScreenshots.length > 0) {
          // Wait for state to update, then trigger send via ref
          setTimeout(() => {
            submitMessageRef.current(initialMessage, initialScreenshots, initialMentions, options)
          }, 100)
        }
      })()
    },
    [selectedModels, refreshChatsList]
  )

  // Handle folder selection from sidebar - opens folder in a new tab
  const handleSelectFolder = useCallback(
    (folderId: string | null) => {
      if (!folderId) {
        setViewingFolderId(null)
        return
      }

      // Check if folder tab already exists
      const existingTab = tabs.find((t) => t.type === 'folder' && t.folderId === folderId)
      if (existingTab) {
        // Switch to existing folder tab
        setViewingFolderId(folderId)
        setCurrentChatId(existingTab.id)
        return
      }

      // Get folder name for tab title
      const folders = loadChatFolders()
      const folder = folders.find((f) => f.id === folderId)
      const folderName = folder?.name || 'Folder'

      // Create a new folder tab
      const tabId = `folder-${folderId}`
      setTabs((prev) => [...prev, { id: tabId, title: folderName, type: 'folder', folderId }])
      setCurrentChatId(tabId)
      setViewingFolderId(folderId)
    },
    [tabs]
  )

  // Add a new tab with a new chat
  const handleNewInNewTab = useCallback(async () => {
    clearActiveGenerationState()
    const chat = await createNewChat(selectedModels[0]?.id)
    setTabs((prev) => {
      const next = [...prev, { id: chat.id, title: 'New Chat' }]
      return next.length > 10 ? next.slice(1) : next
    })
    setCurrentChatId(chat.id)
    setViewingFolderId(null)
    setMessages([])
    setScreenshots([])
    refreshChatsList()
    // Focus the input area so user can start typing immediately
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [clearActiveGenerationState, selectedModels, refreshChatsList])

  // Close a tab
  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tabIndex = tabs.findIndex((t) => t.id === tabId)
      if (tabIndex === -1) return

      const closingTab = tabs[tabIndex]

      // Save closed tab ID for Cmd+Shift+T restoration (only for chat tabs)
      if (closingTab.type !== 'folder') {
        localStorage.setItem('overlay-last-closed-chat-id', tabId)
        runInBackground(() => indexCurrentChatForKnowledge(tabId), 'Failed to index closed chat')
      }

      // If closing the active tab, switch to another tab
      if (tabId === currentChatId) {
        const remainingTabs = tabs.filter((t) => t.id !== tabId)
        if (remainingTabs.length > 0) {
          const newActiveTab = remainingTabs[Math.min(tabIndex, remainingTabs.length - 1)]

          // Check if switching to a folder tab
          if (newActiveTab.type === 'folder' && newActiveTab.folderId) {
            setCurrentChatId(newActiveTab.id)
            setViewingFolderId(newActiveTab.folderId)
          } else {
            // Switch to chat tab
            setViewingFolderId(null)
            const chat = await hydrateChatById(newActiveTab.id)
            if (chat) {
              setCurrentChatId(chat.id)
              setMessages(chat.messages)
              setLastOpenedChatId(chat.id)
            }
          }
        } else {
          // No tabs left, clear folder view
          setViewingFolderId(null)
        }
      }
      setTabs((prev) => prev.filter((t) => t.id !== tabId))
    },
    [tabs, currentChatId, hydrateChatById, indexCurrentChatForKnowledge]
  )

  // Select a tab
  const handleSelectTab = useCallback(
    async (tabId: string) => {
      if (tabId === currentChatId) return

      // Save current chat before switching (only if it's a chat tab, not folder)
      const currentTab = tabs.find((t) => t.id === currentChatId)
      if (currentTab?.type !== 'folder' && currentChatIdRef.current) {
        const chat = loadChat(currentChatIdRef.current)
        if (chat) {
          chat.messages = messages
          chat.updatedAt = Date.now()
          saveChat(chat)
        }
      }

      // Check if target is a folder tab
      const targetTab = tabs.find((t) => t.id === tabId)
      if (targetTab?.type === 'folder' && targetTab.folderId) {
        setCurrentChatId(tabId)
        setViewingFolderId(targetTab.folderId)
        return
      }

      // Load the selected tab's chat
      setViewingFolderId(null)
      const chat = await hydrateChatById(tabId)
      if (chat) {
        setCurrentChatId(chat.id)
        setMessages(chat.messages)
        setLastOpenedChatId(chat.id)
      }
    },
    [currentChatId, hydrateChatById, messages, tabs]
  )

  // Update tab title when chat title changes
  useEffect(() => {
    if (currentChatId) {
      const currentChat = chats.find((c) => c.id === currentChatId)
      if (currentChat) {
        setChatTitle(currentChat.title)
        setTabs((prev) =>
          prev.map((t) => (t.id === currentChatId ? { ...t, title: currentChat.title } : t))
        )
      }
    }
  }, [currentChatId, chats])

  // Rename a tab
  const handleRenameTab = useCallback(
    (tabId: string, newTitle: string) => {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, title: newTitle } : t)))
      // Also update chat title if it's the current chat
      if (tabId === currentChatId) {
        setChatTitle(newTitle)
      }
      // Save to storage
      const chat = loadChat(tabId)
      if (chat) {
        chat.title = newTitle
        chat.updatedAt = Date.now()
        saveChat(chat)
        refreshChatsList()
      }
    },
    [currentChatId, refreshChatsList]
  )

  // Reorder tabs via drag-and-drop
  const handleReorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      const newTabs = [...prev]
      const [movedTab] = newTabs.splice(fromIndex, 1)
      newTabs.splice(toIndex, 0, movedTab)
      return newTabs
    })
  }, [])

  // Open a chat in a new tab (from sidebar)
  const handleOpenChatInNewTab = useCallback(
    async (id: string) => {
      // Check if already open in a tab
      const existingTab = tabs.find((t) => t.id === id)
      if (existingTab) {
        // Just switch to it
        handleSelectTab(id)
        return
      }
      // Save current chat before switching
      if (currentChatIdRef.current) {
        const chat = loadChat(currentChatIdRef.current)
        if (chat) {
          chat.messages = messages
          chat.updatedAt = Date.now()
          saveChat(chat)
        }
      }
      // Load the chat and add to tabs
      const chat = await hydrateChatById(id)
      if (chat) {
        setTabs((prev) => {
          const next = [...prev, { id: chat.id, title: chat.title }]
          return next.length > 10 ? next.slice(1) : next
        })
        setCurrentChatId(chat.id)
        setMessages(chat.messages)
        setChatTitle(chat.title)
        setLastOpenedChatId(chat.id)
      }
    },
    [tabs, messages, handleSelectTab, hydrateChatById]
  )

  // Handle cross-window requests to open a specific chat in this panel.
  useEffect(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== PENDING_CHAT_ID_KEY || !event.newValue) return
      localStorage.removeItem(PENDING_CHAT_ID_KEY)
      handleOpenChatInNewTab(event.newValue)
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [handleOpenChatInNewTab])

  const handleOpenChatInNewWindow = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const result = await window.bridge.openInNewWindow('chat', id)
    if (result.success) {
      // Refresh open items list
      const { openItems } = await window.bridge.getOpenItems('chat')
      setOpenItemIds(openItems)
    }
  }, [])

  // Refresh open items when sidebar opens
  useEffect(() => {
    if (showSidebar) {
      window.bridge.getOpenItems('chat').then(({ openItems }) => {
        setOpenItemIds(openItems)
      })
    }
  }, [showSidebar])

  const toggleContentProtection = useCallback(async () => {
    const newValue = !isProtected
    await window.bridge.setContentProtection('chat', newValue)
    setIsProtected(newValue)
  }, [isProtected])

  const openSourcesPanel = useCallback((turnId: string, sources: WebSourceItem[]) => {
    closeAttachmentPreview()
    setShowProjectSidebar(false)
    setSourcesPanel((current) =>
      current?.turnId === turnId ? null : { turnId, sources }
    )
  }, [closeAttachmentPreview])

  const closeSourcesPanel = useCallback(() => {
    setSourcesPanel(null)
  }, [])

  // Generate consensus from multiple model responses using Kimi K2
  const generateConsensus = useCallback(
    async (
      messageId: string,
      responses: { modelName: string; content: string }[]
    ): Promise<void> => {
      if (consensusLoadingMessageId) return // Already generating

      setConsensusLoadingMessageId(messageId)

      try {
        // Build the prompt for consensus
        const responsesText = responses
          .map((r) => `**${r.modelName}:**\n${r.content}`)
          .join('\n\n---\n\n')

        const consensusPrompt = `You are analyzing responses from multiple AI models to the same question. Your task is to synthesize a consensus response that:

1. Identifies key points of agreement between the models
2. Notes any significant disagreements or different perspectives
3. Provides a balanced, comprehensive answer that combines the best insights

Here are the responses from different models:

${responsesText}

Please provide a concise consensus summary that synthesizes the above responses. Focus on accuracy and clarity.`

        let consensusResponse = ''
        const consensusTurnId = `${Date.now()}-consensus`
        await streamCloudActMessage({
          turnId: consensusTurnId,
          modelId: CONSENSUS_MODEL,
          messages: [
            {
              id: consensusTurnId,
              role: 'user',
              content: consensusPrompt,
              timestamp: Date.now()
            }
          ],
          mode: 'chat',
          onChunk: (chunk) => {
            if (chunk.type === 'parts') {
              for (const part of chunk.parts) {
                if (part.type === 'text') consensusResponse += part.text
              }
            }
          }
        })

        if (consensusResponse.trim()) {
          // Add the consensus as a new assistant message
          const consensusMessage: Message = {
            id: consensusTurnId,
            role: 'assistant',
            content: consensusResponse,
            timestamp: Date.now(),
            responses: [
              {
                modelId: CONSENSUS_MODEL,
                modelName: 'Kimi K2 (Consensus)',
                provider: 'groq',
                content: consensusResponse,
                isLoading: false
              }
            ],
            selectedModelId: CONSENSUS_MODEL
          }

          setMessages((prev) => {
            const newMessages = [...prev, consensusMessage]
            // Save to storage
            if (currentChatIdRef.current) {
              const chat = loadChat(currentChatIdRef.current)
              if (chat) {
                chat.messages = newMessages
                chat.updatedAt = Date.now()
                saveChat(chat)
                refreshChatsList()
              }
            }
            return newMessages
          })
        }
      } catch (error) {
        console.error('Failed to generate consensus:', error)
      } finally {
        setConsensusLoadingMessageId(null)
      }
    },
    [consensusLoadingMessageId, refreshChatsList]
  )

  const isFileDragEvent = useCallback((event: React.DragEvent): boolean => {
    const types = Array.from(event.dataTransfer.types || [])
    return types.includes('Files')
  }, [])

  const processDroppedFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return
      console.log(`[ChatPanel][Drop] Processing ${files.length} file(s)`)

      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      const documentFiles = files.filter((file) => !file.type.startsWith('image/'))

      if (imageFiles.length > 0) {
        if (!supportsVision) {
          console.log(
            `[ChatPanel][Drop] Ignoring ${imageFiles.length} image(s): selected model is not vision-capable`
          )
        } else {
          const droppedScreenshots = await Promise.all(
            imageFiles.map(
              (file) =>
                new Promise<Screenshot>((resolve, reject) => {
                  const reader = new FileReader()
                  reader.onload = (event) => {
                    const dataUrl = event.target?.result as string
                    resolve({
                      dataUrl,
                      displayId: `drop-${Date.now()}-${Math.random()}`,
                      name: file.name
                    })
                  }
                  reader.onerror = () => reject(new Error(`Failed to read image: ${file.name}`))
                  reader.readAsDataURL(file)
                })
            )
          )

          setScreenshots((prev) => [...prev, ...droppedScreenshots])
          console.log(`[ChatPanel][Drop] Added ${droppedScreenshots.length} image(s) to composer`)
        }
      }

      if (documentFiles.length > 0) {
        const chatId = currentChatIdRef.current || undefined
        const folderId = chatId ? getChatFolderId(chatId) || undefined : undefined
        console.log(
          `[ChatPanel][Drop] Attempting document ingest for ${documentFiles.length} file(s) | chatId=${chatId || 'none'} folderId=${folderId || 'none'}`
        )

        for (const file of documentFiles) {
          const filePath = (file as File & { path?: string }).path
          if (!filePath) {
            console.warn(`[ChatPanel][Drop] Skipping "${file.name}" - no local file path available`)
            continue
          }

          try {
            const result = await window.bridge.document.ingest({
              filepath: filePath,
              chatId,
              folderId
            })
            console.log(
              `[ChatPanel][Drop] document.ingest "${file.name}" success=${result.success} error=${result.error || 'none'}`
            )

            if (result.success && result.document?.id && result.document?.filename) {
              const newMention: Mention = {
                id: result.document.id,
                type: 'document',
                title: result.document.filename,
                preview: 'Attached document',
                filename: result.document.filename
              }

              setMentions((prev) =>
                prev.some((mention) => mention.id === newMention.id) ? prev : [...prev, newMention]
              )
            }
          } catch (error) {
            console.error(`[ChatPanel][Drop] Failed to ingest "${file.name}":`, error)
          }
        }
      }
    },
    [supportsVision]
  )

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!isFileDragEvent(e)) return
      e.preventDefault()
      e.stopPropagation()
      dragDepthRef.current += 1
      if (dragDepthRef.current === 1) {
        setIsDragOver(true)
      }
    },
    [isFileDragEvent]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isFileDragEvent(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      if (!isDragOver) {
        setIsDragOver(true)
      }
    },
    [isDragOver, isFileDragEvent]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!isFileDragEvent(e)) return
      e.preventDefault()
      e.stopPropagation()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) {
        setIsDragOver(false)
      }
    },
    [isFileDragEvent]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!isFileDragEvent(e)) return
      e.preventDefault()
      e.stopPropagation()

      dragDepthRef.current = 0
      setIsDragOver(false)

      const files = Array.from(e.dataTransfer.files || [])
      if (files.length === 0) return

      void processDroppedFiles(files)
    },
    [isFileDragEvent, processDroppedFiles]
  )

  // Delete a message and its corresponding response
  const deleteMessage = useCallback(
    (messageId: string) => {
      setMessages((prevMessages) => {
        const messageIds = messageIdsForTurnDeletion(prevMessages, messageId)
        if (messageIds.size === 0) return prevMessages
        const deletedMessage = prevMessages.find((message) => message.id === messageId)!
        const filteredMessages = prevMessages.filter((message) => !messageIds.has(message.id))

        if (currentChatIdRef.current) {
          void deleteTurn(
            currentChatIdRef.current,
            deletedMessage.turnId || deletedMessage.id
          ).catch((error) => {
            console.error('[ChatPanel] Failed to delete remote turn:', error)
          })
          const chat = loadChat(currentChatIdRef.current)
          if (chat) {
            chat.messages = filteredMessages
            chat.updatedAt = Date.now()
            saveChat(chat)
            refreshChatsList()
          }
        }

        return filteredMessages
      })
    },
    [refreshChatsList]
  )

  const retryMessage = useCallback(
    (message: Message) => {
      const source =
        message.role === 'user'
          ? message
          : [...messagesRef.current]
              .slice(
                0,
                messagesRef.current.findIndex((m) => m.id === message.id)
              )
              .reverse()
              .find((candidate) => candidate.role === 'user')
      if (!source) return
      const retryMentions: Mention[] =
        source.mentions
          ?.filter(
            (mention): mention is Mention =>
              mention.type === 'note' ||
              mention.type === 'chat' ||
              mention.type === 'document' ||
              mention.type === 'file'
          )
          .map((mention) => ({
            id: mention.id,
            type: mention.type,
            title: mention.title,
            preview: mention.preview,
            folderId: mention.folderId,
            filename: mention.filename,
            filepath: mention.filepath
          })) ?? []
      submitMessageRef.current(source.content, source.screenshots ?? [], retryMentions, {
        requestedTools: [],
        memoryEnabled,
        mentions: retryMentions,
        generationMode: source.generation?.kind ?? 'text',
        mediaModelIds: source.generation?.modelIds,
        videoSubMode: source.generation?.videoSubMode
      })
    },
    [memoryEnabled]
  )

  const replyToMessage = useCallback((message: Message) => {
    const snippet = (
      message.role === 'assistant'
        ? message.responses?.find((response) => response.modelId === message.selectedModelId)
            ?.content ||
          message.responses?.[0]?.content ||
          message.content
        : message.content
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 160)
    composerRef.current?.setValue(snippet ? `Replying to: "${snippet}"\n\n` : '')
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [])

  const branchConversationAtTurn = useCallback(
    async (turnId: string): Promise<void> => {
      if (
        branchingRef.current ||
        isLoadingRef.current ||
        isAgentRunning ||
        !currentChatIdRef.current
      ) {
        return
      }

      const branchMessages = cloneMessagesThroughTurn(messagesRef.current, turnId)
      if (!branchMessages) return

      branchingRef.current = true
      setIsBranching(true)
      try {
        const sourceChatId = currentChatIdRef.current
        const sourceChat = loadChat(sourceChatId) ?? (await hydrateChatById(sourceChatId))
        if (!sourceChat) throw new Error('Source chat could not be loaded')

        const sourceWithFolder = {
          ...sourceChat,
          folderId: sourceChat.folderId ?? getChatFolderId(sourceChatId) ?? undefined
        }
        const branch = await createChatBranch(
          sourceWithFolder,
          branchMessages,
          selectedModels[0]?.id,
          chatTitle
        )
        const branchTitle = branch.title

        analytics.increment('chats_created')
        setSourcesPanel(null)
        setViewingFolderId(null)
        currentChatIdRef.current = branch.id
        messagesRef.current = branchMessages
        setCurrentChatId(branch.id)
        setMessages(branchMessages)
        setChatTitle(branchTitle)
        setLastOpenedChatId(branch.id)
        setTabs((currentTabs) => {
          const nextTabs = [
            ...currentTabs.filter((tab) => tab.id !== branch.id),
            { id: branch.id, title: branchTitle, type: 'chat' as const }
          ]
          return nextTabs.length > 10 ? nextTabs.slice(1) : nextTabs
        })
        refreshChatsList()
      } catch (error) {
        console.error('[ChatPanel] Failed to branch chat:', error)
      } finally {
        branchingRef.current = false
        setIsBranching(false)
      }
    },
    [chatTitle, hydrateChatById, isAgentRunning, refreshChatsList, selectedModels]
  )

  const selectResponseModel = useCallback((messageId: string, modelId: string) => {
    setMessages((previousMessages) =>
      previousMessages.map((message) => {
        if (message.id !== messageId) return message
        const selected = message.responses?.find((response) => response.modelId === modelId)
        return {
          ...message,
          selectedModelId: modelId,
          content: selected?.content || message.content,
          renderParts: selected?.renderParts || message.renderParts
        }
      })
    )
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Don't trigger shortcuts when typing in input fields (except for specific shortcuts)
      const isTyping =
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'INPUT'

      // Cmd/Ctrl + E: New chat in current tab
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'e') {
        e.preventDefault()
        startNewChat()
        return
      }

      // Cmd/Ctrl + N: New chat in new window
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'n') {
        e.preventDefault()
        startNewChatInNewWindow()
        return
      }

      // Cmd/Ctrl + M: Toggle model dropdown
      if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
        e.preventDefault()
        setShowModelDropdown((prev) => !prev)
        return
      }

      // Cmd/Ctrl + Shift + S: Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 's') {
        e.preventDefault()
        if (showSidebar) {
          closeSidebarAnimated()
        } else {
          setShowSidebar(true)
          refreshChatsList()
        }
        return
      }

      // Cmd/Ctrl + T: Open new chat in new tab
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        handleNewInNewTab()
        return
      }

      // Cmd/Ctrl + W: Close current tab (or window if only one tab)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        if (tabs.length <= 1) {
          window.bridge.closeCurrentWindow()
        } else if (currentChatId) {
          handleCloseTab(currentChatId)
        }
        return
      }

      // Cmd/Ctrl + Shift + W: Close entire window
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        window.bridge.closeCurrentWindow()
        return
      }

      // Cmd/Ctrl + Shift + T: Reopen last closed tab in current window
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        const lastClosedId = localStorage.getItem('overlay-last-closed-chat-id')
        if (lastClosedId) {
          handleOpenChatInNewTab(lastClosedId)
        }
        return
      }

      // Cmd/Ctrl + Shift + N: Reopen last closed window
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        const lastClosedId = localStorage.getItem('overlay-last-closed-chat-id')
        if (lastClosedId) {
          const positionStr = localStorage.getItem('overlay-last-closed-chat-position')
          let position: { x: number; y: number; width: number; height: number } | undefined
          try {
            position = positionStr ? JSON.parse(positionStr) : undefined
          } catch {
            position = undefined
          }
          window.bridge.openInNewWindow('chat', lastClosedId, position)
        }
        return
      }

      // Cmd/Ctrl + K: Toggle sidebar - close and focus input if open, open and focus search if closed
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (showSidebar) {
          closeSidebarAnimated()
          // Focus the chat input area after closing
          setTimeout(() => {
            inputRef.current?.focus()
          }, 150)
        } else {
          setShowSidebar(true)
          refreshChatsList()
          setTimeout(() => {
            const searchInput = document.querySelector('.chat-search-input') as HTMLInputElement
            searchInput?.focus()
          }, 100)
        }
        return
      }

      // Cmd/Ctrl + L: Toggle shortcuts menu
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault()
        setShowShortcutsMenu((prev) => !prev)
        return
      }

      // Cmd/Ctrl + F: Toggle find bar
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setShowFindBar((prev) => !prev)
        return
      }

      // Cmd/Ctrl + 1-8: Switch to tab by index
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key >= '1' && e.key <= '8') {
        e.preventDefault()
        const tabIndex = parseInt(e.key) - 1
        if (tabIndex < tabs.length) {
          handleSelectTab(tabs[tabIndex].id)
        }
        return
      }

      // Cmd/Ctrl + 9: Switch to last tab
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === '9') {
        e.preventDefault()
        if (tabs.length > 0) {
          handleSelectTab(tabs[tabs.length - 1].id)
        }
        return
      }

      // Escape: Close shortcuts menu or find bar
      if (e.key === 'Escape') {
        if (showFindBar) {
          e.preventDefault()
          setShowFindBar(false)
          return
        }
        if (showShortcutsMenu) {
          e.preventDefault()
          setShowShortcutsMenu(false)
          return
        }
      }

      // / : Focus on chat input (only when not already typing)
      if (e.key === '/' && !isTyping && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    startNewChat,
    startNewChatInNewWindow,
    showShortcutsMenu,
    showSidebar,
    closeSidebarAnimated,
    refreshChatsList,
    showFindBar,
    tabs,
    currentChatId,
    handleCloseTab,
    handleNewInNewTab,
    handleOpenChatInNewTab,
    handleSelectTab
  ])

  const sendMessage = useCallback(
    async (
      overrideMessage?: string,
      overrideScreenshots?: Screenshot[],
      overrideMentions?: Mention[],
      sendOptions?: ChatSendOptions
    ) => {
      // Tool-based search: always use selected models, searchEnabled flag is passed to backend
      const modelsForMessage = selectedModels
      const generationMode = sendOptions?.generationMode ?? 'text'
      const mediaModelIds = sendOptions?.mediaModelIds?.slice(0, 4) ?? []
      const baseMessages = messagesRef.current
      const effectiveMessage = overrideMessage ?? composerRef.current?.getValue() ?? ''
      const effectiveScreenshots = overrideScreenshots ?? screenshots
      const effectiveMentions = overrideMentions ?? mentions
      const memoryForTurn = sendOptions?.memoryEnabled ?? memoryEnabled
      const turnToolInstruction = buildTurnToolInstruction(sendOptions)
      const userContent = effectiveMessage.trim()
      if (
        (generationMode === 'text'
          ? userContent.length === 0 && effectiveScreenshots.length === 0
          : userContent.length === 0 || mediaModelIds.length === 0) ||
        (generationMode === 'text' && modelsForMessage.length === 0) ||
        isLoadingRef.current
      )
        return

      analytics.increment('messages_sent')
      // Usage is recorded by the cloud conversation route.
      let activeChatId = currentChatIdRef.current
      if (!activeChatId) {
        const chat = await createNewChat(modelsForMessage[0]?.id ?? mediaModelIds[0])
        activeChatId = chat.id
        currentChatIdRef.current = chat.id
        setCurrentChatId(chat.id)
        setChatTitle(chat.title || 'New Chat')
        setTabs((prev) =>
          prev.length > 0
            ? prev.map((tab, idx) => (idx === 0 ? { ...tab, id: chat.id, title: chat.title } : tab))
            : [{ id: chat.id, title: chat.title }]
        )
      }

      const imageDataArray = effectiveScreenshots.map(screenshotUrl).filter(Boolean)
      const isFirstMessage = baseMessages.length === 0
      const userMessageId = `${Date.now()}-user`
      const userMessage: Message = {
        id: userMessageId,
        turnId: userMessageId,
        role: 'user',
        content: userContent,
        timestamp: Date.now(),
        imageData: imageDataArray[0],
        screenshots: effectiveScreenshots.length > 0 ? [...effectiveScreenshots] : undefined,
        mentions:
          effectiveMentions.length > 0
            ? effectiveMentions.map((m) => ({
                id: m.id,
                type: m.type,
                title: m.title,
                preview: m.preview,
                folderId: m.folderId,
                filename: m.filename
              }))
            : undefined
      }

      if (generationMode === 'image' || generationMode === 'video') {
        const initialResults: GenerationResult[] = mediaModelIds.map(() => ({
          type: generationMode,
          status: 'generating'
        }))
        userMessage.generation = {
          kind: generationMode,
          modelIds: mediaModelIds,
          results: initialResults,
          ...(generationMode === 'video' && sendOptions?.videoSubMode
            ? { videoSubMode: sendOptions.videoSubMode }
            : {})
        }
        const chatId = activeChatId as string
        const newMessages = [...baseMessages, userMessage]
        messagesRef.current = newMessages
        setMessages(newMessages)
        composerRef.current?.setValue('')
        setScreenshots([])
        setMentions([])
        isLoadingRef.current = true
        setIsLoading(true)
        const streamGeneration = ++streamGenerationRef.current
        const controller = new AbortController()
        mediaAbortRef.current = controller

        const persistMediaMessages = async (nextMessages: Message[]): Promise<void> => {
          const chat = loadChat(chatId)
          if (!chat) return
          chat.messages = nextMessages
          chat.updatedAt = Date.now()
          const migrated = await migrateLegacyChatMedia(chat, window.bridge.chatMedia)
          messagesRef.current = migrated.chat.messages
          setMessages(migrated.chat.messages)
          await saveChat(migrated.chat)
          refreshChatsList()
        }

        await persistMediaMessages(newMessages)
        if (isFirstMessage) updateChatTitle(chatId, generateTempTitle(userContent))
        try {
          await runDesktopMediaGenerationBatch({
            kind: generationMode,
            prompt: userContent,
            modelIds: mediaModelIds,
            conversationId: chatId,
            turnId: userMessageId,
            imageUrl: imageDataArray[0],
            videoSubMode: sendOptions?.videoSubMode,
            signal: controller.signal,
            cacheDataUrl: window.bridge.chatMedia.cacheDataUrl,
            onSlot: (index, result) => {
              if (streamGenerationRef.current !== streamGeneration) return
              setMessages((current) => {
                const next = current.map((candidate) => {
                  if (candidate.id !== userMessageId || !candidate.generation) return candidate
                  const results = [...candidate.generation.results]
                  results[index] = result
                  return { ...candidate, generation: { ...candidate.generation, results } }
                })
                messagesRef.current = next
                return next
              })
            }
          })
        } finally {
          if (streamGenerationRef.current === streamGeneration) {
            mediaAbortRef.current = null
            isLoadingRef.current = false
            setIsLoading(false)
            await persistMediaMessages(messagesRef.current)
          }
        }
        return
      }

      // Initialize responses for all selected models
      const initialResponses: ProviderResponse[] = modelsForMessage.map((model) => ({
        modelId: model.id,
        modelName: model.name,
        provider: model.provider,
        content: '',
        isLoading: true,
        renderParts: [],
        status: 'submitted'
      }))

      const assistantMessageId = `${Date.now()}-assistant`
      const assistantMessage: Message & { turnId: string } = {
        id: assistantMessageId,
        turnId: userMessage.id,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        responses: initialResponses,
        selectedModelId: undefined
      }

      const newMessages = [...baseMessages, userMessage, assistantMessage]
      messagesRef.current = newMessages
      setMessages(newMessages)
      composerRef.current?.setValue('')
      setScreenshots([])
      setMentions([])
      isLoadingRef.current = true
      setIsLoading(true)
      const streamGeneration = ++streamGenerationRef.current

      runAfterUi(
        () => indexMentionReferences(effectiveMentions),
        'Failed to index mention references after send'
      )

      // Fetch mention content for AI context (not displayed in message bubble)
      let mentionContext = ''
      if (effectiveMentions.length > 0) {
        const mentionContents: string[] = []
        for (const mention of effectiveMentions) {
          try {
            if (mention.type === 'note') {
              const note = await window.bridge.loadNote(mention.id)
              if (note && note.content) {
                mentionContents.push(
                  `[Attached Note: ${mention.title}]\n${note.content}\n[End of Note]`
                )
              }
            } else if (mention.type === 'chat') {
              mentionContents.push(`[Referenced Chat: ${mention.title}]`)
            } else if (mention.type === 'document') {
              // Fetch actual document content from chunks
              console.log(
                `[ChatPanel] Fetching chunks for document: ${mention.id} (${mention.title})`
              )
              const chunksResult = await window.bridge.document.getChunks(mention.id)
              console.log(`[ChatPanel] Chunks result:`, {
                success: chunksResult.success,
                chunkCount: chunksResult.chunks?.length ?? 0,
                error: chunksResult.error
              })
              if (chunksResult.success && chunksResult.chunks && chunksResult.chunks.length > 0) {
                // Combine chunk content (limit to avoid token overflow)
                const docContent = chunksResult.chunks
                  .slice(0, 50) // Limit chunks to prevent excessive context
                  .map((c: { content: string }) => c.content)
                  .join('\n\n')
                // Truncate if too long (max ~30k chars)
                const truncatedContent =
                  docContent.length > 30000
                    ? docContent.slice(0, 30000) + '\n...[truncated]'
                    : docContent
                console.log(
                  `[ChatPanel] Document content loaded: ${truncatedContent.length} chars from ${chunksResult.chunks.length} chunks`
                )
                mentionContents.push(
                  `[Attached Document: ${mention.title}]\n${truncatedContent}\n[End of Document]`
                )
              } else {
                console.warn(
                  `[ChatPanel] No chunks found for document ${mention.id}, using fallback`
                )
                mentionContents.push(`[Referenced Document: ${mention.title}]`)
              }
            } else if (mention.type === 'file' && mention.filepath) {
              // Read workspace file content directly
              console.log('[ChatPanel] Reading workspace file')
              const fileResult = await window.bridge.workspace.readFile(mention.filepath)
              if (fileResult.success && fileResult.content) {
                const content = fileResult.truncated
                  ? fileResult.content + '\n...[truncated]'
                  : fileResult.content
                mentionContents.push(
                  `[File: ${mention.filepath}]\n\`\`\`\n${content}\n\`\`\`\n[End of File]`
                )
              } else {
                console.warn('[ChatPanel] Failed to read workspace file')
                mentionContents.push(`[Referenced File: ${mention.title}]`)
              }
            }
          } catch (err) {
            console.error(`[ChatPanel] Failed to fetch mention content for ${mention.id}:`, err)
          }
        }
        if (mentionContents.length > 0) {
          mentionContext = mentionContents.join('\n\n')
        }
      }

      // Get context from memory system using the new ContextEngine (only if memory is enabled)
      let contextPrompt = ''
      let retrievedMemories: Array<{
        id: string
        content: string
        type: 'preference' | 'fact' | 'project' | 'decision'
        importance: number
      }> = []
      if (memoryForTurn) {
        try {
          // Get recent message contents for context
          const recentMessages = baseMessages.slice(-6).map((m) => m.content)

          // Use the new context API for better retrieval
          const contextResult = await window.bridge.context.getForMessage({
            userMessage: userContent,
            chatId: activeChatId,
            recentMessages
          })

          if (contextResult.success && contextResult.contextPrompt) {
            contextPrompt = contextResult.contextPrompt
            console.log(
              `[Context] Retrieved ${contextResult.memoriesUsed} memories (${contextResult.totalTokens} tokens)`
            )
            console.log('[Context] Retrieved prompt:\n', contextResult.contextPrompt)
          } else {
            console.log('[Context] No relevant memories retrieved for this message')
          }

          if (showRetrievedMemories) {
            const memories = await window.bridge.memory.search(userContent, 5)
            retrievedMemories = memories.map(
              (m: {
                id: string
                content: string
                type: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
                importance: number
              }) => ({
                id: m.id,
                content: m.content,
                type: m.type === 'agent' ? 'fact' : m.type,
                importance: m.importance
              })
            )
          }
        } catch (error) {
          console.error('[Context] Failed to get context:', error)
        }
      }

      if (retrievedMemories.length > 0) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === userMessage.id ? { ...message, retrievedMemories } : message
          )
        )
      }

      // Set temporary title immediately for first message
      if (isFirstMessage && activeChatId) {
        const tempTitle = generateTempTitle(userMessage.content || 'Image attachment')
        updateChatTitle(activeChatId, tempTitle)
        refreshChatsList()
      }

      // Track accumulated content for each model during streaming
      const streamedContent: Record<string, string> = {}
      const streamedRenderParts: Record<string, MessageRenderPart[]> = {}

      // Send requests to all selected models in parallel with streaming
      const sendToModelWithStreaming = async (model: ChatModel): Promise<ProviderResponse> => {
        streamedContent[model.id] = ''
        streamedRenderParts[model.id] = []

        // Coalesce per-token stream updates into at most ~10 state updates/sec;
        // per-token setState caused a re-render storm across the whole thread.
        let syncScheduled = false
        let hasPendingChanges = false
        let streamError: string | null = null
        const syncResponseParts = (): void => {
          if (streamGenerationRef.current !== streamGeneration) return
          if (!hasPendingChanges) return
          if (syncScheduled) return
          syncScheduled = true
          window.setTimeout(() => {
            if (streamGenerationRef.current !== streamGeneration) return
            syncScheduled = false
            hasPendingChanges = false
            flushResponseParts()
          }, 100)
        }

        const flushResponseParts = (): void => {
          if (streamGenerationRef.current !== streamGeneration) return
          setMessages((prev) => {
            const assistantIdx = prev.findIndex((m) => m.id === assistantMessageId)
            if (assistantIdx === -1) return prev
            const msg = prev[assistantIdx]
            const responseIdx = msg.responses?.findIndex((r) => r.modelId === model.id) ?? -1
            if (responseIdx === -1) return prev

            const existingResponse = msg.responses![responseIdx]
            const newContent = streamedContent[model.id]
            const newRenderParts = streamedRenderParts[model.id]
            if (
              existingResponse.content === newContent &&
              existingResponse.renderParts === newRenderParts
            ) {
              return prev
            }

            const responses = [...(msg.responses || [])]
            responses[responseIdx] = {
              ...existingResponse,
              content: newContent,
              renderParts: [...newRenderParts],
              // Preserve the current loading flag: a throttled flush can land
              // after the final response already marked this model done.
              isLoading: existingResponse.isLoading,
              status: streamError
                ? 'error'
                : deriveDesktopProviderResponseStatus({
                    ...existingResponse,
                    content: newContent,
                    renderParts: newRenderParts
                  })
            }

            const newSelectedModelId = msg.selectedModelId || model.id
            const selectedResponse = responses.find((r) => r.modelId === newSelectedModelId)
            const updated: Message[] = [...prev]
            updated[assistantIdx] = {
              ...msg,
              responses,
              renderParts: selectedResponse?.renderParts || msg.renderParts,
              content: selectedResponse?.content || msg.content,
              selectedModelId: newSelectedModelId
            }
            return updated
          })
        }

        const partIdPrefix = `${assistantMessageId}:${model.id}`

        const mergeParts = (newParts: MessageRenderPart[]): void => {
          const prevLength = streamedRenderParts[model.id].length
          const prevContent = streamedContent[model.id]
          streamedRenderParts[model.id] = mergeStreamingConversationParts(
            streamedRenderParts[model.id],
            newParts,
            partIdPrefix
          )
          // Keep streamedContent in sync by concatenating text part deltas.
          for (const part of newParts) {
            if (part.type === 'text') streamedContent[model.id] += part.text
          }
          if (
            streamedRenderParts[model.id].length !== prevLength ||
            streamedContent[model.id] !== prevContent
          ) {
            hasPendingChanges = true
          }
        }

        const replaceWithTextPart = (text: string): void => {
          streamedRenderParts[model.id] = [
            {
              type: 'text',
              id: `${partIdPrefix}:text:error`,
              text
            }
          ]
          streamedContent[model.id] = text
          hasPendingChanges = true
        }

        try {
          const slotIndex = modelsForMessage.findIndex((m) => m.id === model.id)
          const systemPrompt = [
            DESKTOP_ACT_SYSTEM_PROMPT,
            turnToolInstruction,
            mentionContext ? `Attached context:\n${mentionContext}` : '',
            contextPrompt ? `Relevant user context:\n${contextPrompt}` : ''
          ]
            .filter(Boolean)
            .join('\n\n')

          await streamCloudActMessage({
            conversationId: activeChatId,
            turnId: userMessage.id,
            modelId: model.id,
            messages: [...baseMessages, userMessage],
            mode: 'chat',
            systemPrompt: systemPrompt || undefined,
            multiModelSlotIndex: modelsForMessage.length > 1 ? slotIndex : undefined,
            multiModelTotal: modelsForMessage.length > 1 ? modelsForMessage.length : undefined,
            onChunk: (chunk) => {
              if (streamGenerationRef.current !== streamGeneration) return
              if (chunk.type === 'parts') {
                mergeParts(chunk.parts)
                syncResponseParts()
              } else if (chunk.type === 'done') {
                streamedRenderParts[model.id] = finalizeStreamingConversationParts(
                  streamedRenderParts[model.id]
                )
                syncResponseParts()
                console.log(
                  `[Chat Debug] ${model.id} stream done. API total chars: ${streamedContent[model.id].length}, last 80 chars: "${streamedContent[model.id].slice(-80)}"`
                )
              } else if (chunk.type === 'error') {
                streamError = chunk.content || 'Generation failed'
                // Check for premium model error and show user-friendly message
                if (chunk.content === 'premium_model_not_allowed') {
                  streamedContent[model.id] =
                    `**${model.name}** is a premium model. Please upgrade to [Pro](${CUSTOM_AUTH_BASE_URL}/pricing) or [Max](${CUSTOM_AUTH_BASE_URL}/pricing) to access premium models.`
                } else if (chunk.content === 'daily_limit_exceeded') {
                  streamedContent[model.id] =
                    `You've reached your daily limit. Upgrade to [Pro](${CUSTOM_AUTH_BASE_URL}/pricing) for more requests.`
                } else if (chunk.content === 'insufficient_credits') {
                  streamedContent[model.id] =
                    `You've run out of credits. Visit your [account](${CUSTOM_AUTH_BASE_URL}/account) to purchase more.`
                } else {
                  streamedContent[model.id] = `Error: ${chunk.content}`
                }
                replaceWithTextPart(streamedContent[model.id])
                // Update UI with error message
                setMessages((prev) => {
                  const updated = [...prev]
                  const assistantIdx = updated.findIndex((m) => m.id === assistantMessageId)
                  if (assistantIdx !== -1) {
                    const msg = updated[assistantIdx]
                    const responses: ProviderResponse[] =
                      msg.responses?.map((r) =>
                        r.modelId === model.id
                          ? {
                              ...r,
                              content: streamedContent[model.id],
                              isLoading: false,
                              status: 'error' as const,
                              error: streamError ?? undefined
                            }
                          : r
                      ) || []
                    const responsesWithParts = responses.map((r) =>
                      r.modelId === model.id
                        ? { ...r, renderParts: [...streamedRenderParts[model.id]] }
                        : r
                    )
                    const selectedResponse = responses.find(
                      (r) => r.modelId === (msg.selectedModelId || model.id)
                    )
                    updated[assistantIdx] = {
                      ...msg,
                      responses: responsesWithParts,
                      content: selectedResponse?.content || msg.content,
                      selectedModelId: msg.selectedModelId || model.id
                    }
                  }
                  return updated
                })
              }
            }
          })

          console.log(
            `[Chat Debug] ${model.id} promise resolved. Final content chars: ${streamedContent[model.id].length}, last 80 chars: "${streamedContent[model.id].slice(-80)}"`
          )

          return {
            modelId: model.id,
            modelName: model.name,
            provider: model.provider,
            content: streamedContent[model.id] || '',
            isLoading: false,
            renderParts: [...streamedRenderParts[model.id]],
            status: streamError ? 'error' : 'completed',
            error: streamError ?? undefined
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error && error.message.trim()
              ? error.message
              : 'An error occurred while sending the message.'
          console.error('[ChatPanel] Cloud act send failed:', error)
          return {
            modelId: model.id,
            modelName: model.name,
            provider: model.provider,
            content: errorMessage,
            isLoading: false,
            renderParts: [
              {
                type: 'text',
                id: `${assistantMessageId}:${model.id}:error`,
                text: errorMessage
              }
            ],
            error: String(error),
            status: 'error'
          }
        }
      }

      try {
        // Process all model responses in parallel - handle each as it completes
        const updateFinalResponse = (response: ProviderResponse): void => {
          if (streamGenerationRef.current !== streamGeneration) return
          setMessages((prev) => {
            const updated = [...prev]
            const assistantIdx = updated.findIndex((m) => m.id === assistantMessageId)
            if (assistantIdx !== -1) {
              const msg = updated[assistantIdx]
              const responses: ProviderResponse[] = msg.responses?.map((r) =>
                r.modelId === response.modelId
                  ? {
                      ...response,
                      isLoading: false,
                      status: response.error ? ('error' as const) : ('completed' as const)
                    }
                  : r
              ) || [response]

              const nextSelectedModelId = msg.selectedModelId || response.modelId
              const selectedResponse =
                responses.find((r) => r.modelId === nextSelectedModelId) || responses[0]
              updated[assistantIdx] = {
                ...msg,
                responses,
                selectedModelId: nextSelectedModelId,
                content: selectedResponse?.content || msg.content,
                renderParts: selectedResponse?.renderParts || msg.renderParts
              }
            }
            return updated
          })
        }

        // Start all streaming requests and handle responses as they complete
        const responsePromises = modelsForMessage.map((model) =>
          sendToModelWithStreaming(model).then((response) => {
            updateFinalResponse(response)
            return response
          })
        )

        // Wait for all to complete
        const completedResponses = await Promise.all(responsePromises)
        if (streamGenerationRef.current !== streamGeneration) return

        // Extract memories from the user message only (run in background, don't block)
        // NOTE: We intentionally do NOT pass the assistant response — only the user's
        // own words should be used for memory extraction to avoid storing AI suggestions.
        const primaryResponse = completedResponses.find((r) => !r.error && r.content)
        if (memoryForTurn && primaryResponse && activeChatId) {
          const conversationContext = baseMessages.slice(-6).map((m) => `${m.role}: ${m.content}`)
          window.bridge.memory
            .extract({
              userMessage: userContent,
              chatId: activeChatId,
              messageId: assistantMessageId,
              conversationContext
            })
            .then((extractionResult) => {
              if (extractionResult.extracted.length > 0) {
                console.log(`[Memory] Extracted ${extractionResult.extracted.length} memories`)
                // Update the assistant message with extracted memories
                setMessages((prev) => {
                  const updated = [...prev]
                  const assistantIdx = updated.findIndex((m) => m.id === assistantMessageId)
                  if (assistantIdx !== -1) {
                    updated[assistantIdx] = {
                      ...updated[assistantIdx],
                      addedMemories: extractionResult.extracted.map((mem, idx) => ({
                        id: extractionResult.ids[idx] || `temp-${idx}`,
                        content: mem.content,
                        type: mem.type,
                        importance: mem.importance
                      }))
                    }
                    // Save updated messages
                    if (activeChatId) {
                      const chat = loadChat(activeChatId)
                      if (chat) {
                        chat.messages = updated
                        chat.updatedAt = Date.now()
                        saveChat(chat)
                      }
                    }
                  }
                  return updated
                })
              }
            })
            .catch((err) => console.error('[Memory] Extraction failed:', err))
        }

        // Save chat to storage after all responses complete
        setMessages((prev) => {
          messagesRef.current = prev
          if (activeChatId) {
            const chat = loadChat(activeChatId)
            if (chat) {
              chat.messages = prev
              chat.updatedAt = Date.now()
              saveChat(chat)
              refreshChatsList()
            }
          }
          return prev
        })

        // Generate title outside the state updater to avoid duplicate calls in React strict mode
        if (isFirstMessage && activeChatId) {
          const primaryContent = completedResponses.find((r) => !r.error && r.content)?.content
          if (primaryContent) {
            generateChatTitleAsync(
              userMessage.content,
              primaryContent,
              activeChatId,
              modelsForMessage[0]?.id
            )
          }
        }
      } catch (error) {
        console.error('Chat error:', error)
      } finally {
        if (streamGenerationRef.current === streamGeneration) {
          isLoadingRef.current = false
          setIsLoading(false)
        }
      }
    },
    [
      selectedModels,
      screenshots,
      mentions,
      memoryEnabled,
      showRetrievedMemories,
      refreshChatsList,
      generateChatTitleAsync
    ]
  )

  // Run agent mode
  const runAgent = useCallback(
    async (
      command: string,
      commandScreenshots: Screenshot[] = [],
      commandMentions: Mention[] = [],
      sendOptions?: ChatSendOptions
    ) => {
      console.log(
        `[Agent] runAgent called | workingFolder=${workingFolder ?? 'none'} | isAgentRunning=${isAgentRunning}`
      )
      console.log(`[Agent] Engine: ChatAgentV2 | codingTools=${!!workingFolder}`)
      const trimmedCommand = command.trim()
      const effectiveCommand =
        trimmedCommand.length > 0 ? trimmedCommand : 'Analyze the attached image(s).'
      const requestedToolIds = sendOptions?.requestedTools ?? []
      const memoryForTurn = sendOptions?.memoryEnabled ?? memoryEnabled
      const effectiveSearchEnabled = searchEnabled || requestedToolIds.includes('web_search')
      const sandboxEnabled = requestedToolIds.includes('sandbox')
      const turnToolInstruction = buildTurnToolInstruction(sendOptions)
      const commandForAgent = turnToolInstruction
        ? `${turnToolInstruction}\n\n${effectiveCommand}`
        : effectiveCommand
      if ((trimmedCommand.length === 0 && commandScreenshots.length === 0) || isAgentRunning) {
        console.log('[Agent] Returning early - empty command or already running')
        return
      }

      console.log(
        `[Agent] Starting execution | model=${selectedModels[0]?.id ?? 'default'} | searchEnabled=${effectiveSearchEnabled} | memoryEnabled=${memoryForTurn} | sandboxEnabled=${sandboxEnabled} | history=${messages.length} msgs`
      )
      setIsAgentRunning(true)
      setAgentSteps([])

      const isFirstMessage = messages.length === 0

      // Build history from existing messages for context
      const history = messages
        .filter((m) => m.content)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      // Add user message
      const userMessage: Message = {
        id: `${Date.now()}-user`,
        role: 'user',
        content: effectiveCommand,
        timestamp: Date.now(),
        imageData: commandScreenshots[0] ? screenshotUrl(commandScreenshots[0]) : undefined,
        screenshots: commandScreenshots.length > 0 ? [...commandScreenshots] : undefined,
        mentions:
          commandMentions.length > 0
            ? commandMentions.map((mention) => ({
                id: mention.id,
                type: mention.type,
                title: mention.title,
                preview: mention.preview,
                folderId: mention.folderId,
                filename: mention.filename
              }))
            : undefined
      }

      // Add placeholder agent message
      const agentMessageId = `${Date.now() + 1}-agent`
      const agentMessage: Message = {
        id: agentMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isAgentMessage: true,
        agentCommand: effectiveCommand
      }

      setMessages((prev) => [...prev, userMessage, agentMessage])
      composerRef.current?.setValue('')
      setScreenshots([])
      setMentions([])

      runAfterUi(
        () => indexMentionReferences(commandMentions),
        'Failed to index mention references for agent run'
      )

      // Set temporary title immediately for first message
      if (isFirstMessage && currentChatIdRef.current) {
        const tempTitle = generateTempTitle(effectiveCommand || 'Image attachment')
        updateChatTitle(currentChatIdRef.current, tempTitle)
        refreshChatsList()
      }

      // Track steps for this run to save with the message
      const currentRunSteps: AgentStep[] = []
      let mentionContext = ''

      if (commandMentions.length > 0) {
        const mentionContents: string[] = []

        for (const mention of commandMentions) {
          try {
            if (mention.type === 'note') {
              const note = await window.bridge.loadNote(mention.id)
              if (note?.content) {
                mentionContents.push(
                  `[Attached Note: ${mention.title}]\n${note.content}\n[End of Note]`
                )
              }
            } else if (mention.type === 'chat') {
              mentionContents.push(`[Referenced Chat: ${mention.title}]`)
            } else if (mention.type === 'document') {
              const chunksResult = await window.bridge.document.getChunks(mention.id)
              if (chunksResult.success && chunksResult.chunks && chunksResult.chunks.length > 0) {
                const docContent = chunksResult.chunks
                  .slice(0, 50)
                  .map((chunk: { content: string }) => chunk.content)
                  .join('\n\n')
                const truncatedContent =
                  docContent.length > 30000
                    ? `${docContent.slice(0, 30000)}\n...[truncated]`
                    : docContent
                mentionContents.push(
                  `[Attached Document: ${mention.title}]\n${truncatedContent}\n[End of Document]`
                )
              } else {
                mentionContents.push(`[Referenced Document: ${mention.title}]`)
              }
            }
          } catch (error) {
            console.error(`[Agent] Failed to fetch mention content for ${mention.id}:`, error)
          }
        }

        if (mentionContents.length > 0) {
          mentionContext = mentionContents.join('\n\n')
        }
      }

      try {
        const agentModelId = selectedModels[0]?.id
        console.log(
          `[Agent] Calling runAgentStream | workingFolder=${workingFolder ?? 'none'} | includeCodingTools=${!!workingFolder} | sandboxEnabled=${sandboxEnabled}`
        )
        const { cancel, streamId: agentStreamId } = window.bridge.runAgentStream(
          mentionContext ? `${mentionContext}\n\n${commandForAgent}` : commandForAgent,
          (event) => {
            const step: AgentStep = {
              type: event.type,
              plan: event.plan,
              thinking: event.thinking,
              tool: event.tool,
              toolInput: event.toolInput,
              toolResult: event.toolResult,
              text: event.text,
              error: event.error,
              step: event.step,
              stepsCompleted: event.stepsCompleted,
              maxSteps: event.maxSteps,
              checkpointStep: event.checkpointStep,
              checkpointMessage: event.checkpointMessage,
              timestamp: Date.now()
            }

            currentRunSteps.push(step)
            setAgentSteps((prev) => [...prev, step])

            // Update agent message content as text arrives
            if (event.type === 'text' && event.text) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMessageId ? { ...m, content: (m.content || '') + event.text } : m
                )
              )
            }

            if (event.type === 'max_steps_reached') {
              setIsAgentRunning(false)
              agentCancelRef.current = null
            }

            if (event.type === 'done') {
              setIsAgentRunning(false)
              agentCancelRef.current = null
              // Save agent steps onto the message and persist chat
              setMessages((prev) => {
                const updatedMessages = prev.map((m) =>
                  m.id === agentMessageId ? { ...m, agentSteps: [...currentRunSteps] } : m
                )
                if (currentChatIdRef.current) {
                  const chat = loadChat(currentChatIdRef.current)
                  if (chat) {
                    chat.messages = updatedMessages
                    chat.updatedAt = Date.now()
                    saveChat(chat)
                    refreshChatsList()
                  }
                }
                return updatedMessages
              })
              // Generate title outside the state updater to avoid duplicate calls
              if (isFirstMessage && currentChatIdRef.current) {
                generateChatTitleAsync(
                  effectiveCommand,
                  currentRunSteps.find((s) => s.type === 'text')?.text || '',
                  currentChatIdRef.current!,
                  selectedModels[0]?.id
                )
              }
            }

            if (event.type === 'error') {
              setIsAgentRunning(false)
              agentCancelRef.current = null
            }
          },
          agentModelId,
          history,
          commandScreenshots.map(screenshotUrl).filter(Boolean),
          workingFolder ?? undefined,
          effectiveSearchEnabled,
          memoryForTurn,
          sandboxEnabled
        )

        agentCancelRef.current = cancel

        // Listen for memory candidates emitted after this run completes
        const removeCandidateListener = window.bridge.memory.onAgentMemoryCandidates((data) => {
          if (data.streamId === agentStreamId) {
            setAgentMemoryCandidates((prev) => ({
              ...prev,
              [agentMessageId]: data.candidates.map((c) => ({
                ...c,
                sourceTaskId: data.taskId
              }))
            }))
            removeCandidateListener()
          }
        })
        // Auto-clean listener after 5 minutes if no candidates arrive
        setTimeout(() => removeCandidateListener(), 5 * 60 * 1000)
      } catch (err) {
        console.error('[Agent] Failed to run:', err)
        setIsAgentRunning(false)
        setAgentSteps((prev) => [
          ...prev,
          { type: 'error', error: String(err), timestamp: Date.now() }
        ])
      }
    },
    [
      isAgentRunning,
      messages,
      refreshChatsList,
      selectedModels,
      generateChatTitleAsync,
      workingFolder,
      searchEnabled,
      memoryEnabled
    ]
  )

  // Cancel agent
  const cancelAgent = useCallback(() => {
    if (agentCancelRef.current) {
      agentCancelRef.current()
      agentCancelRef.current = null
    }
    setIsAgentRunning(false)
  }, [])

  // Keep the deferred submit ref updated with the latest send handlers
  useEffect(() => {
    submitMessageRef.current = (message, messageScreenshots, messageMentions, options) => {
      void sendMessage(message, messageScreenshots ?? [], messageMentions ?? [], options)
    }
  }, [sendMessage])

  // Convert basic markdown to TipTap-compatible HTML
  const markdownToHtml = useCallback((md: string): string => {
    const lines = md.split('\n')
    const htmlParts: string[] = []
    let inOrderedList = false

    const closeLists = (): void => {
      if (inOrderedList) {
        htmlParts.push('</ol>')
        inOrderedList = false
      }
    }

    const escapeHtml = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const inlineFormat = (s: string): string =>
      escapeHtml(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')

    for (const raw of lines) {
      const line = raw.trimEnd()
      if (!line) {
        closeLists()
        continue
      }
      const h2 = line.match(/^## (.+)/)
      if (h2) {
        closeLists()
        htmlParts.push(`<h2>${inlineFormat(h2[1])}</h2>`)
        continue
      }
      const h3 = line.match(/^### (.+)/)
      if (h3) {
        closeLists()
        htmlParts.push(`<h3>${inlineFormat(h3[1])}</h3>`)
        continue
      }
      const h1 = line.match(/^# (.+)/)
      if (h1) {
        closeLists()
        htmlParts.push(`<h1>${inlineFormat(h1[1])}</h1>`)
        continue
      }
      const ol = line.match(/^\d+\.\s+(.+)/)
      if (ol) {
        if (!inOrderedList) {
          htmlParts.push('<ol>')
          inOrderedList = true
        }
        htmlParts.push(`<li>${inlineFormat(ol[1])}</li>`)
        continue
      }
      const ul = line.match(/^[-*]\s+(.+)/)
      if (ul) {
        if (!inOrderedList) {
          htmlParts.push('<ul>')
          inOrderedList = true
        }
        htmlParts.push(`<li>${inlineFormat(ul[1])}</li>`)
        continue
      }
      closeLists()
      htmlParts.push(`<p>${inlineFormat(line)}</p>`)
    }
    closeLists()
    return htmlParts.join('')
  }, [])

  // Build a simple HTML SOP from agent steps
  // Extract simple trigger keywords from a command string
  const extractTriggers = useCallback((command: string): string => {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'to',
      'for',
      'in',
      'on',
      'at',
      'is',
      'it',
      'me',
      'my',
      'please',
      'can',
      'could',
      'would',
      'should'
    ])
    return command
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w))
      .slice(0, 5)
      .join(', ')
  }, [])

  // Build a simple markdown SOP (for display in the textarea)
  const buildSkillSopMarkdown = useCallback((steps: AgentStep[]): string => {
    const lines: string[] = ['## Steps']
    let stepNum = 1
    for (const step of steps) {
      if (step.type === 'tool_start' && step.tool) {
        const inputStr = step.toolInput ? JSON.stringify(step.toolInput).slice(0, 80) : ''
        lines.push(`${stepNum}. **${step.tool}**${inputStr ? `: ${inputStr}` : ''}`)
        stepNum++
      } else if (step.type === 'text' && step.text) {
        lines.push(`*Agent note: ${step.text.slice(0, 120)}*`)
      }
    }
    return lines.join('\n')
  }, [])

  const handleMakeSkill = useCallback(
    (command: string, steps: AgentStep[]) => {
      const title = command.slice(0, 60).trim()
      const description = command.slice(0, 120).trim()
      const triggers = extractTriggers(command)
      const content = buildSkillSopMarkdown(steps)
      setMakeSkillDialog({ open: true, title, description, triggers, content })
    },
    [buildSkillSopMarkdown, extractTriggers]
  )

  const handleSaveSkill = useCallback(async () => {
    const { title, description, triggers, content } = makeSkillDialog
    if (!title.trim()) return
    const id = `skill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    const triggerList = triggers
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const { createDefaultSkillMetadata, moveNoteToFolder, SKILLS_FOLDER_ID, ensureSkillsFolder } =
      await import('../utils/folderStorage')
    ensureSkillsFolder()
    // Convert markdown textarea content to HTML for TipTap
    const htmlContent = markdownToHtml(content)
    await window.bridge.saveNote({
      id,
      title: title.trim(),
      content: htmlContent,
      folderId: SKILLS_FOLDER_ID,
      skill: createDefaultSkillMetadata({
        description: description.trim(),
        triggers: triggerList,
        source: { kind: 'agent-run' }
      }) as unknown as Record<string, unknown>
    })
    moveNoteToFolder(id, SKILLS_FOLDER_ID)
    setMakeSkillDialog({ open: false, title: '', description: '', triggers: '', content: '' })
  }, [makeSkillDialog, markdownToHtml])

  // Listen for agent user-input requests (agent needs human interaction in the browser)
  useEffect(() => {
    const removeListener = window.bridge.onAgentUserInputRequest((data) => {
      setUserInputRequest(data)
    })
    return removeListener
  }, [])

  // Skill chips are opt-in from the compose menu; avoid re-rendering ChatPanel on every keystroke.
  useEffect(() => {
    setSkillSuggestions([])
  }, [currentChatId])

  const handleUserInputContinue = useCallback(async () => {
    if (!userInputRequest) return
    const { requestId } = userInputRequest
    setUserInputRequest(null)
    try {
      await window.bridge.agentUserInputContinue(requestId)
    } catch (err) {
      console.error('[ChatPanel] Failed to signal user input continue:', err)
    }
  }, [userInputRequest])

  // Handle send with optional agent mode
  const handleSend = useCallback(
    (
      message: string,
      messageScreenshots: Screenshot[],
      isAgentMode?: boolean,
      options?: ChatSendOptions
    ) => {
      console.log(
        '[ChatPanel] handleSend called, isAgentMode:',
        isAgentMode,
        'message:',
        message.slice(0, 50)
      )
      console.log('[ChatPanel] Routing to cloud conversation send')
      void sendMessage(message, messageScreenshots, options?.mentions ?? mentions, options)
      // Clear mentions after sending
      setMentions([])
    },
    [sendMessage, mentions]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        console.log('[ChatPanel] handleKeyDown Enter')
        void sendMessage()
      }
    },
    [sendMessage]
  )

  const streamingAssistantMessageId = useMemo(() => {
    const active = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' &&
          (message.responses?.some((response) => response.isLoading) ||
            (isAgentRunning && message.isAgentMessage))
      )
    return active?.id ?? null
  }, [isAgentRunning, messages])
  const composerIsStreaming = useMemo(
    () => isDesktopComposerStreaming(messages, isAgentRunning),
    [isAgentRunning, messages]
  )

  void showAddedMemories
  void agentMemoryCandidates
  void generateConsensus
  void runAgent
  void handleMakeSkill
  void handleUserInputContinue

  return (
    <DockablePanel
      panelType="chat"
      panelBg={theme.panelBgOpacity(panelOpacity)}
      frameTransparent={!headerLocked && !isPanelHovered}
      extraWidthLeft={chatAccessTabsInSidebar && showSidebar ? sidebarWidth : 0}
      extraWidthRight={
        attachmentPreview.preview && attachmentPreview.mode === 'panel'
          ? 440
          : sourcesPanel
            ? 380
            : showProjectSidebar && !!workingFolder
              ? 260
              : 0
      }
    >
      <div
        onMouseEnter={() => setIsPanelHovered(true)}
        onMouseLeave={() => setIsPanelHovered(false)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={
          {
            width: '100%',
            height: '100%',
            background:
              !headerLocked && !isPanelHovered
                ? 'transparent'
                : `linear-gradient(${theme.surfaceBg}, ${theme.surfaceBg}), ${theme.panelBg}`,
            borderRadius: 'var(--dockable-border-radius, 12px)',
            borderWidth: isDragOver && supportsVision ? 2 : 'var(--dockable-border-width, 1px)',
            borderStyle: isDragOver && supportsVision ? 'dashed' : 'solid',
            borderColor:
              !headerLocked && !isPanelHovered
                ? 'transparent'
                : isDragOver && supportsVision
                  ? theme.dragOverlayBorder
                  : theme.border,
            boxShadow:
              !headerLocked && !isPanelHovered
                ? 'none'
                : `inset 0 0 0 1px ${theme.border}`,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            WebkitAppRegion: 'no-drag',
            opacity: isVisible ? (dynamicOpacity && !isWindowFocused && headerLocked ? 0.5 : 1) : 0,
            transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(10px)',
            transition:
              'opacity 0.2s ease-out, transform 0.1s ease-out, border 0.15s ease, background 0.2s ease-out, box-shadow 0.15s ease',
            position: 'relative'
          } as React.CSSProperties
        }
      >
        {/* Option+Drag overlay - always present but only active when Option held */}
        <OptionDragOverlay isOptionHeld={isOptionHeld} />
        <PanelFrameBorder
          visible={headerLocked || isPanelHovered}
          color={theme.border}
        />

        {/* Drag overlay */}
        {isDragOver && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: theme.dragOverlayBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              borderRadius: 'var(--dockable-border-radius, 16px)',
              pointerEvents: 'none'
            }}
          >
            <div
              style={{
                padding: '16px 24px',
                background: theme.dropdownBg,
                borderRadius: 12,
                color: theme.text,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              {supportsVision
                ? 'Drop images here'
                : 'This model does not support images, change to a vision model'}
            </div>
          </div>
        )}

        <DesktopAttachmentPreviewDialog
          preview={attachmentPreview.preview}
          mode={attachmentPreview.mode}
          onClose={attachmentPreview.close}
          onModeChange={attachmentPreview.setMode}
        />
        {/* Top spacer when chatAccessTabsInSidebar is enabled - maintains top border frame */}
        {chatAccessTabsInSidebar && (
          <div
            style={
              {
                height: 8,
                flexShrink: 0,
                WebkitAppRegion: 'drag'
              } as React.CSSProperties
            }
          />
        )}

        {/* Header with chat title and new chat button - hidden when chatAccessTabsInSidebar is enabled */}
        {!chatAccessTabsInSidebar && (
          <ChatHeader
            isProtected={isProtected}
            toggleContentProtection={toggleContentProtection}
            onNewInNewTab={handleNewInNewTab}
            onClose={() => {
              if (currentChatIdRef.current) {
                runInBackground(
                  () => indexCurrentChatForKnowledge(currentChatIdRef.current!),
                  'Failed to index chat on panel close'
                )
              }
              window.bridge.destroyPanel()
            }}
            onMinimize={() => window.bridge.hidePanel('chat')}
            onMaximize={async () => {
              const result = await window.bridge.maximizePanel()
              if (result.success) setIsMaximized(result.isMaximized)
            }}
            isMaximized={isMaximized}
            onShowShortcuts={() => setShowShortcutsMenu(true)}
            theme={theme}
            tabs={tabs}
            activeTabId={currentChatId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onRenameTab={handleRenameTab}
            onReorderTabs={handleReorderTabs}
            chatTitle={chatTitle}
            setChatTitle={setChatTitle}
            isEditingTitle={isEditingTitle}
            setIsEditingTitle={setIsEditingTitle}
            showSidebar={showSidebar}
            onToggleSidebar={() => {
              if (showSidebar) {
                closeSidebarAnimated()
              } else {
                setShowSidebar(true)
                refreshChatsList()
              }
            }}
            headerLocked={headerLocked}
            onToggleHeaderLock={() => setHeaderLocked(!headerLocked)}
            isPanelHovered={isPanelHovered}
          />
        )}

        {/* Body content with rounded top corners */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            position: 'relative',
            margin: !headerLocked && !isPanelHovered ? 0 : '0 8px 0 8px',
            transition: 'margin 0.2s ease-out',
            display: 'flex',
            flexDirection: 'row'
          }}
        >
          <PanelSidebarFrame
            accessTabsInSidebar={chatAccessTabsInSidebar}
            open={showSidebar}
            closing={isSidebarClosing}
            width={sidebarWidth}
            defaultWidth={sidebarDefaultWidth}
            collapseThreshold={sidebarCollapseThreshold}
            panelOpacity={panelOpacity}
            frameVisible={headerLocked || isPanelHovered}
            theme={theme}
            onRequestClose={closeSidebarAnimated}
            onOpenChange={setShowSidebar}
            onWidthChange={setSidebarWidth}
          >
            <ChatSidebar
              chats={chats}
              currentChatId={currentChatId}
              isClosing={isSidebarClosing}
              onClose={chatAccessTabsInSidebar ? () => setShowSidebar(false) : closeSidebarAnimated}
              onLoadChat={handleOpenChatInNewTab}
              onDeleteChat={handleDeleteChat}
              onOpenInNewWindow={handleOpenChatInNewWindow}
              onOpenInNewTab={handleOpenChatInNewTab}
              onRenameChat={handleRenameTab}
              openItemIds={openItemIds}
              theme={theme}
              onNewInCurrentTab={startNewChat}
              onNewInNewTab={handleNewInNewTab}
              onNewInNewWindow={startNewChatInNewWindow}
              selectedFolderId={viewingFolderId}
              onSelectFolder={handleSelectFolder}
              accessTabsInSidebar={chatAccessTabsInSidebar}
              openTabs={tabs}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              isCollapsed={sidebarWidth < sidebarCompactThreshold}
            />
          </PanelSidebarFrame>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              borderRadius:
                !headerLocked && !isPanelHovered
                  ? 'var(--dockable-border-radius, 12px)'
                  : chatAccessTabsInSidebar && showSidebar
                    ? '0 8px 8px 0'
                    : 8,
              overflow: 'hidden',
              background: theme.panelBgOpacity(panelOpacity),
              transition: 'border-radius 0.2s ease-out'
            }}
          >
            {/* Chat view header with model dropdown (matches MainWindow extensions header) */}
            {!viewingFolderId && (
              <ChatViewHeader
                title={chatTitle}
                theme={theme}
                models={models}
                selectedModels={selectedModels}
                setSelectedModels={(nextModels) =>
                  setSelectedModels(
                    agentModeEnabled ? nextModels.slice(0, 1) : nextModels.slice(0, 4)
                  )
                }
                allowMultiSelect={!agentModeEnabled}
                isAgentMode={agentModeEnabled}
              />
            )}

            {/* Find Bar */}
            <FindBar
              isOpen={showFindBar}
              onClose={() => setShowFindBar(false)}
              containerRef={chatContainerRef}
              theme={theme}
            />

            {/* Folder View or Messages area */}
            {viewingFolderId ? (
              <FolderView
                folderId={viewingFolderId}
                onChatSelect={(chatId) => {
                  handleOpenChatInNewTab(chatId)
                  setViewingFolderId(null)
                }}
                theme={theme}
              />
            ) : (
              <div
                ref={chatContainerRef}
                className="px-3 py-3 sm:px-4 sm:py-4"
                style={
                  {
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    WebkitAppRegion: 'no-drag'
                  } as React.CSSProperties
                }
              >
                {messages.length === 0 ? (
                  <EmptyState />
                ) : (
                  <DesktopChatTranscript
                    messages={messages}
                    models={models}
                    onDelete={deleteMessage}
                    onRetry={retryMessage}
                    onReply={replyToMessage}
                    onOpenAttachmentPreview={attachmentPreview.open}
                    onSelectResponseModel={selectResponseModel}
                    onBranch={branchConversationAtTurn}
                    onOpenSources={openSourcesPanel}
                    sourcesPanel={sourcesPanel}
                    actionsLocked={isLoading || isAgentRunning || isBranching}
                    streamingAssistantMessageId={streamingAssistantMessageId}
                    theme={theme}
                  />
                )}

                <div ref={messagesEndRef} />
                {transcriptReservedSpace !== null ? (
                  <div
                    aria-hidden
                    style={{ height: transcriptReservedSpace, flexShrink: 0 }}
                  />
                ) : null}
              </div>
            )}
          </div>

          {attachmentPreview.preview && attachmentPreview.mode === 'panel' ? (
            <div className="shared-app-scope w-[440px] shrink-0 border-l border-[var(--border)]">
              <DesktopAttachmentPreviewPanel
                preview={attachmentPreview.preview}
                onClose={attachmentPreview.close}
                onModeChange={attachmentPreview.setMode}
              />
            </div>
          ) : (
            <DesktopSourcesPanel
              open={sourcesPanel !== null}
              onClose={closeSourcesPanel}
              sources={sourcesPanel?.sources ?? []}
              theme={theme}
            />
          )}

          {/* Project File Tree Sidebar — right column with working folder */}
          {workingFolder && (
            <div
              style={{
                width: showProjectSidebar ? 260 : 0,
                flexShrink: 0,
                overflow: 'hidden',
                transition: 'width 0.3s ease',
                position: 'relative'
              }}
            >
              <div
                style={{
                  width: 260,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <NativeProjectFileTreeHost
                  workingFolder={workingFolder}
                  modifiedFiles={modifiedFilesInSession}
                  isClosing={isProjectSidebarClosing}
                  onClose={() => {
                    setIsProjectSidebarClosing(true)
                    setTimeout(() => {
                      setShowProjectSidebar(false)
                      setIsProjectSidebarClosing(false)
                    }, 150)
                  }}
                />
              </div>
            </div>
          )}

        </div>
        {/* End body content wrapper */}

        {/* Embedded bottom bar in frame border - matches NotebookPanel design */}
        <div
          style={
            {
              flexShrink: 0,
              minHeight: 52,
              opacity: headerLocked || isPanelHovered ? 1 : 0,
              overflow: headerLocked || isPanelHovered ? 'visible' : 'hidden',
              transition: 'opacity 0.2s ease, padding 0.25s ease',
              padding: headerLocked || isPanelHovered ? '4px 16px 8px 16px' : '4px 16px 8px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              pointerEvents: headerLocked || isPanelHovered ? 'auto' : 'none'
            } as React.CSSProperties
          }
        >
          {/* Button row - draggable region for window movement */}
          {chatAccessTabsInSidebar && (
            <div
              style={
                {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  minHeight: 36,
                  WebkitAppRegion: 'drag'
                } as React.CSSProperties
              }
            >
              {/* Sidebar toggle button */}
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
                style={
                  {
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: showSidebar ? theme.surfaceBgActive : 'transparent',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                    WebkitAppRegion: 'no-drag'
                  } as React.CSSProperties
                }
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.surfaceBgActive
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = showSidebar
                    ? theme.surfaceBgActive
                    : 'transparent'
                }}
              >
                <PanelLeft size={16} color={theme.iconColor} />
              </button>

              {/* Keyboard shortcuts button */}
              <button
                onClick={() => setShowShortcutsMenu(true)}
                title="Keyboard shortcuts"
                style={
                  {
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'transparent',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                    WebkitAppRegion: 'no-drag'
                  } as React.CSSProperties
                }
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.surfaceBgActive
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Keyboard size={16} color={theme.iconColor} />
              </button>

              {/* Spacer - explicit drag region for window movement */}
              <DraggableSpacer />

              {/* New chat button */}
              <button
                onClick={startNewChat}
                title="New chat"
                style={
                  {
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'transparent',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                    WebkitAppRegion: 'no-drag'
                  } as React.CSSProperties
                }
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.surfaceBgActive
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <SquarePen size={16} color={theme.iconColor} />
              </button>

              {/* Content protection button */}
              <button
                onClick={toggleContentProtection}
                title={isProtected ? 'Show in screenshots' : 'Hide from screenshots'}
                style={
                  {
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: isProtected ? theme.surfaceBgActive : 'transparent',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                    WebkitAppRegion: 'no-drag'
                  } as React.CSSProperties
                }
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.surfaceBgActive
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isProtected
                    ? theme.surfaceBgActive
                    : 'transparent'
                }}
              >
                {isProtected ? (
                  <EyeOff size={16} color={theme.iconColor} />
                ) : (
                  <Eye size={16} color={theme.iconColor} />
                )}
              </button>

              {/* Project file tree toggle — visible with working folder */}
              {workingFolder && (
                <button
                  onClick={() => {
                    setSourcesPanel(null)
                    setShowProjectSidebar((v) => !v)
                  }}
                  title={showProjectSidebar ? 'Hide project files' : 'Show project files'}
                  style={
                    {
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: showProjectSidebar ? theme.surfaceBgActive : 'transparent',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      flexShrink: 0,
                      WebkitAppRegion: 'no-drag'
                    } as React.CSSProperties
                  }
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.surfaceBgActive
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = showProjectSidebar
                      ? theme.surfaceBgActive
                      : 'transparent'
                  }}
                >
                  <FolderTree size={16} color={theme.iconColor} />
                </button>
              )}

              {/* Frame visibility lock button */}
              <button
                onClick={() => setHeaderLocked(!headerLocked)}
                title={headerLocked ? 'Unlock frame' : 'Lock frame'}
                style={
                  {
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: headerLocked ? theme.surfaceBgActive : 'transparent',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    flexShrink: 0,
                    WebkitAppRegion: 'no-drag'
                  } as React.CSSProperties
                }
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.surfaceBgActive
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = headerLocked
                    ? theme.surfaceBgActive
                    : 'transparent'
                }}
              >
                {headerLocked ? (
                  <Lock size={16} color={theme.iconColor} />
                ) : (
                  <Unlock size={16} color={theme.iconColor} />
                )}
              </button>
            </div>
          )}

          {/* Skill suggestion chips — shown when skills match */}
          {skillSuggestions.length > 0 && (
            <div
              style={
                {
                  flexShrink: 0,
                  display: 'flex',
                  gap: 6,
                  padding: '4px 16px 0',
                  flexWrap: 'wrap',
                  WebkitAppRegion: 'no-drag'
                } as React.CSSProperties
              }
            >
              {skillSuggestions.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => {
                    const current = composerRef.current?.getValue() || ''
                    const next = `${current} @${skill.title}`.trimStart()
                    composerRef.current?.setValue(next)
                  }}
                  title={`Use skill: ${skill.title}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 10px',
                    borderRadius: 20,
                    border: `1px solid ${theme.border}`,
                    background: theme.surfaceBg,
                    color: theme.textSecondary,
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    whiteSpace: 'nowrap'
                  }}
                >
                  ✦ {skill.title}
                </button>
              ))}
            </div>
          )}

          {/* Chat Input - always in frame border */}
          <div
            style={
              {
                flexShrink: 0,
                WebkitAppRegion: 'no-drag'
              } as React.CSSProperties
            }
          >
            <ChatInputArea
              theme={theme}
              models={models}
              selectedModels={selectedModels}
              onModelSelect={(model) => {
                // In agent mode, use single-select (replace entire selection)
                if (agentModeEnabled) {
                  setSelectedModels([model])
                  return
                }
                // Multi-select toggle, capped at four parallel model variants.
                const isSelected = selectedModels.some((m) => m.id === model.id)
                if (isSelected) {
                  if (selectedModels.length > 1) {
                    setSelectedModels(selectedModels.filter((m) => m.id !== model.id))
                  }
                } else if (selectedModels.length < 4) {
                  setSelectedModels([...selectedModels, model])
                }
              }}
              supportsVision={supportsVision}
              placeholder={
                viewingFolderId && viewingFolderName
                  ? `New chat in ${viewingFolderName}`
                  : 'Message Overlay...'
              }
              dropdownDirection="up"
              onSend={
                viewingFolderId
                  ? (message, messageScreenshots, _isAgentMode, options) =>
                      startNewChatInFolder(
                        viewingFolderId,
                        message,
                        messageScreenshots,
                        options?.mentions ?? folderMentions,
                        options
                      )
                  : handleSend
              }
              ref={composerRef}
              screenshots={viewingFolderId ? folderScreenshots : screenshots}
              onScreenshotsChange={viewingFolderId ? setFolderScreenshots : setScreenshots}
              onKeyDown={viewingFolderId ? undefined : handleKeyDown}
              textareaRef={inputRef}
              embedded
              memoryEnabled={memoryEnabled}
              onToggleMemory={() => setMemoryEnabled((prev) => !prev)}
              searchEnabled={searchEnabled}
              onToggleSearch={() => setSearchEnabled((prev) => !prev)}
              chatId={viewingFolderId ? undefined : (currentChatId ?? undefined)}
              mentions={viewingFolderId ? folderMentions : mentions}
              onMentionsChange={viewingFolderId ? setFolderMentions : setMentions}
              folderId={
                viewingFolderId ??
                (currentChatId ? (getChatFolderId(currentChatId) ?? undefined) : undefined)
              }
              containerRef={viewingFolderId ? undefined : chatContainerRef}
              showModelSelector={Boolean(viewingFolderId)}
              isStreaming={composerIsStreaming}
              onStop={() => {
                if (isAgentRunning) {
                  cancelAgent()
                }
                mediaAbortRef.current?.abort()
                mediaAbortRef.current = null
                streamGenerationRef.current += 1
                isLoadingRef.current = false
                setMessages((previousMessages) => {
                  const settled = settleDesktopMessagesAsInterrupted(previousMessages)
                  messagesRef.current = settled
                  return settled
                })
                setIsLoading(false)
              }}
              workingFolder={workingFolder}
              onWorkingFolderChange={setWorkingFolder}
            />
          </div>
        </div>

        {/* Keyboard Shortcuts Menu */}
        <ShortcutsMenu
          isOpen={showShortcutsMenu}
          onClose={() => setShowShortcutsMenu(false)}
          shortcuts={[
            { keys: ['⌘', 'E'], description: 'New chat in current tab' },
            { keys: ['⌘', 'N'], description: 'New chat in new window' },
            { keys: ['⌘', 'T'], description: 'New chat in new tab' },
            { keys: ['⌘', 'W'], description: 'Close current tab' },
            { keys: ['⌘', '⇧', 'W'], description: 'Close window' },
            { keys: ['⌘', '⇧', 'T'], description: 'Reopen last closed tab' },
            { keys: ['⌘', '⇧', 'N'], description: 'Reopen last closed window' },
            { keys: ['⌘', '1-8'], description: 'Switch to tab 1-8' },
            { keys: ['⌘', '9'], description: 'Switch to last tab' },
            { keys: ['⌘', 'M'], description: 'Toggle model selector' },
            { keys: ['⌘', '⇧', 'S'], description: 'Toggle sidebar' },
            { keys: ['⌘', 'K'], description: 'Search chats' },
            { keys: ['⌘', 'F'], description: 'Find in chat' },
            { keys: ['/'], description: 'Focus chat input' },
            { keys: ['⌘', 'L'], description: 'Show shortcuts' },
            { keys: ['⌥', 'Drag'], description: 'Move panel' },
            { keys: ['⌘', '+'], description: 'Zoom in' },
            { keys: ['⌘', '-'], description: 'Zoom out' },
            { keys: ['⌘', '0'], description: 'Reset zoom' }
          ]}
          theme={theme}
          title="Chat Shortcuts"
        />

        {/* Make Skill dialog */}
        {makeSkillDialog.open && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2000
            }}
            onClick={() =>
              setMakeSkillDialog({
                open: false,
                title: '',
                description: '',
                triggers: '',
                content: ''
              })
            }
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 520,
                maxHeight: '85vh',
                background: theme.panelBg,
                borderRadius: 16,
                border: `1px solid ${theme.border}`,
                boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '18px 22px',
                  borderBottom: `1px solid ${theme.border}`
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>
                  Create Skill from Run
                </span>
                <button
                  onClick={() =>
                    setMakeSkillDialog({
                      open: false,
                      title: '',
                      description: '',
                      triggers: '',
                      content: ''
                    })
                  }
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: theme.textSecondary,
                    fontSize: 18,
                    lineHeight: 1,
                    padding: 2
                  }}
                >
                  ×
                </button>
              </div>

              {/* Fields */}
              <div
                style={{
                  padding: '20px 22px',
                  flex: 1,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14
                }}
              >
                {[
                  {
                    label: 'Skill Name',
                    key: 'title' as const,
                    placeholder: 'e.g., Send weekly report email'
                  },
                  {
                    label: 'Description (one line)',
                    key: 'description' as const,
                    placeholder: 'What does this skill do?'
                  },
                  {
                    label: 'Trigger keywords (comma-separated)',
                    key: 'triggers' as const,
                    placeholder: 'e.g., send email, weekly report'
                  }
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: 11,
                        fontWeight: 600,
                        color: theme.textSecondary,
                        marginBottom: 5,
                        textTransform: 'uppercase',
                        letterSpacing: '0.4px'
                      }}
                    >
                      {label}
                    </label>
                    <input
                      type="text"
                      value={makeSkillDialog[key]}
                      onChange={(e) =>
                        setMakeSkillDialog((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      placeholder={placeholder}
                      style={{
                        width: '100%',
                        padding: '9px 13px',
                        borderRadius: 10,
                        border: `1px solid ${theme.border}`,
                        background: theme.inputBg,
                        color: theme.text,
                        fontSize: 13,
                        outline: 'none',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                ))}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 600,
                      color: theme.textSecondary,
                      marginBottom: 5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px'
                    }}
                  >
                    Procedure (Markdown)
                  </label>
                  <textarea
                    value={makeSkillDialog.content}
                    onChange={(e) =>
                      setMakeSkillDialog((prev) => ({ ...prev, content: e.target.value }))
                    }
                    rows={8}
                    style={{
                      width: '100%',
                      padding: '9px 13px',
                      borderRadius: 10,
                      border: `1px solid ${theme.border}`,
                      background: theme.inputBg,
                      color: theme.text,
                      fontSize: 12,
                      lineHeight: 1.5,
                      outline: 'none',
                      resize: 'vertical',
                      fontFamily: 'ui-monospace, monospace',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                  padding: '14px 22px',
                  borderTop: `1px solid ${theme.border}`
                }}
              >
                <button
                  onClick={() =>
                    setMakeSkillDialog({
                      open: false,
                      title: '',
                      description: '',
                      triggers: '',
                      content: ''
                    })
                  }
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: theme.text,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSaveSkill()}
                  disabled={!makeSkillDialog.title.trim()}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: makeSkillDialog.title.trim()
                      ? theme.isDark
                        ? '#ffffff'
                        : '#0a0a0a'
                      : theme.border,
                    color: makeSkillDialog.title.trim()
                      ? theme.isDark
                        ? '#0a0a0a'
                        : '#ffffff'
                      : theme.textDisabled,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: makeSkillDialog.title.trim() ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit',
                    transition: 'opacity 0.15s'
                  }}
                  onMouseEnter={(e) => {
                    if (makeSkillDialog.title.trim()) e.currentTarget.style.opacity = '0.85'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1'
                  }}
                >
                  Save Skill
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DockablePanel>
  )
}

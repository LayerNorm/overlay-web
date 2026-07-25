import { Transcription } from '../types/transcription'
import type { KnowledgeMigrationJournal } from '@overlay/app-core'
import type {
  LegacyKnowledgeAsset,
  LegacyKnowledgeInventory
} from '../main/services/knowledge-migration-store'

interface DownloadProgress {
  modelId: string
  percent: number
  downloaded: number
  total: number
  downloadedFormatted: string
  totalFormatted: string
  currentFile: string
}

interface ModelInfo {
  id: string
  name: string
  size: number
  sizeFormatted: string
  downloaded: boolean
  path?: string
}

interface OverlayServerProfile {
  deploymentId: string
  mode: 'cloud' | 'self-hosted'
  origin: string
  verifiedAt: number
}

interface Bridge {
  checkOnboardingComplete(): Promise<boolean>
  setOnboardingComplete(): Promise<boolean>
  initializeOnboardingPanelHotkeys(): Promise<boolean>
  checkMicrophonePermission(): Promise<string>
  requestMicrophonePermission(): Promise<string>
  checkAccessibilityPermission(): Promise<boolean>
  requestAccessibilityPermission(): Promise<string>
  checkSystemEventsPermission(): Promise<boolean>
  requestSystemEventsPermission(): Promise<string>
  updateSoundEffects(enabled: boolean): Promise<void>
  updateSmartTranscription(enabled: boolean): Promise<void>
  updateAssistantMode(enabled: boolean): Promise<void>
  updateAgentModel(modelId: string): Promise<void>
  updateRecordingStorage(enabled: boolean): Promise<void>
  updateRecordingRetention(retention: string): Promise<void>
  updateShowPanelsOnStartup(enabled: boolean): Promise<void>
  openRecordingsFolder(): Promise<void>
  onForceSignOut(cb: (data?: { reason?: 'session_expired' }) => void): () => void
  onWindowZoomCommand(cb: (command: { action?: 'in' | 'out' | 'reset' }) => void): () => void
  onRecordStart(cb: () => void): () => void
  onRecordStop(cb: () => void): () => void
  onRecordCancel(cb: () => void): () => void
  onTranscriptionAdd(cb: (transcription: Transcription) => void): () => void
  transcribe(
    mime: string,
    arrayBuffer: ArrayBuffer,
    duration: number,
    extras?: { dictionaryWords?: string[]; smartTranscriptionModePrompt?: string }
  ): Promise<{ text: string; agentMode?: boolean }>
  pasteText(text: string): Promise<boolean>
  updatePushToTalkHotkey(hotkey: string): Promise<void>
  updateAutoMute(enabled: boolean): Promise<void>
  updateTranscriptionModeHotkey(hotkey: string): Promise<void>
  updateAssistantModeHotkey(hotkey: string): Promise<void>
  updateAssistantScreenshot(enabled: boolean): Promise<void>
  updateInputDevice(deviceId: string): Promise<void>
  getSettings(): Promise<{
    autoCopy: boolean
    pressEnterAfter: boolean
    selectedModelId: string
    chatToolPermissionMode: 'ask_for_approval' | 'full_access'
    analyticsConsentEnabled: boolean
  }>
  setChatToolPermissionMode(mode: 'ask_for_approval' | 'full_access'): Promise<{
    updated: boolean
    mode: 'ask_for_approval' | 'full_access'
    error?: 'invalid_mode' | 'confirmation_unavailable'
  }>
  updateAutoCopy(enabled: boolean): Promise<void>
  updatePressEnterAfter(enabled: boolean): Promise<void>
  updateContextAwareCapitalization(enabled: boolean): Promise<void>
  syncSettings(settings: { autoCopy: boolean; pressEnterAfter: boolean }): Promise<void>
  syncSmartTranscriptionModes(data: {
    modes: Array<{ id: string; name: string; prompt: string; isDefault: boolean }>
    activeModeId: string
  }): Promise<void>
  getSmartTranscriptionModes(): Promise<{
    modes: Array<{ id: string; name: string; prompt: string; isDefault: boolean }>
    activeModeId: string
  }>
  setActiveSmartTranscriptionMode(modeId: string): Promise<void>
  getAnalyticsToken(): Promise<string | null>
  onSmartTranscriptionModeChanged(cb: (modeId: string) => void): () => void
  onSettingsChanged(cb: (payload: { key: string; value: unknown }) => void): () => void
  broadcastSettingsChanged(payload: { key: string; value: unknown }): Promise<void>
  updateLocalTranscription(enabled: boolean): Promise<void>
  updateCloudTranscription(enabled: boolean): Promise<void>
  updateTranscriptionPriority(priority: 'cloud' | 'local'): Promise<void>
  // Model management methods
  getInstalledModels(): Promise<string[]>
  downloadModel(modelId: string): Promise<void>
  deleteModel(modelId: string): Promise<void>
  switchModel(modelId: string): Promise<void>
  getModelInfo(modelId: string): Promise<ModelInfo>
  openModelsFolder(): Promise<void>
  onDownloadProgress(cb: (progress: DownloadProgress) => void): () => void
  getCurrentModel(): Promise<string>
  // Panel window management
  // For chat/notebook: toggles visibility (hide all if any visible, show all if all hidden)
  togglePanelWindow(
    panelType: 'notebook' | 'chat' | 'transcription' | 'browser',
    open: boolean
  ): Promise<{ action: string; count: number; isVisible: boolean }>
  isPanelVisible(
    panelType: 'chat' | 'notebook' | 'browser'
  ): Promise<{ isVisible: boolean; windowCount: number }>
  onPanelClosed(
    cb: (panelType: 'notebook' | 'chat' | 'transcription' | 'browser', itemId?: string) => void
  ): () => void
  onPanelVisibilityChanged(
    cb: (panelType: 'notebook' | 'chat' | 'browser', isVisible: boolean) => void
  ): () => void
  notifyPanelRendererReady(panelType: 'notebook' | 'chat' | 'browser'): void
  reportPanelLatency(payload: {
    panelType: 'notebook' | 'chat' | 'browser'
    stage: 'paint' | 'hydrate'
  }): void
  setContentProtection(
    panelType: 'notebook' | 'chat' | 'transcription' | 'browser',
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }>
  // Multi-window support
  isItemOpen(
    panelType: 'chat' | 'notebook',
    itemId: string
  ): Promise<{ isOpen: boolean; windowId?: number }>
  openInNewWindow(
    panelType: 'chat' | 'notebook',
    itemId: string,
    position?: { x: number; y: number; width: number; height: number }
  ): Promise<{ success: boolean; error?: string; windowId?: number }>
  registerOpenItem(panelType: 'chat' | 'notebook', itemId: string): Promise<{ success: boolean }>
  unregisterOpenItem(panelType: 'chat' | 'notebook', itemId: string): Promise<{ success: boolean }>
  getOpenItems(panelType: 'chat' | 'notebook'): Promise<{ openItems: string[] }>
  // Transcription panel events
  onTranscriptionText(cb: (text: string) => void): () => void
  sendTranscriptionToPanel(text: string): Promise<{ success: boolean }>
  // Chat input events
  sendTextToChatInput(text: string): Promise<{ success: boolean; error?: string }>
  sendTextToNewChat(text: string): Promise<{ success: boolean; error?: string }>
  onChatInputText(cb: (text: string) => void): () => void
  onNewChatWithText(cb: (text: string) => void): () => void
  // Notebook input events
  sendTextToNoteInput(text: string): Promise<{ success: boolean; error?: string }>
  sendTextToNewNote(text: string): Promise<{ success: boolean; error?: string }>
  onNoteInputText(cb: (text: string) => void): () => void
  onNewNoteWithText(cb: (text: string) => void): () => void
  onNewNoteWithTitleAndContent(
    cb: (payload: { title: string; content: string }) => void
  ): () => void
  // Chat methods
  getChatModels(): Promise<ChatModel[]>
  onChatModelsChanged(cb: () => void): () => void
  captureScreenshots(): Promise<Screenshot[]>
  // Panel hotkey methods
  updateChatPanelHotkey(hotkey: string): Promise<void>
  updateNotebookPanelHotkey(hotkey: string): Promise<void>
  updateBrowserPanelHotkey(hotkey: string): Promise<void>
  // Browser methods
  browser: {
    ensureWindow(createInitialTab?: boolean): Promise<boolean>
    createTab(url?: string): Promise<BrowserTab | null>
    closeTab(tabId: string): Promise<boolean>
    switchTab(tabId: string): Promise<boolean>
    navigate(tabId: string, url: string): Promise<boolean>
    goBack(tabId: string): Promise<boolean>
    goForward(tabId: string): Promise<boolean>
    reload(tabId: string): Promise<boolean>
    stop(tabId: string): Promise<boolean>
    hardReload(tabId: string): Promise<boolean>
    reopenClosedTab(): Promise<BrowserTab | null>
    getTabByIndex(index: number): Promise<string | null>
    getNextTab(): Promise<string | null>
    getPreviousTab(): Promise<string | null>
    getTabCount(): Promise<number>
    getTabInfo(tabId: string): Promise<BrowserTab | null>
    getTabs(): Promise<BrowserTab[]>
    getActiveTab(): Promise<string | null>
    getHistory(): Promise<HistoryEntry[]>
    clearHistory(): Promise<boolean>
    clearAllCookies(): Promise<boolean>
    deleteHistoryEntry(id: string): Promise<boolean>
    getDownloads(): Promise<DownloadInfo[]>
    pauseDownload(downloadId: string): Promise<boolean>
    resumeDownload(downloadId: string): Promise<boolean>
    cancelDownload(downloadId: string): Promise<boolean>
    openDownloadsFolder(): Promise<boolean>
    setSidePanelWidth(width: number): Promise<boolean>
    setLeftPanelWidth(width: number): Promise<boolean>
    setBottomBarHeight(height: number): Promise<boolean>
    setTopBarHeight(height: number): Promise<boolean>
    onTabCreated(cb: (tab: { id: string; url: string; title: string }) => void): () => void
    onTabUpdated(cb: (tabId: string, changes: Record<string, unknown>) => void): () => void
    onTabClosed(cb: (tabId: string) => void): () => void
    onTabActivated(cb: (tabId: string) => void): () => void
    onDownloadStarted(cb: (info: Record<string, unknown>) => void): () => void
    onDownloadUpdated(cb: (info: Record<string, unknown>) => void): () => void
    onDownloadCompleted(cb: (info: Record<string, unknown>) => void): () => void
    // Find in page
    findInPage(
      tabId: string,
      text: string,
      options: { forward?: boolean; findNext?: boolean }
    ): Promise<boolean>
    stopFindInPage(
      tabId: string,
      action: 'clearSelection' | 'keepSelection' | 'activateSelection'
    ): Promise<boolean>
    onFoundInPage(cb: (result: { activeMatchOrdinal: number; matches: number }) => void): () => void
    // Permission handling
    resolvePermission(
      requestId: string,
      granted: boolean,
      remember: boolean,
      origin?: string,
      permission?: string
    ): Promise<boolean>
    onPermissionRequest(
      cb: (request: {
        id: string
        permission: string
        origin: string
        requestingUrl: string
      }) => void
    ): () => void
    // Context menu
    executeContextAction(
      tabId: string,
      action: string,
      params: Record<string, unknown>
    ): Promise<boolean>
    onContextMenu(cb: (params: Record<string, unknown>) => void): () => void
    onShortcut(cb: (action: string, data?: number) => void): () => void
    onCursorInPanel(cb: (isInside: boolean) => void): () => void
    setPanelBounds(bounds: {
      x: number
      y: number
      width: number
      height: number
      borderRadius: number
    }): Promise<boolean>
    // Tab visibility control
    hideAllTabs(): Promise<boolean>
    showActiveTab(): Promise<boolean>
    // Close all tabs
    closeAllTabs(): Promise<boolean>
    // Close tab or open new if last
    closeTabOrOpenNew(tabId: string): Promise<{ closed: boolean; newTabId?: string }>
    // Cookie/site data methods
    getCookiesForSite(url: string): Promise<CookieInfo[]>
    getCookieDomains(url: string): Promise<CookieDomain[]>
    deleteCookiesForDomain(domain: string): Promise<boolean>
    clearSiteData(url: string): Promise<boolean>
    getSecurityInfo(url: string): Promise<{ isSecure: boolean; protocol: string }>
    // Get ALL cookie domains (comprehensive list)
    getAllCookieDomains(): Promise<CookieDomain[]>
    // Get cookies for a specific domain
    getCookiesForDomainDetail(domain: string): Promise<CookieInfo[]>
    // Get ALL saved permissions
    getAllPermissions(): Promise<SavedPermission[]>
    // Delete all permissions for an origin
    deletePermissionsForOrigin(origin: string): Promise<boolean>
    // Delete a specific permission
    deletePermission(origin: string, permission: string): Promise<boolean>
  }
  // Notebook persistence methods
  onNotesChanged(cb: () => void): () => void
  saveNote(note: {
    id: string
    title: string
    content: string
    folderId?: string
    skill?: Record<string, unknown>
    updatedAt?: number
  }): Promise<{ success: boolean }>
  loadNotes(): Promise<NoteMeta[]>
  loadNote(id: string): Promise<Note | null>
  deleteNote(id: string): Promise<{ success: boolean }>
  getLastOpenedNoteId(): Promise<string | null>
  setLastOpenedNoteId(id: string): Promise<void>
  getNotesFolder(): Promise<string>
  openNotesFolder(): Promise<void>
  getSkills(): Promise<
    Array<{ id: string; title: string; updatedAt: number; skill: Record<string, unknown> }>
  >
  updateSkillUsage(id: string): Promise<{ success: boolean }>
  saveNotebookImage(
    data: string,
    mimeType: string
  ): Promise<{ success: boolean; path?: string; error?: string }>
  openExternal(url: string): Promise<void>
  setWindowZoomFactor(zoomFactor: number): Promise<boolean>
  detectSelectedText(): Promise<{ success: boolean; hasSelection: boolean; selectedText: string }>
  closeCurrentWindow(): Promise<{ success: boolean }>
  // Traffic light button methods
  destroyPanel(): Promise<{ success: boolean }>
  hidePanel(
    panelType: 'chat' | 'notebook' | 'browser' | 'transcription'
  ): Promise<{ success: boolean }>
  maximizePanel(): Promise<{ success: boolean; isMaximized: boolean }>
  startWindowDrag(): Promise<{ success: boolean; x?: number; y?: number }>
  moveWindowBy(deltaX: number, deltaY: number): Promise<{ success: boolean }>
  setIgnoreMouseEvents(ignore: boolean, forward?: boolean): Promise<{ success: boolean }>
  getScreenBounds(): Promise<{
    success: boolean
    bounds?: { x: number; y: number; width: number; height: number }
    workArea?: { x: number; y: number; width: number; height: number }
  }>
  getAllDisplays(): Promise<{
    success: boolean
    displays?: Array<{
      id: number
      bounds: { x: number; y: number; width: number; height: number }
      workArea: { x: number; y: number; width: number; height: number }
      scaleFactor: number
    }>
  }>
  moveToDisplay(
    screenX: number,
    screenY: number
  ): Promise<{
    success: boolean
    bounds?: { x: number; y: number; width: number; height: number }
  }>
  getWindowItemId(): string | null
  getPlatformInfo(): Promise<{ platform: string; arch: string }>
  onAuthError(cb: (data: { error: string; errorDescription?: string }) => void): () => void
  onSessionTransfer(
    cb: (data: {
      authenticated: true
      expiresAt?: number
      user: { id: string; email: string; firstName: string; lastName: string }
    }) => void
  ): () => void
  startNativeSignIn(forceSignIn?: boolean): Promise<{ success: boolean; error?: string }>
  server: {
    getProfile(): Promise<OverlayServerProfile>
    verifyProfile(origin: string): Promise<OverlayServerProfile>
    activateProfile(
      profile: OverlayServerProfile,
      confirmation: string
    ): Promise<OverlayServerProfile>
    onChanged(cb: (profile: OverlayServerProfile) => void): () => void
  }
  // Sign out - cancels token refresh and clears secure storage
  signOut(): Promise<{ success: boolean }>
  // Launch at startup
  getLaunchAtStartup(): Promise<boolean>
  setLaunchAtStartup(enabled: boolean): Promise<boolean>
  // Subscription and usage tracking
  subscription: {
    getEntitlements(): Promise<SubscriptionEntitlements | null>
    canPerform(
      type: 'ask' | 'write' | 'agent',
      modelId: string
    ): Promise<{ allowed: boolean; reason?: string }>
    canUseLocalTranscription(): Promise<boolean>
    getCreditsRemaining(): Promise<number>
    refresh(): Promise<SubscriptionEntitlements | null>
    devSetTier(tier: 'free' | 'pro' | 'max'): Promise<SubscriptionEntitlements | null>
    devResetUsage(): Promise<SubscriptionEntitlements | null>
    onUpdated(cb: (entitlements: SubscriptionEntitlements) => void): () => void
  }
  appApi: {
    request(input: {
      path: string
      method?: string
      headers?: Record<string, string>
      body?: string | null
    }): Promise<{
      ok: boolean
      status: number
      statusText: string
      bodyText: string
      bodyBase64?: string
      headers?: Record<string, string>
    }>
    stream(
      input: {
        path: string
        method?: string
        headers?: Record<string, string>
        body?: string | null
        streamId: string
      },
      cb: (event: {
        type: 'ready' | 'chunk' | 'done' | 'error'
        status?: number
        statusText?: string
        headers?: Record<string, string>
        chunk?: string
        error?: string
      }) => void
    ): Promise<{ ok: boolean; status: number; statusText: string; bodyText: string }>
    abort(streamId: string): Promise<{ aborted: boolean }>
  }
  uploadToStorage(input: {
    url: string
    contentType: string
    data: ArrayBuffer
  }): Promise<{ ok: boolean; status: number }>
  chatMedia: {
    cacheDataUrl(input: { chatId: string; dataUrl: string; name?: string }): Promise<{
      cacheKey: string
      url: string
      mimeType: string
      sizeBytes: number
      name: string
    }>
  }
  security: {
    getAuthState(): Promise<{
      session: {
        authenticated: true
        user: {
          id: string
          email: string
          firstName?: string
          lastName?: string
          profilePictureUrl?: string
        }
        expiresAt?: number
      } | null
      error?: string
    }>
    isEncryptionAvailable(): Promise<boolean>
    getUsageStats(): Promise<{
      currentMonth: string
      tokensUsed: number
      creditsUsed: number
      creditsRemaining: number
      percentageRemaining: number
      transcriptionSecondsUsed: number
      transcriptionMinutesRemaining: number
      transcriptionPercentageRemaining: number
      warningThreshold: boolean
    }>
  }
  // Panel transcription destination methods
  setPanelTranscriptionDestination(
    panelType: 'chat' | 'notebook',
    destination: 'new' | 'current'
  ): Promise<{ success: boolean }>
  getPanelTranscriptionDestination(): Promise<{
    panel: 'chat' | 'notebook'
    wasVisible: boolean
  } | null>
  clearPanelTranscriptionDestination(): Promise<{ success: boolean }>
  // Native context menu
  showContextMenu(
    items: Array<{
      id: string
      label: string
      accelerator?: string
      enabled?: boolean
      type?: 'normal' | 'separator'
    }>
  ): Promise<{ clicked: string | null }>
  // Memory operations
  memory: {
    search(query: string, limit?: number): Promise<StoredMemory[]>
    getByChat(chatId: string): Promise<StoredMemory[]>
    getByFolder(folderId: string): Promise<StoredMemory[]>
    getAll(): Promise<StoredMemory[]>
    extract(params: {
      userMessage: string
      assistantResponse?: string
      chatId: string
      messageId?: string
      folderId?: string
      conversationContext?: string[]
    }): Promise<{ extracted: ExtractedMemory[]; ids: string[]; model: string }>
    add(memory: {
      id?: string
      content: string
      type: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
      importance: number
      source: { chatId: string; messageId?: string; folderId?: string; noteId?: string }
      sourceType?: string
      chunk?: boolean
      createdAt?: number
      updatedAt?: number
      lastAccessedAt?: number
      accessCount?: number
    }): Promise<string>
    delete(id: string): Promise<boolean>
    deleteMany(ids: string[]): Promise<number>
    update(
      id: string,
      updates: {
        content?: string
        type?: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
        importance?: number
        source?: { chatId: string; messageId?: string; folderId?: string; noteId?: string }
        sourceType?: string
        updatedAt?: number
        lastAccessedAt?: number
        accessCount?: number
      }
    ): Promise<boolean>
    getStats(): Promise<{ total: number; byType: Record<string, number>; recentlyAccessed: number }>
    // Agent memory operations (Phase 3)
    agentApprove(candidate: {
      content: string
      type: string
      importance: number
      taskFingerprint: string
      sourceTaskId: string
      chatId?: string
      folderId?: string
    }): Promise<{ success: boolean; id?: string; error?: string }>
    agentReject(candidate: {
      content: string
      type: string
      importance: number
      taskFingerprint: string
      sourceTaskId: string
      chatId?: string
      folderId?: string
    }): Promise<{ success: boolean }>
    runSchemaMigration(): Promise<{ migrated: number; failed: number; skipped: boolean }>
    onAgentMemoryCandidates(
      cb: (data: {
        streamId: string
        taskId: string
        candidates: Array<{
          content: string
          type: string
          importance: number
          taskFingerprint: string
        }>
      }) => void
    ): () => void
  }
  // Knowledge search operations (unified search across memories, notes, chats, documents)
  knowledge: {
    search(options: {
      query: string
      chatId?: string
      folderId?: string
      noteId?: string
      includeMemories?: boolean
      includeNotes?: boolean
      includeChats?: boolean
      includeDocuments?: boolean
      limit?: number
    }): Promise<{
      memories: UnifiedSearchResult[]
      notes: UnifiedSearchResult[]
      chats: UnifiedSearchResult[]
      documents: UnifiedSearchResult[]
      all: UnifiedSearchResult[]
      totalTokensEstimate: number
    }>
    searchNotes(options: {
      query: string
      folderId?: string
      limit?: number
      includeGlobal?: boolean
    }): Promise<NoteSearchResult[]>
    searchChats(options: {
      query: string
      folderId?: string
      limit?: number
      includeGlobal?: boolean
      type?: 'summary' | 'message'
    }): Promise<ChatSearchResult[]>
    indexNote(note: {
      id: string
      title: string
      content: string
      folderId?: string | null
      tags?: string[]
      createdAt?: number
      updatedAt?: number
    }): Promise<string[]>
    removeNote(noteId: string): Promise<void>
    indexChat(chat: {
      id: string
      title: string
      messages: Array<{ role: string; content: string }>
      folderId?: string | null
      createdAt?: number
      updatedAt?: number
    }): Promise<string[]>
    removeChat(chatId: string): Promise<void>
    getStats(): Promise<{
      memories: { total: number; byType: Record<string, number> }
      notes: { totalNotes: number; totalChunks: number }
      chats: { totalChats: number; totalEntries: number }
    }>
    getFolderNotes(folderId: string, limit?: number): Promise<NoteSearchResult[]>
    getFolderChats(folderId: string, limit?: number): Promise<ChatSearchResult[]>
    mentionSearch(options: {
      query: string
      type: 'note' | 'chat' | 'document' | 'folder'
      folderId?: string
      limit?: number
    }): Promise<MentionSearchResult[]>
  }
  // Document ingestion and search operations
  document: {
    ingest(options: { filepath: string; folderId?: string; chatId?: string }): Promise<{
      success: boolean
      document?: {
        id: string
        filename: string
        filepath?: string
        mimeType: string
        size: number
        pageCount?: number
        chunkCount: number
        folderId?: string
        chatId?: string
      }
      error?: string
    }>
    ingestDialog(options: { folderId?: string; chatId?: string; waitForIndex?: boolean }): Promise<{
      success: boolean
      canceled?: boolean
      document?: {
        id: string
        filename: string
        filepath?: string
        mimeType: string
        size: number
        pageCount?: number
        chunkCount: number
        folderId?: string
        chatId?: string
      }
      error?: string
    }>
    search(options: {
      query: string
      folderId?: string
      chatId?: string
      limit?: number
      includeGlobal?: boolean
    }): Promise<DocumentSearchResult[]>
    remove(documentId: string): Promise<{ success: boolean; error?: string }>
    getAll(limit?: number): Promise<DocumentInfo[]>
    getByFolder(folderId: string, limit?: number): Promise<DocumentInfo[]>
    getByChat(chatId: string, limit?: number): Promise<DocumentInfo[]>
    getChunks(documentId: string): Promise<{
      success: boolean
      chunks: Array<{
        id: string
        documentId: string
        chunkIndex: number
        content: string
        filename: string
        filepath: string
        mimeType: string
        folderId?: string
        chatId?: string
        pageNumber?: number
        score: number
        createdAt: number
      }>
      error?: string
    }>
    getStats(): Promise<{
      totalDocuments: number
      totalChunks: number
      byFolder: number
      byChat: number
    }>
    isSupported(filepath: string): Promise<boolean>
  }
  knowledgeMigration: {
    inventory(): Promise<LegacyKnowledgeInventory>
    readAsset(assetId: string): Promise<{ dataBase64: string; asset: LegacyKnowledgeAsset }>
    createBackup(
      userId: string
    ): Promise<{ backupId: string; createdAt: number; itemCount: number }>
    loadJournal(userId: string): Promise<KnowledgeMigrationJournal | null>
    saveJournal(userId: string, journal: KnowledgeMigrationJournal): Promise<{ success: boolean }>
  }
  knowledgeFiles: {
    pick(options: { multiple?: boolean; directory?: boolean }): Promise<
      Array<{
        token: string
        name: string
        sizeBytes: number
        mimeType: string
        relativePath?: string
      }>
    >
    readPicked(token: string): Promise<{ dataBase64: string }>
    revealDownloaded(input: {
      name: string
      dataBase64: string
    }): Promise<{ success: boolean; path: string }>
  }
  // Context retrieval operations
  context: {
    initialize(): Promise<{ success: boolean; error?: string }>
    getForMessage(params: {
      userMessage: string
      chatId: string
      folderId?: string
      projectInstructions?: string
      recentMessages?: string[]
    }): Promise<{
      success: boolean
      contextPrompt: string
      memoriesUsed: number
      totalTokens: number
      error?: string
    }>
    getContext(params: {
      query: string
      conversationHistory?: string[]
      chatId?: string
      folderId?: string
      projectInstructions?: string
      maxTokens?: number
      includeTypes?: string[]
      excludeTypes?: string[]
    }): Promise<{
      success: boolean
      systemContext?: string
      totalTokens?: number
      memoriesUsed?: number
      truncated?: boolean
      sections?: Array<{
        title: string
        content: string
        priority: number
        tokenCount: number
      }>
      retrievedCount?: number
      rankedCount?: number
      error?: string
    }>
    hasRelevant(params: {
      query: string
      chatId?: string
      folderId?: string
    }): Promise<{ success: boolean; hasRelevant: boolean; error?: string }>
  }
  // Note import methods
  import: {
    detectApps(): Promise<{ obsidian: boolean; bear: boolean; appleNotes: boolean }>
    obsidian(): Promise<{
      notes: Array<{
        title: string
        content: string
        createdAt?: number
        updatedAt?: number
        tags: string[]
        source: string
        sourceId?: string
        folderPath?: string[]
      }>
      error?: string
      cancelled?: boolean
      iCloudWarning?: string
    }>
    bear(): Promise<{
      notes: Array<{
        title: string
        content: string
        createdAt?: number
        updatedAt?: number
        tags: string[]
        source: string
        sourceId?: string
        folderPath?: string[]
      }>
      error?: string
      cancelled?: boolean
    }>
    appleNotes(): Promise<{
      notes: Array<{
        title: string
        content: string
        createdAt?: number
        updatedAt?: number
        tags: string[]
        source: string
        sourceId?: string
        folderPath?: string[]
      }>
      error?: string
      cancelled?: boolean
    }>
    saveNotes(
      notes: Array<{
        title: string
        content: string
        createdAt?: number
        updatedAt?: number
        tags: string[]
        source: string
        sourceId?: string
        folderPath?: string[]
      }>
    ): Promise<{
      saved: number
      errors: number
      ids: string[]
      savedNotes: Array<{ id: string; folderPath?: string[] }>
    }>
    notifyNotesChanged(): Promise<{ success: boolean }>
  }
  // Auto-updater methods
  updater: {
    checkForUpdates(): Promise<void>
    quitAndInstall(): Promise<void>
    getCurrentVersion(): Promise<string>
    getStatus(): Promise<{
      updateAvailable: boolean
      updateDownloaded: boolean
      latestVersion?: string
      updateDismissed?: boolean
    }>
    dismissUpdate(): Promise<{ success: boolean }>
    onStatus(cb: (status: UpdateStatus) => void): () => void
  }
  // Agent user-input request (agent needs human interaction in browser)
  onAgentUserInputRequest(cb: (data: { requestId: string; reason: string }) => void): () => void
  agentUserInputContinue(requestId: string): Promise<{ success: boolean }>
  onAgentStart(cb: (data: { command: string }) => void): () => void
  onAgentDone(cb: (data: { summary: string; steps: number }) => void): () => void
  onAgentError(cb: (data: { error: string }) => void): () => void
  updateAgenticWakeWord(enabled: boolean): Promise<void>
  // Agent streaming for chat panel
  runAgentStream(
    command: string,
    onEvent: (event: AgentStreamEvent) => void,
    modelId?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    imageDataArray?: string[],
    workingFolder?: string,
    searchEnabled?: boolean,
    memoryEnabled?: boolean,
    sandboxEnabled?: boolean
  ): AgentStreamHandle
  // Browser agent streaming - prioritizes browser tools
  runBrowserAgentStream(
    command: string,
    onEvent: (event: AgentStreamEvent) => void,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    modelId?: string,
    mode?: 'ask' | 'act'
  ): AgentStreamHandle
  // Notebook agent (agentic code editor) streaming
  runNotebookAgent(
    noteContent: string,
    noteTitle: string,
    command: string,
    modelId: string,
    mode: 'ask' | 'write',
    onEvent: (event: NotebookAgentStreamEvent) => void
  ): NotebookAgentHandle
  // Composio integration methods
  composio: {
    getConnected(): Promise<string[]>
    listToolkits(args?: { query?: string; cursor?: string; limit?: number }): Promise<{
      items: Array<{
        slug: string
        name: string
        description: string
        logoUrl: string | null
        isConnected: boolean
        connectedAccountId: string | null
      }>
      nextCursor: string | null
    }>
    getToolkitMetadata(
      toolkits: string[]
    ): Promise<
      Record<
        string,
        { slug: string; name: string; description: string; logoUrl: string; appUrl: string | null }
      >
    >
    isConnected(toolkit: string): Promise<boolean>
    connect(toolkit: string): Promise<{
      success: boolean
      redirectUrl?: string
      connectionId?: string
      alreadyConnected?: boolean
      error?: string
    }>
    checkStatus(
      toolkit: string
    ): Promise<{ success: boolean; isConnected?: boolean; error?: string }>
    disconnect(toolkit: string): Promise<{ success: boolean; error?: string }>
    onToolkitsSynced(callback: () => void): () => void
  }
  // Browser chat session management
  browserChatSessions: {
    list(): Promise<BrowserChatSession[]>
    get(sessionId: string): Promise<BrowserChatSession | null>
    create(mode: 'ask' | 'act'): Promise<BrowserChatSession>
    update(
      sessionId: string,
      updates: {
        title?: string
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>
        mode?: 'ask' | 'act'
      }
    ): Promise<BrowserChatSession | null>
    delete(sessionId: string): Promise<boolean>
    clear(): Promise<boolean>
  }
  // Notification methods
  onNotification(
    cb: (data: {
      id: string
      type: 'success' | 'error'
      title: string
      summary: string
      trace: string[]
    }) => void
  ): () => void
  showNotification(data: {
    id: string
    type: 'success' | 'error'
    title: string
    summary: string
    trace: string[]
  }): Promise<{ success: boolean; error?: string }>
  dismissNotification(id: string): Promise<{ success: boolean }>
  closeNotificationWindow(): Promise<{ success: boolean }>
  // Terminal operations
  terminal: {
    run(
      command: string,
      cwd?: string,
      timeoutMs?: number
    ): Promise<{
      success: boolean
      exitCode?: number
      stdout: string
      stderr: string
      timedOut?: boolean
      error?: string
    }>
    createSession(
      cwd?: string
    ): Promise<{ success: boolean; sessionId?: string; cwd?: string; error?: string }>
    listSessions(): Promise<{
      success: boolean
      sessions: Array<{ id: string; cwd: string; createdAt: number; lastActiveAt: number }>
    }>
    write(sessionId: string, data: string): Promise<{ success: boolean; error?: string }>
    read(
      sessionId: string,
      lastN?: number
    ): Promise<{ success: boolean; output: string; error?: string }>
    resize(
      sessionId: string,
      cols: number,
      rows: number
    ): Promise<{ success: boolean; error?: string }>
    kill(sessionId: string): Promise<{ success: boolean; error?: string }>
    subscribe(sessionId: string): Promise<{ success: boolean; error?: string }>
    onData(cb: (data: { sessionId: string; data: string }) => void): () => void
  }

  // ── Runtime (Script Execution) ────────────────────────────────────────────
  runtime: {
    ensurePython(): Promise<{ ready: boolean; path: string; error?: string }>
    runScript(options: {
      runtime: 'python' | 'javascript'
      code: string
      packages?: string[]
      cwd?: string
      timeoutMs?: number
    }): Promise<{
      success: boolean
      stdout: string
      stderr: string
      exitCode?: number
      timedOut?: boolean
      sandboxPath?: string
      error?: string
    }>
    installPackages(packages: string[]): Promise<{ success: boolean; error?: string }>
    cleanup(): Promise<{ cleaned: number }>
  }

  // ── Working Folder ──────────────────────────────────────────────
  pickWorkingFolder(): Promise<{ cancelled: boolean; path?: string }>
  // ── Workspace File Listing ──────────────────────────────────────
  workspace: {
    listFiles(
      workingFolder: string,
      maxDepth?: number
    ): Promise<{ success: boolean; paths: string[]; error?: string }>
    readFile(
      filePath: string,
      maxBytes?: number
    ): Promise<{
      success: boolean
      content: string
      truncated?: boolean
      size?: number
      error?: string
    }>
  }
}

interface BrowserChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  mode: 'ask' | 'act'
}

interface Screenshot {
  dataUrl: string
  displayId: string
  name: string
  bounds: { x: number; y: number; width: number; height: number }
}

interface BrowserTab {
  id: string
  webContentsId: number
  url: string
  title: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

interface HistoryEntry {
  id: string
  url: string
  title: string
  visitTime: number
  favicon?: string
}

interface DownloadInfo {
  id: string
  url: string
  filename: string
  savePath: string
  receivedBytes: number
  totalBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
  isPaused: boolean
}

interface NoteMeta {
  id: string
  title: string
  updatedAt: number
}

interface Note {
  id: string
  title: string
  content: string
  updatedAt: number
  skill?: Record<string, unknown>
}

interface ChatModel {
  id: string
  name: string
  provider: string
  description?: string
  supportsVision: boolean
  supportsReasoning: boolean
  supportsSearch: boolean
  disabled?: boolean
  disabledReason?: string
}

interface StreamChunk {
  type: 'text' | 'error' | 'done' | 'usage'
  content: string
}

interface StreamHandle {
  streamId: string
  promise: Promise<{ success: boolean; error?: string }>
  cancel: () => void
}

interface CookieInfo {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
}

interface CookieDomain {
  domain: string
  cookieCount: number
}

interface SavedPermission {
  origin: string
  permissions: { permission: string; granted: boolean }[]
}

interface ChatMessageWithImage {
  role: 'user' | 'assistant' | 'system'
  content: string
  imageData?: string
}

interface UpdateStatus {
  status:
    | 'checking-for-update'
    | 'update-available'
    | 'update-not-available'
    | 'download-progress'
    | 'update-downloaded'
    | 'error'
  data?: {
    version?: string
    percent?: number
    bytesPerSecond?: number
    message?: string
  }
}

type SubscriptionTier = 'free' | 'pro' | 'max'

interface SubscriptionEntitlements {
  tier: SubscriptionTier
  planKind?: 'free' | 'paid'
  planAmountCents?: number
  creditsUsed: number
  creditsTotal: number
  budgetUsedCents?: number
  budgetTotalCents?: number
  budgetRemainingCents?: number
  overlayStorageBytesUsed?: number
  overlayStorageBytesLimit?: number
  dailyUsage: { ask: number; write: number; agent: number }
  dailyLimits: { ask: number; write: number; agent: number }
  transcriptionSecondsUsed: number
  transcriptionSecondsLimit: number
  localTranscriptionEnabled: boolean
  resetAt: string
  billingPeriodEnd: string
  lastSyncedAt: number
}

interface StoredMemory {
  id: string
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision' | 'agent'
  importance: number
  source: {
    chatId: string
    messageId?: string
    folderId?: string
    noteId?: string
  }
  createdAt: number
  updatedAt: number
  accessCount: number
  lastAccessedAt: number
}

interface ExtractedMemory {
  content: string
  type: 'preference' | 'fact' | 'project' | 'decision'
  importance: number
}

interface AgentStreamEvent {
  streamId: string
  type:
    | 'plan'
    | 'thinking'
    | 'tool_start'
    | 'tool_result'
    | 'text'
    | 'done'
    | 'error'
    | 'checkpoint'
    | 'max_steps_reached'
    | 'history_update'
  plan?: string
  thinking?: string
  tool?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  text?: string
  error?: string
  step?: number
  stepsCompleted?: number
  maxSteps?: number
  checkpointStep?: number
  checkpointMessage?: string
  summary?: string
  taskComplete?: boolean
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>
}

interface AgentStreamHandle {
  streamId: string
  promise: Promise<{ success: boolean; error?: string }>
  cancel: () => void
}

interface NotebookAgentEdit {
  id: string
  description: string
  startLine: number
  endLine: number
  originalLines: string[]
  newLines: string[]
}

interface NotebookAgentStreamEvent {
  streamId: string
  type: 'thinking' | 'tool_call' | 'edit_proposal' | 'text' | 'done' | 'error'
  thinking?: string
  tool?: string
  toolInput?: Record<string, unknown>
  edit?: NotebookAgentEdit
  text?: string
  error?: string
  step?: number
}

interface NotebookAgentHandle {
  streamId: string
  promise: Promise<{ success: boolean; error?: string }>
  cancel: () => void
}

interface UnifiedSearchResult {
  id: string
  type: 'memory' | 'note' | 'chat' | 'document'
  sourceId: string
  title?: string
  content: string
  folderId?: string | null
  chatId?: string | null
  filename?: string
  score: number
  priorityBoost: number
  finalScore: number
  createdAt: number
}

interface NoteSearchResult {
  id: string
  noteId: string
  chunkIndex: number
  totalChunks: number
  title: string
  content: string
  folderId?: string | null
  tags: string[]
  score: number
  updatedAt: number
}

interface ChatSearchResult {
  id: string
  chatId: string
  type: 'summary' | 'message'
  title: string
  content: string
  folderId?: string | null
  score: number
  timestamp: number
  updatedAt: number
}

interface MentionSearchResult {
  id: string
  type: 'note' | 'chat' | 'document' | 'folder'
  title: string
  preview: string
  folderId?: string
  filename?: string
  score: number
}

interface DocumentSearchResult {
  id: string
  documentId: string
  chunkIndex: number
  content: string
  filename: string
  filepath: string
  mimeType: string
  folderId?: string
  chatId?: string
  pageNumber?: number
  score: number
  createdAt: number
}

interface DocumentInfo {
  id: string
  filename: string
  filepath: string
  mimeType: string
  folderId?: string
  chatId?: string
  chunkCount: number
  createdAt: number
}

interface DocumentChunkInfo {
  id: string
  chunkIndex: number
  content: string
  pageNumber?: number
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

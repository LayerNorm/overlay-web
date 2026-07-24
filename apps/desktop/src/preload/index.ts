import { contextBridge, ipcRenderer } from 'electron'
import { Transcription } from '../types/transcription'
import type { KnowledgeMigrationJournal } from '@overlay/app-core'

const bridge = {
  checkOnboardingComplete(): Promise<boolean> {
    return ipcRenderer.invoke('onboarding:check-complete')
  },
  setOnboardingComplete(): Promise<boolean> {
    return ipcRenderer.invoke('onboarding:set-complete')
  },
  initializeOnboardingPanelHotkeys(): Promise<boolean> {
    return ipcRenderer.invoke('onboarding:init-panel-hotkeys')
  },
  checkMicrophonePermission() {
    return ipcRenderer.invoke('permissions:check-microphone')
  },
  requestMicrophonePermission() {
    return ipcRenderer.invoke('permissions:request-microphone')
  },
  checkAccessibilityPermission() {
    return ipcRenderer.invoke('permissions:check-accessibility')
  },
  requestAccessibilityPermission() {
    return ipcRenderer.invoke('permissions:request-accessibility')
  },
  checkSystemEventsPermission() {
    return ipcRenderer.invoke('permissions:check-system-events')
  },
  requestSystemEventsPermission() {
    return ipcRenderer.invoke('permissions:request-system-events')
  },
  updateSoundEffects(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-sound-effects', enabled)
  },
  updateSmartTranscription(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-smart-transcription', enabled)
  },
  updateAssistantMode(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-assistant-mode', enabled)
  },
  updateAgentModel(modelId: string) {
    return ipcRenderer.invoke('settings:update-agent-model', modelId)
  },
  updateRecordingStorage(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-recording-storage', enabled)
  },
  updateRecordingRetention(retention: string) {
    return ipcRenderer.invoke('settings:update-recording-retention', retention)
  },
  updateShowPanelsOnStartup(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-show-panels-on-startup', enabled)
  },
  openRecordingsFolder() {
    return ipcRenderer.invoke('recording:open-folder')
  },
  onForceSignOut(cb: (data?: { reason?: 'session_expired' }) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data?: { reason?: 'session_expired' }
    ): void => cb(data)
    ipcRenderer.on('auth:force-sign-out', handler)
    return () => ipcRenderer.removeListener('auth:force-sign-out', handler)
  },
  onWindowZoomCommand(cb: (command: { action?: 'in' | 'out' | 'reset' }) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      command: { action?: 'in' | 'out' | 'reset' }
    ): void => cb(command)
    ipcRenderer.on('window:zoom-command', handler)
    return () => ipcRenderer.removeListener('window:zoom-command', handler)
  },
  onRecordStart(cb: () => void) {
    const handler = () => cb()
    ipcRenderer.on('record:start', handler)
    return () => ipcRenderer.removeListener('record:start', handler)
  },
  onRecordStop(cb: () => void) {
    const handler = () => cb()
    ipcRenderer.on('record:stop', handler)
    return () => ipcRenderer.removeListener('record:stop', handler)
  },
  onRecordCancel(cb: () => void) {
    const handler = () => cb()
    ipcRenderer.on('record:cancel', handler)
    return () => ipcRenderer.removeListener('record:cancel', handler)
  },
  onTranscriptionAdd(cb: (transcription: Transcription) => void) {
    const handler = (_event: any, transcription: Transcription) => cb(transcription)
    ipcRenderer.on('transcription:add', handler)
    return () => ipcRenderer.removeListener('transcription:add', handler)
  },
  transcribe(
    mime: string,
    arrayBuffer: ArrayBuffer,
    duration: number,
    extras?: { dictionaryWords?: string[]; smartTranscriptionModePrompt?: string }
  ) {
    return ipcRenderer.invoke('stt:transcribe', {
      mime,
      buf: Buffer.from(arrayBuffer),
      duration,
      dictionaryWords: extras?.dictionaryWords || [],
      smartTranscriptionModePrompt: extras?.smartTranscriptionModePrompt
    })
  },
  pasteText(text: string) {
    return ipcRenderer.invoke('stt:paste', { text })
  },
  updatePushToTalkHotkey(hotkey: string) {
    return ipcRenderer.invoke('settings:update-hotkey', hotkey)
  },
  updateAutoMute(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-auto-mute', enabled)
  },
  updateTranscriptionModeHotkey(hotkey: string) {
    return ipcRenderer.invoke('settings:update-transcription-hotkey', hotkey)
  },
  updateAssistantModeHotkey(hotkey: string) {
    return ipcRenderer.invoke('settings:update-assistant-mode-hotkey', hotkey)
  },
  updateAssistantScreenshot(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-assistant-screenshot', enabled)
  },
  updateInputDevice(deviceId: string) {
    return ipcRenderer.invoke('settings:update-input-device', deviceId)
  },
  getSettings() {
    return ipcRenderer.invoke('settings:get')
  },
  setChatToolPermissionMode(mode: 'ask_for_approval' | 'full_access') {
    return ipcRenderer.invoke('settings:set-chat-tool-permission', mode)
  },
  updateAutoCopy(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-auto-copy', enabled)
  },
  updatePressEnterAfter(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-press-enter-after', enabled)
  },
  updateContextAwareCapitalization(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-context-aware-capitalization', enabled)
  },
  syncSettings(settings: { autoCopy: boolean; pressEnterAfter: boolean }) {
    return ipcRenderer.invoke('settings:sync', settings)
  },
  syncSmartTranscriptionModes(data: {
    modes: Array<{ id: string; name: string; prompt: string; isDefault: boolean }>
    activeModeId: string
  }) {
    ipcRenderer.send('smart-transcription-modes-updated')
    return ipcRenderer.invoke('settings:sync-smart-transcription-modes', data)
  },
  getSmartTranscriptionModes() {
    return ipcRenderer.invoke('settings:get-smart-transcription-modes')
  },
  setActiveSmartTranscriptionMode(modeId: string) {
    ipcRenderer.send('smart-transcription-modes-updated')
    return ipcRenderer.invoke('settings:set-active-smart-transcription-mode', modeId)
  },
  getAnalyticsToken(): Promise<string | null> {
    return ipcRenderer.invoke('settings:get-analytics-token')
  },
  onSmartTranscriptionModeChanged(cb: (modeId: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, modeId: string): void => cb(modeId)
    ipcRenderer.on('smart-transcription-mode-changed', handler)
    return () => ipcRenderer.removeListener('smart-transcription-mode-changed', handler)
  },
  onSettingsChanged(cb: (payload: { key: string; value: unknown }) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { key: string; value: unknown }
    ): void => cb(payload)
    ipcRenderer.on('settings:changed', handler)
    return () => ipcRenderer.removeListener('settings:changed', handler)
  },
  broadcastSettingsChanged(payload: { key: string; value: unknown }) {
    return ipcRenderer.invoke('settings:broadcast-changed', payload)
  },
  updateLocalTranscription(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-local-transcription', enabled)
  },
  updateCloudTranscription(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-cloud-transcription', enabled)
  },
  updateTranscriptionPriority(priority: 'cloud' | 'local') {
    return ipcRenderer.invoke('settings:update-transcription-priority', priority)
  },
  // Model management methods
  getInstalledModels() {
    return ipcRenderer.invoke('models:get-installed')
  },
  downloadModel(modelId: string) {
    return ipcRenderer.invoke('models:download', modelId)
  },
  deleteModel(modelId: string) {
    return ipcRenderer.invoke('models:delete', modelId)
  },
  switchModel(modelId: string) {
    return ipcRenderer.invoke('models:switch', modelId)
  },
  getCurrentModel() {
    return ipcRenderer.invoke('models:get-current')
  },
  getModelInfo(modelId: string) {
    return ipcRenderer.invoke('models:get-info', modelId)
  },
  openModelsFolder() {
    return ipcRenderer.invoke('models:open-folder')
  },
  onDownloadProgress(cb: (progress: any) => void) {
    const handler = (_event: any, progress: any) => cb(progress)
    ipcRenderer.on('models:download-progress', handler)
    return () => ipcRenderer.removeListener('models:download-progress', handler)
  },
  // Panel window management
  // For chat/notebook: toggles visibility (hide all if any visible, show all if all hidden)
  // Returns { action: 'hidden' | 'shown' | 'created', count: number, isVisible: boolean }
  togglePanelWindow(panelType: 'notebook' | 'chat' | 'transcription' | 'browser', open: boolean) {
    return ipcRenderer.invoke('panel:toggle', { panelType, open })
  },
  // Check if any panels of a type are currently visible
  isPanelVisible(
    panelType: 'chat' | 'notebook' | 'browser'
  ): Promise<{ isVisible: boolean; windowCount: number }> {
    return ipcRenderer.invoke('panel:isVisible', { panelType })
  },
  onPanelClosed(
    cb: (
      panelType: 'notebook' | 'chat' | 'transcription' | 'browser',
      itemId?: string,
      position?: { x: number; y: number; width: number; height: number }
    ) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      panelType: 'notebook' | 'chat' | 'transcription' | 'browser',
      itemId?: string,
      position?: { x: number; y: number; width: number; height: number }
    ) => cb(panelType, itemId, position)
    ipcRenderer.on('panel:closed', handler)
    return () => ipcRenderer.removeListener('panel:closed', handler)
  },
  // Listen for panel visibility changes (from hotkey toggle or other sources)
  onPanelVisibilityChanged(
    cb: (panelType: 'notebook' | 'chat' | 'browser', isVisible: boolean) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      panelType: 'notebook' | 'chat' | 'browser',
      isVisible: boolean
    ) => cb(panelType, isVisible)
    ipcRenderer.on('panel:visibility-changed', handler)
    return () => ipcRenderer.removeListener('panel:visibility-changed', handler)
  },
  notifyPanelRendererReady(panelType: 'notebook' | 'chat' | 'browser') {
    ipcRenderer.send('panel:renderer-ready', { panelType })
  },
  reportPanelLatency(payload: {
    panelType: 'notebook' | 'chat' | 'browser'
    stage: 'paint' | 'hydrate'
  }) {
    ipcRenderer.send('panel:latency', payload)
  },
  setContentProtection(
    panelType: 'notebook' | 'chat' | 'transcription' | 'browser',
    enabled: boolean
  ) {
    return ipcRenderer.invoke('panel:setContentProtection', { panelType, enabled })
  },
  isItemOpen(
    panelType: 'chat' | 'notebook',
    itemId: string
  ): Promise<{ isOpen: boolean; windowId?: number }> {
    return ipcRenderer.invoke('panel:isItemOpen', { panelType, itemId })
  },
  openInNewWindow(
    panelType: 'chat' | 'notebook',
    itemId: string,
    position?: { x: number; y: number; width: number; height: number }
  ): Promise<{ success: boolean; windowId?: number; error?: string }> {
    return ipcRenderer.invoke('panel:openInNewWindow', { panelType, itemId, position })
  },
  registerOpenItem(panelType: 'chat' | 'notebook', itemId: string): Promise<{ success: boolean }> {
    return ipcRenderer.invoke('panel:registerOpenItem', { panelType, itemId })
  },
  unregisterOpenItem(
    panelType: 'chat' | 'notebook',
    itemId: string
  ): Promise<{ success: boolean }> {
    return ipcRenderer.invoke('panel:unregisterOpenItem', { panelType, itemId })
  },
  getOpenItems(panelType: 'chat' | 'notebook'): Promise<{ openItems: string[] }> {
    return ipcRenderer.invoke('panel:getOpenItems', { panelType })
  },
  closeAllPanelsAndSave(
    panelType: 'chat' | 'notebook'
  ): Promise<{ success: boolean; closedCount: number }> {
    return ipcRenderer.invoke('panel:closeAllAndSave', { panelType })
  },
  reopenSavedPanels(
    panelType: 'chat' | 'notebook'
  ): Promise<{ success: boolean; openedCount: number }> {
    return ipcRenderer.invoke('panel:reopenSaved', { panelType })
  },
  getOpenPanelCount(panelType: 'chat' | 'notebook'): Promise<{ count: number }> {
    return ipcRenderer.invoke('panel:getOpenCount', { panelType })
  },
  hasSavedPanels(panelType: 'chat' | 'notebook'): Promise<{ hasSaved: boolean }> {
    return ipcRenderer.invoke('panel:hasSavedPanels', { panelType })
  },
  // Transcription panel events
  onTranscriptionText(cb: (text: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => cb(text)
    ipcRenderer.on('transcription:text', handler)
    return () => ipcRenderer.removeListener('transcription:text', handler)
  },
  sendTranscriptionToPanel(text: string) {
    return ipcRenderer.invoke('transcription:send-to-panel', text)
  },
  // Panel transcription destination methods for hold-to-transcribe feature
  getPanelTranscriptionDestination(): Promise<{
    panel: 'chat' | 'notebook'
    wasVisible: boolean
  } | null> {
    return ipcRenderer.invoke('transcription:get-panel-destination')
  },
  clearPanelTranscriptionDestination() {
    return ipcRenderer.invoke('transcription:clear-panel-destination')
  },
  sendTextToChatInput(text: string) {
    return ipcRenderer.invoke('chat:send-text-to-input', text)
  },
  sendTextToNewChat(text: string) {
    return ipcRenderer.invoke('chat:send-text-to-new', text)
  },
  sendTextToNoteInput(text: string) {
    return ipcRenderer.invoke('notebook:send-text-to-input', text)
  },
  sendTextToNewNote(text: string) {
    return ipcRenderer.invoke('notebook:send-text-to-new', text)
  },
  onNoteInputText(cb: (text: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => cb(text)
    ipcRenderer.on('notebook:input-text', handler)
    return () => ipcRenderer.removeListener('notebook:input-text', handler)
  },
  onChatInputText(cb: (text: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => cb(text)
    ipcRenderer.on('chat:input-text', handler)
    return () => ipcRenderer.removeListener('chat:input-text', handler)
  },
  onNewChatWithText(cb: (text: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => cb(text)
    ipcRenderer.on('chat:new-with-text', handler)
    return () => ipcRenderer.removeListener('chat:new-with-text', handler)
  },
  onNewNoteWithText(cb: (text: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, text: string) => cb(text)
    ipcRenderer.on('notebook:new-with-text', handler)
    return () => ipcRenderer.removeListener('notebook:new-with-text', handler)
  },
  onNewNoteWithTitleAndContent(cb: (payload: { title: string; content: string }) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { title: string; content: string }
    ) => cb(payload)
    ipcRenderer.on('notebook:new-with-title-and-content', handler)
    return () => ipcRenderer.removeListener('notebook:new-with-title-and-content', handler)
  },
  // Chat methods
  getChatModels() {
    return ipcRenderer.invoke('chat:get-models')
  },
  onChatModelsChanged(cb: () => void) {
    const handler = () => cb()
    ipcRenderer.on('chat:models-changed', handler)
    return () => ipcRenderer.removeListener('chat:models-changed', handler)
  },
  captureScreenshots() {
    return ipcRenderer.invoke('capture-screenshots')
  },
  // Panel hotkey methods
  updateChatPanelHotkey(hotkey: string) {
    return ipcRenderer.invoke('settings:update-chat-panel-hotkey', hotkey)
  },
  updateNotebookPanelHotkey(hotkey: string) {
    return ipcRenderer.invoke('settings:update-notebook-panel-hotkey', hotkey)
  },
  updateBrowserPanelHotkey(hotkey: string) {
    return ipcRenderer.invoke('settings:update-browser-panel-hotkey', hotkey)
  },
  // Browser methods
  browser: {
    ensureWindow(createInitialTab = false) {
      return ipcRenderer.invoke('browser:ensure-window', createInitialTab)
    },
    createTab(url?: string) {
      return ipcRenderer.invoke('browser:create-tab', url)
    },
    closeTab(tabId: string) {
      return ipcRenderer.invoke('browser:close-tab', tabId)
    },
    switchTab(tabId: string) {
      return ipcRenderer.invoke('browser:switch-tab', tabId)
    },
    navigate(tabId: string, url: string) {
      return ipcRenderer.invoke('browser:navigate', tabId, url)
    },
    goBack(tabId: string) {
      return ipcRenderer.invoke('browser:go-back', tabId)
    },
    goForward(tabId: string) {
      return ipcRenderer.invoke('browser:go-forward', tabId)
    },
    reload(tabId: string) {
      return ipcRenderer.invoke('browser:reload', tabId)
    },
    stop(tabId: string) {
      return ipcRenderer.invoke('browser:stop', tabId)
    },
    hardReload(tabId: string) {
      return ipcRenderer.invoke('browser:hard-reload', tabId)
    },
    reopenClosedTab() {
      return ipcRenderer.invoke('browser:reopen-closed-tab')
    },
    getTabByIndex(index: number) {
      return ipcRenderer.invoke('browser:get-tab-by-index', index)
    },
    getNextTab() {
      return ipcRenderer.invoke('browser:get-next-tab')
    },
    getPreviousTab() {
      return ipcRenderer.invoke('browser:get-previous-tab')
    },
    getTabCount() {
      return ipcRenderer.invoke('browser:get-tab-count')
    },
    getTabInfo(tabId: string) {
      return ipcRenderer.invoke('browser:get-tab-info', tabId)
    },
    getTabs() {
      return ipcRenderer.invoke('browser:get-tabs')
    },
    getActiveTab() {
      return ipcRenderer.invoke('browser:get-active-tab')
    },
    getHistory() {
      return ipcRenderer.invoke('browser:get-history')
    },
    clearHistory() {
      return ipcRenderer.invoke('browser:clear-history')
    },
    clearAllCookies() {
      return ipcRenderer.invoke('browser:clear-all-cookies')
    },
    deleteHistoryEntry(id: string) {
      return ipcRenderer.invoke('browser:delete-history-entry', id)
    },
    getDownloads() {
      return ipcRenderer.invoke('browser:get-downloads')
    },
    pauseDownload(downloadId: string) {
      return ipcRenderer.invoke('browser:pause-download', downloadId)
    },
    resumeDownload(downloadId: string) {
      return ipcRenderer.invoke('browser:resume-download', downloadId)
    },
    cancelDownload(downloadId: string) {
      return ipcRenderer.invoke('browser:cancel-download', downloadId)
    },
    openDownloadsFolder() {
      return ipcRenderer.invoke('browser:open-downloads-folder')
    },
    setSidePanelWidth(width: number) {
      return ipcRenderer.invoke('browser:set-side-panel-width', width)
    },
    setLeftPanelWidth(width: number) {
      return ipcRenderer.invoke('browser:set-left-panel-width', width)
    },
    setBottomBarHeight(height: number) {
      return ipcRenderer.invoke('browser:set-bottom-bar-height', height)
    },
    setTopBarHeight(height: number) {
      return ipcRenderer.invoke('browser:set-top-bar-height', height)
    },
    onTabCreated(cb: (tab: { id: string; url: string; title: string }) => void) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        tab: { id: string; url: string; title: string }
      ) => cb(tab)
      ipcRenderer.on('browser:tab-created', handler)
      return () => ipcRenderer.removeListener('browser:tab-created', handler)
    },
    onTabUpdated(cb: (tabId: string, changes: Record<string, unknown>) => void) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        tabId: string,
        changes: Record<string, unknown>
      ) => cb(tabId, changes)
      ipcRenderer.on('browser:tab-updated', handler)
      return () => ipcRenderer.removeListener('browser:tab-updated', handler)
    },
    onTabClosed(cb: (tabId: string) => void) {
      const handler = (_event: Electron.IpcRendererEvent, tabId: string) => cb(tabId)
      ipcRenderer.on('browser:tab-closed', handler)
      return () => ipcRenderer.removeListener('browser:tab-closed', handler)
    },
    onTabActivated(cb: (tabId: string) => void) {
      const handler = (_event: Electron.IpcRendererEvent, tabId: string) => cb(tabId)
      ipcRenderer.on('browser:tab-activated', handler)
      return () => ipcRenderer.removeListener('browser:tab-activated', handler)
    },
    onDownloadStarted(cb: (info: Record<string, unknown>) => void) {
      const handler = (_event: Electron.IpcRendererEvent, info: Record<string, unknown>) => cb(info)
      ipcRenderer.on('browser:download-started', handler)
      return () => ipcRenderer.removeListener('browser:download-started', handler)
    },
    onDownloadUpdated(cb: (info: Record<string, unknown>) => void) {
      const handler = (_event: Electron.IpcRendererEvent, info: Record<string, unknown>) => cb(info)
      ipcRenderer.on('browser:download-updated', handler)
      return () => ipcRenderer.removeListener('browser:download-updated', handler)
    },
    onDownloadCompleted(cb: (info: Record<string, unknown>) => void) {
      const handler = (_event: Electron.IpcRendererEvent, info: Record<string, unknown>) => cb(info)
      ipcRenderer.on('browser:download-completed', handler)
      return () => ipcRenderer.removeListener('browser:download-completed', handler)
    },
    // Find in page
    findInPage(tabId: string, text: string, options: { forward?: boolean; findNext?: boolean }) {
      return ipcRenderer.invoke('browser:find-in-page', tabId, text, options)
    },
    stopFindInPage(
      tabId: string,
      action: 'clearSelection' | 'keepSelection' | 'activateSelection'
    ) {
      return ipcRenderer.invoke('browser:stop-find-in-page', tabId, action)
    },
    onFoundInPage(cb: (result: { activeMatchOrdinal: number; matches: number }) => void) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        result: { activeMatchOrdinal: number; matches: number }
      ) => cb(result)
      ipcRenderer.on('browser:found-in-page', handler)
      return () => ipcRenderer.removeListener('browser:found-in-page', handler)
    },
    // Permission handling
    resolvePermission(
      requestId: string,
      granted: boolean,
      remember: boolean,
      origin?: string,
      permission?: string
    ) {
      return ipcRenderer.invoke(
        'browser:resolve-permission',
        requestId,
        granted,
        remember,
        origin,
        permission
      )
    },
    onPermissionRequest(
      cb: (request: {
        id: string
        permission: string
        origin: string
        requestingUrl: string
      }) => void
    ) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        request: { id: string; permission: string; origin: string; requestingUrl: string }
      ) => cb(request)
      ipcRenderer.on('browser:permission-request', handler)
      return () => ipcRenderer.removeListener('browser:permission-request', handler)
    },
    // Context menu
    executeContextAction(tabId: string, action: string, params: Record<string, unknown>) {
      return ipcRenderer.invoke('browser:context-action', tabId, action, params)
    },
    onContextMenu(cb: (params: Record<string, unknown>) => void) {
      const handler = (_event: Electron.IpcRendererEvent, params: Record<string, unknown>) =>
        cb(params)
      ipcRenderer.on('browser:context-menu', handler)
      return () => ipcRenderer.removeListener('browser:context-menu', handler)
    },
    onShortcut(cb: (action: string, data?: number) => void) {
      const handler = (_event: Electron.IpcRendererEvent, action: string, data?: number) =>
        cb(action, data)
      ipcRenderer.on('browser:shortcut', handler)
      return () => ipcRenderer.removeListener('browser:shortcut', handler)
    },
    onCursorInPanel(cb: (isInside: boolean) => void) {
      const handler = (_event: Electron.IpcRendererEvent, isInside: boolean) => cb(isInside)
      ipcRenderer.on('browser:cursor-in-panel', handler)
      return () => ipcRenderer.removeListener('browser:cursor-in-panel', handler)
    },
    setPanelBounds(bounds: {
      x: number
      y: number
      width: number
      height: number
      borderRadius: number
    }) {
      return ipcRenderer.invoke('browser:set-panel-bounds', bounds)
    },
    // Tab visibility control (for settings view)
    hideAllTabs() {
      return ipcRenderer.invoke('browser:hide-all-tabs')
    },
    showActiveTab() {
      return ipcRenderer.invoke('browser:show-active-tab')
    },
    // Close all tabs (Cmd+Shift+W)
    closeAllTabs() {
      return ipcRenderer.invoke('browser:close-all-tabs')
    },
    // Close tab or open new if last (Cmd+W)
    closeTabOrOpenNew(tabId: string) {
      return ipcRenderer.invoke('browser:close-tab-or-new', tabId)
    },
    // Cookie/site data methods
    getCookiesForSite(url: string) {
      return ipcRenderer.invoke('browser:get-cookies-for-site', url)
    },
    getCookieDomains(url: string) {
      return ipcRenderer.invoke('browser:get-cookie-domains', url)
    },
    deleteCookiesForDomain(domain: string) {
      return ipcRenderer.invoke('browser:delete-cookies-for-domain', domain)
    },
    clearSiteData(url: string) {
      return ipcRenderer.invoke('browser:clear-site-data', url)
    },
    getSecurityInfo(url: string) {
      return ipcRenderer.invoke('browser:get-security-info', url)
    },
    // Get ALL cookie domains (comprehensive list)
    getAllCookieDomains() {
      return ipcRenderer.invoke('browser:get-all-cookie-domains')
    },
    // Get cookies for a specific domain
    getCookiesForDomainDetail(domain: string) {
      return ipcRenderer.invoke('browser:get-cookies-for-domain', domain)
    },
    // Get ALL saved permissions
    getAllPermissions() {
      return ipcRenderer.invoke('browser:get-all-permissions')
    },
    // Delete all permissions for an origin
    deletePermissionsForOrigin(origin: string) {
      return ipcRenderer.invoke('browser:delete-permissions-for-origin', origin)
    },
    // Delete a specific permission
    deletePermission(origin: string, permission: string) {
      return ipcRenderer.invoke('browser:delete-permission', origin, permission)
    }
  },
  // Notebook persistence methods
  onNotesChanged(cb: () => void) {
    const handler = () => cb()
    ipcRenderer.on('notebook:notes-changed', handler)
    return () => ipcRenderer.removeListener('notebook:notes-changed', handler)
  },
  saveNote(note: {
    id: string
    title: string
    content: string
    folderId?: string
    skill?: Record<string, unknown>
    updatedAt?: number
  }) {
    return ipcRenderer.invoke('notebook:save', note)
  },
  loadNotes() {
    return ipcRenderer.invoke('notebook:load-all')
  },
  loadNote(id: string) {
    return ipcRenderer.invoke('notebook:load', id)
  },
  deleteNote(id: string) {
    return ipcRenderer.invoke('notebook:delete', id)
  },
  getLastOpenedNoteId() {
    return ipcRenderer.invoke('notebook:get-last-opened')
  },
  setLastOpenedNoteId(id: string) {
    return ipcRenderer.invoke('notebook:set-last-opened', id)
  },
  getNotesFolder() {
    return ipcRenderer.invoke('notebook:get-folder')
  },
  openNotesFolder() {
    return ipcRenderer.invoke('notebook:open-folder')
  },
  // Skill-specific notebook methods
  getSkills(): Promise<
    Array<{ id: string; title: string; updatedAt: number; skill: Record<string, unknown> }>
  > {
    return ipcRenderer.invoke('notebook:get-skills')
  },
  updateSkillUsage(id: string): Promise<{ success: boolean }> {
    return ipcRenderer.invoke('notebook:update-skill-usage', id)
  },
  saveNotebookImage(data: string, mimeType: string) {
    return ipcRenderer.invoke('notebook:save-image', { data, mimeType })
  },
  openExternal(url: string) {
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        console.warn('[Bridge] Blocked openExternal with disallowed protocol:', parsed.protocol)
        return Promise.resolve()
      }
    } catch {
      console.warn('[Bridge] Blocked openExternal with invalid URL:', url)
      return Promise.resolve()
    }
    return ipcRenderer.invoke('shell:open-external', url)
  },
  setWindowZoomFactor(zoomFactor: number) {
    return ipcRenderer.invoke('window:set-zoom-factor', zoomFactor)
  },
  closeCurrentWindow() {
    return ipcRenderer.invoke('window:close-current')
  },
  // Traffic light button methods
  destroyPanel() {
    return ipcRenderer.invoke('panel:destroy')
  },
  hidePanel(panelType: 'chat' | 'notebook' | 'browser' | 'transcription') {
    return ipcRenderer.invoke('panel:hide', { panelType })
  },
  maximizePanel() {
    return ipcRenderer.invoke('panel:maximize')
  },
  startWindowDrag() {
    return ipcRenderer.invoke('window:start-drag')
  },
  moveWindowBy(deltaX: number, deltaY: number) {
    return ipcRenderer.invoke('window:drag-move', { deltaX, deltaY })
  },
  setIgnoreMouseEvents(ignore: boolean, forward?: boolean) {
    return ipcRenderer.invoke('panel:set-ignore-mouse', { ignore, forward })
  },
  getScreenBounds() {
    return ipcRenderer.invoke('panel:get-screen-bounds')
  },
  getAllDisplays() {
    return ipcRenderer.invoke('panel:get-all-displays')
  },
  moveToDisplay(screenX: number, screenY: number) {
    return ipcRenderer.invoke('panel:move-to-display', { screenX, screenY })
  },
  getWindowItemId(): string | null {
    const params = new URLSearchParams(window.location.search)
    return params.get('itemId')
  },
  detectSelectedText(): Promise<{ success: boolean; hasSelection: boolean; selectedText: string }> {
    return ipcRenderer.invoke('system:detect-selected-text')
  },
  getPlatformInfo(): Promise<{ platform: string; arch: string }> {
    return ipcRenderer.invoke('platform:get-info')
  },
  onAuthError(cb: (data: { error: string; errorDescription?: string }) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { error: string; errorDescription?: string }
    ) => {
      console.log('[Auth Preload] Received auth error')
      cb(data)
    }
    ipcRenderer.on('auth:error', handler)
    return () => ipcRenderer.removeListener('auth:error', handler)
  },
  // Main-process auth completion. Tokens are deliberately not exposed.
  onSessionTransfer(
    cb: (data: {
      authenticated: true
      expiresAt?: number
      user: { id: string; email: string; firstName: string; lastName: string }
    }) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        authenticated: true
        expiresAt?: number
        user: { id: string; email: string; firstName: string; lastName: string }
      }
    ) => {
      console.log('[Auth Preload] Received session transfer from landing page')
      cb(data)
    }
    ipcRenderer.on('auth:session-transfer', handler)
    return () => ipcRenderer.removeListener('auth:session-transfer', handler)
  },
  startNativeSignIn(forceSignIn = false): Promise<{ success: boolean; error?: string }> {
    return ipcRenderer.invoke('auth:start-sign-in', forceSignIn)
  },
  server: {
    getProfile() {
      return ipcRenderer.invoke('server:get-profile')
    },
    verifyProfile(origin: string) {
      return ipcRenderer.invoke('server:verify-profile', origin)
    },
    activateProfile(
      profile: {
        deploymentId: string
        mode: 'cloud' | 'self-hosted'
        origin: string
        verifiedAt: number
      },
      confirmation: string
    ) {
      return ipcRenderer.invoke('server:activate-profile', { profile, confirmation })
    },
    onChanged(
      cb: (profile: {
        deploymentId: string
        mode: 'cloud' | 'self-hosted'
        origin: string
        verifiedAt: number
      }) => void
    ) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        profile: {
          deploymentId: string
          mode: 'cloud' | 'self-hosted'
          origin: string
          verifiedAt: number
        }
      ): void => cb(profile)
      ipcRenderer.on('server:profile-changed', handler)
      return () => ipcRenderer.removeListener('server:profile-changed', handler)
    }
  },
  // Sign out - cancels token refresh and clears secure storage
  signOut(): Promise<{ success: boolean }> {
    return ipcRenderer.invoke('auth:sign-out')
  },
  // Launch at startup
  getLaunchAtStartup(): Promise<boolean> {
    return ipcRenderer.invoke('settings:get-launch-at-startup')
  },
  setLaunchAtStartup(enabled: boolean): Promise<boolean> {
    return ipcRenderer.invoke('settings:set-launch-at-startup', enabled)
  },
  // Subscription and usage tracking
  subscription: {
    getEntitlements() {
      return ipcRenderer.invoke('subscription:get-entitlements')
    },
    canPerform(type: 'ask' | 'write' | 'agent', modelId: string) {
      return ipcRenderer.invoke('subscription:can-perform', { type, modelId })
    },
    canUseLocalTranscription() {
      return ipcRenderer.invoke('subscription:can-use-local-transcription')
    },
    getCreditsRemaining() {
      return ipcRenderer.invoke('subscription:get-credits-remaining')
    },
    refresh() {
      return ipcRenderer.invoke('subscription:refresh')
    },
    // Dev mode helpers — only exposed when running in dev
    ...(process.env.OVERLAY_ENABLE_LOCAL_BILLING_TESTS === '1'
      ? {
          devSetTier(tier: 'free' | 'pro' | 'max') {
            return ipcRenderer.invoke('subscription:dev-set-tier', { tier })
          },
          devResetUsage() {
            return ipcRenderer.invoke('subscription:dev-reset-usage')
          },
          devSetState(state: {
            tier?: 'free' | 'pro' | 'max'
            creditsUsed?: number
            creditsTotal?: number
            dailyUsage?: { ask: number; write: number; agent: number }
            dailyLimits?: { ask: number; write: number; agent: number }
            transcriptionSecondsUsed?: number
            transcriptionSecondsLimit?: number
          }) {
            return ipcRenderer.invoke('subscription:dev-set-state', state)
          }
        }
      : {}),
    // Listen for entitlement updates from main process
    onUpdated(cb: (entitlements: unknown) => void) {
      const handler = (_event: Electron.IpcRendererEvent, entitlements: unknown) => cb(entitlements)
      ipcRenderer.on('subscription:updated', handler)
      return () => ipcRenderer.removeListener('subscription:updated', handler)
    }
  },
  appApi: {
    request(input: {
      path: string
      method?: string
      headers?: Record<string, string>
      body?: string | null
    }): Promise<{ ok: boolean; status: number; statusText: string; bodyText: string }> {
      return ipcRenderer.invoke('app-api:request', input)
    },
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
    ): Promise<{ ok: boolean; status: number; statusText: string; bodyText: string }> {
      const streamId = input.streamId
      const handler = (
        _event: Electron.IpcRendererEvent,
        event: {
          streamId: string
          type: 'ready' | 'chunk' | 'done' | 'error'
          status?: number
          statusText?: string
          headers?: Record<string, string>
          chunk?: string
          error?: string
        }
      ): void => {
        if (event.streamId !== streamId) return
        cb({
          type: event.type,
          status: event.status,
          statusText: event.statusText,
          headers: event.headers,
          chunk: event.chunk,
          error: event.error
        })
      }
      ipcRenderer.on('app-api:stream-event', handler)
      return ipcRenderer
        .invoke('app-api:stream', { ...input, streamId })
        .finally(() => ipcRenderer.removeListener('app-api:stream-event', handler))
    },
    abort(streamId: string): Promise<{ aborted: boolean }> {
      return ipcRenderer.invoke('app-api:abort', streamId)
    }
  },
  uploadToStorage(input: {
    url: string
    contentType: string
    data: ArrayBuffer
  }): Promise<{ ok: boolean; status: number }> {
    return ipcRenderer.invoke('storage:upload', input)
  },
  chatMedia: {
    cacheDataUrl(input: { chatId: string; dataUrl: string; name?: string }): Promise<{
      cacheKey: string
      url: string
      mimeType: string
      sizeBytes: number
      name: string
    }> {
      return ipcRenderer.invoke('chat-media:cache-data-url', input)
    }
  },
  // Native context menu
  showContextMenu(
    items: Array<{
      id: string
      label: string
      accelerator?: string
      enabled?: boolean
      type?: 'normal' | 'separator'
    }>
  ): Promise<{ clicked: string | null }> {
    return ipcRenderer.invoke('context-menu:show', { items })
  },
  // Memory operations
  memory: {
    search(query: string, limit?: number) {
      return ipcRenderer.invoke('memory:search', query, limit)
    },
    getByChat(chatId: string) {
      return ipcRenderer.invoke('memory:getByChat', chatId)
    },
    getByFolder(folderId: string) {
      return ipcRenderer.invoke('memory:getByFolder', folderId)
    },
    getAll() {
      return ipcRenderer.invoke('memory:getAll')
    },
    extract(params: {
      userMessage: string
      assistantResponse?: string
      chatId: string
      messageId?: string
      folderId?: string
      conversationContext?: string[]
    }) {
      return ipcRenderer.invoke('memory:extract', params)
    },
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
    }) {
      return ipcRenderer.invoke('memory:add', memory)
    },
    delete(id: string) {
      return ipcRenderer.invoke('memory:delete', id)
    },
    deleteMany(ids: string[]) {
      return ipcRenderer.invoke('memory:deleteMany', ids)
    },
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
    ) {
      return ipcRenderer.invoke('memory:update', id, updates)
    },
    getStats() {
      return ipcRenderer.invoke('memory:stats')
    },
    // Agent memory operations (Phase 3)
    agentApprove(candidate: {
      content: string
      type: string
      importance: number
      taskFingerprint: string
      sourceTaskId: string
      chatId?: string
      folderId?: string
    }) {
      return ipcRenderer.invoke('memory:agent-approve', candidate)
    },
    agentReject(candidate: {
      content: string
      type: string
      importance: number
      taskFingerprint: string
      sourceTaskId: string
      chatId?: string
      folderId?: string
    }) {
      return ipcRenderer.invoke('memory:agent-reject', candidate)
    },
    runSchemaMigration() {
      return ipcRenderer.invoke('memory:run-schema-migration')
    },
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
    ) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          streamId: string
          taskId: string
          candidates: Array<{
            content: string
            type: string
            importance: number
            taskFingerprint: string
          }>
        }
      ) => cb(data)
      ipcRenderer.on('agent:memory-candidates', handler)
      return () => ipcRenderer.removeListener('agent:memory-candidates', handler)
    }
  },
  // Knowledge search operations (unified search across memories, notes, chats)
  knowledge: {
    search(options: {
      query: string
      chatId?: string
      folderId?: string
      noteId?: string
      includeMemories?: boolean
      includeNotes?: boolean
      includeChats?: boolean
      limit?: number
    }) {
      return ipcRenderer.invoke('knowledge/knowledge:search', options)
    },
    searchNotes(options: {
      query: string
      folderId?: string
      limit?: number
      includeGlobal?: boolean
    }) {
      return ipcRenderer.invoke('knowledge/knowledge:search-notes', options)
    },
    searchChats(options: {
      query: string
      folderId?: string
      limit?: number
      includeGlobal?: boolean
      type?: 'summary' | 'message'
    }) {
      return ipcRenderer.invoke('knowledge/knowledge:search-chats', options)
    },
    indexNote(note: {
      id: string
      title: string
      content: string
      folderId?: string | null
      tags?: string[]
      createdAt?: number
      updatedAt?: number
    }) {
      return ipcRenderer.invoke('knowledge/knowledge:index-note', note)
    },
    removeNote(noteId: string) {
      return ipcRenderer.invoke('knowledge/knowledge:remove-note', noteId)
    },
    indexChat(chat: {
      id: string
      title: string
      messages: Array<{ role: string; content: string }>
      folderId?: string | null
      createdAt?: number
      updatedAt?: number
    }) {
      return ipcRenderer.invoke('knowledge/knowledge:index-chat', chat)
    },
    removeChat(chatId: string) {
      return ipcRenderer.invoke('knowledge/knowledge:remove-chat', chatId)
    },
    getStats() {
      return ipcRenderer.invoke('knowledge/knowledge:get-stats')
    },
    getFolderNotes(folderId: string, limit?: number) {
      return ipcRenderer.invoke('knowledge/knowledge:get-folder-notes', folderId, limit)
    },
    getFolderChats(folderId: string, limit?: number) {
      return ipcRenderer.invoke('knowledge/knowledge:get-folder-chats', folderId, limit)
    },
    mentionSearch(options: {
      query: string
      type: 'note' | 'chat' | 'document' | 'folder'
      folderId?: string
      limit?: number
    }) {
      return ipcRenderer.invoke('knowledge/knowledge:mention-search', options)
    }
  },
  // Document ingestion and search operations
  document: {
    ingest(options: { filepath: string; folderId?: string; chatId?: string }) {
      return ipcRenderer.invoke('document:ingest', options)
    },
    ingestDialog(options: { folderId?: string; chatId?: string; waitForIndex?: boolean }) {
      return ipcRenderer.invoke('document:ingest-dialog', options)
    },
    search(options: {
      query: string
      folderId?: string
      chatId?: string
      limit?: number
      includeGlobal?: boolean
    }) {
      return ipcRenderer.invoke('document:search', options)
    },
    remove(documentId: string) {
      return ipcRenderer.invoke('document:remove', documentId)
    },
    getAll(limit?: number) {
      return ipcRenderer.invoke('document:get-all', limit)
    },
    getByFolder(folderId: string, limit?: number) {
      return ipcRenderer.invoke('document:get-by-folder', folderId, limit)
    },
    getByChat(chatId: string, limit?: number) {
      return ipcRenderer.invoke('document:get-by-chat', chatId, limit)
    },
    getChunks(documentId: string) {
      return ipcRenderer.invoke('document:get-chunks', documentId)
    },
    getStats() {
      return ipcRenderer.invoke('document:get-stats')
    },
    isSupported(filepath: string) {
      return ipcRenderer.invoke('document:is-supported', filepath)
    }
  },
  knowledgeMigration: {
    inventory() {
      return ipcRenderer.invoke('knowledge-migration:inventory')
    },
    readAsset(assetId: string) {
      return ipcRenderer.invoke('knowledge-migration:read-asset', assetId)
    },
    createBackup(userId: string) {
      return ipcRenderer.invoke('knowledge-migration:create-backup', userId)
    },
    loadJournal(userId: string) {
      return ipcRenderer.invoke('knowledge-migration:load-journal', userId)
    },
    saveJournal(userId: string, journal: KnowledgeMigrationJournal) {
      return ipcRenderer.invoke('knowledge-migration:save-journal', userId, journal)
    }
  },
  knowledgeFiles: {
    pick(options: { multiple?: boolean; directory?: boolean }) {
      return ipcRenderer.invoke('knowledge-files:pick', options)
    },
    readPicked(token: string) {
      return ipcRenderer.invoke('knowledge-files:read-picked', token)
    },
    revealDownloaded(input: { name: string; dataBase64: string }) {
      return ipcRenderer.invoke('knowledge-files:reveal-downloaded', input)
    }
  },
  // Context retrieval operations
  context: {
    initialize() {
      return ipcRenderer.invoke('context:initialize')
    },
    getForMessage(params: {
      userMessage: string
      chatId: string
      folderId?: string
      projectInstructions?: string
      recentMessages?: string[]
    }) {
      return ipcRenderer.invoke('context:getForMessage', params)
    },
    getContext(params: {
      query: string
      conversationHistory?: string[]
      chatId?: string
      folderId?: string
      projectInstructions?: string
      maxTokens?: number
      includeTypes?: string[]
      excludeTypes?: string[]
    }) {
      return ipcRenderer.invoke('context:getContext', params)
    },
    hasRelevant(params: { query: string; chatId?: string; folderId?: string }) {
      return ipcRenderer.invoke('context:hasRelevant', params)
    }
  },
  // Note import methods
  import: {
    detectApps() {
      return ipcRenderer.invoke('import:detect-apps')
    },
    obsidian() {
      return ipcRenderer.invoke('import:obsidian')
    },
    bear() {
      return ipcRenderer.invoke('import:bear')
    },
    appleNotes() {
      return ipcRenderer.invoke('import:apple-notes')
    },
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
    ) {
      return ipcRenderer.invoke('import:save-notes', notes)
    },
    notifyNotesChanged() {
      return ipcRenderer.invoke('import:notify-notes-changed')
    }
  },
  // Agent user-input request (agent needs human interaction in the browser)
  onAgentUserInputRequest(cb: (data: { requestId: string; reason: string }) => void) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { requestId: string; reason: string }
    ) => cb(data)
    ipcRenderer.on('agent:user-input-request', handler)
    return () => ipcRenderer.removeListener('agent:user-input-request', handler)
  },
  agentUserInputContinue(requestId: string): Promise<{ success: boolean }> {
    return ipcRenderer.invoke('agent:user-input-continue', { requestId })
  },

  // Agent voice events
  onAgentStart(cb: (data: { command: string }) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: { command: string }) => cb(data)
    ipcRenderer.on('agent:start', handler)
    return () => ipcRenderer.removeListener('agent:start', handler)
  },
  onAgentDone(cb: (data: { summary: string; steps: number }) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: { summary: string; steps: number }) =>
      cb(data)
    ipcRenderer.on('agent:done', handler)
    return () => ipcRenderer.removeListener('agent:done', handler)
  },
  onAgentError(cb: (data: { error: string }) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: { error: string }) => cb(data)
    ipcRenderer.on('agent:error', handler)
    return () => ipcRenderer.removeListener('agent:error', handler)
  },
  updateAgenticWakeWord(enabled: boolean) {
    return ipcRenderer.invoke('settings:update-agentic-wake-word', enabled)
  },
  // Agent streaming for chat panel
  runAgentStream(
    command: string,
    onEvent: (event: {
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
    }) => void,
    modelId?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    imageDataArray?: string[],
    workingFolder?: string,
    searchEnabled?: boolean,
    memoryEnabled?: boolean,
    sandboxEnabled?: boolean
  ): {
    streamId: string
    promise: Promise<{ success: boolean; error?: string }>
    cancel: () => void
  } {
    const streamId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    let listenerRemoved = false

    let resolveStream: (value: { success: boolean; error?: string }) => void
    const promise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      resolveStream = resolve
    })

    const removeHandler = (): void => {
      if (!listenerRemoved) {
        listenerRemoved = true
        ipcRenderer.removeListener('agent:stream-event', handler)
      }
    }

    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
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
      }
    ) => {
      if (data.streamId === streamId) {
        onEvent(data)
        if (data.type === 'done') {
          removeHandler()
          resolveStream({ success: true })
        } else if (data.type === 'error') {
          removeHandler()
          resolveStream({ success: false, error: data.error })
        }
      }
    }
    ipcRenderer.on('agent:stream-event', handler)

    ipcRenderer
      .invoke('agent:run-stream', {
        command,
        streamId,
        modelId,
        history,
        imageDataArray,
        workingFolder,
        searchEnabled,
        memoryEnabled,
        sandboxEnabled
      })
      .then((result) => {
        if (!listenerRemoved) {
          setTimeout(() => {
            if (!listenerRemoved) {
              removeHandler()
              const invokeResult = result as { success: boolean; error?: string }
              resolveStream({ success: invokeResult.success, error: invokeResult.error })
            }
          }, 2000)
        }
      })
      .catch((err) => {
        if (!listenerRemoved) {
          removeHandler()
          resolveStream({ success: false, error: String(err) })
        }
      })

    const cancel = (): void => {
      ipcRenderer.invoke('agent:cancel-stream', { streamId })
      removeHandler()
      resolveStream({ success: false, error: 'Cancelled' })
    }

    return { streamId, promise, cancel }
  },
  // Browser agent streaming - prioritizes browser tools
  runBrowserAgentStream(
    command: string,
    onEvent: (event: {
      streamId: string
      type:
        | 'plan'
        | 'thinking'
        | 'tool_start'
        | 'tool_result'
        | 'text'
        | 'done'
        | 'error'
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
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>
    }) => void,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    modelId?: string,
    mode?: 'ask' | 'act'
  ): {
    streamId: string
    promise: Promise<{ success: boolean; error?: string }>
    cancel: () => void
  } {
    const streamId = `browser-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    let listenerRemoved = false

    let resolveStream: (value: { success: boolean; error?: string }) => void
    const promise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      resolveStream = resolve
    })

    const removeHandler = (): void => {
      if (!listenerRemoved) {
        listenerRemoved = true
        ipcRenderer.removeListener('browser-agent:stream-event', handler)
      }
    }

    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        streamId: string
        type:
          | 'plan'
          | 'thinking'
          | 'tool_start'
          | 'tool_result'
          | 'text'
          | 'done'
          | 'error'
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
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>
      }
    ) => {
      if (data.streamId === streamId) {
        onEvent(data)
        if (data.type === 'done' || data.type === 'max_steps_reached') {
          removeHandler()
          resolveStream({ success: true })
        } else if (data.type === 'error') {
          removeHandler()
          resolveStream({ success: false, error: data.error })
        }
      }
    }
    ipcRenderer.on('browser-agent:stream-event', handler)

    ipcRenderer
      .invoke('browser-agent:run-stream', { command, streamId, history, modelId, mode })
      .then((result) => {
        if (!listenerRemoved) {
          setTimeout(() => {
            if (!listenerRemoved) {
              removeHandler()
              const invokeResult = result as { success: boolean; error?: string }
              resolveStream({ success: invokeResult.success, error: invokeResult.error })
            }
          }, 2000)
        }
      })
      .catch((err) => {
        if (!listenerRemoved) {
          removeHandler()
          resolveStream({ success: false, error: String(err) })
        }
      })

    const cancel = (): void => {
      ipcRenderer.invoke('agent:cancel-stream', { streamId })
      removeHandler()
      resolveStream({ success: false, error: 'Cancelled' })
    }

    return { streamId, promise, cancel }
  },
  // Composio integration methods
  composio: {
    async getConnected(): Promise<string[]> {
      return ipcRenderer.invoke('composio:get-connected')
    },
    async listToolkits(args?: { query?: string; cursor?: string; limit?: number }): Promise<{
      items: Array<{
        slug: string
        name: string
        description: string
        logoUrl: string | null
        isConnected: boolean
        connectedAccountId: string | null
      }>
      nextCursor: string | null
    }> {
      return ipcRenderer.invoke('composio:list-toolkits', args)
    },
    async getToolkitMetadata(
      toolkits: string[]
    ): Promise<
      Record<
        string,
        { slug: string; name: string; description: string; logoUrl: string; appUrl: string | null }
      >
    > {
      return ipcRenderer.invoke('composio:get-toolkit-metadata', toolkits)
    },
    async isConnected(toolkit: string): Promise<boolean> {
      return ipcRenderer.invoke('composio:is-connected', toolkit)
    },
    async connect(toolkit: string): Promise<{
      success: boolean
      redirectUrl?: string
      connectionId?: string
      alreadyConnected?: boolean
      error?: string
    }> {
      return ipcRenderer.invoke('composio:connect', toolkit)
    },
    async checkStatus(
      toolkit: string
    ): Promise<{ success: boolean; isConnected?: boolean; error?: string }> {
      return ipcRenderer.invoke('composio:check-status', toolkit)
    },
    async disconnect(toolkit: string): Promise<{ success: boolean; error?: string }> {
      return ipcRenderer.invoke('composio:disconnect', toolkit)
    },
    onToolkitsSynced(callback: () => void): () => void {
      const handler = (): void => callback()
      ipcRenderer.on('composio:toolkits-synced', handler)
      return () => ipcRenderer.off('composio:toolkits-synced', handler)
    }
  },
  // Notebook agent (agentic code editor) streaming
  runNotebookAgent(
    noteContent: string,
    noteTitle: string,
    command: string,
    modelId: string,
    mode: 'ask' | 'write',
    onEvent: (event: {
      streamId: string
      type: 'thinking' | 'tool_call' | 'edit_proposal' | 'text' | 'done' | 'error'
      thinking?: string
      tool?: string
      toolInput?: Record<string, unknown>
      edit?: {
        id: string
        description: string
        startLine: number
        endLine: number
        originalLines: string[]
        newLines: string[]
      }
      text?: string
      error?: string
      step?: number
    }) => void
  ): {
    streamId: string
    promise: Promise<{ success: boolean; error?: string }>
    cancel: () => void
  } {
    const streamId = `nb-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    let listenerRemoved = false

    let resolveStream: (value: { success: boolean; error?: string }) => void
    const promise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      resolveStream = resolve
    })

    const removeHandler = (): void => {
      if (!listenerRemoved) {
        listenerRemoved = true
        ipcRenderer.removeListener('notebook-agent:event', handler)
      }
    }

    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { streamId: string; type: string; [key: string]: unknown }
    ): void => {
      if (data.streamId === streamId) {
        onEvent(data as Parameters<typeof onEvent>[0])
        if (data.type === 'done') {
          removeHandler()
          resolveStream({ success: true })
        } else if (data.type === 'error') {
          removeHandler()
          resolveStream({ success: false, error: data.error as string })
        }
      }
    }
    ipcRenderer.on('notebook-agent:event', handler)

    ipcRenderer
      .invoke('notebook-agent:run', { noteContent, noteTitle, command, modelId, mode, streamId })
      .then((result) => {
        if (!listenerRemoved) {
          setTimeout(() => {
            if (!listenerRemoved) {
              removeHandler()
              const r = result as { success: boolean; error?: string }
              resolveStream({ success: r.success, error: r.error })
            }
          }, 2000)
        }
      })
      .catch((err) => {
        if (!listenerRemoved) {
          removeHandler()
          resolveStream({ success: false, error: String(err) })
        }
      })

    const cancel = (): void => {
      ipcRenderer.invoke('notebook-agent:cancel', { streamId })
      removeHandler()
      resolveStream({ success: false, error: 'Cancelled' })
    }

    return { streamId, promise, cancel }
  },
  // Auto-updater methods
  updater: {
    checkForUpdates() {
      return ipcRenderer.invoke('updater:check-for-updates')
    },
    quitAndInstall() {
      return ipcRenderer.invoke('updater:quit-and-install')
    },
    getCurrentVersion() {
      return ipcRenderer.invoke('updater:get-current-version')
    },
    getStatus() {
      return ipcRenderer.invoke('updater:get-status')
    },
    dismissUpdate() {
      return ipcRenderer.invoke('updater:dismiss-update')
    },
    onStatus(cb: (status: { status: string; data?: unknown }) => void) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        statusData: { status: string; data?: unknown }
      ) => cb(statusData)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    }
  },
  // Browser chat session management
  browserChatSessions: {
    list() {
      return ipcRenderer.invoke('browser-chat:list-sessions')
    },
    get(sessionId: string) {
      return ipcRenderer.invoke('browser-chat:get-session', sessionId)
    },
    create(mode: 'ask' | 'act') {
      return ipcRenderer.invoke('browser-chat:create-session', mode)
    },
    update(
      sessionId: string,
      updates: {
        title?: string
        messages?: Array<{ role: 'user' | 'assistant'; content: string }>
        mode?: 'ask' | 'act'
      }
    ) {
      return ipcRenderer.invoke('browser-chat:update-session', sessionId, updates)
    },
    delete(sessionId: string) {
      return ipcRenderer.invoke('browser-chat:delete-session', sessionId)
    },
    clear() {
      return ipcRenderer.invoke('browser-chat:clear-sessions')
    }
  },
  // Notification methods
  onNotification(
    cb: (data: {
      id: string
      type: 'success' | 'error'
      title: string
      summary: string
      trace: string[]
    }) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        id: string
        type: 'success' | 'error'
        title: string
        summary: string
        trace: string[]
      }
    ) => cb(data)
    ipcRenderer.on('notification:new', handler)
    return () => ipcRenderer.removeListener('notification:new', handler)
  },
  showNotification(data: {
    id: string
    type: 'success' | 'error'
    title: string
    summary: string
    trace: string[]
  }) {
    return ipcRenderer.invoke('notification:show', data)
  },
  dismissNotification(id: string) {
    return ipcRenderer.invoke('notification:dismiss', id)
  },
  closeNotificationWindow() {
    return ipcRenderer.invoke('notification:close-window')
  },

  // ── Security & Safe Storage ─────────────────────────────────────────────────
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
    }> {
      return ipcRenderer.invoke('security:get-auth-state')
    },

    // Check if encryption is available
    isEncryptionAvailable(): Promise<boolean> {
      return ipcRenderer.invoke('security:is-encryption-available')
    },

    // Get current usage stats with percentages
    getUsageStats(): Promise<{
      creditsUsed: number
      creditsTotal: number
      percentageRemaining: number
      transcriptionMinutesUsed?: number
      transcriptionMinutesLimit?: number
      transcriptionPercentageRemaining?: number
    } | null> {
      return ipcRenderer.invoke('security:get-usage-stats')
    }
  },

  // ── Terminal ──────────────────────────────────────────────────────────────────
  terminal: {
    run(command: string, cwd?: string, timeoutMs?: number) {
      return ipcRenderer.invoke('terminal:run', { command, cwd, timeoutMs })
    },
    createSession(cwd?: string) {
      return ipcRenderer.invoke('terminal:create-session', { cwd })
    },
    listSessions() {
      return ipcRenderer.invoke('terminal:list-sessions')
    },
    write(sessionId: string, data: string) {
      return ipcRenderer.invoke('terminal:write', { sessionId, data })
    },
    read(sessionId: string, lastN?: number) {
      return ipcRenderer.invoke('terminal:read', { sessionId, lastN })
    },
    resize(sessionId: string, cols: number, rows: number) {
      return ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows })
    },
    kill(sessionId: string) {
      return ipcRenderer.invoke('terminal:kill', { sessionId })
    },
    subscribe(sessionId: string) {
      return ipcRenderer.invoke('terminal:subscribe', { sessionId })
    },
    onData(cb: (data: { sessionId: string; data: string }) => void) {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { sessionId: string; data: string }
      ) => cb(payload)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    }
  },

  // ── Runtime (Script Execution) ──────────────────────────────────────────────
  runtime: {
    ensurePython() {
      return ipcRenderer.invoke('runtime:ensure-python')
    },
    runScript(options: {
      runtime: 'python' | 'javascript'
      code: string
      packages?: string[]
      cwd?: string
      timeoutMs?: number
    }) {
      return ipcRenderer.invoke('runtime:run-script', options)
    },
    createSandbox(runtime: 'python' | 'javascript') {
      return ipcRenderer.invoke('runtime:create-sandbox', { runtime })
    },
    installPackages(sandboxId: string, packages: string[]) {
      return ipcRenderer.invoke('runtime:install-packages', { sandboxId, packages })
    },
    runInSandbox(sandboxId: string, code: string, timeoutMs?: number) {
      return ipcRenderer.invoke('runtime:run-in-sandbox', { sandboxId, code, timeoutMs })
    },
    destroySandbox(sandboxId: string) {
      return ipcRenderer.invoke('runtime:destroy-sandbox', { sandboxId })
    },
    listSandboxes() {
      return ipcRenderer.invoke('runtime:list-sandboxes')
    },
    cleanup() {
      return ipcRenderer.invoke('runtime:cleanup')
    }
  },

  // ── Working Folder ──────────────────────────────────────────────────────────
  pickWorkingFolder() {
    return ipcRenderer.invoke('runtime:pick-working-folder')
  },

  // ── Workspace File Listing ───────────────────────────────────────────────────
  workspace: {
    listFiles(workingFolder: string, maxDepth?: number) {
      return ipcRenderer.invoke('workspace:list-files', { workingFolder, maxDepth })
    },
    readFile(filePath: string, maxBytes?: number) {
      return ipcRenderer.invoke('workspace:read-file', { path: filePath, maxBytes })
    }
  }
}

if (!process.contextIsolated) {
  throw new Error('Context isolation is required. The app cannot run without it.')
}

try {
  contextBridge.exposeInMainWorld('bridge', bridge)
} catch (error) {
  console.error(error)
}

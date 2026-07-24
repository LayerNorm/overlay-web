import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { AppSettings, AppState, RecordingMode } from '../types'
import {
  DEFAULT_CHAT_TOOL_PERMISSION_MODE,
  normalizeChatToolPermissionMode,
  type ChatToolPermissionMode
} from '../../types/agent-permissions'

class SettingsService {
  private settingsPath: string | null = null

  // Application state with defaults
  private state: AppState = {
    previousVolume: 0,
    autoMuteEnabled: true,
    soundEffectsEnabled: false,
    smartTranscriptionEnabled: false,
    cloudTranscriptionEnabled: false,
    localTranscriptionEnabled: true,
    transcriptionPriority: 'cloud',
    assistantModeEnabled: true,
    assistantScreenshotEnabled: false,
    assistantModel: 'openrouter/free',
    agentModel: 'openrouter/free',
    selectedTextBeforeRecording: null,
    precedingTextContext: null,
    followingTextContext: null,
    isMidSentence: false,
    contextAwareCapitalizationEnabled: true,
    autoCopyEnabled: true,
    pressEnterAfterEnabled: false,
    lastRecordingMode: 'idle' as RecordingMode,
    selectedModelId: 'parakeet_v2',
    agenticWakeWordEnabled: true,
    recordingStorageEnabled: false,
    recordingStorageRetention: '7d' as '24h' | '7d' | '30d',
    chatToolPermissionMode: DEFAULT_CHAT_TOOL_PERMISSION_MODE,
    analyticsConsentEnabled: false
  }

  private _onboardingComplete = false
  private _isAuthenticated = false
  private _showPanelsOnStartup = false

  getSettingsPath(): string {
    if (!this.settingsPath) {
      this.settingsPath = join(app.getPath('userData'), 'settings.json')
    }
    return this.settingsPath
  }

  loadSettings(): AppSettings {
    try {
      const settingsPath = this.getSettingsPath()
      if (existsSync(settingsPath)) {
        const data = readFileSync(settingsPath, 'utf-8')
        return JSON.parse(data)
      }
    } catch (error) {
      console.error('[Settings] Failed to load settings:', error)
    }
    return {}
  }

  saveSettings(settings: AppSettings): void {
    try {
      const settingsPath = this.getSettingsPath()
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    } catch (error) {
      console.error('[Settings] Failed to save settings:', error)
    }
  }

  // State getters
  getState(): AppState {
    return { ...this.state }
  }

  get previousVolume(): number {
    return this.state.previousVolume
  }
  set previousVolume(value: number) {
    this.state.previousVolume = value
  }

  get autoMuteEnabled(): boolean {
    return this.state.autoMuteEnabled
  }
  set autoMuteEnabled(value: boolean) {
    this.state.autoMuteEnabled = value
  }

  get soundEffectsEnabled(): boolean {
    return this.state.soundEffectsEnabled
  }
  set soundEffectsEnabled(value: boolean) {
    this.state.soundEffectsEnabled = value
  }

  get smartTranscriptionEnabled(): boolean {
    return this.state.smartTranscriptionEnabled
  }
  set smartTranscriptionEnabled(value: boolean) {
    this.state.smartTranscriptionEnabled = value
  }

  get cloudTranscriptionEnabled(): boolean {
    return this.state.cloudTranscriptionEnabled
  }
  set cloudTranscriptionEnabled(value: boolean) {
    this.state.cloudTranscriptionEnabled = value
  }

  get localTranscriptionEnabled(): boolean {
    return this.state.localTranscriptionEnabled
  }
  set localTranscriptionEnabled(value: boolean) {
    this.state.localTranscriptionEnabled = value
  }

  get transcriptionPriority(): 'cloud' | 'local' {
    return this.state.transcriptionPriority
  }
  set transcriptionPriority(value: 'cloud' | 'local') {
    this.state.transcriptionPriority = value
  }

  get assistantModeEnabled(): boolean {
    return this.state.assistantModeEnabled
  }
  set assistantModeEnabled(value: boolean) {
    this.state.assistantModeEnabled = value
  }

  get assistantScreenshotEnabled(): boolean {
    return this.state.assistantScreenshotEnabled
  }
  set assistantScreenshotEnabled(value: boolean) {
    this.state.assistantScreenshotEnabled = value
  }

  get assistantModel(): string {
    return this.state.assistantModel
  }
  set assistantModel(value: string) {
    this.state.assistantModel = value
  }

  get agentModel(): string {
    return this.state.agentModel
  }
  set agentModel(value: string) {
    this.state.agentModel = value
  }

  get selectedTextBeforeRecording(): string | null {
    return this.state.selectedTextBeforeRecording
  }
  set selectedTextBeforeRecording(value: string | null) {
    this.state.selectedTextBeforeRecording = value
  }

  get precedingTextContext(): string | null {
    return this.state.precedingTextContext
  }
  set precedingTextContext(value: string | null) {
    this.state.precedingTextContext = value
  }

  get followingTextContext(): string | null {
    return this.state.followingTextContext
  }
  set followingTextContext(value: string | null) {
    this.state.followingTextContext = value
  }

  get isMidSentence(): boolean {
    return this.state.isMidSentence
  }
  set isMidSentence(value: boolean) {
    this.state.isMidSentence = value
  }

  get contextAwareCapitalizationEnabled(): boolean {
    return this.state.contextAwareCapitalizationEnabled
  }
  set contextAwareCapitalizationEnabled(value: boolean) {
    this.state.contextAwareCapitalizationEnabled = value
  }

  get autoCopyEnabled(): boolean {
    return this.state.autoCopyEnabled
  }
  set autoCopyEnabled(value: boolean) {
    this.state.autoCopyEnabled = value
  }

  get pressEnterAfterEnabled(): boolean {
    return this.state.pressEnterAfterEnabled
  }
  set pressEnterAfterEnabled(value: boolean) {
    this.state.pressEnterAfterEnabled = value
  }

  get lastRecordingMode(): RecordingMode {
    return this.state.lastRecordingMode
  }
  set lastRecordingMode(value: RecordingMode) {
    this.state.lastRecordingMode = value
  }

  get selectedModelId(): string {
    return this.state.selectedModelId
  }
  set selectedModelId(value: string) {
    this.state.selectedModelId = value
  }

  get agenticWakeWordEnabled(): boolean {
    return this.state.agenticWakeWordEnabled
  }
  set agenticWakeWordEnabled(value: boolean) {
    this.state.agenticWakeWordEnabled = value
  }

  get recordingStorageEnabled(): boolean {
    return this.state.recordingStorageEnabled
  }
  set recordingStorageEnabled(value: boolean) {
    this.state.recordingStorageEnabled = value
  }

  get recordingStorageRetention(): '24h' | '7d' | '30d' {
    return this.state.recordingStorageRetention
  }
  set recordingStorageRetention(value: '24h' | '7d' | '30d') {
    this.state.recordingStorageRetention = value
  }

  get chatToolPermissionMode(): ChatToolPermissionMode {
    return this.state.chatToolPermissionMode
  }
  set chatToolPermissionMode(value: ChatToolPermissionMode) {
    this.state.chatToolPermissionMode = normalizeChatToolPermissionMode(value)
  }

  get analyticsConsentEnabled(): boolean {
    return this.state.analyticsConsentEnabled
  }
  set analyticsConsentEnabled(value: boolean) {
    this.state.analyticsConsentEnabled = value === true
  }

  get onboardingComplete(): boolean {
    return this._onboardingComplete
  }
  set onboardingComplete(value: boolean) {
    this._onboardingComplete = value
  }

  get showPanelsOnStartup(): boolean {
    return this._showPanelsOnStartup
  }
  set showPanelsOnStartup(value: boolean) {
    this._showPanelsOnStartup = value
  }

  get isAuthenticated(): boolean {
    return this._isAuthenticated
  }
  set isAuthenticated(value: boolean) {
    this._isAuthenticated = value
    console.log('[Settings] Auth state changed:', value)
  }

  // Initialize from persisted settings
  initializeFromPersistedSettings(): void {
    const settings = this.loadSettings()
    if (settings.autoCopy !== undefined) {
      this.state.autoCopyEnabled = settings.autoCopy
    }
    if (settings.pressEnterAfter !== undefined) {
      this.state.pressEnterAfterEnabled = settings.pressEnterAfter
    }
    if (settings.selectedModelId !== undefined) {
      this.state.selectedModelId = settings.selectedModelId
      console.log('[Main] Loaded persisted model selection:', this.state.selectedModelId)
    }
    if (settings.localTranscriptionEnabled !== undefined) {
      this.state.localTranscriptionEnabled = settings.localTranscriptionEnabled
      console.log(
        '[Main] Loaded persisted local transcription setting:',
        this.state.localTranscriptionEnabled
      )
    }
    if (settings.transcriptionPriority !== undefined) {
      this.state.transcriptionPriority = settings.transcriptionPriority
      console.log(
        '[Main] Loaded persisted transcription priority:',
        this.state.transcriptionPriority
      )
    }
    if (settings.onboardingComplete !== undefined) {
      this._onboardingComplete = settings.onboardingComplete
      console.log('[Main] Loaded persisted onboarding status:', this._onboardingComplete)
    }
    if (settings.showPanelsOnStartup !== undefined) {
      this._showPanelsOnStartup = settings.showPanelsOnStartup
      console.log('[Main] Loaded show panels on startup:', this._showPanelsOnStartup)
    }
    if (settings.agentModel !== undefined) {
      this.state.agentModel = settings.agentModel
      console.log('[Main] Loaded persisted agent model:', this.state.agentModel)
    }
    if (settings.recordingStorageEnabled !== undefined) {
      this.state.recordingStorageEnabled = settings.recordingStorageEnabled
      console.log(
        '[Main] Loaded persisted recording storage enabled:',
        this.state.recordingStorageEnabled
      )
    }
    if (settings.recordingStorageRetention !== undefined) {
      this.state.recordingStorageRetention = settings.recordingStorageRetention
      console.log(
        '[Main] Loaded persisted recording storage retention:',
        this.state.recordingStorageRetention
      )
    }
    this.state.chatToolPermissionMode = normalizeChatToolPermissionMode(
      settings.chatToolPermissionMode
    )
    console.log('[Main] Loaded chat tool permission mode:', this.state.chatToolPermissionMode)
    this.state.analyticsConsentEnabled = settings.analyticsConsentEnabled === true
  }

  // Persist current settings
  persistCurrentSettings(): void {
    this.saveSettings({
      autoCopy: this.state.autoCopyEnabled,
      pressEnterAfter: this.state.pressEnterAfterEnabled,
      selectedModelId: this.state.selectedModelId,
      localTranscriptionEnabled: this.state.localTranscriptionEnabled,
      transcriptionPriority: this.state.transcriptionPriority,
      onboardingComplete: this._onboardingComplete,
      agentModel: this.state.agentModel,
      recordingStorageEnabled: this.state.recordingStorageEnabled,
      recordingStorageRetention: this.state.recordingStorageRetention,
      showPanelsOnStartup: this._showPanelsOnStartup,
      chatToolPermissionMode: this.state.chatToolPermissionMode,
      analyticsConsentEnabled: this.state.analyticsConsentEnabled
    })
  }
}

export const settingsService = new SettingsService()

import { BrowserWindow } from 'electron'
import type { ChatToolPermissionMode } from '../types/agent-permissions'

// Settings persistence
export interface AppSettings {
  autoCopy?: boolean
  pressEnterAfter?: boolean
  selectedModelId?: string
  localTranscriptionEnabled?: boolean
  transcriptionPriority?: 'cloud' | 'local'
  onboardingComplete?: boolean
  smartTranscriptionModes?: SmartTranscriptionMode[]
  activeSmartTranscriptionModeId?: string
  agentModel?: string
  recordingStorageEnabled?: boolean
  recordingStorageRetention?: '24h' | '7d' | '30d'
  showPanelsOnStartup?: boolean
  chatToolPermissionMode?: ChatToolPermissionMode
  analyticsConsentEnabled?: boolean
}

// Smart Transcription Mode
export interface SmartTranscriptionMode {
  id: string
  name: string
  prompt: string
  isDefault: boolean
}

// Recording modes (must include all HotkeyMode values plus 'idle')
export type RecordingMode =
  | 'push-to-talk'
  | 'transcription'
  | 'assistant'
  | 'panel-chat'
  | 'panel-notebook'
  | 'idle'

// Panel types
export type PanelType = 'notebook' | 'chat' | 'transcription' | 'browser' | 'notification'
export type WindowType =
  | 'main'
  | 'overlay'
  | 'notebook'
  | 'chat'
  | 'transcription'
  | 'browser'
  | 'notification'

// Panel window options
export interface CreatePanelOptions {
  show?: boolean
  preload?: boolean
  itemId?: string
  forceNew?: boolean
  position?: PanelPositionOverride
}

export interface PanelPositionOverride {
  x: number
  y: number
  width?: number
  height?: number
}

// Saved window state for reopening
export interface SavedWindowState {
  itemId: string
  x: number
  y: number
  width: number
  height: number
}

// Panel positions storage
export interface PanelPositions {
  notebook?: { x: number; y: number }
  chat?: { x: number; y: number }
  transcription?: { x: number; y: number }
  browser?: { x: number; y: number }
}

export interface PanelSizes {
  notebook?: { width: number; height: number }
  chat?: { width: number; height: number }
  transcription?: { width: number; height: number }
  browser?: { width: number; height: number }
}

// Preloaded panels
export interface PreloadedPanels {
  notebook?: BrowserWindow
  chat?: BrowserWindow
  browser?: BrowserWindow
}

// Hidden panel windows tracking
export interface HiddenPanelWindows {
  chat: Set<number>
  notebook: Set<number>
  browser: Set<number>
}

// Toggle result
export interface ToggleResult {
  action: 'hidden' | 'shown' | 'created'
  count: number
}

// Transcription request
export interface TranscriptionRequest {
  mime: string
  buf: ArrayBuffer
  duration: number
  dictionaryWords?: string[]
}

// Note structure
export interface Note {
  id: string
  title: string
  content: string
  updatedAt?: number
}

// Note metadata (for list view)
export interface NoteMetadata {
  id: string
  title: string
  updatedAt: number
}

// Screenshot result
export interface ScreenshotResult {
  dataUrl: string
  displayId: string
  name: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

// App state interface
export interface AppState {
  previousVolume: number
  autoMuteEnabled: boolean
  soundEffectsEnabled: boolean
  smartTranscriptionEnabled: boolean
  cloudTranscriptionEnabled: boolean
  localTranscriptionEnabled: boolean
  transcriptionPriority: 'cloud' | 'local'
  assistantModeEnabled: boolean
  assistantScreenshotEnabled: boolean
  assistantModel: string
  agentModel: string
  selectedTextBeforeRecording: string | null
  precedingTextContext: string | null
  followingTextContext: string | null
  isMidSentence: boolean
  contextAwareCapitalizationEnabled: boolean
  autoCopyEnabled: boolean
  pressEnterAfterEnabled: boolean
  lastRecordingMode: RecordingMode
  selectedModelId: string
  agenticWakeWordEnabled: boolean
  recordingStorageEnabled: boolean
  recordingStorageRetention: '24h' | '7d' | '30d'
  chatToolPermissionMode: ChatToolPermissionMode
  analyticsConsentEnabled: boolean
}

// Notification data
export interface NotificationData {
  id: string
  type: 'success' | 'error'
  title: string
  summary: string
  trace: string[]
}

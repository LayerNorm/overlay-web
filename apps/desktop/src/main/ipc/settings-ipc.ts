import { getTrustedIpcWindowRole, ipcMain } from '../services/security/secure-ipc-main'
import { BrowserWindow, dialog } from 'electron'

import { settingsService } from '../services/settings-service'
import { hotkeyManager } from '../services/hotkey-manager'
import { whisperKitService } from '../services/whisperkit-service'
import { parakeetService } from '../services/parakeet-service'
import { keyCacheService } from '../services/key-cache-service'
import { windowManager } from '../services/window-manager'
import {
  isChatToolPermissionMode,
  type ChatToolPermissionMode
} from '../../types/agent-permissions'

const getLocalService = (modelId: string): typeof parakeetService | typeof whisperKitService => {
  if (modelId.startsWith('parakeet_')) {
    return parakeetService
  }
  return whisperKitService
}

export function registerSettingsIPC(): void {
  ipcMain.handle('settings:update-auto-mute', async (_evt, enabled: boolean) => {
    settingsService.autoMuteEnabled = enabled
  })

  ipcMain.handle('settings:update-sound-effects', async (_evt, enabled: boolean) => {
    settingsService.soundEffectsEnabled = enabled
  })

  ipcMain.handle('settings:update-hotkey', async (_evt, hotkey: string) => {
    hotkeyManager.registerHotkey('push-to-talk', hotkey)
  })

  ipcMain.handle('settings:update-transcription-hotkey', async (_evt, hotkey: string) => {
    hotkeyManager.registerHotkey('transcription', hotkey)
  })

  ipcMain.handle('settings:update-smart-transcription', async (_evt, enabled: boolean) => {
    settingsService.smartTranscriptionEnabled = enabled
  })

  ipcMain.handle('settings:update-context-aware-capitalization', async (_evt, enabled: boolean) => {
    settingsService.contextAwareCapitalizationEnabled = enabled
  })

  ipcMain.handle('settings:update-cloud-transcription', async (_evt, enabled: boolean) => {
    settingsService.cloudTranscriptionEnabled = enabled
    console.log('Updated cloud transcription enabled:', settingsService.cloudTranscriptionEnabled)
  })

  ipcMain.handle(
    'settings:update-transcription-priority',
    async (_evt, priority: 'cloud' | 'local') => {
      settingsService.transcriptionPriority = priority
      settingsService.cloudTranscriptionEnabled = priority === 'cloud'
      settingsService.localTranscriptionEnabled = priority === 'local'
      settingsService.persistCurrentSettings()
      console.log('Updated transcription priority:', priority)
    }
  )

  ipcMain.handle('settings:update-local-transcription', async (_evt, enabled: boolean) => {
    settingsService.localTranscriptionEnabled = enabled
    console.log('Updated local transcription enabled:', settingsService.localTranscriptionEnabled)

    // Persist the setting
    settingsService.persistCurrentSettings()

    // Start or stop WhisperKit servers based on setting
    if (enabled) {
      const selectedModelId = settingsService.selectedModelId
      const selectedService = getLocalService(selectedModelId)
      const selectedAvailable = selectedService.isAvailable()
      const baseAvailable = whisperKitService.isAvailable()

      try {
        if (selectedAvailable) {
          if (baseAvailable && selectedModelId !== 'openai_whisper-base') {
            await whisperKitService.startServerForModel('openai_whisper-base')
            console.log('[Main] Base model server started')
          }
          await selectedService.startServerForModel(selectedModelId as any)
          console.log('[Main] Current model server started')
        } else if (baseAvailable) {
          await whisperKitService.startServerForModel('openai_whisper-base')
          console.log('[Main] Base model server started (fallback)')
        } else {
          console.log('[Main] No local ASR backend available')
        }
      } catch (error) {
        console.error('[Main] Failed to start local ASR servers:', error)
      }
    } else if (!enabled) {
      parakeetService.stopServer()
      whisperKitService.stopServer()
      console.log('[Main] Local ASR servers stopped')
    }
  })

  ipcMain.handle('settings:update-assistant-mode-hotkey', async (_evt, hotkey: string) => {
    hotkeyManager.registerHotkey('assistant', hotkey)
  })

  ipcMain.handle('settings:update-chat-panel-hotkey', async (_evt, hotkey: string) => {
    hotkeyManager.registerPanelHotkey('chat', hotkey)
  })

  ipcMain.handle('settings:update-notebook-panel-hotkey', async (_evt, hotkey: string) => {
    hotkeyManager.registerPanelHotkey('notebook', hotkey)
  })

  ipcMain.handle('settings:update-browser-panel-hotkey', async (_evt, hotkey: string) => {
    hotkeyManager.registerPanelHotkey('browser', hotkey)
  })

  ipcMain.handle('settings:update-assistant-screenshot', async (_evt, enabled: boolean) => {
    settingsService.assistantScreenshotEnabled = enabled
    console.log('Updated assistant screenshot enabled:', settingsService.assistantScreenshotEnabled)
  })

  ipcMain.handle('settings:update-assistant-mode', async (_evt, enabled: boolean) => {
    settingsService.assistantModeEnabled = enabled
    console.log('Updated assistant mode enabled:', settingsService.assistantModeEnabled)
  })

  ipcMain.handle('settings:update-agent-model', async (_evt, modelId: string) => {
    settingsService.agentModel = modelId
    console.log('Updated agent model:', settingsService.agentModel)
    settingsService.persistCurrentSettings()
  })

  ipcMain.handle('settings:update-input-device', async (_evt, deviceId: string) => {
    console.log('Updated input device:', deviceId)
  })

  ipcMain.handle('settings:get', async () => {
    return {
      autoCopy: settingsService.autoCopyEnabled,
      pressEnterAfter: settingsService.pressEnterAfterEnabled,
      selectedModelId: settingsService.selectedModelId,
      chatToolPermissionMode: settingsService.chatToolPermissionMode,
      analyticsConsentEnabled: settingsService.analyticsConsentEnabled
    }
  })

  ipcMain.handle(
    'settings:set-chat-tool-permission',
    async (
      event,
      requestedMode: unknown
    ): Promise<{
      updated: boolean
      mode: ChatToolPermissionMode
      error?: 'invalid_mode' | 'confirmation_unavailable'
    }> => {
      if (!isChatToolPermissionMode(requestedMode)) {
        return {
          updated: false,
          mode: settingsService.chatToolPermissionMode,
          error: 'invalid_mode'
        }
      }

      // The preference is rendered only inside Settings on the main window.
      // Panel renderers may read ordinary settings, but cannot mutate this
      // security boundary even if one of them becomes compromised.
      if (getTrustedIpcWindowRole(event.sender) !== 'main') {
        return {
          updated: false,
          mode: settingsService.chatToolPermissionMode,
          error: 'confirmation_unavailable'
        }
      }

      if (
        requestedMode === 'full_access' &&
        settingsService.chatToolPermissionMode !== 'full_access'
      ) {
        const parent = BrowserWindow.fromWebContents(event.sender)
        if (!parent || parent.isDestroyed()) {
          return {
            updated: false,
            mode: settingsService.chatToolPermissionMode,
            error: 'confirmation_unavailable'
          }
        }
        const result = await dialog.showMessageBox(parent, {
          type: 'warning',
          title: 'Enable Full access?',
          message: 'Chat commands will run without asking for approval.',
          detail:
            'This mode is not sandboxed. Commands can access files, applications, accounts, and the internet with your macOS user permissions. Only enable it when you trust the task and its inputs.',
          buttons: ['Cancel', 'Enable Full access'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        if (result.response !== 1) {
          return { updated: false, mode: settingsService.chatToolPermissionMode }
        }
      }

      settingsService.chatToolPermissionMode = requestedMode
      const existing = settingsService.loadSettings()
      settingsService.saveSettings({
        ...existing,
        chatToolPermissionMode: settingsService.chatToolPermissionMode
      })
      const payload = {
        key: 'chatToolPermissionMode',
        value: settingsService.chatToolPermissionMode
      }
      windowManager.broadcastToAllWindows('settings:changed', payload)
      return { updated: true, mode: settingsService.chatToolPermissionMode }
    }
  )

  ipcMain.handle('settings:update-auto-copy', async (_evt, enabled: boolean) => {
    settingsService.autoCopyEnabled = enabled
    console.log('Updated auto copy enabled:', settingsService.autoCopyEnabled)
    settingsService.persistCurrentSettings()
  })

  ipcMain.handle('settings:update-press-enter-after', async (_evt, enabled: boolean) => {
    settingsService.pressEnterAfterEnabled = enabled
    console.log('Updated press enter after enabled:', settingsService.pressEnterAfterEnabled)
    settingsService.persistCurrentSettings()
  })

  ipcMain.handle(
    'settings:sync',
    async (_evt, settings: { autoCopy: boolean; pressEnterAfter: boolean }) => {
      settingsService.autoCopyEnabled = settings.autoCopy
      settingsService.pressEnterAfterEnabled = settings.pressEnterAfter
      console.log('Synced settings from renderer:', {
        autoCopy: settingsService.autoCopyEnabled,
        pressEnterAfter: settingsService.pressEnterAfterEnabled
      })
      settingsService.persistCurrentSettings()
    }
  )

  // Smart transcription modes sync
  ipcMain.handle(
    'settings:sync-smart-transcription-modes',
    async (
      _evt,
      data: {
        modes: Array<{ id: string; name: string; prompt: string; isDefault: boolean }>
        activeModeId: string
      }
    ) => {
      const settings = settingsService.loadSettings()
      settings.smartTranscriptionModes = data.modes
      settings.activeSmartTranscriptionModeId = data.activeModeId
      settingsService.saveSettings(settings)
      console.log('[Settings] Synced smart transcription modes:', data.modes.length, 'modes')
    }
  )

  ipcMain.handle('settings:get-smart-transcription-modes', async () => {
    const settings = settingsService.loadSettings()
    return {
      modes: settings.smartTranscriptionModes || [],
      activeModeId: settings.activeSmartTranscriptionModeId || 'default'
    }
  })

  ipcMain.handle('settings:set-active-smart-transcription-mode', async (_evt, modeId: string) => {
    const settings = settingsService.loadSettings()
    settings.activeSmartTranscriptionModeId = modeId
    settingsService.saveSettings(settings)
    console.log('[Settings] Set active smart transcription mode:', modeId)
  })

  ipcMain.handle('settings:get-analytics-token', async (): Promise<string | null> => {
    if (!settingsService.analyticsConsentEnabled) return null
    return keyCacheService.getKey('mixpanel')
  })

  ipcMain.handle('settings:update-recording-storage', (_evt, enabled: boolean) => {
    settingsService.recordingStorageEnabled = enabled
    settingsService.persistCurrentSettings()
    console.log('[Settings] Recording storage enabled:', enabled)
  })

  ipcMain.handle('settings:update-recording-retention', (_evt, retention: '24h' | '7d' | '30d') => {
    settingsService.recordingStorageRetention = retention
    settingsService.persistCurrentSettings()
    console.log('[Settings] Recording storage retention:', retention)
  })

  ipcMain.handle('settings:update-show-panels-on-startup', (_evt, enabled: boolean) => {
    settingsService.showPanelsOnStartup = enabled
    const existing = settingsService.loadSettings()
    settingsService.saveSettings({ ...existing, showPanelsOnStartup: enabled })
    console.log('[Settings] Show panels on startup:', enabled)
  })

  ipcMain.handle(
    'settings:broadcast-changed',
    (event, payload: { key: string; value: unknown }) => {
      if (payload.key === 'chatToolPermissionMode') {
        windowManager.broadcastToAllWindows('settings:changed', {
          key: 'chatToolPermissionMode',
          value: settingsService.chatToolPermissionMode
        })
        return
      }
      if (payload.key === 'showPanelsOnStartup' && typeof payload.value === 'boolean') {
        settingsService.showPanelsOnStartup = payload.value
        const existing = settingsService.loadSettings()
        settingsService.saveSettings({
          ...existing,
          showPanelsOnStartup: payload.value
        })
        // Preference only affects the next launch — do not close the settings window
        // or hide panels while the user is still configuring the app.
      }
      if (payload.key === 'analyticsConsentEnabled' && typeof payload.value === 'boolean') {
        if (getTrustedIpcWindowRole(event.sender) !== 'main') return
        settingsService.analyticsConsentEnabled = payload.value
        const existing = settingsService.loadSettings()
        settingsService.saveSettings({
          ...existing,
          analyticsConsentEnabled: payload.value
        })
      }
      windowManager.broadcastToAllWindows('settings:changed', payload)
    }
  )
}

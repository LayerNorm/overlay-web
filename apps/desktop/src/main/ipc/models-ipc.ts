import { app, shell } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import { join } from 'path'
import { settingsService } from '../services/settings-service'
import { modelDownloadService } from '../services/model-download-service'
import { whisperKitService } from '../services/whisperkit-service'
import { parakeetService } from '../services/parakeet-service'
import { windowManager } from '../services/window-manager'

const getLocalService = (modelId: string): typeof parakeetService | typeof whisperKitService => {
  if (modelId.startsWith('parakeet_')) {
    return parakeetService
  }
  return whisperKitService
}

export function registerModelsIPC(): void {
  ipcMain.handle('models:get-installed', async () => {
    try {
      // Get downloaded models only - no bundled models
      const installedModels = await modelDownloadService.getInstalledModels()
      const parakeetModels = await modelDownloadService.getInstalledParakeetModels()
      const merged = Array.from(new Set([...installedModels, ...parakeetModels]))
      return merged
    } catch (error) {
      console.error('[Models] Failed to get installed models:', error)
      return [] // Return empty if no models installed
    }
  })

  ipcMain.handle('models:download', async (_evt, modelId: string) => {
    try {
      console.log('[Models] Starting download for:', modelId)

      // Register progress callback
      const mainWindow = windowManager.findWindowByType('main')
      if (mainWindow) {
        modelDownloadService.onProgress(modelId, (progress) => {
          mainWindow.webContents.send('models:download-progress', progress)
        })
      }

      // Route to appropriate download method
      if (modelId.startsWith('parakeet_')) {
        await modelDownloadService.downloadParakeetModel(modelId as 'parakeet_v2' | 'parakeet_v3')
      } else {
        await modelDownloadService.downloadModel(modelId)
      }

      // Cleanup progress callback
      modelDownloadService.offProgress(modelId)

      console.log('[Models] Download completed:', modelId)
    } catch (error) {
      console.error('[Models] Download failed:', error)
      modelDownloadService.offProgress(modelId)
      throw error
    }
  })

  ipcMain.handle('models:delete', async (_evt, modelId: string) => {
    try {
      console.log('[Models] Deleting model:', modelId)
      if (modelId.startsWith('parakeet_')) {
        await modelDownloadService.deleteParakeetModel(modelId as 'parakeet_v2' | 'parakeet_v3')
      } else {
        await modelDownloadService.deleteModel(modelId)
      }
      console.log('[Models] Model deleted:', modelId)
    } catch (error) {
      console.error('[Models] Delete failed:', error)
      throw error
    }
  })

  ipcMain.handle('models:switch', async (_evt, modelId: string) => {
    // Start the switch in the background, don't wait for it
    console.log('[Models] Starting background switch to model:', modelId)

    const previousModelId = settingsService.selectedModelId
    // Update and persist selected model
    settingsService.selectedModelId = modelId
    settingsService.persistCurrentSettings()
    console.log('[Models] Persisted model selection:', settingsService.selectedModelId)

    const targetService = getLocalService(modelId)
    const previousService = getLocalService(previousModelId)

    const isParakeetTarget = modelId.startsWith('parakeet_')

    // When switching to Parakeet, stop ALL non-base WhisperKit servers first
    if (isParakeetTarget) {
      console.log('[Models] Switching to Parakeet - stopping all non-base WhisperKit servers')
      whisperKitService.stopAllExceptBase()
    }

    // Fire and forget - the switch will happen in the background
    targetService
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .switchModel(modelId as any)
      .then(() => {
        console.log('[Models] Background model switch completed successfully')

        // Stop previous service if switching between different service types
        if (previousService !== targetService) {
          try {
            previousService.stopServer()
          } catch (err) {
            console.error('[Models] Failed to stop previous model service:', err)
          }
        }
      })
      .catch((error) => {
        console.error('[Models] Background switch failed:', error)
        // Server will fall back to Groq cloud model during this time
      })

    // Return immediately so UI isn't blocked
    return Promise.resolve()
  })

  ipcMain.handle('models:get-info', async (_evt, modelId: string) => {
    if (modelId.startsWith('parakeet_')) {
      const sizeEstimateMb = 600
      const basePath = app.isPackaged
        ? join(process.resourcesPath, 'parakeet', 'Models')
        : join(process.cwd(), 'ParakeetServer', 'Models')
      const folder =
        modelId === 'parakeet_v2' ? 'parakeet-tdt-0.6b-v2-coreml' : 'parakeet-tdt-0.6b-v3-coreml'
      return {
        id: modelId,
        name: modelId === 'parakeet_v2' ? 'Parakeet v2 (English)' : 'Parakeet v3 (Multilingual)',
        size: sizeEstimateMb * 1024 * 1024,
        sizeFormatted: `${sizeEstimateMb} MB`,
        downloaded: true,
        path: join(basePath, folder)
      }
    }
    try {
      const info = await modelDownloadService.getModelInfo(modelId)
      return info
    } catch (error) {
      console.error('[Models] Failed to get model info:', error)
      throw error
    }
  })

  ipcMain.handle('models:get-current', async () => {
    return settingsService.selectedModelId
  })

  ipcMain.handle('models:open-folder', async () => {
    try {
      const modelsPath = modelDownloadService.getModelsBasePath()
      console.log('[Models] Opening models folder:', modelsPath)
      await shell.openPath(modelsPath)
    } catch (error) {
      console.error('[Models] Failed to open models folder:', error)
      throw error
    }
  })

  ipcMain.handle('platform:get-info', () => {
    return {
      platform: process.platform,
      arch: process.arch
    }
  })
}

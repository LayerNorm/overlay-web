import { autoUpdater, UpdateInfo } from 'electron-updater'
import { app, BrowserWindow } from 'electron'
import { ipcMain } from './security/secure-ipc-main'
import log from 'electron-log'
import { isAllowedStableUpgrade } from './auto-updater-policy'

// Configure logging
autoUpdater.logger = log
log.transports.file.level = 'info'

// Check interval: 10 minutes
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000
function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'Update operation failed'
}

class AutoUpdaterService {
  private mainWindow: BrowserWindow | null = null
  private updateAvailable = false
  private updateDownloaded = false
  private latestVersion: string | null = null
  private updateDismissed = false
  private checkIntervalId: NodeJS.Timeout | null = null

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow

    // Configure auto-updater
    // Only a validated stable upgrade is downloaded. Installation remains an
    // explicit user action.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false
    autoUpdater.channel = 'latest'

    // Set up event handlers
    this.setupEventHandlers()

    // Register IPC handlers
    this.registerIpcHandlers()

    // Check for updates after a short delay on startup
    setTimeout(() => {
      this.checkForUpdates()
    }, 3000)

    // Set up periodic update checks every 10 minutes
    this.checkIntervalId = setInterval(() => {
      log.info('[AutoUpdater] Periodic update check')
      this.checkForUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)
  }

  private setupEventHandlers(): void {
    autoUpdater.on('checking-for-update', () => {
      log.info('[AutoUpdater] Checking for updates...')
      this.sendStatusToWindow('checking-for-update')
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      if (!isAllowedStableUpgrade(app.getVersion(), info.version)) {
        log.warn('[AutoUpdater] Rejected non-stable or non-increasing update metadata')
        this.sendStatusToWindow('error', { message: 'The update metadata was rejected.' })
        return
      }
      log.info('[AutoUpdater] Valid stable update is available')
      this.updateAvailable = true
      // Reset dismissed state when a NEW version is detected
      // (handles case where user dismissed v1.1 but v1.2 is now available)
      if (this.latestVersion !== info.version) {
        this.updateDismissed = false
      }
      this.latestVersion = info.version
      this.sendStatusToWindow('update-available', { version: info.version })
      void autoUpdater.downloadUpdate().catch((error) => {
        const message = safeErrorMessage(error)
        log.error('[AutoUpdater] Validated update download failed:', message)
        this.sendStatusToWindow('error', { message })
      })
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      log.info('[AutoUpdater] No update available. Current version:', info.version)
      this.sendStatusToWindow('update-not-available', { version: info.version })
    })

    autoUpdater.on('download-progress', (progress) => {
      const message = `Download speed: ${Math.round(progress.bytesPerSecond / 1024)} KB/s - ${Math.round(progress.percent)}%`
      log.info('[AutoUpdater]', message)
      this.sendStatusToWindow('download-progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      log.info('[AutoUpdater] Update downloaded:', info.version)
      this.updateDownloaded = true
      this.latestVersion = info.version
      this.sendStatusToWindow('update-downloaded', { version: info.version })
    })

    autoUpdater.on('error', (error) => {
      const message = safeErrorMessage(error)
      log.error('[AutoUpdater] Error:', message)
      this.sendStatusToWindow('error', { message })
    })
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('updater:check-for-updates', async () => {
      return this.checkForUpdates()
    })

    ipcMain.handle('updater:quit-and-install', async () => {
      if (this.updateDownloaded) {
        autoUpdater.quitAndInstall()
      }
    })

    ipcMain.handle('updater:get-current-version', async () => {
      return app.getVersion()
    })

    ipcMain.handle('updater:get-status', async () => {
      return {
        updateAvailable: this.updateAvailable,
        updateDownloaded: this.updateDownloaded,
        latestVersion: this.latestVersion,
        updateDismissed: this.updateDismissed
      }
    })

    ipcMain.handle('updater:dismiss-update', async () => {
      log.info('[AutoUpdater] User dismissed update notification')
      this.updateDismissed = true
      return { success: true }
    })
  }

  private sendStatusToWindow(status: string, data?: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('updater:status', { status, data })
    }
  }

  async checkForUpdates(): Promise<void> {
    try {
      log.info('[AutoUpdater] Checking for updates')
      await autoUpdater.checkForUpdates()
    } catch (error) {
      log.error('[AutoUpdater] Error checking for updates:', safeErrorMessage(error))
    }
  }

  // Check if update notification should be shown (not dismissed)
  shouldShowUpdateNotification(): boolean {
    return this.updateDownloaded && !this.updateDismissed
  }

  // Clean up interval on app quit
  cleanup(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId)
      this.checkIntervalId = null
    }
  }
}

export const autoUpdaterService = new AutoUpdaterService()

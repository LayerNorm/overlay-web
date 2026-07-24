import { ipcMain } from '../services/security/secure-ipc-main'

import { windowManager } from '../services/window-manager'
import { systemUtils } from '../services/system-utils'
import { settingsService } from '../services/settings-service'
import { NotificationData } from '../types'

interface RendererSettings {
  showNotifications?: boolean
  notificationSound?: boolean
}

function getRendererSettings(): RendererSettings {
  // The notification settings are stored in the renderer's localStorage
  // We need to load them from the settings file that gets synced
  const settings = settingsService.loadSettings() as RendererSettings
  return settings
}

export function registerNotificationIPC(): void {
  // Show a notification
  ipcMain.handle(
    'notification:show',
    async (_evt, data: NotificationData): Promise<{ success: boolean; error?: string }> => {
      try {
        const settings = getRendererSettings()
        if (settings.showNotifications === false) {
          return { success: false, error: 'Notifications disabled' }
        }

        if (settings.notificationSound !== false) {
          systemUtils.playSound('bing.mp3', 0.3, true)
        }

        const notifWindow = windowManager.createNotificationWindow()

        if (notifWindow.webContents.isLoading()) {
          await new Promise<void>((resolve) => {
            notifWindow.webContents.once('did-finish-load', () => resolve())
          })
        }

        notifWindow.webContents.send('notification:new', data)
        return { success: true }
      } catch (error) {
        console.error('[Notification IPC] Failed to show notification:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  // Dismiss a notification
  ipcMain.handle('notification:dismiss', async (_evt, id: string): Promise<{ success: boolean }> => {
    console.log('[Notification IPC] Dismissed:', id)
    return { success: true }
  })

  // Close notification window
  ipcMain.handle('notification:close-window', async (): Promise<{ success: boolean }> => {
    windowManager.closeNotificationWindow()
    return { success: true }
  })
}

// Helper function to show notification from main process code
export async function showNotification(data: NotificationData): Promise<void> {
  try {
    const settings = getRendererSettings()
    if (settings.showNotifications === false) {
      return
    }

    if (settings.notificationSound !== false) {
      systemUtils.playSound('bing.mp3', 0.3, true)
    }

    const notifWindow = windowManager.createNotificationWindow()

    if (notifWindow.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        notifWindow.webContents.once('did-finish-load', () => resolve())
      })
    }

    notifWindow.webContents.send('notification:new', data)
  } catch (error) {
    console.error('[Notification] Failed to show notification:', error)
  }
}

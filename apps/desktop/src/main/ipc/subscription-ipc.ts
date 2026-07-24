/**
 * Subscription IPC Handlers
 *
 * Bridge between renderer and subscription service
 * Handles entitlement queries and usage recording
 */

import { BrowserWindow, app } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import {
  subscriptionService,
  UserEntitlements,
  ActionCheckResult
} from '../services/subscription-service'
import { validateSender } from '../utils/ipc-security'

// Check if running in development mode
const ENABLE_LOCAL_BILLING_TESTS =
  !app.isPackaged &&
  process.env.OVERLAY_ENABLE_LOCAL_BILLING_TESTS === '1' &&
  /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(
    process.env.APP_SERVER_URL?.trim() || 'http://localhost:3000'
  )

// Broadcast entitlement updates to all renderer windows
function broadcastEntitlements(entitlements: UserEntitlements | null): void {
  if (!entitlements) return
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('subscription:updated', entitlements)
    }
  })
}

export function registerSubscriptionIPC(): void {
  // Get current entitlements
  ipcMain.handle('subscription:get-entitlements', async (event): Promise<UserEntitlements | null> => {
    validateSender(event, 'subscription:get-entitlements')
    return subscriptionService.getEntitlements()
  })

  // Check if action is allowed (pre-request check)
  ipcMain.handle(
    'subscription:can-perform',
    async (
      event,
      { type, modelId }: { type: 'ask' | 'write' | 'agent'; modelId: string }
    ): Promise<ActionCheckResult> => {
      validateSender(event, 'subscription:can-perform')
      return subscriptionService.canPerformAction(type, modelId)
    }
  )

  // Check if local transcription is allowed
  ipcMain.handle('subscription:can-use-local-transcription', async (): Promise<boolean> => {
    return subscriptionService.canUseLocalTranscription()
  })

  // Get remaining credits
  ipcMain.handle('subscription:get-credits-remaining', async (): Promise<number> => {
    return subscriptionService.getCreditsRemaining()
  })

  // Force refresh entitlements from server
  ipcMain.handle('subscription:refresh', async (): Promise<UserEntitlements | null> => {
    await subscriptionService.refresh()
    return subscriptionService.getEntitlements()
  })

  // Dev-only handlers: only registered when running in development mode
  if (ENABLE_LOCAL_BILLING_TESTS) {
    ipcMain.handle(
      'subscription:dev-set-tier',
      async (
        _event,
        { tier }: { tier: 'free' | 'pro' | 'max' }
      ): Promise<UserEntitlements | null> => {
        subscriptionService.setDevTierOverride(tier)
        const entitlements = subscriptionService.getEntitlements()
        broadcastEntitlements(entitlements)
        return entitlements
      }
    )

    ipcMain.handle('subscription:dev-reset-usage', async (): Promise<UserEntitlements | null> => {
      subscriptionService.resetUsageForTesting()
      const entitlements = subscriptionService.getEntitlements()
      broadcastEntitlements(entitlements)
      return entitlements
    })

    ipcMain.handle(
      'subscription:dev-set-state',
      async (_event, state: Partial<UserEntitlements>): Promise<UserEntitlements | null> => {
        subscriptionService.setDevStateOverride(state)
        const entitlements = subscriptionService.getEntitlements()
        broadcastEntitlements(entitlements)
        return entitlements
      }
    )
  }

  console.log('[SubscriptionIPC] Registered subscription handlers')
}

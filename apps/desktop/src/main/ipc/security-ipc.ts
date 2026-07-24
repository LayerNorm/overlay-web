import { ipcMain } from '../services/security/secure-ipc-main'
// Security IPC Handlers
// Handles safe storage, audit logging, and security-related IPC calls


import { safeStorageService } from '../services/security/safe-storage-service'
import type { AuthSession, AuthSessionMetadata } from '../services/security/safe-storage-service'
import { usageTrackingService } from '../services/security/usage-tracking-service'
import { validateSender } from '../utils/ipc-security'

export function registerSecurityIpcHandlers(): void {
  // ── Safe Storage Handlers ───────────────────────────────────────────────────

  // Renderers receive only a non-sensitive identity summary. Access and refresh
  // tokens are confined to the main process and OS-protected storage.
  ipcMain.handle(
    'security:get-auth-state',
    async (event): Promise<{ session: AuthSessionMetadata | null; error?: string }> => {
      validateSender(event, 'security:get-auth-state')
      try {
        return { session: safeStorageService.getAuthSessionMetadata() }
      } catch {
        console.error('[SecurityIPC] Failed to get auth state')
        return { session: null, error: 'auth_state_unavailable' }
      }
    }
  )

  // Check if safe storage encryption is available
  ipcMain.handle('security:is-encryption-available', async (): Promise<boolean> => {
    return safeStorageService.isEncryptionAvailable()
  })

  // Read-only local presentation data. Usage mutation is recorded only by the
  // trusted provider execution path or Overlay Server.
  ipcMain.handle('security:get-usage-stats', async () => {
    return usageTrackingService.getUsageStats()
  })

  console.log('[SecurityIPC] Registered security IPC handlers')
}

// Initialize security services when auth is loaded from storage on app start
export async function initializeSecurityFromStoredSession(): Promise<AuthSession | null> {
  const session = safeStorageService.getAuthSession()

  if (session) {
    usageTrackingService.setCredentials(session.accessToken, session.user.id)
    console.log('[SecurityIPC] Initialized security from stored session')
  }

  return session
}

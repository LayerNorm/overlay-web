import { app, safeStorage } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { auditLogger } from './security-service'

const STORAGE_DIR = 'secure-storage'
const AUTH_TOKEN_FILE = 'auth-session.enc'
const STORAGE_FORMAT = Buffer.from('OVERLAY_SAFE_STORAGE_V1\n', 'utf8')
const MAX_ENCRYPTED_VALUE_BYTES = 2 * 1024 * 1024
const MAX_TOKEN_CHARS = 64 * 1024

interface AuthSession {
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    firstName?: string
    lastName?: string
    profilePictureUrl?: string
  }
  expiresAt?: number
}

export interface AuthSessionMetadata {
  authenticated: true
  expiresAt?: number
  user: AuthSession['user']
}

class SafeStorageService {
  private readonly storagePath: string

  constructor() {
    this.storagePath = join(app.getPath('userData'), STORAGE_DIR)
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true, mode: 0o700 })
    }
    chmodSync(this.storagePath, 0o700)
  }

  storeAuthSession(session: AuthSession): boolean {
    if (!isValidAuthSession(session)) {
      console.error('[SafeStorage] Refused invalid auth session')
      return false
    }
    try {
      this.writeEncrypted(this.getAuthSessionFilePath(), JSON.stringify(session))
      auditLogger.log({
        type: 'auth:token_access',
        action: 'Auth session stored with operating-system protection',
        userId: session.user.id,
        success: true
      })
      return true
    } catch (error) {
      console.error('[SafeStorage] Failed to store auth session:', safeErrorCode(error))
      auditLogger.log({
        type: 'auth:token_access',
        action: 'Failed to store auth session with operating-system protection',
        details: { error: safeErrorCode(error) },
        success: false
      })
      return false
    }
  }

  getAuthSession(): AuthSession | null {
    const filePath = this.getAuthSessionFilePath()
    if (!existsSync(filePath)) return null

    try {
      const session = JSON.parse(this.readEncrypted(filePath)) as unknown
      if (!isValidAuthSession(session)) throw new Error('invalid_auth_session')
      return session
    } catch (error) {
      const errorCode = safeErrorCode(error)
      console.error('[SafeStorage] Failed to retrieve auth session:', errorCode)
      const isTemporaryOsProtectionFailure = errorCode === 'os_encryption_unavailable'
      if (!isTemporaryOsProtectionFailure) {
        this.clearUnreadableAuthSession(filePath)
      }
      auditLogger.log({
        type: 'auth:token_access',
        action: isTemporaryOsProtectionFailure
          ? 'Operating-system auth protection was temporarily unavailable'
          : 'Rejected unreadable or legacy auth session',
        details: { error: errorCode },
        success: false
      })
      return null
    }
  }

  getAuthSessionMetadata(): AuthSessionMetadata | null {
    const session = this.getAuthSession()
    if (!session) return null
    return {
      authenticated: true,
      ...(typeof session.expiresAt === 'number' ? { expiresAt: session.expiresAt } : {}),
      user: { ...session.user }
    }
  }

  clearAuthSession(): boolean {
    try {
      this.deleteFile(this.getAuthSessionFilePath())
      auditLogger.log({
        type: 'auth:logout',
        action: 'Auth session cleared',
        success: true
      })
      return true
    } catch (error) {
      console.error('[SafeStorage] Failed to clear auth session:', safeErrorCode(error))
      return false
    }
  }

  storeSecureValue(key: string, value: string): boolean {
    if (!isValidStorageKey(key) || typeof value !== 'string' || value.length > MAX_TOKEN_CHARS) {
      return false
    }
    try {
      this.writeEncrypted(join(this.storagePath, `${key}.enc`), value)
      return true
    } catch (error) {
      console.error(`[SafeStorage] Failed to store ${key}:`, safeErrorCode(error))
      return false
    }
  }

  getSecureValue(key: string): string | null {
    if (!isValidStorageKey(key)) return null
    const filePath = join(this.storagePath, `${key}.enc`)
    if (!existsSync(filePath)) return null
    try {
      return this.readEncrypted(filePath)
    } catch (error) {
      console.error(`[SafeStorage] Failed to retrieve ${key}:`, safeErrorCode(error))
      this.deleteFile(filePath)
      return null
    }
  }

  deleteSecureValue(key: string): boolean {
    if (!isValidStorageKey(key)) return false
    try {
      this.deleteFile(join(this.storagePath, `${key}.enc`))
      return true
    } catch (error) {
      console.error(`[SafeStorage] Failed to delete ${key}:`, safeErrorCode(error))
      return false
    }
  }

  isEncryptionAvailable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'linux') {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text'
    }
    return true
  }

  private getAuthSessionFilePath(): string {
    return join(this.storagePath, AUTH_TOKEN_FILE)
  }

  private writeEncrypted(filePath: string, value: string): void {
    if (!this.isEncryptionAvailable()) {
      throw new Error('os_encryption_unavailable')
    }
    const encrypted = safeStorage.encryptString(value)
    if (encrypted.byteLength > MAX_ENCRYPTED_VALUE_BYTES) {
      throw new Error('encrypted_value_too_large')
    }
    writeFileSync(filePath, Buffer.concat([STORAGE_FORMAT, encrypted]), {
      flag: 'w',
      mode: 0o600
    })
    chmodSync(filePath, 0o600)
  }

  private readEncrypted(filePath: string): string {
    if (!this.isEncryptionAvailable()) {
      throw new Error('os_encryption_unavailable')
    }
    const payload = readFileSync(filePath)
    if (payload.byteLength > MAX_ENCRYPTED_VALUE_BYTES) {
      throw new Error('encrypted_value_too_large')
    }
    if (
      payload.byteLength <= STORAGE_FORMAT.byteLength ||
      !payload.subarray(0, STORAGE_FORMAT.byteLength).equals(STORAGE_FORMAT)
    ) {
      // Phase 2 migration: predictable AES storage is never decrypted or retained.
      throw new Error('legacy_insecure_storage_rejected')
    }
    return safeStorage.decryptString(payload.subarray(STORAGE_FORMAT.byteLength))
  }

  private deleteFile(filePath: string): void {
    if (existsSync(filePath)) unlinkSync(filePath)
  }

  private clearUnreadableAuthSession(filePath: string): void {
    try {
      this.deleteFile(filePath)
      console.warn('[SafeStorage] Cleared unreadable auth session')
    } catch (cleanupError) {
      console.error(
        '[SafeStorage] Failed to clear unreadable auth session:',
        safeErrorCode(cleanupError)
      )
    }
  }
}

function isValidStorageKey(key: string): boolean {
  return Boolean(key && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(key))
}

function isValidAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<AuthSession>
  const user = session.user
  return Boolean(
    typeof session.accessToken === 'string' &&
    session.accessToken.length > 0 &&
    session.accessToken.length <= MAX_TOKEN_CHARS &&
    typeof session.refreshToken === 'string' &&
    session.refreshToken.length > 0 &&
    session.refreshToken.length <= MAX_TOKEN_CHARS &&
    user &&
    typeof user.id === 'string' &&
    user.id.length >= 5 &&
    user.id.length <= 512 &&
    typeof user.email === 'string' &&
    user.email.length > 2 &&
    user.email.length <= 1024 &&
    (session.expiresAt === undefined || Number.isFinite(session.expiresAt))
  )
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown_error'
  if (/^[a-z0-9_:-]{1,120}$/i.test(error.message)) return error.message
  return error.name || 'storage_error'
}

export const safeStorageService = new SafeStorageService()

export type { AuthSession }

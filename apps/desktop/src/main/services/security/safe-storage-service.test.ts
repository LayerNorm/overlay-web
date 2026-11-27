import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  encryptionAvailable: true,
  userData: `/tmp/overlay-safe-storage-test-${process.pid}`
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryptionAvailable,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (value: string) => Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5),
    decryptString: (value: Buffer) => Buffer.from(value.map((byte) => byte ^ 0xa5)).toString('utf8')
  }
}))

vi.mock('./security-service', () => ({
  auditLogger: { log: vi.fn() }
}))

type SafeStorageModule = typeof import('./safe-storage-service')
let storage: SafeStorageModule['safeStorageService']
const secureDirectory = path.join(mocks.userData, 'secure-storage')
const authFile = path.join(secureDirectory, 'auth-session.enc')

describe('OS-protected auth storage', () => {
  beforeAll(async () => {
    rmSync(mocks.userData, { recursive: true, force: true })
    mkdirSync(mocks.userData, { recursive: true, mode: 0o700 })
    storage = (await import('./safe-storage-service')).safeStorageService
  })

  beforeEach(() => {
    mocks.encryptionAvailable = true
    storage.clearAuthSession()
    storage.deleteSecureValue('fixture')
  })

  afterAll(() => {
    rmSync(mocks.userData, { recursive: true, force: true })
  })

  it('stores tokens encrypted with owner-only permissions and returns only metadata', () => {
    const session = {
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
      user: { id: 'user_12345', email: 'user@example.com' }
    }
    expect(storage.storeAuthSession(session)).toBe(true)
    const payload = readFileSync(authFile)
    expect(payload.includes(Buffer.from(session.accessToken))).toBe(false)
    expect(statSync(authFile).mode & 0o777).toBe(0o600)
    expect(statSync(secureDirectory).mode & 0o777).toBe(0o700)
    expect(storage.getAuthSession()).toEqual(session)
    expect(storage.getAuthSessionMetadata()).toEqual({
      authenticated: true,
      user: session.user
    })
    expect(storage.getAuthSessionMetadata()).not.toHaveProperty('accessToken')
    expect(storage.getAuthSessionMetadata()).not.toHaveProperty('refreshToken')
  })

  it('deletes legacy plaintext, malformed, or unreadable auth state', () => {
    writeFileSync(authFile, JSON.stringify({ accessToken: 'legacy-plaintext' }), {
      mode: 0o600
    })
    expect(storage.getAuthSession()).toBeNull()
    expect(existsSync(authFile)).toBe(false)

    expect(
      storage.storeAuthSession({
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 'user_12345', email: 'user@example.com' }
      })
    ).toBe(true)
    const encrypted = readFileSync(authFile)
    encrypted[Buffer.byteLength('OVERLAY_SAFE_STORAGE_V1\n')] ^= 0xff
    writeFileSync(authFile, encrypted)
    expect(storage.getAuthSession()).toBeNull()
    expect(existsSync(authFile)).toBe(false)
  })

  it('fails closed instead of writing plaintext when OS encryption is unavailable', () => {
    mocks.encryptionAvailable = false
    expect(
      storage.storeAuthSession({
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 'user_12345', email: 'user@example.com' }
      })
    ).toBe(false)
    expect(storage.storeSecureValue('fixture', 'secret')).toBe(false)
    expect(existsSync(authFile)).toBe(false)
  })

  it('retains an encrypted session when OS protection is temporarily unavailable', () => {
    expect(
      storage.storeAuthSession({
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 'user_12345', email: 'user@example.com' }
      })
    ).toBe(true)
    mocks.encryptionAvailable = false

    expect(storage.getAuthSession()).toBeNull()
    expect(existsSync(authFile)).toBe(true)
  })

  it('rejects traversal-shaped keys and retains owner-only mode after overwrite', () => {
    expect(storage.storeSecureValue('../fixture', 'secret')).toBe(false)
    expect(storage.storeSecureValue('fixture', 'first')).toBe(true)
    chmodSync(path.join(secureDirectory, 'fixture.enc'), 0o644)
    expect(storage.storeSecureValue('fixture', 'second')).toBe(true)
    expect(statSync(path.join(secureDirectory, 'fixture.enc')).mode & 0o777).toBe(0o600)
    expect(storage.getSecureValue('fixture')).toBe('second')
  })
})

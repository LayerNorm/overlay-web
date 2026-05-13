import { NativeModules, Platform } from 'react-native'
import { AUTH_BASE_URL } from './appConfig'
import { loadAuthSession } from './authService'

// SharedKeyStore is the existing native bridge (ios/SharedKeyStore.swift / .m).
// We extend it with extra methods for background voice. All methods are
// no-ops on Android until we add an Android implementation.
type SharedKeyStoreNative = {
  setGroqKey?: (key: string) => void
  clearGroqKey?: () => void
  setAuthSession?: (token: string, baseURL: string, userId: string) => void
  clearAuthSession?: () => void
  setBackgroundModeEnabled?: (enabled: boolean) => Promise<boolean> | void
  getBackgroundModeEnabled?: () => Promise<boolean>
  requestMicPermission?: () => Promise<'granted' | 'denied' | 'undetermined'>
  getMicPermission?: () => Promise<'granted' | 'denied' | 'undetermined'>
  getTranscriptionHistory?: () => Promise<VoiceTranscription[]>
  deleteTranscription?: (id: string) => Promise<boolean>
}

const NativeKeyStore: SharedKeyStoreNative =
  (NativeModules.SharedKeyStore as SharedKeyStoreNative | undefined) ?? {}

export type VoicePermission = 'granted' | 'denied' | 'undetermined'

export type VoiceTranscription = {
  id: string
  text: string
  createdAt: string
}

export async function syncAuthSessionToAppGroup(): Promise<void> {
  if (Platform.OS !== 'ios') return
  try {
    const session = await loadAuthSession()
    if (session?.accessToken && session.user?.id && NativeKeyStore.setAuthSession) {
      NativeKeyStore.setAuthSession(session.accessToken, AUTH_BASE_URL, session.user.id)
    } else if (NativeKeyStore.clearAuthSession) {
      NativeKeyStore.clearAuthSession()
    }
  } catch (error) {
    console.warn('[Voice] syncAuthSessionToAppGroup failed', error)
  }
}

export async function clearVoiceAuthSessionFromAppGroup(): Promise<void> {
  if (Platform.OS !== 'ios' || !NativeKeyStore.clearAuthSession) return
  try {
    NativeKeyStore.clearAuthSession()
  } catch {
    // ignore native cleanup failures
  }
}

export async function getMicPermission(): Promise<VoicePermission> {
  if (Platform.OS !== 'ios' || !NativeKeyStore.getMicPermission) return 'undetermined'
  try {
    return await NativeKeyStore.getMicPermission()
  } catch {
    return 'undetermined'
  }
}

export async function requestMicPermission(): Promise<VoicePermission> {
  if (Platform.OS !== 'ios' || !NativeKeyStore.requestMicPermission) return 'denied'
  try {
    return await NativeKeyStore.requestMicPermission()
  } catch {
    return 'denied'
  }
}

export async function getBackgroundVoiceEnabled(): Promise<boolean> {
  if (Platform.OS !== 'ios' || !NativeKeyStore.getBackgroundModeEnabled) return false
  try {
    return await NativeKeyStore.getBackgroundModeEnabled()
  } catch {
    return false
  }
}

/**
 * Enable background voice. Requests mic permission first; returns the final
 * enabled state. If permission is denied, returns false.
 */
export async function enableBackgroundVoice(): Promise<{ enabled: boolean; permission: VoicePermission }> {
  await syncAuthSessionToAppGroup()
  const permission = await requestMicPermission()
  if (permission !== 'granted') {
    if (NativeKeyStore.setBackgroundModeEnabled) {
      await NativeKeyStore.setBackgroundModeEnabled(false)
    }
    return { enabled: false, permission }
  }
  if (NativeKeyStore.setBackgroundModeEnabled) {
    await NativeKeyStore.setBackgroundModeEnabled(true)
  }
  return { enabled: true, permission }
}

export async function disableBackgroundVoice(): Promise<void> {
  if (NativeKeyStore.setBackgroundModeEnabled) {
    await NativeKeyStore.setBackgroundModeEnabled(false)
  }
}

export async function getTranscriptionHistory(): Promise<VoiceTranscription[]> {
  if (Platform.OS !== 'ios' || !NativeKeyStore.getTranscriptionHistory) return []
  try {
    const history = await NativeKeyStore.getTranscriptionHistory()
    return Array.isArray(history) ? history : []
  } catch {
    return []
  }
}

export async function deleteTranscription(id: string): Promise<void> {
  if (Platform.OS !== 'ios' || !NativeKeyStore.deleteTranscription) return
  await NativeKeyStore.deleteTranscription(id)
}

export async function clearTranscriptionHistory(): Promise<void> {
  const history = await getTranscriptionHistory()
  await Promise.all(history.map((item) => deleteTranscription(item.id)))
}

export async function pruneTranscriptionHistory(retentionDays: number): Promise<void> {
  if (retentionDays <= 0) {
    await clearTranscriptionHistory()
    return
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const history = await getTranscriptionHistory()
  await Promise.all(
    history
      .filter((item) => {
        const createdAt = new Date(item.createdAt).getTime()
        return Number.isFinite(createdAt) && createdAt < cutoff
      })
      .map((item) => deleteTranscription(item.id)),
  )
}

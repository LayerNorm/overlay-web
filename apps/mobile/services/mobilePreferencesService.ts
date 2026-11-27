import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, Paths } from 'expo-file-system'

export type AppearanceMode = 'light' | 'dark' | 'auto'
export type StartDestination = 'last-used' | 'chat' | 'agents' | 'voice' | 'work' | 'files'
export type TranscriptionRetentionDays = 7 | 30 | 90 | 365 | 0

export interface MobilePreferences {
  appearanceMode: AppearanceMode
  hapticsEnabled: boolean
  startDestination: StartDestination
  transcriptionRetentionDays: TranscriptionRetentionDays
  showAdvancedDiagnostics: boolean
  notificationBannersEnabled: boolean
}

const MOBILE_PREFERENCES_KEY = 'overlay-mobile-preferences-v1'

export const DEFAULT_MOBILE_PREFERENCES: MobilePreferences = {
  appearanceMode: 'auto',
  hapticsEnabled: true,
  startDestination: 'last-used',
  transcriptionRetentionDays: 30,
  showAdvancedDiagnostics: false,
  notificationBannersEnabled: true,
}

type MobilePreferencesListener = (preferences: MobilePreferences) => void

const listeners = new Set<MobilePreferencesListener>()

function notify(preferences: MobilePreferences): void {
  listeners.forEach((listener) => listener(preferences))
}

function normalizePreferences(value: unknown): MobilePreferences {
  if (!value || typeof value !== 'object') return DEFAULT_MOBILE_PREFERENCES
  const candidate = value as Partial<MobilePreferences>

  return {
    appearanceMode:
      candidate.appearanceMode === 'light' ||
      candidate.appearanceMode === 'dark' ||
      candidate.appearanceMode === 'auto'
        ? candidate.appearanceMode
        : DEFAULT_MOBILE_PREFERENCES.appearanceMode,
    hapticsEnabled:
      typeof candidate.hapticsEnabled === 'boolean'
        ? candidate.hapticsEnabled
        : DEFAULT_MOBILE_PREFERENCES.hapticsEnabled,
    startDestination:
      candidate.startDestination === 'last-used' ||
      candidate.startDestination === 'chat' ||
      candidate.startDestination === 'agents' ||
      candidate.startDestination === 'voice' ||
      candidate.startDestination === 'work' ||
      candidate.startDestination === 'files'
        ? candidate.startDestination
        : DEFAULT_MOBILE_PREFERENCES.startDestination,
    transcriptionRetentionDays:
      candidate.transcriptionRetentionDays === 7 ||
      candidate.transcriptionRetentionDays === 30 ||
      candidate.transcriptionRetentionDays === 90 ||
      candidate.transcriptionRetentionDays === 365 ||
      candidate.transcriptionRetentionDays === 0
        ? candidate.transcriptionRetentionDays
        : DEFAULT_MOBILE_PREFERENCES.transcriptionRetentionDays,
    showAdvancedDiagnostics:
      typeof candidate.showAdvancedDiagnostics === 'boolean'
        ? candidate.showAdvancedDiagnostics
        : DEFAULT_MOBILE_PREFERENCES.showAdvancedDiagnostics,
    notificationBannersEnabled:
      typeof candidate.notificationBannersEnabled === 'boolean'
        ? candidate.notificationBannersEnabled
        : DEFAULT_MOBILE_PREFERENCES.notificationBannersEnabled,
  }
}

export function subscribeMobilePreferences(listener: MobilePreferencesListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function loadMobilePreferences(): Promise<MobilePreferences> {
  const raw = await AsyncStorage.getItem(MOBILE_PREFERENCES_KEY)
  if (!raw) return DEFAULT_MOBILE_PREFERENCES
  try {
    return normalizePreferences(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_MOBILE_PREFERENCES
  }
}

export async function updateMobilePreferences(
  patch: Partial<MobilePreferences>,
): Promise<MobilePreferences> {
  const current = await loadMobilePreferences()
  const next = normalizePreferences({ ...current, ...patch })
  await AsyncStorage.setItem(MOBILE_PREFERENCES_KEY, JSON.stringify(next))
  notify(next)
  return next
}

export async function resetMobilePreferences(): Promise<MobilePreferences> {
  await AsyncStorage.setItem(MOBILE_PREFERENCES_KEY, JSON.stringify(DEFAULT_MOBILE_PREFERENCES))
  notify(DEFAULT_MOBILE_PREFERENCES)
  return DEFAULT_MOBILE_PREFERENCES
}

export async function clearDownloadedFileCache(): Promise<void> {
  const directory = new Directory(Paths.cache, 'overlay-downloads')
  if (directory.exists) {
    directory.delete()
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from '@overlay/app-core'
import { appJson } from './appApi'
import { readNativeSettings } from './settingsNativeService'

const SETTINGS_CACHE_KEY = 'overlay-ui-settings'

export const DEFAULT_UI_SETTINGS: AppSettings = DEFAULT_APP_SETTINGS

type UiSettingsListener = (settings: AppSettings) => void

const uiSettingsListeners = new Set<UiSettingsListener>()

function notifyUiSettings(settings: AppSettings): void {
  uiSettingsListeners.forEach((listener) => listener(settings))
}

export function subscribeUiSettings(listener: UiSettingsListener): () => void {
  uiSettingsListeners.add(listener)
  return () => {
    uiSettingsListeners.delete(listener)
  }
}

export async function getUiSettings(): Promise<AppSettings> {
  const settings = await readNativeSettings()
  if (!settings) throw new Error('Settings are unavailable. Sign in again.')
  await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings))
  notifyUiSettings(settings)
  return settings
}

export async function updateUiSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const settings = await appJson<AppSettings>('/api/v1/settings', {
    method: 'PATCH',
    json: patch as Record<string, unknown>,
  })
  await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings))
  notifyUiSettings(settings)
  return settings
}

export async function loadCachedUiSettings(): Promise<AppSettings | null> {
  const cached = await AsyncStorage.getItem(SETTINGS_CACHE_KEY)
  if (!cached) return null
  try {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...(JSON.parse(cached) as Partial<AppSettings>),
    }
  } catch {
    return null
  }
}

export async function persistUiSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings))
  notifyUiSettings(settings)
}

export async function clearUiSettingsCache(): Promise<void> {
  await AsyncStorage.removeItem(SETTINGS_CACHE_KEY)
  notifyUiSettings(DEFAULT_APP_SETTINGS)
}

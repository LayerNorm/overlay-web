import AsyncStorage from '@react-native-async-storage/async-storage'
import { appJson } from './appApi'
import type { UiSettings } from './appContracts'

const SETTINGS_CACHE_KEY = 'overlay-ui-settings'

export const DEFAULT_UI_SETTINGS: UiSettings = {
  theme: 'light',
  useSecondarySidebar: false,
}

export async function getUiSettings(): Promise<UiSettings> {
  const settings = await appJson<UiSettings>('/api/app/settings')
  await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings))
  return settings
}

export async function updateUiSettings(
  patch: Partial<UiSettings>,
): Promise<UiSettings> {
  const settings = await appJson<UiSettings>('/api/app/settings', {
    method: 'PATCH',
    json: patch as Record<string, unknown>,
  })
  await AsyncStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings))
  return settings
}

export async function loadCachedUiSettings(): Promise<UiSettings | null> {
  const cached = await AsyncStorage.getItem(SETTINGS_CACHE_KEY)
  if (!cached) return null
  try {
    return JSON.parse(cached) as UiSettings
  } catch {
    return null
  }
}

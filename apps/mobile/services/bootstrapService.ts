import AsyncStorage from '@react-native-async-storage/async-storage'
import { appJson } from './appApi'
import type { AppBootstrap } from './appContracts'

const BOOTSTRAP_CACHE_KEY = 'overlay-app-bootstrap'

export async function getAppBootstrap(
  options: { forceRefresh?: boolean } = {},
): Promise<AppBootstrap> {
  if (!options.forceRefresh) {
    const cached = await AsyncStorage.getItem(BOOTSTRAP_CACHE_KEY)
    if (cached) {
      try {
        return JSON.parse(cached) as AppBootstrap
      } catch {
        // ignore bad cache
      }
    }
  }

  const bootstrap = await appJson<AppBootstrap>('/api/app/bootstrap')
  await AsyncStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(bootstrap))
  return bootstrap
}

export async function clearBootstrapCache(): Promise<void> {
  await AsyncStorage.removeItem(BOOTSTRAP_CACHE_KEY)
}

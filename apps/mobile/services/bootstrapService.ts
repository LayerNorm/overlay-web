import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AppBootstrap } from '@overlay/app-core'
import { appJson } from './appApi'

const BOOTSTRAP_CACHE_KEY = 'overlay-app-bootstrap'

let inMemoryBootstrap: AppBootstrap | null = null

export async function getAppBootstrap(
  options: { forceRefresh?: boolean } = {},
): Promise<AppBootstrap> {
  if (!options.forceRefresh) {
    if (inMemoryBootstrap) {
      return inMemoryBootstrap
    }

    const cached = await AsyncStorage.getItem(BOOTSTRAP_CACHE_KEY)
    if (cached) {
      try {
        inMemoryBootstrap = JSON.parse(cached) as AppBootstrap
        return inMemoryBootstrap
      } catch {
        // ignore bad cache
      }
    }
  }

  const bootstrap = await appJson<AppBootstrap>('/api/app/bootstrap')
  inMemoryBootstrap = bootstrap
  await AsyncStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(bootstrap))
  return bootstrap
}

export function getCachedBootstrap(): AppBootstrap | null {
  return inMemoryBootstrap
}

export async function setCachedBootstrap(bootstrap: AppBootstrap): Promise<void> {
  inMemoryBootstrap = bootstrap
  await AsyncStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(bootstrap))
}

export async function clearBootstrapCache(): Promise<void> {
  inMemoryBootstrap = null
  await AsyncStorage.removeItem(BOOTSTRAP_CACHE_KEY)
}

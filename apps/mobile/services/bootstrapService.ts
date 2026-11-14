import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AppBootstrap } from '@overlay/app-core'
import { mobileOverlayAppClient } from './overlayClient'

const BOOTSTRAP_CACHE_KEY = 'overlay-app-bootstrap-v2'

let inMemoryBootstrap: AppBootstrap | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStringFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof record[field] === 'string')
}

function isModelRecord(value: unknown): boolean {
  return isRecord(value) && hasStringFields(value, ['id', 'name', 'provider'])
}

function hasBootstrapReadinessShape(value: unknown): value is AppBootstrap {
  if (!isRecord(value)) return false

  const userIsValid = value.user === null ||
    (isRecord(value.user) && hasStringFields(value.user, ['id', 'email']))
  const entitlementsAreValid = value.entitlements === null ||
    (isRecord(value.entitlements) && typeof value.entitlements.tier === 'string')

  if (
    !userIsValid ||
    !entitlementsAreValid ||
    !isRecord(value.uiSettings) ||
    !Array.isArray(value.chatModels) || !value.chatModels.every(isModelRecord) ||
    !Array.isArray(value.imageModels) || !value.imageModels.every(isModelRecord) ||
    !Array.isArray(value.videoModels) || !value.videoModels.every(isModelRecord) ||
    !isRecord(value.featureFlags) ||
    !isRecord(value.capabilities) ||
    !Array.isArray(value.destinations)
  ) return false

  return true
}

function invalidBootstrapError(source: string): Error {
  return new Error(`Invalid app bootstrap ${source}`)
}

export async function getAppBootstrap(
  options: { forceRefresh?: boolean } = {},
): Promise<AppBootstrap> {
  if (inMemoryBootstrap !== null && !hasBootstrapReadinessShape(inMemoryBootstrap)) {
    inMemoryBootstrap = null
  }

  if (!options.forceRefresh) {
    if (inMemoryBootstrap) {
      return inMemoryBootstrap
    }

    const cached = await AsyncStorage.getItem(BOOTSTRAP_CACHE_KEY)
    if (cached !== null) {
      try {
        const parsed: unknown = JSON.parse(cached)
        if (hasBootstrapReadinessShape(parsed)) {
          inMemoryBootstrap = parsed
          return parsed
        }
      } catch {
        // Invalid cache entries are removed before fetching a fresh response.
      }
      await AsyncStorage.removeItem(BOOTSTRAP_CACHE_KEY)
    }
  }

  const bootstrap: unknown = await mobileOverlayAppClient.bootstrap.get()
  if (!hasBootstrapReadinessShape(bootstrap)) {
    throw invalidBootstrapError('response')
  }

  inMemoryBootstrap = bootstrap
  await AsyncStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(bootstrap))
  return bootstrap
}

export function getCachedBootstrap(): AppBootstrap | null {
  if (inMemoryBootstrap !== null && !hasBootstrapReadinessShape(inMemoryBootstrap)) {
    inMemoryBootstrap = null
  }
  return inMemoryBootstrap
}

export async function setCachedBootstrap(bootstrap: AppBootstrap): Promise<void> {
  if (!hasBootstrapReadinessShape(bootstrap)) {
    throw invalidBootstrapError('value')
  }

  inMemoryBootstrap = bootstrap
  await AsyncStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(bootstrap))
}

export async function clearBootstrapCache(): Promise<void> {
  inMemoryBootstrap = null
  await AsyncStorage.removeItem(BOOTSTRAP_CACHE_KEY)
}

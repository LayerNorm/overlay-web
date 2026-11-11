import { api, queryConvex, convexWorkspaceId } from './convexClient'
import { appJson, getRequestWorkspaceId } from './appApi'
import * as Crypto from 'expo-crypto'
import type { AppSettings } from '@overlay/app-core'
import { DEFAULT_APP_SETTINGS, isThemePresetId } from '@overlay/app-core'

const queryNativeSettings = () => queryConvex(api.platform.uiSettings.mine, {})
export function normalizeNativeSettings(
  value: NonNullable<Awaited<ReturnType<typeof queryNativeSettings>>>,
): AppSettings {
  return {
    ...value,
    lightThemePreset: isThemePresetId(value.lightThemePreset)
      ? value.lightThemePreset
      : DEFAULT_APP_SETTINGS.lightThemePreset,
    darkThemePreset: isThemePresetId(value.darkThemePreset)
      ? value.darkThemePreset
      : DEFAULT_APP_SETTINGS.darkThemePreset,
  }
}
export async function readNativeSettings() {
  const value = await queryNativeSettings()
  return value ? normalizeNativeSettings(value) : null
}
export const readMemories = () =>
  queryConvex(api.knowledge.memoryBrowse.list, { workspaceId: convexWorkspaceId() })
export const readMembers = (workspaceId: string) =>
  queryConvex(api.collaboration.management.view, { workspaceId, view: 'people' })
export const readBilling = (workspaceId: string) =>
  queryConvex(api.billing.browse.workspaceSummary, { workspaceId })
export const readProviders = () =>
  queryConvex(api.providers.browse.connections, { workspaceId: convexWorkspaceId() })
export async function saveAccountName(displayName: string) {
  if (!displayName.trim() || displayName.trim().length > 80)
    throw new Error('Enter a name of 1–80 characters.')
  return appJson('/api/v1/account/profile', {
    method: 'PATCH',
    workspaceId: getRequestWorkspaceId(),
    json: { displayName: displayName.trim() },
  })
}
export type SubscriptionAvailability = {
  available: boolean
  providers: { id: string; label: string; description: string; enabled: boolean }[]
  reason?: string
}
export type SubscriptionAuthorization = {
  connectionId: string
  authorization: {
    url: string
    userCode?: string
    expiresAt: number
    interval: number
    callbackRequired?: boolean
  }
}
export type SubscriptionProgress = {
  status: 'pending' | 'connected' | 'expired' | 'error'
  error?: string
  retryable?: boolean
}
export async function subscriptionRequest<T>(
  workspaceId: string,
  body?: Record<string, unknown>,
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  signal?: AbortSignal,
  idempotencyKey?: string,
): Promise<T> {
  if (getRequestWorkspaceId() !== workspaceId)
    throw new Error('Workspace changed. Reopen connections.')
  const result = await appJson<{ data: T }>('/api/v1/providers/subscriptions', {
    workspaceId,
    method: method ?? (body ? 'PATCH' : 'GET'),
    ...(body
      ? { json: body, headers: { 'Idempotency-Key': idempotencyKey ?? Crypto.randomUUID() } }
      : {}),
  })
  if (signal?.aborted || getRequestWorkspaceId() !== workspaceId)
    throw new Error('Connection request cancelled.')
  if (!result?.data) throw new Error('Could not reach subscription connections. Try again.')
  return result.data
}

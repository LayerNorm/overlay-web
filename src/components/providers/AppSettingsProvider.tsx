'use client'

import type { AppSettings, ThemePresetId } from '@overlay/app-core'
import { DEFAULT_APP_SETTINGS } from '@overlay/app-core'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getPresetCssVars, isThemePresetId } from '@/shared/app/themes'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useAuth } from '@/contexts/AuthContext'

export type { AppSettings, ChatStreamingMode, ThemePreference, ThemePresetId } from '@overlay/app-core'

type AppSettingsContextValue = {
  settings: AppSettings
  isLoading: boolean
  isSaving: boolean
  refresh: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)
const APP_SETTINGS_STORAGE_KEY = 'overlay.app.settings'
const MAX_MODEL_ID_LENGTH = 160
const MAX_ASK_MODEL_IDS = 4
const MAX_ENABLED_MODEL_IDS = 400
const MODEL_ID_PATTERN = /^[A-Za-z0-9._~:/@+-]+$/
const ASPECT_RATIO_PATTERN = /^\d{1,2}:\d{1,2}$/

function isValidPresetId(value: unknown): value is ThemePresetId {
  return isThemePresetId(value)
}

function isSafeModelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_MODEL_ID_LENGTH &&
    MODEL_ID_PATTERN.test(value)
  )
}

function isSafeAspectRatio(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 5 && ASPECT_RATIO_PATTERN.test(value)
}

function isAppSettingsPayload(value: unknown): value is Partial<AppSettings> {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AppSettings>
  if (candidate.theme !== undefined && candidate.theme !== 'light' && candidate.theme !== 'dark') return false
  if (candidate.lightThemePreset !== undefined && !isValidPresetId(candidate.lightThemePreset)) return false
  if (candidate.darkThemePreset !== undefined && !isValidPresetId(candidate.darkThemePreset)) return false
  if (
    candidate.chatStreamingMode !== undefined &&
    candidate.chatStreamingMode !== 'token' &&
    candidate.chatStreamingMode !== 'chunk'
  ) {
    return false
  }
  if (candidate.autoContinue !== undefined && typeof candidate.autoContinue !== 'boolean') return false
  if (
    candidate.defaultChatMode !== undefined &&
    candidate.defaultChatMode !== 'ask' &&
    candidate.defaultChatMode !== 'act'
  ) {
    return false
  }
  if (
    candidate.modelPreference !== undefined &&
    candidate.modelPreference !== 'same-for-each-chat' &&
    candidate.modelPreference !== 'different-for-each-chat'
  ) {
    return false
  }
  if (
    candidate.defaultAskModelIds !== undefined &&
    (!Array.isArray(candidate.defaultAskModelIds) ||
      candidate.defaultAskModelIds.length > MAX_ASK_MODEL_IDS ||
      !candidate.defaultAskModelIds.every(isSafeModelId))
  ) {
    return false
  }
  for (const key of [
    'defaultActModelId',
    'defaultImageModelId',
    'defaultVideoModelId',
  ] as const) {
    if (candidate[key] !== undefined && !isSafeModelId(candidate[key])) return false
  }
  for (const key of ['defaultImageAspectRatio', 'defaultVideoAspectRatio'] as const) {
    if (candidate[key] !== undefined && !isSafeAspectRatio(candidate[key])) return false
  }
  if (candidate.sendWithEnter !== undefined && typeof candidate.sendWithEnter !== 'boolean') return false
  if (
    candidate.attachFilesToKnowledgeByDefault !== undefined &&
    typeof candidate.attachFilesToKnowledgeByDefault !== 'boolean'
  ) {
    return false
  }
  if (candidate.onlyAllowZdrModels !== undefined && typeof candidate.onlyAllowZdrModels !== 'boolean') return false
  if (
    candidate.dismissedZdrWarningGlobally !== undefined &&
    typeof candidate.dismissedZdrWarningGlobally !== 'boolean'
  ) {
    return false
  }
  if (
    candidate.dismissedZdrWarningModelIds !== undefined &&
    (!Array.isArray(candidate.dismissedZdrWarningModelIds) ||
      candidate.dismissedZdrWarningModelIds.length > 100 ||
      !candidate.dismissedZdrWarningModelIds.every(isSafeModelId))
  ) {
    return false
  }
  if (
    candidate.enabledChatModelIds !== undefined &&
    (!Array.isArray(candidate.enabledChatModelIds) ||
      candidate.enabledChatModelIds.length > MAX_ENABLED_MODEL_IDS ||
      !candidate.enabledChatModelIds.every(isSafeModelId))
  ) {
    return false
  }
  if (
    candidate.modelOrder !== undefined &&
    (!Array.isArray(candidate.modelOrder) ||
      candidate.modelOrder.length > MAX_ENABLED_MODEL_IDS ||
      !candidate.modelOrder.every(isSafeModelId))
  ) {
    return false
  }
  return (
    typeof candidate.theme === 'string' ||
    typeof candidate.lightThemePreset === 'string' ||
    typeof candidate.darkThemePreset === 'string' ||
    typeof candidate.chatStreamingMode === 'string' ||
    typeof candidate.autoContinue === 'boolean' ||
    typeof candidate.defaultChatMode === 'string' ||
    typeof candidate.modelPreference === 'string' ||
    Array.isArray(candidate.defaultAskModelIds) ||
    typeof candidate.defaultActModelId === 'string' ||
    typeof candidate.defaultImageModelId === 'string' ||
    typeof candidate.defaultVideoModelId === 'string' ||
    typeof candidate.defaultImageAspectRatio === 'string' ||
    typeof candidate.defaultVideoAspectRatio === 'string' ||
    typeof candidate.sendWithEnter === 'boolean' ||
    typeof candidate.attachFilesToKnowledgeByDefault === 'boolean' ||
    typeof candidate.onlyAllowZdrModels === 'boolean' ||
    typeof candidate.dismissedZdrWarningGlobally === 'boolean' ||
    Array.isArray(candidate.dismissedZdrWarningModelIds) ||
    Array.isArray(candidate.enabledChatModelIds) ||
    Array.isArray(candidate.modelOrder)
  )
}

function coerceChatStreamingMode(settings: AppSettings): AppSettings {
  // Older cached payloads may still have `chunk`; normalize for the token-only contract.
  const mode = settings.chatStreamingMode as AppSettings['chatStreamingMode'] | 'chunk'
  if (mode === 'token') return settings
  return { ...settings, chatStreamingMode: 'token' }
}

function normalizeSettingsPayload(settings: Partial<AppSettings> & { useSecondarySidebar?: unknown }): AppSettings {
  const publicSettings = { ...settings }
  delete publicSettings.useSecondarySidebar
  return coerceChatStreamingMode({ ...DEFAULT_APP_SETTINGS, ...publicSettings } as AppSettings)
}

function readStoredSettings(): AppSettings | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isAppSettingsPayload(parsed)) return null
    // Back-fill defaults for fields added in later releases so older cached payloads
    // don't lock the user into stale settings.
    return normalizeSettingsPayload(parsed)
  } catch {
    return null
  }
}

function persistSettings(settings: AppSettings) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Ignore storage failures and keep in-memory settings.
  }
}

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth()
  const authUserId = user?.id ?? null
  const [settings, setSettings] = useState<AppSettings>(() => readStoredSettings() ?? DEFAULT_APP_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const refresh = useCallback(async () => {
    const stored = readStoredSettings()
    if (stored) {
      setSettings(stored)
    }
    if (authLoading) return
    if (!authUserId) {
      setSettings(stored ?? DEFAULT_APP_SETTINGS)
      setIsLoading(false)
      return
    }

    try {
      const res = await overlayAppClient.settings.getResponse({ cache: 'no-store' })
      if (res.ok) {
        const next = normalizeSettingsPayload(await res.json() as Partial<AppSettings> & { useSecondarySidebar?: unknown })
        setSettings(next)
        persistSettings(next)
      } else if (res.status === 401) {
        setSettings(stored ?? DEFAULT_APP_SETTINGS)
      }
    } catch {
      if (!stored) {
        setSettings(DEFAULT_APP_SETTINGS)
      }
    } finally {
      setIsLoading(false)
    }
  }, [authLoading, authUserId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const prevPresetVarsRef = useRef<Set<string>>(new Set())

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.style.colorScheme = settings.theme

    const activePreset =
      settings.theme === 'dark'
        ? settings.darkThemePreset ?? 'default-dark'
        : settings.lightThemePreset ?? 'default-light'
    root.dataset.themePreset = activePreset

    const presetVars = getPresetCssVars(activePreset as ThemePresetId)
    const applied = new Set<string>()
    for (const [key, val] of Object.entries(presetVars)) {
      root.style.setProperty(key, val)
      applied.add(key)
    }

    // Reset any previously-applied preset vars that are no longer in the active preset
    for (const key of prevPresetVarsRef.current) {
      if (!applied.has(key)) {
        root.style.removeProperty(key)
      }
    }
    prevPresetVarsRef.current = applied
  }, [settings.theme, settings.lightThemePreset, settings.darkThemePreset])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const optimistic = normalizeSettingsPayload({ ...settings, ...patch })
    setSettings(optimistic)
    persistSettings(optimistic)
    if (!authUserId) return optimistic

    setIsSaving(true)
    try {
      const res = await overlayAppClient.settings.updateResponse(patch)
      if (!res.ok) {
        console.warn('Failed to save settings to server; using local state')
        return optimistic
      }
      const saved = normalizeSettingsPayload(await res.json() as Partial<AppSettings> & { useSecondarySidebar?: unknown })
      setSettings(saved)
      persistSettings(saved)
      return saved
    } catch (error) {
      console.warn('Failed to save settings to server; using local state', error)
      return optimistic
    } finally {
      setIsSaving(false)
    }
  }, [authUserId, settings])

  const value = useMemo<AppSettingsContextValue>(() => ({
    settings,
    isLoading,
    isSaving,
    refresh,
    updateSettings,
  }), [settings, isLoading, isSaving, refresh, updateSettings])

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  )
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext)
  if (!ctx) {
    throw new Error('useAppSettings must be used within AppSettingsProvider')
  }
  return ctx
}

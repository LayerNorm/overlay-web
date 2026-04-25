import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  CANONICAL_APP_DESTINATIONS,
  DEFAULT_APP_SETTINGS,
  type AppBootstrap,
  type AppDestinationConfig,
  type AppFeatureFlags,
  type AppSettings,
  type AppBootstrapDefaults,
  type AuthUser,
  type ChatModel,
  type Entitlements,
  type ImageModel,
  type VideoModel,
} from '@overlay/app-core'
import { useAuth } from './AuthContext'
import {
  clearBootstrapCache,
  getAppBootstrap,
  getCachedBootstrap,
  setCachedBootstrap,
} from '../services/bootstrapService'
import {
  DEFAULT_UI_SETTINGS,
  loadCachedUiSettings,
  persistUiSettings,
  updateUiSettings,
} from '../services/settingsService'

type AppSessionContextValue = {
  bootstrap: AppBootstrap | null
  user: AuthUser | null
  entitlements: Entitlements | null
  uiSettings: AppSettings
  chatModels: ChatModel[]
  imageModels: ImageModel[]
  videoModels: VideoModel[]
  featureFlags: AppFeatureFlags
  destinations: AppDestinationConfig[]
  defaults?: AppBootstrapDefaults
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  refresh: (options?: { forceRefresh?: boolean }) => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
}

const DEFAULT_FEATURE_FLAGS: AppFeatureFlags = {
  canUseVoiceTranscription: true,
  canUseKnowledge: true,
  canUseProjects: true,
  canUseAutomations: true,
  canUseExtensions: true,
}

const AppSessionContext = createContext<AppSessionContextValue | undefined>(undefined)

function mergeSettings(
  current: AppSettings,
  patch: Partial<AppSettings>,
): AppSettings {
  return {
    ...current,
    ...patch,
  }
}

export function AppSessionProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const { isAuthenticated, isLoading: authLoading, user: authUser } = useAuth()
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(getCachedBootstrap())
  const [uiSettings, setUiSettings] = useState<AppSettings>(
    getCachedBootstrap()?.uiSettings ?? DEFAULT_UI_SETTINGS,
  )
  const [hasLoadedCachedSettings, setHasLoadedCachedSettings] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void loadCachedUiSettings()
      .then((cached) => {
        if (!cancelled && cached) {
          setUiSettings(cached)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setHasLoadedCachedSettings(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const applyBootstrap = useCallback(async (next: AppBootstrap | null) => {
    setBootstrap(next)
    if (next?.uiSettings) {
      setUiSettings(next.uiSettings)
      await persistUiSettings(next.uiSettings)
    }
  }, [])

  const refresh = useCallback(
    async (options: { forceRefresh?: boolean } = {}) => {
      if (!isAuthenticated) {
        return
      }

      setIsRefreshing(true)
      setError(null)

      try {
        const next = await getAppBootstrap({
          forceRefresh: options.forceRefresh,
        })
        await applyBootstrap(next)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to load app session')
      } finally {
        setIsRefreshing(false)
      }
    },
    [applyBootstrap, isAuthenticated],
  )

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!isAuthenticated) {
      setError(null)
      void clearBootstrapCache()
      void applyBootstrap(null)
      return
    }

    void refresh({ forceRefresh: false })
  }, [applyBootstrap, authLoading, isAuthenticated, refresh])

  const handleUpdateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const optimistic = mergeSettings(uiSettings, patch)
      setUiSettings(optimistic)
      await persistUiSettings(optimistic)

      if (!isAuthenticated) {
        return optimistic
      }

      try {
        const saved = await updateUiSettings(patch)
        setUiSettings(saved)
        if (bootstrap) {
          const nextBootstrap: AppBootstrap = {
            ...bootstrap,
            uiSettings: saved,
          }
          setBootstrap(nextBootstrap)
          await setCachedBootstrap(nextBootstrap)
        }
        return saved
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to save settings')
        return optimistic
      }
    },
    [bootstrap, isAuthenticated, uiSettings],
  )

  const value = useMemo<AppSessionContextValue>(
    () => ({
      bootstrap,
      user: bootstrap?.user ?? authUser ?? null,
      entitlements: bootstrap?.entitlements ?? null,
      uiSettings,
      chatModels: bootstrap?.chatModels ?? [],
      imageModels: bootstrap?.imageModels ?? [],
      videoModels: bootstrap?.videoModels ?? [],
      featureFlags: bootstrap?.featureFlags ?? DEFAULT_FEATURE_FLAGS,
      destinations: bootstrap?.destinations ?? [...CANONICAL_APP_DESTINATIONS],
      defaults: bootstrap?.defaults,
      isLoading:
        authLoading || !hasLoadedCachedSettings || (isAuthenticated && !bootstrap && isRefreshing),
      isRefreshing,
      error,
      refresh,
      updateSettings: handleUpdateSettings,
    }),
    [
      authLoading,
      authUser,
      bootstrap,
      error,
      hasLoadedCachedSettings,
      handleUpdateSettings,
      isAuthenticated,
      isRefreshing,
      refresh,
      uiSettings,
    ],
  )

  return (
    <AppSessionContext.Provider value={value}>
      {children}
    </AppSessionContext.Provider>
  )
}

export function useAppSession(): AppSessionContextValue {
  const context = useContext(AppSessionContext)

  if (!context) {
    throw new Error('useAppSession must be used within an AppSessionProvider')
  }

  return context
}

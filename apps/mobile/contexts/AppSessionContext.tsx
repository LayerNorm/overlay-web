import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  CANONICAL_APP_DESTINATIONS,
  deriveOverlayCapabilities,
  type AppBootstrap,
  type AppDestinationConfig,
  type AppFeatureFlags,
  type AppSettings,
  type AppBootstrapDefaults,
  type AuthUser,
  type CapabilityCheck,
  type ChatModel,
  type Entitlements,
  type ImageModel,
  type OverlayFeatureFlagId,
  type VideoModel,
} from '@overlay/app-core'
import { useAuth } from './AuthContext'
import { isWorkspaceSetupRequired } from '../services/workspaceSetup'
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
  subscribeUiSettings,
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
  capabilities: CapabilityCheck
  destinations: AppDestinationConfig[]
  /**
   * True when a feature-flag registry entry is enabled AND its required
   * capabilities are satisfied. Flags absent from the registry fall back to
   * the matching `featureFlags`/`capabilities` keys, then to enabled — so
   * features stay on while bootstrap loads (matches previous behavior).
   */
  isFeatureEnabled: (flagId: OverlayFeatureFlagId) => boolean
  defaults?: AppBootstrapDefaults
  isLoading: boolean
  isInitialized: boolean
  workspaceSetupRequired: boolean
  isRefreshing: boolean
  error: string | null
  refresh: (options?: { forceRefresh?: boolean }) => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
}

const DEFAULT_FEATURE_FLAGS: AppFeatureFlags = {
  canUseVoiceTranscription: true,
  canUseKnowledge: true,
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
  useEffect(() => subscribeUiSettings(setUiSettings), [])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [initializedUserId, setInitializedUserId] = useState<string | null>(null)
  const refreshGeneration = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [workspaceSetupRequired, setWorkspaceSetupRequired] = useState(false)

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
      setInitializedUserId(null)
      setError(null)
      setWorkspaceSetupRequired(false)
      const generation = ++refreshGeneration.current

      try {
        const next = await getAppBootstrap({
          forceRefresh: options.forceRefresh ?? true,
        })
        if (generation !== refreshGeneration.current) return
        await applyBootstrap(next)
        if (generation === refreshGeneration.current) setInitializedUserId(authUser?.id ?? null)
      } catch (nextError) {
        if (generation === refreshGeneration.current) setWorkspaceSetupRequired(isWorkspaceSetupRequired(nextError))
        if (generation === refreshGeneration.current)
          setError(nextError instanceof Error ? nextError.message : 'Failed to load app session')
      } finally {
        if (generation === refreshGeneration.current) setIsRefreshing(false)
      }
    },
    [applyBootstrap, authUser?.id, isAuthenticated],
  )

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!isAuthenticated) {
      setWorkspaceSetupRequired(false)
      setInitializedUserId(null)
      setError(null)
      void clearBootstrapCache()
      void applyBootstrap(null)
      return
    }

    void refresh({ forceRefresh: true })
    return () => { refreshGeneration.current++ }
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

  const capabilities = useMemo(() => deriveOverlayCapabilities(bootstrap), [bootstrap])

  const isFeatureEnabled = useCallback(
    (flagId: OverlayFeatureFlagId): boolean => {
      const entry = bootstrap?.featureFlagRegistry?.find((flag) => flag.id === flagId)
      const flagEnabled = entry?.enabled ?? true
      const required = entry?.requiredCapabilities ?? []
      const anyOf = entry?.requiredAnyCapabilities ?? []
      const meetsRequired = required.every((capability) => capabilities[capability])
      const meetsAnyOf =
        anyOf.length === 0 || anyOf.some((capability) => capabilities[capability])
      return flagEnabled && meetsRequired && meetsAnyOf
    },
    [bootstrap?.featureFlagRegistry, capabilities],
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
      capabilities,
      destinations: bootstrap?.destinations ?? [...CANONICAL_APP_DESTINATIONS],
      isFeatureEnabled,
      defaults: bootstrap?.defaults,
      isLoading:
        authLoading || !hasLoadedCachedSettings || (isAuthenticated && !bootstrap && isRefreshing),
      isRefreshing,
      isInitialized: isAuthenticated && initializedUserId === authUser?.id,
      workspaceSetupRequired,
      error,
      refresh,
      updateSettings: handleUpdateSettings,
    }),
    [
      workspaceSetupRequired,
      authLoading,
      authUser,
      bootstrap,
      capabilities,
      error,
      hasLoadedCachedSettings,
      handleUpdateSettings,
      isAuthenticated,
      isFeatureEnabled,
      isRefreshing,
      initializedUserId,
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

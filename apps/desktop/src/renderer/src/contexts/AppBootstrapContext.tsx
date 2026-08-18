import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import type {
  AppBootstrapResponse,
  AppDestinationConfig,
  AppSettings,
  ChatModel as SharedChatModel,
  ImageModel,
  VideoModel
} from '@overlay/app-core'
import type { Entitlements } from '@overlay/billing'
import type { User } from '@overlay/auth-contracts'
import { BUILT_IN_MODELS } from '@overlay/llm-gateway'
import type { ChatModel } from '../components/chat/types'
import { overlayDesktopAppClient } from '../services/app-api-client'
import { getAuthReadyState } from '../services/auth-service'
import { withDisabledState } from '../utils/chatModels'

interface AppBootstrapContextValue {
  bootstrap: AppBootstrapResponse | null
  isLoading: boolean
  error: string | null
  refreshBootstrap: () => Promise<AppBootstrapResponse | null>
  chatModels: ChatModel[]
  imageModels: ImageModel[]
  videoModels: VideoModel[]
  destinations: AppDestinationConfig[]
  uiSettings: AppSettings | null
  entitlements: Entitlements | null
  user: User | null
}

const AppBootstrapContext = createContext<AppBootstrapContextValue | null>(null)

export function AppBootstrapProvider({ children }: { children: ReactNode }): React.ReactElement<any> {
  const [bootstrap, setBootstrap] = useState<AppBootstrapResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshBootstrap = useCallback(async (): Promise<AppBootstrapResponse | null> => {
    if (getAuthReadyState() !== true) return null
    setIsLoading(true)
    setError(null)
    try {
      const next = await overlayDesktopAppClient.bootstrap.get()
      setBootstrap(next)
      window.dispatchEvent(new CustomEvent('overlay:app-bootstrap-updated', { detail: next }))
      return next
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError)
      setError(message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const refreshWhenAuthenticated = (event: Event): void => {
      const authed = (event as CustomEvent<{ authed?: boolean }>).detail?.authed === true
      if (authed) {
        void refreshBootstrap()
      } else {
        setBootstrap(null)
        setError(null)
        setIsLoading(false)
      }
    }
    window.addEventListener('overlay:auth-ready', refreshWhenAuthenticated)
    if (getAuthReadyState() === true) void refreshBootstrap()
    return () => {
      window.removeEventListener('overlay:auth-ready', refreshWhenAuthenticated)
    }
  }, [refreshBootstrap])

  const value = useMemo<AppBootstrapContextValue>(() => {
    const isFreeTier = bootstrap?.entitlements?.tier === 'free'
    // Prefer the server catalog from bootstrap. While bootstrap is still loading,
    // do NOT fall back to BUILT_IN_MODELS — intersecting a custom enabled list
    // with the tiny built-in set is what made the picker show only 1–2 models.
    const sourceModels = bootstrap?.chatModels?.length
      ? bootstrap.chatModels
      : bootstrap
        ? (BUILT_IN_MODELS as unknown as SharedChatModel[])
        : []
    const chatModels: ChatModel[] = withDisabledState(sourceModels, isFreeTier)

    return {
      bootstrap,
      isLoading,
      error,
      refreshBootstrap,
      chatModels,
      imageModels: bootstrap?.imageModels ?? [],
      videoModels: bootstrap?.videoModels ?? [],
      destinations: bootstrap?.destinations ?? [],
      uiSettings: bootstrap?.uiSettings ?? null,
      entitlements: bootstrap?.entitlements ?? null,
      user: bootstrap?.user ?? null
    }
  }, [bootstrap, error, isLoading, refreshBootstrap])

  return <AppBootstrapContext.Provider value={value}>{children}</AppBootstrapContext.Provider>
}

export function useAppBootstrap(): AppBootstrapContextValue {
  const context = useContext(AppBootstrapContext)
  if (!context) {
    throw new Error('useAppBootstrap must be used within an AppBootstrapProvider')
  }
  return context
}

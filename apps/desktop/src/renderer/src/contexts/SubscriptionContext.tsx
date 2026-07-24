import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

export type SubscriptionTier = 'free' | 'pro' | 'max'

export interface SubscriptionState {
  tier: SubscriptionTier
  planKind?: 'free' | 'paid'
  planAmountCents?: number
  creditsUsed: number
  creditsTotal: number
  budgetUsedCents?: number
  budgetTotalCents?: number
  budgetRemainingCents?: number
  overlayStorageBytesUsed: number
  overlayStorageBytesLimit: number
  dailyUsage: { ask: number; write: number; agent: number }
  dailyLimits: { ask: number; write: number; agent: number }
  transcriptionSecondsUsed: number
  transcriptionSecondsLimit: number // 10 minutes = 600 seconds for free users
  resetAt: string
  billingPeriodEnd: string
  isLoading: boolean
}

interface SubscriptionContextValue extends SubscriptionState {
  refresh: () => Promise<void>
  canUseCredits: (estimatedCost: number) => boolean
  canPerformAction: (type: 'ask' | 'write' | 'agent') => boolean
  isPremiumModel: (modelId: string) => boolean
  incrementUsage: (type: 'ask' | 'write' | 'agent', creditCost?: number) => void
  incrementTranscriptionUsage: (seconds: number) => void
  creditsRemaining: number
  creditsPercentage: number
  dailyUsagePercentage: number
  transcriptionPercentage: number
  transcriptionMinutesUsed: number
  transcriptionMinutesLimit: number
  weeklyResetTime: string // Human-readable time until weekly reset
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null)

// To test different subscription states in dev, temporarily set these:
//   const DEV_TIER_OVERRIDE: SubscriptionTier = 'pro'
//   const DEV_USAGE_OVERRIDE: Partial<SubscriptionState> = { creditsUsed: 14 }

// Subscription state is managed by the main process (source of truth).
// The renderer receives state via IPC and never trusts localStorage.

import { useAppBootstrap } from './AppBootstrapContext'
import { getAuthReadyState } from '../services/auth-service'

const TIER_DEFAULTS: Record<SubscriptionTier, Omit<SubscriptionState, 'isLoading'>> = {
  free: {
    tier: 'free',
    planKind: 'free',
    planAmountCents: 0,
    creditsUsed: 0,
    creditsTotal: 0,
    budgetUsedCents: 0,
    budgetTotalCents: 0,
    budgetRemainingCents: 0,
    overlayStorageBytesUsed: 0,
    overlayStorageBytesLimit: 0,
    dailyUsage: { ask: 0, write: 0, agent: 0 },
    dailyLimits: { ask: 15, write: 15, agent: 15 }, // Combined limit of 15 total per WEEK
    transcriptionSecondsUsed: 0,
    transcriptionSecondsLimit: 600, // 10 minutes per week for free users
    resetAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    billingPeriodEnd: ''
  },
  pro: {
    tier: 'pro',
    planKind: 'paid',
    planAmountCents: 1500,
    creditsUsed: 0,
    creditsTotal: 15,
    budgetUsedCents: 0,
    budgetTotalCents: 1500,
    budgetRemainingCents: 1500,
    overlayStorageBytesUsed: 0,
    overlayStorageBytesLimit: 0,
    dailyUsage: { ask: 0, write: 0, agent: 0 },
    dailyLimits: { ask: Infinity, write: Infinity, agent: Infinity },
    transcriptionSecondsUsed: 0,
    transcriptionSecondsLimit: Infinity, // Unlimited for pro
    resetAt: '',
    billingPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  },
  max: {
    tier: 'max',
    planKind: 'paid',
    planAmountCents: 9000,
    creditsUsed: 0,
    creditsTotal: 90,
    budgetUsedCents: 0,
    budgetTotalCents: 9000,
    budgetRemainingCents: 9000,
    overlayStorageBytesUsed: 0,
    overlayStorageBytesLimit: 0,
    dailyUsage: { ask: 0, write: 0, agent: 0 },
    dailyLimits: { ask: Infinity, write: Infinity, agent: Infinity },
    transcriptionSecondsUsed: 0,
    transcriptionSecondsLimit: Infinity, // Unlimited for max
    resetAt: '',
    billingPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }
}

function getInitialState(): SubscriptionState {
  return {
    ...TIER_DEFAULTS.free,
    isLoading: true
  }
}

interface SubscriptionProviderProps {
  children: ReactNode
}

export function SubscriptionProvider({ children }: SubscriptionProviderProps): React.ReactElement {
  const { bootstrap, chatModels } = useAppBootstrap()
  const [state, setState] = useState<SubscriptionState>(() => {
    // Always start from defaults; fetch authoritative state from main process via IPC
    return getInitialState()
  })
  const fetchEntitlements = useCallback(async () => {
    if (getAuthReadyState() !== true) {
      setState({ ...TIER_DEFAULTS.free, isLoading: false })
      return
    }
    try {
      setState((prev) => ({ ...prev, isLoading: true }))

      const bootstrapped = bootstrap?.entitlements
      if (bootstrapped) {
        setState({
          tier: bootstrapped.tier,
          planKind: bootstrapped.planKind,
          planAmountCents: bootstrapped.planAmountCents,
          creditsUsed: bootstrapped.creditsUsed,
          creditsTotal: bootstrapped.creditsTotal,
          budgetUsedCents: bootstrapped.budgetUsedCents,
          budgetTotalCents: bootstrapped.budgetTotalCents,
          budgetRemainingCents: bootstrapped.budgetRemainingCents,
          overlayStorageBytesUsed: bootstrapped.overlayStorageBytesUsed ?? 0,
          overlayStorageBytesLimit: bootstrapped.overlayStorageBytesLimit ?? 0,
          dailyUsage: bootstrapped.dailyUsage,
          dailyLimits: bootstrapped.dailyLimits ?? TIER_DEFAULTS[bootstrapped.tier].dailyLimits,
          transcriptionSecondsUsed: bootstrapped.transcriptionSecondsUsed ?? 0,
          transcriptionSecondsLimit:
            bootstrapped.transcriptionSecondsLimit ??
            TIER_DEFAULTS[bootstrapped.tier].transcriptionSecondsLimit,
          resetAt: bootstrapped.resetAt ?? '',
          billingPeriodEnd: bootstrapped.billingPeriodEnd ?? '',
          isLoading: false
        })
        return
      }

      // Fetch from main process via IPC
      const result = await window.bridge?.subscription?.getEntitlements?.()
      if (result) {
        setState({
          tier: result.tier,
          planKind: result.planKind,
          planAmountCents: result.planAmountCents,
          creditsUsed: result.creditsUsed,
          creditsTotal: result.creditsTotal,
          budgetUsedCents: result.budgetUsedCents,
          budgetTotalCents: result.budgetTotalCents,
          budgetRemainingCents: result.budgetRemainingCents,
          overlayStorageBytesUsed: result.overlayStorageBytesUsed ?? 0,
          overlayStorageBytesLimit: result.overlayStorageBytesLimit ?? 0,
          dailyUsage: result.dailyUsage,
          dailyLimits: result.dailyLimits,
          transcriptionSecondsUsed: result.transcriptionSecondsUsed,
          transcriptionSecondsLimit: result.transcriptionSecondsLimit,
          resetAt: result.resetAt,
          billingPeriodEnd: result.billingPeriodEnd,
          isLoading: false
        })
      } else {
        // Fallback to free tier defaults
        setState({ ...TIER_DEFAULTS.free, isLoading: false })
      }
    } catch (error) {
      console.error('[SubscriptionContext] Failed to fetch entitlements:', error)
      setState((prev) => ({ ...prev, isLoading: false }))
    }
  }, [bootstrap?.entitlements])

  useEffect(() => {
    const refreshWhenAuthenticated = (event: Event): void => {
      const authed = (event as CustomEvent<{ authed?: boolean }>).detail?.authed === true
      if (authed) void fetchEntitlements()
      else setState({ ...TIER_DEFAULTS.free, isLoading: false })
    }
    window.addEventListener('overlay:auth-ready', refreshWhenAuthenticated)
    if (getAuthReadyState() === true) void fetchEntitlements()
    return () => {
      window.removeEventListener('overlay:auth-ready', refreshWhenAuthenticated)
    }
  }, [fetchEntitlements])

  // Listen for subscription updates from main process (e.g., devSetTier, usage recording)
  useEffect(() => {
    const unsubscribe = window.bridge?.subscription?.onUpdated?.((entitlements) => {
      if (entitlements) {
        setState({
          tier: entitlements.tier,
          planKind: entitlements.planKind,
          planAmountCents: entitlements.planAmountCents,
          creditsUsed: entitlements.creditsUsed,
          creditsTotal: entitlements.creditsTotal,
          budgetUsedCents: entitlements.budgetUsedCents,
          budgetTotalCents: entitlements.budgetTotalCents,
          budgetRemainingCents: entitlements.budgetRemainingCents,
          overlayStorageBytesUsed: entitlements.overlayStorageBytesUsed ?? 0,
          overlayStorageBytesLimit: entitlements.overlayStorageBytesLimit ?? 0,
          dailyUsage: entitlements.dailyUsage,
          dailyLimits: entitlements.dailyLimits,
          transcriptionSecondsUsed: entitlements.transcriptionSecondsUsed,
          transcriptionSecondsLimit: entitlements.transcriptionSecondsLimit,
          resetAt: entitlements.resetAt,
          billingPeriodEnd: entitlements.billingPeriodEnd,
          isLoading: false
        })
      }
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  const creditsRemaining = Math.max(0, state.creditsTotal - state.creditsUsed)
  // Clamp percentage between 0 and 100 to prevent negative display
  const creditsPercentage =
    state.creditsTotal > 0
      ? Math.max(0, Math.min(100, (creditsRemaining / state.creditsTotal) * 100))
      : 0

  const totalDailyUsage = state.dailyUsage.ask + state.dailyUsage.write + state.dailyUsage.agent
  const totalDailyLimit = state.dailyLimits.ask + state.dailyLimits.write + state.dailyLimits.agent
  const dailyUsagePercentage =
    totalDailyLimit > 0 && isFinite(totalDailyLimit)
      ? ((totalDailyLimit - totalDailyUsage) / totalDailyLimit) * 100
      : 100

  // Transcription usage calculations
  const transcriptionMinutesUsed = state.transcriptionSecondsUsed / 60
  const transcriptionMinutesLimit = isFinite(state.transcriptionSecondsLimit)
    ? state.transcriptionSecondsLimit / 60
    : Infinity
  const transcriptionPercentage =
    state.transcriptionSecondsLimit > 0 && isFinite(state.transcriptionSecondsLimit)
      ? ((state.transcriptionSecondsLimit - state.transcriptionSecondsUsed) /
          state.transcriptionSecondsLimit) *
        100
      : 100

  // Calculate time until next weekly reset (Monday 00:00 UTC)
  const getWeeklyResetTime = (): string => {
    const now = new Date()
    const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7 // Days until next Monday
    const nextMonday = new Date(now)
    nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday)
    nextMonday.setUTCHours(0, 0, 0, 0)

    const diff = nextMonday.getTime() - now.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

    if (days > 0) {
      return `${days}d ${hours}h`
    }
    return `${hours}h`
  }
  const weeklyResetTime = getWeeklyResetTime()

  const canUseCredits = useCallback(
    (estimatedCost: number): boolean => {
      if (state.tier === 'free') return false
      return creditsRemaining >= estimatedCost
    },
    [state.tier, creditsRemaining]
  )

  // UI-level gating only — actual enforcement happens in the main process
  // (chat-ipc.ts, agent-ipc.ts, notebook-agent-ipc.ts all call
  // subscriptionService.canPerformAction() before processing requests).
  // State here is sourced from the main process via IPC, not localStorage.
  const canPerformAction = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_type: 'ask' | 'write' | 'agent'): boolean => {
      if (state.tier !== 'free') return true
      const totalUsage = state.dailyUsage.ask + state.dailyUsage.write + state.dailyUsage.agent
      return totalUsage < 15
    },
    [state.tier, state.dailyUsage]
  )

  const isPremiumModel = useCallback(
    (modelId: string): boolean => {
      const model = chatModels.find((m) => m.id === modelId)
      return model ? model.cost !== 0 : true
    },
    [chatModels]
  )

  const incrementUsage = useCallback(
    (type: 'ask' | 'write' | 'agent', creditCost?: number): void => {
      setState((prev) => {
        if (prev.tier === 'free') {
          return {
            ...prev,
            dailyUsage: {
              ...prev.dailyUsage,
              [type]: prev.dailyUsage[type] + 1
            }
          }
        }
        const cost = creditCost ?? 0.01
        return {
          ...prev,
          creditsUsed: prev.creditsUsed + cost
        }
      })
    },
    []
  )

  const incrementTranscriptionUsage = useCallback((seconds: number): void => {
    setState((prev) => ({
      ...prev,
      transcriptionSecondsUsed: prev.transcriptionSecondsUsed + seconds
    }))
  }, [])

  // Cross-window sync is handled by the main process broadcasting 'subscription:updated'
  // via IPC (see onUpdated listener above). No localStorage sync needed.

  const value: SubscriptionContextValue = {
    ...state,
    refresh: fetchEntitlements,
    canUseCredits,
    canPerformAction,
    isPremiumModel,
    incrementUsage,
    incrementTranscriptionUsage,
    creditsRemaining,
    creditsPercentage,
    dailyUsagePercentage,
    transcriptionPercentage,
    transcriptionMinutesUsed,
    transcriptionMinutesLimit,
    weeklyResetTime
  }

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
}

export function useSubscriptionContext(): SubscriptionContextValue {
  const context = useContext(SubscriptionContext)
  if (!context) {
    throw new Error('useSubscriptionContext must be used within a SubscriptionProvider')
  }
  return context
}

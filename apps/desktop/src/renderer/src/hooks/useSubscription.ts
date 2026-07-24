import {
  useSubscriptionContext,
  SubscriptionTier,
  SubscriptionState
} from '../contexts/SubscriptionContext'

export type SubscriptionContextValue = ReturnType<typeof useSubscriptionContext>

export function useSubscription(): SubscriptionContextValue {
  return useSubscriptionContext()
}

export type { SubscriptionTier, SubscriptionState }

'use client'

import { useCallback, useMemo, useState } from 'react'
import { isFreeTierChatModelId, type ChatModel } from '@/shared/ai/gateway/model-types'
import { getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export type WorkspaceModelEntitlements = {
  tier: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  creditsUsed: number
  creditsTotal: number
  budgetUsedCents?: number
  budgetTotalCents?: number
  budgetRemainingCents?: number
  topUpAmountCents?: number
  autoTopUpAmountCents?: number
  autoTopUpEnabled?: boolean
}

export function budgetTotalCentsFor(entitlements: WorkspaceModelEntitlements): number {
  return entitlements.budgetTotalCents ?? Math.max(0, Math.round((entitlements.creditsTotal ?? 0) * 100))
}

export function budgetUsedCentsFor(entitlements: WorkspaceModelEntitlements): number {
  return entitlements.budgetUsedCents ?? Math.max(0, Math.round(entitlements.creditsUsed ?? 0))
}

export function budgetRemainingCentsFor(entitlements: WorkspaceModelEntitlements): number {
  return entitlements.budgetRemainingCents
    ?? Math.max(0, budgetTotalCentsFor(entitlements) - budgetUsedCentsFor(entitlements))
}

export function resolveEntitlementDerived(
  entitlements: WorkspaceModelEntitlements | null,
  billingEnabled: boolean,
  onlyAllowZdrModels: boolean,
) {
  const resolvedPlanKind = entitlements
    ? (entitlements.planKind ?? (entitlements.tier === 'free' ? 'free' : 'paid'))
    : null
  const isPaidSubscription = !billingEnabled || resolvedPlanKind === 'paid'
  const budgetTotalCents = entitlements ? budgetTotalCentsFor(entitlements) : 0
  const budgetUsedCents = entitlements ? budgetUsedCentsFor(entitlements) : 0
  const budgetRemainingCents = entitlements ? budgetRemainingCentsFor(entitlements) : 0
  const isBudgetExhaustedPaid = billingEnabled && Boolean(entitlements) && isPaidSubscription && budgetRemainingCents <= 0
  const isFreeTier = billingEnabled && Boolean(entitlements) && (!isPaidSubscription || isBudgetExhaustedPaid)
  const isModelAccessRestricted = isFreeTier
  const effectiveOnlyAllowZdrModels = isPaidSubscription && !isBudgetExhaustedPaid && onlyAllowZdrModels
  return {
    isPaidSubscription,
    budgetTotalCents,
    budgetUsedCents,
    budgetRemainingCents,
    isBudgetExhaustedPaid,
    isFreeTier,
    isModelAccessRestricted,
    effectiveOnlyAllowZdrModels,
  }
}

export function buildSelectableTextModels({
  isModelAccessRestricted,
  effectiveOnlyAllowZdrModels,
}: {
  isModelAccessRestricted: boolean
  effectiveOnlyAllowZdrModels: boolean
}): ChatModel[] {
  const availableTextModels = getModelsByIntelligence(isModelAccessRestricted)
    .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
    .filter((model) => !isModelAccessRestricted || isFreeTierChatModelId(model.id))
  return effectiveOnlyAllowZdrModels
    ? availableTextModels.filter((model) => model.supportsZeroDataRetention)
    : availableTextModels
}

export function useWorkspaceTextModelAccess<T extends WorkspaceModelEntitlements = WorkspaceModelEntitlements>({
  activeWorkspaceId,
  billingEnabled,
  catalogRevision,
  modelCatalogVersion,
  onlyAllowZdrModels,
  onEntitlementsFetched,
}: {
  activeWorkspaceId: string | null
  billingEnabled: boolean
  catalogRevision: number
  modelCatalogVersion?: string | number
  onlyAllowZdrModels: boolean
  onEntitlementsFetched?: (data: T) => void
}) {
  const [entitlements, setEntitlements] = useState<T | null>(null)
  const [loading, setLoading] = useState(billingEnabled)
  const derived = resolveEntitlementDerived(entitlements, billingEnabled, onlyAllowZdrModels)
  const selectableTextModels = useMemo(() => {
    void catalogRevision
    void modelCatalogVersion
    return buildSelectableTextModels(derived)
  }, [
    catalogRevision,
    derived.effectiveOnlyAllowZdrModels,
    derived.isModelAccessRestricted,
    modelCatalogVersion,
  ])

  const loadSubscription = useCallback(async () => {
    if (!billingEnabled) {
      setEntitlements(null)
      setLoading(false)
      return null
    }
    setLoading(true)
    try {
      const response = await overlayAppClient.subscription.getResponse({
        cache: 'no-store',
        ...(activeWorkspaceId
          ? { headers: { [ACTIVE_WORKSPACE_HEADER]: activeWorkspaceId } }
          : {}),
      })
      if (!response.ok) return null
      const data = await response.json() as T
      setEntitlements(data)
      onEntitlementsFetched?.(data)
      return data
    } catch {
      return null
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, billingEnabled, onEntitlementsFetched])

  return {
    ...derived,
    entitlements,
    loading,
    loadSubscription,
    selectableTextModels,
  }
}

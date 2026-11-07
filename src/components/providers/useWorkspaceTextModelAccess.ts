'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ChatModel } from '@/shared/ai/gateway/model-types'
import { getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { byokConnectionsToChatModels } from '@/shared/ai/gateway/byok-model-conversion'
import { useByokModels } from './useByokModels'
import { useLiveWorkspaceEntitlements } from '@/hooks/use-billing'

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
  // The server gates models on stored entitlements even when billing is off, so mirror them whenever known.
  const isPaidSubscription = resolvedPlanKind ? resolvedPlanKind === 'paid' : !billingEnabled
  const budgetTotalCents = entitlements ? budgetTotalCentsFor(entitlements) : 0
  const budgetUsedCents = entitlements ? budgetUsedCentsFor(entitlements) : 0
  const budgetRemainingCents = entitlements ? budgetRemainingCentsFor(entitlements) : 0
  const isBudgetExhaustedPaid = billingEnabled && Boolean(entitlements) && isPaidSubscription && budgetRemainingCents <= 0
  const isModelAccessRestricted = billingEnabled && (!entitlements || !isPaidSubscription || budgetRemainingCents <= 0)
  const effectiveOnlyAllowZdrModels = onlyAllowZdrModels
  return {
    isPaidSubscription,
    budgetTotalCents,
    budgetUsedCents,
    budgetRemainingCents,
    isBudgetExhaustedPaid,
    isModelAccessRestricted,
    effectiveOnlyAllowZdrModels,
  }
}

export function buildSelectableTextModels({
  effectiveOnlyAllowZdrModels,
}: {
  effectiveOnlyAllowZdrModels: boolean
}): ChatModel[] {
  const availableTextModels = getModelsByIntelligence()
    .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
  return effectiveOnlyAllowZdrModels
    ? availableTextModels.filter((model) => model.supportsZeroDataRetention)
    : availableTextModels
}

export function buildPickerTextModels({
  effectiveOnlyAllowZdrModels,
}: {
  effectiveOnlyAllowZdrModels: boolean
}): ChatModel[] {
  const availableTextModels = getModelsByIntelligence()
    .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
  return effectiveOnlyAllowZdrModels
    ? availableTextModels.filter((model) => model.supportsZeroDataRetention)
    : availableTextModels
}

export function isTextModelLocked(modelId: string, isModelAccessRestricted: boolean): boolean {
  void modelId
  return isModelAccessRestricted
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
  const { connections, isLoading: connectionsLoading } = useByokModels()
  // Live: every charge, top-up and payment updates the gates and meters without refetching. With billing off the
  // query carries the member's own entitlements, which is what the server enforces then.
  const live = useLiveWorkspaceEntitlements<T>(activeWorkspaceId)
  const entitlements = live ?? null
  const loading = live === undefined
  const liveRef = useRef(live)
  useEffect(() => { liveRef.current = live }, [live])
  useEffect(() => {
    if (live) onEntitlementsFetched?.(live)
  }, [live, onEntitlementsFetched])
  const derived = resolveEntitlementDerived(entitlements, billingEnabled, onlyAllowZdrModels)
  const selectableTextModels = useMemo(() => {
    void connections
    void catalogRevision
    void modelCatalogVersion
    return buildSelectableTextModels({
      effectiveOnlyAllowZdrModels: derived.effectiveOnlyAllowZdrModels,
    })
  }, [
    connections,
    catalogRevision,
    derived.effectiveOnlyAllowZdrModels,
    modelCatalogVersion,
  ])
  const pickerTextModels = useMemo(() => {
    void catalogRevision
    void modelCatalogVersion
    const available = buildPickerTextModels({
      effectiveOnlyAllowZdrModels: derived.effectiveOnlyAllowZdrModels,
    })
    const unavailable = byokConnectionsToChatModels(connections, { includeUnavailable: true })
      .filter((model) => model.subscription?.unavailable)
      .filter((model) => !derived.effectiveOnlyAllowZdrModels || model.supportsZeroDataRetention)
    return [...available, ...unavailable]
  }, [
    connections,
    catalogRevision,
    derived.effectiveOnlyAllowZdrModels,
    modelCatalogVersion,
  ])

  /** The current entitlements: live, so this never fetches; callers that refreshed after each turn get the newest. */
  const loadSubscription = useCallback(async () => liveRef.current ?? null, [])

  return {
    ...derived,
    entitlements,
    loading,
    connectionsLoading,
    loadSubscription,
    pickerTextModels,
    selectableTextModels,
  }
}

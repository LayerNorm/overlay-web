'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_MODEL_ID,
  FREE_TIER_AUTO_MODEL_ID,
  isFreeTierChatModelId,
  isLegacyFreeTierDefaultModelId,
} from '@/shared/ai/gateway/model-types'
import {
  getEnabledChatModels,
  modelSupportsZeroDataRetention,
} from '@/shared/ai/gateway/model-data'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
import { safeHttpUrl } from '@/shared/security/safe-url'
import { currentLegalAcceptancePayload } from '@/shared/legal/legal-documents'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import type { Entitlements } from '../chat-interface/types'

type ChatRouter = {
  replace: (href: string) => void
}

type ChatSearchParams = {
  get: (name: string) => string | null
  toString: () => string
} | null

const BUDGET_EXHAUSTED_NOTICE =
  'Budget exhausted. Add a top-up to continue with paid models, or switch to Auto for free chat.'

function budgetTotalCentsFor(entitlements: Entitlements): number {
  return entitlements.budgetTotalCents ?? Math.max(0, Math.round((entitlements.creditsTotal ?? 0) * 100))
}

function budgetUsedCentsFor(entitlements: Entitlements): number {
  return entitlements.budgetUsedCents ?? Math.max(0, Math.round(entitlements.creditsUsed ?? 0))
}

function budgetRemainingCentsFor(entitlements: Entitlements): number {
  return entitlements.budgetRemainingCents ?? Math.max(0, budgetTotalCentsFor(entitlements) - budgetUsedCentsFor(entitlements))
}

export function useChatBillingControls({
  activeChatId,
  activeWorkspaceId,
  billingEnabled,
  catalogRevision,
  modelCatalogVersion,
  modelCatalogReady = true,
  chatPrefsHydrated,
  onlyAllowZdrModels,
  enabledModelIds,
  modelOrder,
  pathname,
  router,
  searchParams,
  selectedActModel,
  selectedModels,
  setAskModelSelectionMode,
  setComposerNotice,
  setSelectedActModel,
  setSelectedModels,
}: {
  activeChatId: string | null
  activeWorkspaceId: string | null
  billingEnabled: boolean
  /** From useGatewayModelCatalog — forces recompute when AVAILABLE_MODELS mutates. */
  catalogRevision: number
  modelCatalogVersion?: string | number
  modelCatalogReady?: boolean
  chatPrefsHydrated: boolean
  onlyAllowZdrModels: boolean
  enabledModelIds: readonly string[]
  modelOrder?: readonly string[]
  pathname: string
  router: ChatRouter
  searchParams: ChatSearchParams
  selectedActModel: string
  selectedModels: string[]
  setAskModelSelectionMode: (mode: 'single' | 'multiple') => void
  setComposerNotice: (value: string | null | ((current: string | null) => string | null)) => void
  setSelectedActModel: (modelId: string) => void
  setSelectedModels: (modelIds: string[]) => void
}) {
  const [topUpAmountDraftCents, setTopUpAmountDraftCents] = useState(800)
  const [autoTopUpEnabledDraft, setAutoTopUpEnabledDraft] = useState(false)
  const [billingActionLoading, setBillingActionLoading] = useState<'checkout' | 'save' | null>(null)
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null)
  const announcedBudgetExhaustedRef = useRef(false)

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
  // catalogRevision is required: getEnabledChatModels reads module-level AVAILABLE_MODELS
  // which mutates when the gateway catalog registers.
  const selectableTextModels = useMemo(() => {
    void catalogRevision
    void modelCatalogVersion
    const enabledTextModels = getEnabledChatModels(enabledModelIds, isModelAccessRestricted, modelOrder)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
    return effectiveOnlyAllowZdrModels
      ? enabledTextModels.filter((model) => model.supportsZeroDataRetention)
      : enabledTextModels
  }, [catalogRevision, effectiveOnlyAllowZdrModels, enabledModelIds, isModelAccessRestricted, modelCatalogVersion, modelOrder])
  const premiumModelBlocked =
    isModelAccessRestricted &&
    !isByokModelId(selectedActModel) &&
    !isFreeTierChatModelId(selectedActModel)
  const isSendBlocked = premiumModelBlocked

  useEffect(() => {
    if (!chatPrefsHydrated || !modelCatalogReady || !isByokModelId(selectedActModel)) return
    if (selectableTextModels.some((model) => model.id === selectedActModel)) return
    const fallbackModelId = selectableTextModels[0]?.id ?? FREE_TIER_AUTO_MODEL_ID
    setSelectedModels([fallbackModelId])
    setSelectedActModel(fallbackModelId)
    setAskModelSelectionMode('single')
  }, [
    chatPrefsHydrated,
    modelCatalogReady,
    selectableTextModels,
    selectedActModel,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

  useEffect(() => {
    if (!chatPrefsHydrated || !isModelAccessRestricted || activeChatId) return
    if (isByokModelId(selectedActModel)) return
    if (isFreeTierChatModelId(selectedActModel) && !isLegacyFreeTierDefaultModelId(selectedActModel)) return

    setSelectedModels([FREE_TIER_AUTO_MODEL_ID])
    setAskModelSelectionMode('single')
    setSelectedActModel(FREE_TIER_AUTO_MODEL_ID)
  }, [
    activeChatId,
    chatPrefsHydrated,
    isModelAccessRestricted,
    selectedActModel,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

  useEffect(() => {
    if (!chatPrefsHydrated || !effectiveOnlyAllowZdrModels) return
    const fallback = selectableTextModels[0]?.id ?? DEFAULT_MODEL_ID
    const nextSelected = selectedModels.filter((id) => modelSupportsZeroDataRetention(id)).slice(0, 4)
    const resolvedSelected = nextSelected.length > 0 ? nextSelected : [fallback]
    const nextActModel = modelSupportsZeroDataRetention(selectedActModel) ? selectedActModel : resolvedSelected[0]!
    const changed =
      resolvedSelected.length !== selectedModels.length ||
      resolvedSelected.some((id, index) => id !== selectedModels[index]) ||
      nextActModel !== selectedActModel
    if (!changed) return
    setSelectedModels(resolvedSelected)
    setSelectedActModel(nextActModel)
    if (resolvedSelected.length === 1) setAskModelSelectionMode('single')
  }, [
    activeChatId,
    chatPrefsHydrated,
    effectiveOnlyAllowZdrModels,
    selectableTextModels,
    selectedActModel,
    selectedModels,
    setAskModelSelectionMode,
    setSelectedActModel,
    setSelectedModels,
  ])

  const loadSubscription = useCallback(async () => {
    if (!billingEnabled) {
      setEntitlements(null)
      return null
    }
    try {
      const res = await overlayAppClient.subscription.getResponse({
        cache: 'no-store',
        ...(activeWorkspaceId
          ? { headers: { [ACTIVE_WORKSPACE_HEADER]: activeWorkspaceId } }
          : {}),
      })
      if (res.ok) {
        const data = await res.json() as Entitlements
        setEntitlements(data)
        setTopUpAmountDraftCents(data.topUpAmountCents ?? data.autoTopUpAmountCents ?? 800)
        setAutoTopUpEnabledDraft(Boolean(data.autoTopUpEnabled))
        const planKind = data.planKind ?? (data.tier === 'free' ? 'free' : 'paid')
        const exhausted = planKind === 'paid' && budgetRemainingCentsFor(data) <= 0
        if (exhausted && !announcedBudgetExhaustedRef.current) {
          announcedBudgetExhaustedRef.current = true
          setComposerNotice(BUDGET_EXHAUSTED_NOTICE)
        } else if (!exhausted) {
          announcedBudgetExhaustedRef.current = false
          setComposerNotice((current) =>
            current === BUDGET_EXHAUSTED_NOTICE
              ? null
              : current,
          )
        }
        return data
      }
    } catch { /* ignore */ }
    return null
  }, [activeWorkspaceId, billingEnabled, setComposerNotice])

  const buildTopUpReturnPath = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams?.toString() ?? '')
    nextParams.delete('topup_success')
    nextParams.delete('topup_session_id')
    nextParams.delete('topup_canceled')
    const query = nextParams.toString()
    return `${pathname}${query ? `?${query}` : ''}`
  }, [pathname, searchParams])

  const handleStartTopUp = useCallback(async () => {
    setBillingActionLoading('checkout')
    try {
      const response = await fetch('/api/topups/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents: topUpAmountDraftCents,
          autoTopUpEnabled: autoTopUpEnabledDraft,
          returnPath: buildTopUpReturnPath(),
          ...currentLegalAcceptancePayload(),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.url) {
        setComposerNotice(data.error || 'Failed to start top-up checkout.')
        return
      }
      const checkoutUrl = safeHttpUrl(data.url)
      if (!checkoutUrl) {
        setComposerNotice('Failed to start top-up checkout.')
        return
      }
      window.location.href = checkoutUrl
    } catch {
      setComposerNotice('Failed to start top-up checkout.')
    } finally {
      setBillingActionLoading(null)
    }
  }, [autoTopUpEnabledDraft, buildTopUpReturnPath, setComposerNotice, topUpAmountDraftCents])

  const handleSaveTopUpPreference = useCallback(async () => {
    setBillingActionLoading('save')
    try {
      const response = await overlayAppClient.subscription.updateSettingsResponse({
        autoTopUpEnabled: autoTopUpEnabledDraft,
        confirmation: 'UPDATE_BILLING_SETTINGS',
        topUpAmountCents: topUpAmountDraftCents,
        grantOffSessionConsent: autoTopUpEnabledDraft,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setComposerNotice(data.error || 'Failed to save top-up preference.')
        return
      }
      await loadSubscription()
      setComposerNotice('Top-up preference updated.')
      window.setTimeout(() => setComposerNotice((current) => current === 'Top-up preference updated.' ? null : current), 5000)
    } catch {
      setComposerNotice('Failed to save top-up preference.')
    } finally {
      setBillingActionLoading(null)
    }
  }, [autoTopUpEnabledDraft, loadSubscription, setComposerNotice, topUpAmountDraftCents])

  useEffect(() => {
    if (!billingEnabled) return
    const topUpSuccess = searchParams?.get('topup_success') === 'true'
    const topUpSessionId = searchParams?.get('topup_session_id')
    const topUpCanceled = searchParams?.get('topup_canceled') === 'true'

    if (!topUpSuccess && !topUpCanceled) return

    const nextParams = new URLSearchParams(searchParams?.toString() ?? '')
    nextParams.delete('topup_success')
    nextParams.delete('topup_session_id')
    nextParams.delete('topup_canceled')
    const nextUrl = `${pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ''}`

    if (topUpCanceled) {
      setComposerNotice('Top-up checkout canceled.')
      router.replace(nextUrl)
      return
    }

    if (!topUpSessionId) return

    let cancelled = false
    void fetch('/api/topups/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: topUpSessionId }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (cancelled) return
        if (response.ok) {
          setComposerNotice(`Top-up applied: $${(Number(data.amountCents ?? 0) / 100).toFixed(2)}.`)
          await loadSubscription()
        } else {
          setComposerNotice(data.error || 'We could not verify your top-up.')
        }
      })
      .catch(() => {
        if (!cancelled) setComposerNotice('We could not verify your top-up.')
      })
      .finally(() => {
        if (!cancelled) router.replace(nextUrl)
      })

    return () => {
      cancelled = true
    }
  }, [billingEnabled, loadSubscription, pathname, router, searchParams, setComposerNotice])

  return {
    autoTopUpEnabledDraft,
    billingActionLoading,
    budgetRemainingCents,
    budgetTotalCents,
    budgetUsedCents,
    effectiveOnlyAllowZdrModels,
    entitlements,
    handleSaveTopUpPreference,
    handleStartTopUp,
    isBudgetExhaustedPaid,
    isFreeTier,
    isPaidSubscription,
    isSendBlocked,
    loadSubscription,
    premiumModelBlocked,
    selectableTextModels,
    setAutoTopUpEnabledDraft,
    setTopUpAmountDraftCents,
    topUpAmountDraftCents,
  }
}

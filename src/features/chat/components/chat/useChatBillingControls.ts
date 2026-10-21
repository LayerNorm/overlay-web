'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_MODEL_ID,
  FREE_TIER_AUTO_MODEL_ID,
  isFreeTierChatModelId,
  isLegacyFreeTierDefaultModelId,
  type ChatModel,
} from '@/shared/ai/gateway/model-types'
import {
  getModelsByIntelligence,
  modelSupportsZeroDataRetention,
} from '@/shared/ai/gateway/model-data'
import { useRouter } from 'next/navigation'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'
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
  'This workspace’s credit is used up. Add credit in Workspace → Billing to keep using paid models, or switch to Auto for free chat.'

function budgetTotalCentsFor(entitlements: Entitlements): number {
  return entitlements.budgetTotalCents ?? Math.max(0, Math.round((entitlements.creditsTotal ?? 0) * 100))
}

function budgetUsedCentsFor(entitlements: Entitlements): number {
  return entitlements.budgetUsedCents ?? Math.max(0, Math.round(entitlements.creditsUsed ?? 0))
}

function budgetRemainingCentsFor(entitlements: Entitlements): number {
  return entitlements.budgetRemainingCents ?? Math.max(0, budgetTotalCentsFor(entitlements) - budgetUsedCentsFor(entitlements))
}

type ComposerNoticeSetter = (value: string | null | ((current: string | null) => string | null)) => void

type ModelSelectionControls = {
  setSelectedActModel: (modelId: string) => void
  setSelectedModels: (modelIds: string[]) => void
}

function useByokModelFallback({
  chatPrefsHydrated,
  modelCatalogReady,
  selectableTextModels,
  selectedActModel,
  setSelectedActModel,
  setSelectedModels,
}: {
  chatPrefsHydrated: boolean
  modelCatalogReady: boolean
  selectableTextModels: ChatModel[]
  selectedActModel: string
} & ModelSelectionControls) {
  useEffect(() => {
    if (!chatPrefsHydrated || !modelCatalogReady || !isByokModelId(selectedActModel)) return
    if (selectableTextModels.some((model) => model.id === selectedActModel)) return
    const fallbackModelId = selectableTextModels[0]?.id ?? FREE_TIER_AUTO_MODEL_ID
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent
    setSelectedModels([fallbackModelId])
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent
    setSelectedActModel(fallbackModelId)
  }, [
    chatPrefsHydrated,
    modelCatalogReady,
    selectableTextModels,
    selectedActModel,
    setSelectedActModel,
    setSelectedModels,
  ])
}

function useFreeTierModelSelection({
  activeChatId,
  chatPrefsHydrated,
  isModelAccessRestricted,
  selectedActModel,
  setSelectedActModel,
  setSelectedModels,
}: {
  activeChatId: string | null
  chatPrefsHydrated: boolean
  isModelAccessRestricted: boolean
  selectedActModel: string
} & ModelSelectionControls) {
  useEffect(() => {
    if (!chatPrefsHydrated || !isModelAccessRestricted || activeChatId) return
    if (isByokModelId(selectedActModel)) return
    if (isFreeTierChatModelId(selectedActModel) && !isLegacyFreeTierDefaultModelId(selectedActModel)) return

    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent
    setSelectedModels([FREE_TIER_AUTO_MODEL_ID])
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent
    setSelectedActModel(FREE_TIER_AUTO_MODEL_ID)
  }, [
    activeChatId,
    chatPrefsHydrated,
    isModelAccessRestricted,
    selectedActModel,
    setSelectedActModel,
    setSelectedModels,
  ])
}

function useZdrModelSelection({
  activeChatId,
  chatPrefsHydrated,
  effectiveOnlyAllowZdrModels,
  selectableTextModels,
  selectedActModel,
  selectedModels,
  setSelectedActModel,
  setSelectedModels,
}: {
  activeChatId: string | null
  chatPrefsHydrated: boolean
  effectiveOnlyAllowZdrModels: boolean
  selectableTextModels: ChatModel[]
  selectedActModel: string
  selectedModels: string[]
} & ModelSelectionControls) {
  useEffect(() => {
    if (!chatPrefsHydrated || !effectiveOnlyAllowZdrModels) return
    const fallback = selectableTextModels[0]?.id ?? DEFAULT_MODEL_ID
    const nextSelected = selectedModels.filter((id) => modelSupportsZeroDataRetention(id)).slice(0, 1)
    const resolvedSelected = nextSelected.length > 0 ? nextSelected : [fallback]
    const nextActModel = modelSupportsZeroDataRetention(selectedActModel) ? selectedActModel : resolvedSelected[0]!
    const changed =
      resolvedSelected.length !== selectedModels.length ||
      resolvedSelected.some((id, index) => id !== selectedModels[index]) ||
      nextActModel !== selectedActModel
    if (!changed) return
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent
    setSelectedModels(resolvedSelected)
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent
    setSelectedActModel(nextActModel)
  }, [
    activeChatId,
    chatPrefsHydrated,
    effectiveOnlyAllowZdrModels,
    selectableTextModels,
    selectedActModel,
    selectedModels,
    setSelectedActModel,
    setSelectedModels,
  ])
}

function applyFetchedEntitlements(
  data: Entitlements,
  {
    announcedBudgetExhaustedRef,
    setAutoTopUpEnabledDraft,
    setComposerNotice,
    setEntitlements,
    setTopUpAmountDraftCents,
  }: {
    announcedBudgetExhaustedRef: { current: boolean }
    setAutoTopUpEnabledDraft: (value: boolean) => void
    setComposerNotice: ComposerNoticeSetter
    setEntitlements: (value: Entitlements | null) => void
    setTopUpAmountDraftCents: (value: number) => void
  },
) {
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
}

const WORKSPACE_BILLING_PATH = '/app/settings?section=workspace&workspace_tab=billing'

/** Credit and top-ups belong to the workspace, so both actions open Workspace → Billing. */
function useTopUpActions() {
  const router = useRouter()
  const openWorkspaceBilling = useCallback(async () => {
    router.push(WORKSPACE_BILLING_PATH)
  }, [router])
  return { handleStartTopUp: openWorkspaceBilling, handleSaveTopUpPreference: openWorkspaceBilling }
}

function resolveEntitlementDerived(
  entitlements: Entitlements | null,
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

export function useChatBillingControls({
  activeChatId,
  activeWorkspaceId,
  billingEnabled,
  catalogRevision,
  modelCatalogVersion,
  modelCatalogReady = true,
  chatPrefsHydrated,
  onlyAllowZdrModels,
  selectedActModel,
  selectedModels,
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
  pathname: string
  router: ChatRouter
  searchParams: ChatSearchParams
  selectedActModel: string
  selectedModels: string[]
  setComposerNotice: ComposerNoticeSetter
  setSelectedActModel: (modelId: string) => void
  setSelectedModels: (modelIds: string[]) => void
}) {
  const [topUpAmountDraftCents, setTopUpAmountDraftCents] = useState(800)
  const [autoTopUpEnabledDraft, setAutoTopUpEnabledDraft] = useState(false)
  const [billingActionLoading] = useState<'checkout' | 'save' | null>(null)
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null)
  const announcedBudgetExhaustedRef = useRef(false)

  const {
    isPaidSubscription,
    budgetTotalCents,
    budgetUsedCents,
    budgetRemainingCents,
    isBudgetExhaustedPaid,
    isFreeTier,
    isModelAccessRestricted,
    effectiveOnlyAllowZdrModels,
  } = resolveEntitlementDerived(entitlements, billingEnabled, onlyAllowZdrModels)
  // catalogRevision is required: getModelsByIntelligence reads module-level AVAILABLE_MODELS
  // which mutates when the gateway catalog registers.
  const selectableTextModels = useMemo(() => {
    void catalogRevision
    void modelCatalogVersion
    const availableTextModels = getModelsByIntelligence(isModelAccessRestricted)
      .filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2')
    return effectiveOnlyAllowZdrModels
      ? availableTextModels.filter((model) => model.supportsZeroDataRetention)
      : availableTextModels
  }, [catalogRevision, effectiveOnlyAllowZdrModels, isModelAccessRestricted, modelCatalogVersion])
  const premiumModelBlocked =
    isModelAccessRestricted &&
    !isByokModelId(selectedActModel) &&
    !isFreeTierChatModelId(selectedActModel)
  const isSendBlocked = premiumModelBlocked

  useByokModelFallback({
    chatPrefsHydrated,
    modelCatalogReady,
    selectableTextModels,
    selectedActModel,
    setSelectedActModel,
    setSelectedModels,
  })

  useFreeTierModelSelection({
    activeChatId,
    chatPrefsHydrated,
    isModelAccessRestricted,
    selectedActModel,
    setSelectedActModel,
    setSelectedModels,
  })

  useZdrModelSelection({
    activeChatId,
    chatPrefsHydrated,
    effectiveOnlyAllowZdrModels,
    selectableTextModels,
    selectedActModel,
    selectedModels,
    setSelectedActModel,
    setSelectedModels,
  })

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
        applyFetchedEntitlements(data, {
          announcedBudgetExhaustedRef,
          setAutoTopUpEnabledDraft,
          setComposerNotice,
          setEntitlements,
          setTopUpAmountDraftCents,
        })
        return data
      }
    } catch { /* ignore */ }
    return null
  }, [activeWorkspaceId, billingEnabled, setComposerNotice])

  const { handleStartTopUp, handleSaveTopUpPreference } = useTopUpActions()

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

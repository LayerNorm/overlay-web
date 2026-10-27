'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_MODEL_ID,
  FREE_TIER_AUTO_MODEL_ID,
  isFreeTierChatModelId,
  isLegacyFreeTierDefaultModelId,
  type ChatModel,
} from '@/shared/ai/gateway/model-types'
import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { useRouter } from 'next/navigation'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { toast } from '@overlay/ui/primitives'
import type { Entitlements } from '../chat-interface/types'
import {
  budgetRemainingCentsFor,
  isTextModelLocked,
  useWorkspaceTextModelAccess,
} from '@/components/providers/useWorkspaceTextModelAccess'
import { CONNECTION_UNAVAILABLE_NOTICE, hasUnavailableByokModel } from './chat-composer-blocking'
import { showUsageExhaustedToast, WORKSPACE_BILLING_PATH } from './usage-exhausted-toast'

type ChatRouter = {
  replace: (href: string) => void
  push: (href: string) => void
}

type ChatSearchParams = {
  get: (name: string) => string | null
  toString: () => string
} | null

type ComposerNoticeSetter = (value: string | null | ((current: string | null) => string | null)) => void

type ModelSelectionControls = {
  setSelectedActModel: (modelId: string) => void
  setSelectedModels: (modelIds: string[]) => void
}

function useByokModelAvailability({
  chatPrefsHydrated,
  modelCatalogReady,
  selectableTextModels,
  selectedActModel,
  selectedModels,
  setComposerNotice,
}: {
  chatPrefsHydrated: boolean
  modelCatalogReady: boolean
  selectableTextModels: ChatModel[]
  selectedActModel: string
  selectedModels: string[]
  setComposerNotice: ComposerNoticeSetter
}) {
  const unavailable = hasUnavailableByokModel({
    chatPrefsHydrated,
    modelCatalogReady,
    selectableTextModels,
    selectedActModel,
    selectedModels,
  })
  useEffect(() => {
    setComposerNotice((current) => unavailable ? CONNECTION_UNAVAILABLE_NOTICE : current === CONNECTION_UNAVAILABLE_NOTICE ? null : current)
  }, [unavailable, setComposerNotice])
  return unavailable
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
    if ([selectedActModel, ...selectedModels].some(isByokModelId)) return
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
    router,
    setTopUpAmountDraftCents,
  }: {
    announcedBudgetExhaustedRef: { current: boolean }
    setAutoTopUpEnabledDraft: (value: boolean) => void
    router: ChatRouter
    setTopUpAmountDraftCents: (value: number) => void
  },
) {
  setTopUpAmountDraftCents(data.topUpAmountCents ?? data.autoTopUpAmountCents ?? 800)
  setAutoTopUpEnabledDraft(Boolean(data.autoTopUpEnabled))
  const planKind = data.planKind ?? (data.tier === 'free' ? 'free' : 'paid')
  const exhausted = planKind === 'paid' && budgetRemainingCentsFor(data) <= 0
  if (exhausted && !announcedBudgetExhaustedRef.current) {
    announcedBudgetExhaustedRef.current = true
    showUsageExhaustedToast(router, 'paid')
  } else if (!exhausted) {
    announcedBudgetExhaustedRef.current = false
    toast.dismiss('usage-exhausted')
  }
}

/** Credit and top-ups belong to the workspace, so both actions open Workspace → Billing. */
function useTopUpActions() {
  const router = useRouter()
  const openWorkspaceBilling = useCallback(async () => {
    router.push(WORKSPACE_BILLING_PATH)
  }, [router])
  return { handleStartTopUp: openWorkspaceBilling, handleSaveTopUpPreference: openWorkspaceBilling }
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
  router,
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
  const announcedBudgetExhaustedRef = useRef(false)

  const handleEntitlementsFetched = useCallback((data: Entitlements) => {
    applyFetchedEntitlements(data, {
      announcedBudgetExhaustedRef,
      setAutoTopUpEnabledDraft,
      router,
      setTopUpAmountDraftCents,
    })
  }, [router])
  const modelAccess = useWorkspaceTextModelAccess<Entitlements>({
    activeWorkspaceId,
    billingEnabled,
    catalogRevision,
    modelCatalogVersion,
    onlyAllowZdrModels,
    onEntitlementsFetched: handleEntitlementsFetched,
  })
  const {
    isPaidSubscription,
    budgetTotalCents,
    budgetUsedCents,
    budgetRemainingCents,
    isBudgetExhaustedPaid,
    isFreeTier,
    isModelAccessRestricted,
    effectiveOnlyAllowZdrModels,
    entitlements,
    loadSubscription,
    pickerTextModels,
    selectableTextModels,
  } = modelAccess
  const premiumModelBlocked = isTextModelLocked(selectedActModel, isModelAccessRestricted)
  const connectionUnavailable = useByokModelAvailability({
    chatPrefsHydrated,
    modelCatalogReady,
    selectableTextModels,
    selectedActModel,
    selectedModels,
    setComposerNotice,
  })
  const isSendBlocked = premiumModelBlocked || connectionUnavailable

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
    pickerTextModels,
    premiumModelBlocked,
    connectionUnavailable,
    selectableTextModels,
    isModelAccessRestricted,
    setAutoTopUpEnabledDraft,
    setTopUpAmountDraftCents,
    topUpAmountDraftCents,
  }
}

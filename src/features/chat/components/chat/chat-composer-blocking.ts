import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { EXECUTION_ACCESS_MESSAGES } from '@/shared/billing/execution-access'

export const CONNECTION_UNAVAILABLE_NOTICE =
  'This model connection is unavailable. Reconnect it in Settings > Providers or choose another model. No fallback has been selected.'

const BUDGET_EXHAUSTED_NOTICE =
  'Budget exhausted. Add credit to continue model execution.'

export function getBillingAccessNotice({
  billingEnabled,
  hasEntitlements,
  loading,
}: {
  billingEnabled: boolean
  hasEntitlements: boolean
  loading: boolean
}): string | null {
  if (!billingEnabled || hasEntitlements) return null
  return loading
    ? 'Checking workspace access...'
    : 'Workspace access could not be verified. Reload to try again.'
}

export function hasUnavailableByokModel({
  chatPrefsHydrated,
  modelCatalogReady,
  selectableTextModels,
  selectedActModel,
  selectedModels,
}: {
  chatPrefsHydrated: boolean
  modelCatalogReady: boolean
  selectableTextModels: readonly { id: string }[]
  selectedActModel: string
  selectedModels: readonly string[]
}) {
  return chatPrefsHydrated && modelCatalogReady && [selectedActModel, ...selectedModels].some((id) =>
    isByokModelId(id) && !selectableTextModels.some((model) => model.id === id),
  )
}

export function shouldShowPaidModelReplacement({
  billingAccessNotice,
  isBudgetExhaustedPaid,
  premiumModelBlocked,
}: {
  billingAccessNotice: string | null
  isBudgetExhaustedPaid: boolean
  premiumModelBlocked: boolean
}) {
  return billingAccessNotice === null && premiumModelBlocked && !isBudgetExhaustedPaid
}

export function getBlockedSendNotice({
  connectionUnavailable,
  isBudgetExhaustedPaid,
  premiumModelBlocked,
}: {
  connectionUnavailable: boolean
  isBudgetExhaustedPaid: boolean
  premiumModelBlocked: boolean
}) {
  if (isBudgetExhaustedPaid) return BUDGET_EXHAUSTED_NOTICE
  if (connectionUnavailable && !premiumModelBlocked) return CONNECTION_UNAVAILABLE_NOTICE
  if (premiumModelBlocked) return EXECUTION_ACCESS_MESSAGES.subscription_required
  return null
}

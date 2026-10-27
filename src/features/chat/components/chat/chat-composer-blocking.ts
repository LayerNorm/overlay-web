import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

export const CONNECTION_UNAVAILABLE_NOTICE =
  'This model connection is unavailable. Reconnect it in Settings > Providers or choose another model. No fallback has been selected.'

const BUDGET_EXHAUSTED_NOTICE =
  'Budget exhausted. Add a top-up to continue with paid models, or switch to Auto for free chat.'
const PAID_MODEL_BLOCKED_NOTICE = 'This model requires a paid plan. Switch to Auto or upgrade.'

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
  isBudgetExhaustedPaid,
  premiumModelBlocked,
}: {
  isBudgetExhaustedPaid: boolean
  premiumModelBlocked: boolean
}) {
  return premiumModelBlocked && !isBudgetExhaustedPaid
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
  if (premiumModelBlocked) return PAID_MODEL_BLOCKED_NOTICE
  return null
}

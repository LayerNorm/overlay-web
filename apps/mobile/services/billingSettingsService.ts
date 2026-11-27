import { appJson } from './appApi'

export interface BillingSettings {
  planKind: 'free' | 'paid'
  autoTopUpEnabled: boolean
  topUpAmountCents: number
  autoTopUpAmountCents: number
  offSessionConsentAt?: number
  topUpMinAmountCents: number
  topUpMaxAmountCents: number
  topUpStepAmountCents: number
}

export async function getBillingSettings(): Promise<BillingSettings> {
  return appJson<BillingSettings>('/api/v1/subscription/settings')
}

export async function updateBillingSettings(input: {
  autoTopUpEnabled: boolean
  topUpAmountCents: number
  grantOffSessionConsent?: boolean
}): Promise<{ success: boolean }> {
  return appJson<{ success: boolean }>('/api/v1/subscription/settings', {
    method: 'POST',
    json: input,
  })
}

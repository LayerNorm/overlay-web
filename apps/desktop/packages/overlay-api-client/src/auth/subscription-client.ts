import type {
  BillingSettings,
  Entitlements,
  UpdateBillingSettingsRequest,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'

export class SubscriptionClient {
  constructor(private readonly http: HttpContext) {}

  get(init?: RequestInit) {
    return this.http.json<Entitlements>('/api/v1/subscription', init)
  }

  getResponse(init?: RequestInit) {
    return this.http.request('/api/v1/subscription', init)
  }

  getSettings(init?: RequestInit) {
    return this.http.json<BillingSettings>('/api/v1/subscription/settings', init)
  }

  getSettingsResponse(init?: RequestInit) {
    return this.http.request('/api/v1/subscription/settings', init)
  }

  updateSettings(body: UpdateBillingSettingsRequest, init?: RequestInit) {
    return this.http.json<BillingSettings>(
      '/api/v1/subscription/settings',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  updateSettingsResponse(body: UpdateBillingSettingsRequest, init?: RequestInit) {
    return this.http.request('/api/v1/subscription/settings', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }
}

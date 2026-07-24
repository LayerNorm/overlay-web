import type {
  BillingPortalRequest,
  BillingPortalResponse,
  CheckoutVerifyRequest,
  CheckoutVerifyResponse,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'

export class BillingClient {
  constructor(private readonly http: HttpContext) {}

  portal(body: BillingPortalRequest, init?: RequestInit) {
    return this.http.json<BillingPortalResponse>('/api/portal', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  portalResponse(body: BillingPortalRequest, init?: RequestInit) {
    return this.http.request('/api/portal', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  verifyCheckout(body: CheckoutVerifyRequest, init?: RequestInit) {
    return this.http.json<CheckoutVerifyResponse>(
      '/api/checkout/verify',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  verifyCheckoutResponse(body: CheckoutVerifyRequest, init?: RequestInit) {
    return this.http.request('/api/checkout/verify', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }
}

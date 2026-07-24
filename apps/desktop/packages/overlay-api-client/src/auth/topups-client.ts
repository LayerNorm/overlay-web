import type {
  TopUpCheckoutRequest,
  TopUpCheckoutResponse,
  TopUpHistoryResponse,
  TopUpVerifyRequest,
  TopUpVerifyResponse,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'

export class TopUpsClient {
  constructor(private readonly http: HttpContext) {}

  history(init?: RequestInit) {
    return this.http.json<TopUpHistoryResponse>('/api/topups/history', init)
  }

  historyResponse(init?: RequestInit) {
    return this.http.request('/api/topups/history', init)
  }

  checkout(body: TopUpCheckoutRequest, init?: RequestInit) {
    return this.http.json<TopUpCheckoutResponse>(
      '/api/topups/checkout',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  checkoutResponse(body: TopUpCheckoutRequest, init?: RequestInit) {
    return this.http.request('/api/topups/checkout', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  verify(body: TopUpVerifyRequest, init?: RequestInit) {
    return this.http.json<TopUpVerifyResponse>(
      '/api/topups/verify',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  verifyResponse(body: TopUpVerifyRequest, init?: RequestInit) {
    return this.http.request('/api/topups/verify', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }
}

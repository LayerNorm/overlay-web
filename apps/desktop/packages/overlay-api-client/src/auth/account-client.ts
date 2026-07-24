import type {
  AccountEntitlements,
  DesktopLinkRequest,
  DesktopLinkResponse,
} from '@overlay/app-core'
import type { HttpContext } from '../shared/http'

export class AccountClient {
  constructor(private readonly http: HttpContext) {}

  entitlements(init?: RequestInit) {
    return this.http.json<AccountEntitlements>('/api/entitlements', init)
  }

  entitlementsResponse(init?: RequestInit) {
    return this.http.request('/api/entitlements', init)
  }

  desktopLink(body: DesktopLinkRequest, init?: RequestInit) {
    return this.http.json<DesktopLinkResponse>(
      '/api/auth/desktop-link',
      this.http.jsonRequest(body, { ...init, method: 'POST' }),
    )
  }

  desktopLinkResponse(body: DesktopLinkRequest, init?: RequestInit) {
    return this.http.request('/api/auth/desktop-link', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }

  deleteResponse(body: Record<string, unknown> = {}, init?: RequestInit) {
    return this.http.request('/api/account/delete', this.http.jsonRequest(body, { ...init, method: 'POST' }))
  }
}

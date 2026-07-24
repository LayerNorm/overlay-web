import type { AppBootstrapResponse } from '@overlay/app-core'
import type { HttpContext } from '../shared/http'

export class BootstrapClient {
  constructor(private readonly http: HttpContext) {}

  get(init?: RequestInit) {
    return this.http.json<AppBootstrapResponse>('/api/v1/bootstrap', init)
  }

  getResponse(init?: RequestInit) {
    return this.http.request('/api/v1/bootstrap', init)
  }
}

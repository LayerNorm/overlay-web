import type { AppSettings } from '@overlay/app-core'
import type { HttpContext } from '../shared/http'

export class SettingsClient {
  constructor(private readonly http: HttpContext) {}

  get(init?: RequestInit) {
    return this.http.json<AppSettings>('/api/v1/settings', init)
  }

  getResponse(init?: RequestInit) {
    return this.http.request('/api/v1/settings', init)
  }

  update(body: Partial<AppSettings>, init?: RequestInit) {
    return this.http.json<AppSettings>('/api/v1/settings', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }

  updateResponse(body: Partial<AppSettings>, init?: RequestInit) {
    return this.http.request('/api/v1/settings', this.http.jsonRequest(body, { ...init, method: 'PATCH' }))
  }
}

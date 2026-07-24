import type { HttpContext } from '../shared/http'
import type { OverlayServerDiscovery } from './types'

export class DiscoveryClient {
  constructor(private readonly http: HttpContext) {}

  get(init?: RequestInit) {
    return this.http.json<OverlayServerDiscovery>('/api/v1/discovery', init)
  }
}

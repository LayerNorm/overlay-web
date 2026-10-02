import type { HttpContext } from '../shared/http'

export type ProviderAccountResource = {
  id: string
  provider: 'claude-code' | 'codex'
  method: 'subscription' | 'api_key'
  label: string
  status: 'active' | 'needs_reauth'
  lastError?: string
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}

/**
 * The person's own Claude Code and Codex accounts. Responses never include a
 * credential; a secret is only ever sent, never read back.
 */
export class ProviderAccountsClient {
  constructor(private readonly http: HttpContext) {}

  list(init?: RequestInit) {
    return this.http.json<{ data: ProviderAccountResource[] }>('/api/v1/provider-accounts', init)
  }

  connect(
    input: { provider: ProviderAccountResource['provider']; method: ProviderAccountResource['method']; secret: string; label?: string },
    init?: RequestInit,
  ) {
    return this.http.json<{ account: ProviderAccountResource }>(
      '/api/v1/provider-accounts',
      this.http.jsonRequest(input, { ...init, method: 'POST' }),
    )
  }

  reconnect(accountId: string, secret: string, init?: RequestInit) {
    return this.http.json<{ account: ProviderAccountResource }>(
      '/api/v1/provider-accounts',
      this.http.jsonRequest({ accountId, secret }, { ...init, method: 'PATCH' }),
    )
  }

  rename(accountId: string, label: string, init?: RequestInit) {
    return this.http.json<{ ok: true }>(
      '/api/v1/provider-accounts',
      this.http.jsonRequest({ accountId, label }, { ...init, method: 'PATCH' }),
    )
  }

  remove(accountId: string, init?: RequestInit) {
    return this.http.json<{ ok: true }>(
      `/api/v1/provider-accounts?accountId=${encodeURIComponent(accountId)}`,
      { ...init, method: 'DELETE' },
    )
  }
}

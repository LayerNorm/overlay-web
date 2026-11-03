import 'server-only'

export type BridgeCredential = {
  backend: 'cliproxyapi'
  version: 1
  providerId: 'codex'
  metadata: unknown
  expiresAt: number
  displayName?: string
}

export type BridgePendingState = {
  backend: 'cliproxyapi'
  version: 1
  providerId: 'codex'
  metadata: unknown
  expiresAt: number
  interval: number
}

const safeError = 'The subscription service could not complete this request.'

export class SubscriptionBridgeError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message)
  }
}

export function isBridgeCredential(value: unknown): value is BridgeCredential {
  return Boolean(value && typeof value === 'object' &&
    'backend' in value && value.backend === 'cliproxyapi' &&
    'version' in value && value.version === 1 &&
    'providerId' in value && value.providerId === 'codex' &&
    'metadata' in value && isRecord(value.metadata) &&
    'expiresAt' in value && typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) && value.expiresAt > 0)
}

export function isBridgePendingState(value: unknown): value is BridgePendingState {
  return isBridgeCredential(value) && 'interval' in value &&
    typeof value.interval === 'number' && Number.isFinite(value.interval) &&
    value.interval >= 1 && value.interval <= 30 && value.expiresAt > Date.now()
}

export class SubscriptionBridgeClient {
  constructor(
    private readonly serviceUrl = process.env.OVERLAY_CLIPROXYAPI_URL,
    private readonly secret = process.env.OVERLAY_CLIPROXYAPI_SECRET,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    if (!this.serviceUrl || !this.secret || this.secret.length < 32) return false
    try {
      const url = new URL(this.serviceUrl)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch (_error) {
      return false
    }
  }

  async authorize() {
    const value = await this.request<unknown>('/internal/v1/authorize', {})
    if (!isRecord(value) || !isRecord(value.authorization) ||
        typeof value.authorization.url !== 'string' ||
        typeof value.authorization.userCode !== 'string' ||
        typeof value.authorization.expiresAt !== 'number' ||
        !Number.isFinite(value.authorization.expiresAt) ||
        value.authorization.expiresAt <= Date.now() ||
        typeof value.authorization.interval !== 'number' ||
        !Number.isFinite(value.authorization.interval) ||
        value.authorization.interval < 1 || value.authorization.interval > 30 ||
        !isBridgePendingState(value.pendingState)) throw new Error(safeError)
    return value as {
      authorization: { url: string; userCode: string; expiresAt: number; interval: number }
      pendingState: BridgePendingState
    }
  }

  async poll(pendingState: BridgePendingState) {
    const value = await this.request<unknown>('/internal/v1/poll', { pendingState })
    if (!isRecord(value) || (value.status !== 'pending' && value.status !== 'connected') ||
        (value.credential !== undefined && !isBridgeCredential(value.credential)) ||
        (value.status === 'connected' && !isBridgeCredential(value.credential))) throw new Error(safeError)
    return value as {
      status: 'pending' | 'connected'
      credential?: BridgeCredential
    }
  }

  async refresh(credential: BridgeCredential) {
    const value = await this.request<unknown>('/internal/v1/refresh', { credential })
    if (!isRecord(value) || !isBridgeCredential(value.credential)) throw new Error(safeError)
    return value as { credential: BridgeCredential }
  }

  async models(credential: BridgeCredential) {
    const value = await this.request<unknown>('/internal/v1/models', { credential })
    if (!isRecord(value) || value.source !== 'provider_catalog' || !Array.isArray(value.models) ||
        !value.models.every((model) => isRecord(model) &&
          typeof model.id === 'string' && typeof model.name === 'string')) throw new Error(safeError)
    return value as { models: Array<{ id: string; name: string }>; source: 'provider_catalog' }
  }

  async infer(
    request: { connectionId: string; credential: BridgeCredential; modelId: string; request: unknown },
    signal?: AbortSignal,
  ): Promise<Response> {
    return await this.send('/internal/v1/infer', request, signal)
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await this.send(path, body, AbortSignal.timeout(30_000))
    if (!response.ok) throw await this.safeFailure(response)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 2_000_000) throw new Error(safeError)
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as T
    } catch (_error) {
      throw new Error(safeError)
    }
  }

  private async send(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    if (!this.isConfigured()) throw new Error('Codex subscriptions are unavailable until the private service is configured.')
    const url = new URL(path, this.serviceUrl)
    return await this.fetcher(url, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${this.secret}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
  }

  private async safeFailure(response: Response): Promise<Error> {
    let code: unknown
    try {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > 2_000_000) return new Error(safeError)
      const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (body && typeof body === 'object' && 'error' in body &&
          body.error && typeof body.error === 'object' && 'code' in body.error) {
        code = body.error.code
      }
    } catch (_error) { /* use the generic safe error */ }
    if (typeof code === 'string' && ['reconnect_required', 'model_unavailable',
      'rate_limited', 'provider_unavailable', 'temporary_failure'].includes(code)) {
      const messages: Record<string, string> = {
        reconnect_required: 'Reconnect your Codex subscription to continue.',
        model_unavailable: 'This Codex model is unavailable for the connected account.',
        rate_limited: 'Codex is rate-limiting requests. Retry later.',
        provider_unavailable: 'Codex is temporarily unavailable. Retry later.',
        temporary_failure: 'The subscription service is temporarily unavailable. Retry later.',
      }
      return new SubscriptionBridgeError(code, response.status, messages[code]!)
    }
    if (response.status === 401 || response.status === 403) {
      return new Error('The private subscription service rejected the request.')
    }
    return new Error(safeError)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

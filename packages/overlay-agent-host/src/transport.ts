import {
  canonicalHostRequestProof,
  environmentCredentialResponseSchema,
  OVERLAY_AGENT_PROTOCOL_VERSION,
  localToolPollResponseSchema,
  localToolResultSchema,
  LOCAL_TOOL_POLL_WAIT_MAX_MS,
  type EnvironmentCredentialResponse,
  type FilesystemGrant,
  type HostCapabilities,
  type LocalToolPollResponse,
  type LocalToolResult,
} from '@layernorm/overlay-agent-bridge-protocol'
import { createHash, randomBytes, sign } from 'node:crypto'

/** A control-plane request that failed; `code` is the server's stable error code when it sent one. */
export class ControlPlaneRequestError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly requestId?: string) {
    // The request id matches this failure to Overlay's own log line for the same request.
    super(`control plane request failed with ${status}${code ? ` (${code})` : ''}${requestId ? ` [request ${requestId}]` : ''}`)
    this.name = 'ControlPlaneRequestError'
  }
}

export interface AgentControlPlaneClient {
  heartbeat(): Promise<void>
  updateCapabilities(capabilities: HostCapabilities): Promise<void>
  pollLocalToolCalls(args: { waitMs: number; signal?: AbortSignal }): Promise<Omit<LocalToolPollResponse, 'protocolVersion'>>
  submitLocalToolResult(result: LocalToolResult): Promise<void>
}

export type HttpControlPlaneClientOptions = {
  baseUrl: string
  environmentId: string
  credential: string
  credentialExpiresAt?: number
  privateKey?: string
  onCredentialRotated?: (credential: {
    token: string
    expiresAt: number
    filesystemGrant: FilesystemGrant
    methods: EnvironmentCredentialResponse['methods']
  }) => Promise<void> | void
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
}

/** Device-signed HTTPS client for the host's own environment routes. */
export class HttpAgentControlPlaneClient implements AgentControlPlaneClient {
  private readonly fetch: typeof globalThis.fetch
  private readonly requestTimeoutMs: number
  private credential: string
  private credentialExpiresAt?: number
  private refreshing?: Promise<EnvironmentCredentialResponse>

  constructor(private readonly options: HttpControlPlaneClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.requestTimeoutMs = options.requestTimeoutMs ?? 35_000
    this.credential = options.credential
    this.credentialExpiresAt = options.credentialExpiresAt
  }

  async heartbeat(): Promise<void> {
    await this.request(new URL('heartbeat', withSlash(this.options.baseUrl)), {
      method: 'POST', body: '', headers: { 'content-type': 'application/json' },
    })
  }

  async updateCapabilities(capabilities: HostCapabilities): Promise<void> {
    await this.request(new URL('capabilities', withSlash(this.options.baseUrl)), {
      method: 'PUT', body: JSON.stringify(capabilities), headers: { 'content-type': 'application/json' },
    })
  }

  async pollLocalToolCalls(args: { waitMs: number; signal?: AbortSignal }): Promise<Omit<LocalToolPollResponse, 'protocolVersion'>> {
    const url = new URL('local-tool-calls', withSlash(this.options.baseUrl))
    url.searchParams.set('environmentId', this.options.environmentId)
    url.searchParams.set('waitMs', String(Math.min(Math.max(args.waitMs, 0), LOCAL_TOOL_POLL_WAIT_MAX_MS)))
    const response = await this.request(url, { method: 'GET', signal: args.signal })
    return { calls: localToolPollResponseSchema.parse(await response.json()).calls }
  }

  async submitLocalToolResult(result: LocalToolResult): Promise<void> {
    const body = localToolResultSchema.parse(result)
    await this.request(new URL(`local-tool-calls/${encodeURIComponent(body.callId)}/result`, withSlash(this.options.baseUrl)), {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
    })
  }

  async refreshFilesystemGrant(): Promise<FilesystemGrant> {
    return (await this.refreshCredential()).filesystemGrant
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    if (this.options.privateKey && this.credentialExpiresAt &&
      this.credentialExpiresAt - Date.now() < 60_000 && !url.pathname.endsWith('/credentials/refresh')) {
      await this.refreshCredential()
    }
    const timeout = AbortSignal.timeout(this.requestTimeoutMs)
    const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout
    const body = typeof init.body === 'string' ? init.body : ''
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${this.credential}`)
    headers.set('x-overlay-protocol-version', String(OVERLAY_AGENT_PROTOCOL_VERSION))
    if (this.options.privateKey) {
      const timestamp = String(Date.now())
      const nonce = randomBytes(18).toString('base64url')
      const canonical = canonicalHostRequestProof({
        method: init.method ?? 'GET',
        pathname: `${url.pathname}${url.search}`,
        timestamp,
        nonce,
        bodySha256: sha256(body),
        tokenSha256: sha256(this.credential),
      })
      headers.set('x-overlay-agent-timestamp', timestamp)
      headers.set('x-overlay-agent-nonce', nonce)
      headers.set('x-overlay-agent-signature', sign(null, Buffer.from(canonical), this.options.privateKey).toString('base64url'))
    }
    const response = await this.fetch(url, { ...init, signal, headers })
    if (!response.ok) {
      const failure = await response.json().catch(() => null) as { code?: unknown } | null
      const requestId = response.headers?.get?.('x-overlay-request-id') ?? undefined
      throw new ControlPlaneRequestError(response.status, typeof failure?.code === 'string' ? failure.code : undefined,
        requestId && /^[A-Za-z0-9_.:-]{1,128}$/.test(requestId) ? requestId : undefined)
    }
    return response
  }

  private async refreshCredential(): Promise<EnvironmentCredentialResponse> {
    if (!this.refreshing) this.refreshing = this.rotateCredential()
    const pending = this.refreshing
    try { return await pending } finally { if (this.refreshing === pending) this.refreshing = undefined }
  }

  private async rotateCredential(): Promise<EnvironmentCredentialResponse> {
    const url = new URL('credentials/refresh', withSlash(this.options.baseUrl))
    const response = await this.request(url, { method: 'POST', body: '' })
    const rotated = environmentCredentialResponseSchema.parse(await response.json())
    if (rotated.environmentId !== this.options.environmentId) throw Error('Credential refresh scope does not match this host')
    this.credential = rotated.token
    this.credentialExpiresAt = rotated.expiresAt
    await this.options.onCredentialRotated?.({
      token: rotated.token, expiresAt: rotated.expiresAt, filesystemGrant: rotated.filesystemGrant, methods: rotated.methods,
    })
    return rotated
  }
}

function withSlash(value: string): string { return value.endsWith('/') ? value : `${value}/` }
function sha256(value: string) { return createHash('sha256').update(value).digest('hex') }

export function nextReconnectDelay(attempt: number, random = Math.random): number {
  const capped = Math.min(Math.max(attempt, 0), 8)
  const ceiling = Math.min(30_000, 250 * (2 ** capped))
  return Math.max(100, Math.floor(ceiling * (0.5 + random() * 0.5)))
}

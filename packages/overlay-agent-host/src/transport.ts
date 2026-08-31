import {
  canonicalHostRequestProof,
  commandPollResponseSchema,
  environmentCredentialResponseSchema,
  eventAcknowledgementSchema,
  eventBatchSchema,
  OVERLAY_AGENT_PROTOCOL_VERSION,
  type AgentHostCommand,
  type CommandAcknowledgement,
  type EventAcknowledgement,
  type EventBatch,
  type HostCapabilities,
  type ArtifactUploadRequest,
  type ArtifactUploadResponse,
  artifactUploadResponseSchema,
} from '@layernorm/overlay-agent-bridge-protocol'
import { createHash, randomBytes, sign } from 'node:crypto'

export interface AgentControlPlaneClient {
  pollCommands(args: { waitMs: number; signal?: AbortSignal }): Promise<{ commands: AgentHostCommand[]; retryAfterMs?: number }>
  acknowledgeCommand(acknowledgement: CommandAcknowledgement): Promise<void>
  uploadEvents(batch: EventBatch): Promise<EventAcknowledgement>
  heartbeat?(): Promise<void>
  updateCapabilities?(capabilities: HostCapabilities): Promise<void>
  createArtifactUpload?(input: ArtifactUploadRequest): Promise<ArtifactUploadResponse>
  uploadArtifactBytes?(upload: ArtifactUploadResponse, bytes: Uint8Array): Promise<void>
  completeArtifactUpload?(artifactId: string): Promise<void>
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
    filesystemGrant: import('@layernorm/overlay-agent-bridge-protocol').FilesystemGrant
  }) => Promise<void> | void
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
}

export class HttpAgentControlPlaneClient implements AgentControlPlaneClient {
  private readonly fetch: typeof globalThis.fetch
  private readonly requestTimeoutMs: number
  private credential: string
  private credentialExpiresAt?: number

  constructor(private readonly options: HttpControlPlaneClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.requestTimeoutMs = options.requestTimeoutMs ?? 35_000
    this.credential = options.credential
    this.credentialExpiresAt = options.credentialExpiresAt
  }

  async pollCommands(args: { waitMs: number; signal?: AbortSignal }): Promise<{ commands: AgentHostCommand[]; retryAfterMs?: number }> {
    const url = new URL('commands', withSlash(this.options.baseUrl))
    url.searchParams.set('environmentId', this.options.environmentId)
    url.searchParams.set('waitMs', String(Math.min(Math.max(args.waitMs, 0), 30_000)))
    const response = await this.request(url, { method: 'GET', signal: args.signal })
    const parsed = commandPollResponseSchema.parse(await response.json())
    return { commands: parsed.commands, ...(parsed.retryAfterMs === undefined ? {} : { retryAfterMs: parsed.retryAfterMs }) }
  }

  async acknowledgeCommand(acknowledgement: CommandAcknowledgement): Promise<void> {
    await this.request(new URL(`commands/${encodeURIComponent(acknowledgement.commandId)}/ack`, withSlash(this.options.baseUrl)), {
      method: 'POST', body: JSON.stringify(acknowledgement), headers: { 'content-type': 'application/json' },
    })
  }

  async uploadEvents(batch: EventBatch): Promise<EventAcknowledgement> {
    const validated = eventBatchSchema.parse(batch)
    const response = await this.request(new URL('events', withSlash(this.options.baseUrl)), {
      method: 'POST', body: JSON.stringify(validated), headers: { 'content-type': 'application/json' },
    })
    return eventAcknowledgementSchema.parse(await response.json())
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

  async createArtifactUpload(input: ArtifactUploadRequest): Promise<ArtifactUploadResponse> {
    const response = await this.request(new URL('artifacts', withSlash(this.options.baseUrl)), {
      method: 'POST', body: JSON.stringify(input), headers: { 'content-type': 'application/json' },
    })
    return artifactUploadResponseSchema.parse(await response.json())
  }

  async uploadArtifactBytes(upload: ArtifactUploadResponse, bytes: Uint8Array): Promise<void> {
    const response = await this.fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: bytes as BodyInit,
      signal: AbortSignal.timeout(this.requestTimeoutMs) })
    if (!response.ok) throw new Error(`artifact upload failed with ${response.status}`)
  }

  async completeArtifactUpload(artifactId: string): Promise<void> {
    await this.request(new URL(`artifacts/${encodeURIComponent(artifactId)}/complete`, withSlash(this.options.baseUrl)), {
      method: 'POST', body: JSON.stringify({ protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION, uploadReference: artifactId }),
      headers: { 'content-type': 'application/json' },
    })
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
    const response = await this.fetch(url, {
      ...init,
      signal,
      headers,
    })
    if (!response.ok) throw new Error(`control plane request failed with ${response.status}`)
    return response
  }

  private async refreshCredential(): Promise<void> {
    const url = new URL('credentials/refresh', withSlash(this.options.baseUrl))
    const response = await this.request(url, { method: 'POST', body: '' })
    const rotated = environmentCredentialResponseSchema.parse(await response.json())
    this.credential = rotated.token
    this.credentialExpiresAt = rotated.expiresAt
    await this.options.onCredentialRotated?.({
      token: rotated.token,
      expiresAt: rotated.expiresAt,
      filesystemGrant: rotated.filesystemGrant,
    })
  }
}

function withSlash(value: string): string { return value.endsWith('/') ? value : `${value}/` }
function sha256(value: string) { return createHash('sha256').update(value).digest('hex') }

export function nextReconnectDelay(attempt: number, random = Math.random): number {
  const capped = Math.min(Math.max(attempt, 0), 8)
  const ceiling = Math.min(30_000, 250 * (2 ** capped))
  return Math.max(100, Math.floor(ceiling * (0.5 + random() * 0.5)))
}

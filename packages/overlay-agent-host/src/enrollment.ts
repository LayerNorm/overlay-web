import { hostname, homedir, platform, release } from 'node:os'
import { join } from 'node:path'
import { sign } from 'node:crypto'
import {
  OVERLAY_AGENT_PROTOCOL_VERSION,
  canonicalEnrollmentProof,
  enrollmentResponseSchema,
  environmentCredentialResponseSchema,
  type HostCapabilities,
} from '@layernorm/agent-bridge-protocol'
import { saveStoredConnection, type StoredAgentConnection } from './connection.js'
import { loadOrCreateDeviceKeyPair } from './device-key.js'

export type ConnectAgentHostOptions = {
  code: string
  serverUrl: string
  stateDirectory?: string
  name?: string
  kind?: 'local' | 'vps' | 'overlay_cloud' | 'external'
  adapters?: HostCapabilities['adapters']
  fetch?: typeof globalThis.fetch
  waitTimeoutMs?: number
  onPendingApproval?: (value: { verificationPhrase: string; environmentId: string }) => void
}

export async function connectAgentHost(options: ConnectAgentHostOptions): Promise<StoredAgentConnection> {
  const fetcher = options.fetch ?? globalThis.fetch
  const stateDirectory = options.stateDirectory ?? join(homedir(), '.overlay', 'agent-host')
  const serverUrl = withoutSlash(new URL(options.serverUrl).toString())
  const keys = await loadOrCreateDeviceKeyPair(stateDirectory)
  const capabilities: HostCapabilities = {
    protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
    hostVersion: '0.0.1',
    platform: `${platform()} ${release()}`,
    adapters: options.adapters ?? [],
    filesystem: { mode: 'all_user_files' },
    maxConcurrentRuns: 1,
  }
  const enrollmentResponse = await fetcher(`${serverUrl}/api/v1/agent-environments/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: options.code,
      kind: options.kind ?? 'local',
      name: options.name?.trim() || hostname(),
      publicKey: keys.publicKey,
      hostVersion: capabilities.hostVersion,
      platform: capabilities.platform,
      capabilities,
    }),
  })
  if (!enrollmentResponse.ok) throw await responseError(enrollmentResponse, 'enrollment failed')
  const enrollment = enrollmentResponseSchema.parse(await enrollmentResponse.json())
  options.onPendingApproval?.({
    verificationPhrase: enrollment.verificationPhrase,
    environmentId: enrollment.environmentId,
  })

  const deadline = Date.now() + (options.waitTimeoutMs ?? 15 * 60_000)
  while (Date.now() < deadline) {
    const signature = sign(
      null,
      Buffer.from(canonicalEnrollmentProof(enrollment.environmentId, enrollment.proofChallenge)),
      keys.privateKey,
    ).toString('base64url')
    const response = await fetcher(
      `${serverUrl}/api/v1/agent-environments/${encodeURIComponent(enrollment.environmentId)}/credentials`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocolVersion: OVERLAY_AGENT_PROTOCOL_VERSION,
          proofChallenge: enrollment.proofChallenge,
          signature,
        }),
      },
    )
    if (response.ok) {
      const issued = environmentCredentialResponseSchema.parse(await response.json())
      const connection: StoredAgentConnection = {
        ...issued,
        serverUrl,
        controlPlaneUrl: `${serverUrl}/api/v1/agent-environments/${encodeURIComponent(issued.environmentId)}/`,
      }
      await saveStoredConnection(stateDirectory, connection)
      return connection
    }
    if (response.status !== 425) throw await responseError(response, 'credential issuance failed')
    await delay(2_500)
  }
  throw new Error('approval timed out; create a new enrollment code and try again')
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null
  const message = typeof body?.error === 'string' ? body.error : fallback
  const code = typeof body?.code === 'string' ? ` (${body.code})` : ''
  return new Error(`${message}${code}`)
}
function withoutSlash(value: string) { return value.endsWith('/') ? value.slice(0, -1) : value }
function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)) }

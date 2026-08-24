/** Provider-neutral sandbox primitives owned by Overlay. Provider SDK types must not cross this boundary. */

export type SandboxProviderId = 'vercel' | 'daytona'
export type SandboxLifecycleState =
  | 'provisioning'
  | 'running'
  | 'stopped'
  | 'archived'
  | 'failed'
  | 'deleted'

export type SandboxNetworkPolicy =
  | { mode: 'allow_all' }
  | { mode: 'deny_all' }
  | {
      mode: 'allowlist'
      domains?: string[]
      allowedCidrs?: string[]
      deniedCidrs?: string[]
    }

export type SandboxCredentialBinding = {
  /** Opaque broker-owned reference. It is never persisted in provider diagnostics. */
  brokerRef: string
  /** Placeholder environment variable visible to the sandbox process. */
  environmentVariable: string
  allowedDomains: string[]
}

export type SandboxCredentialMaterial = {
  headers: Record<string, string>
  placeholder?: string
}

export interface SandboxCredentialBroker {
  resolve(binding: SandboxCredentialBinding): Promise<SandboxCredentialMaterial>
}

export type SandboxResources = {
  vcpus?: number
  memoryGiB?: number
  diskGiB?: number
}

export type SandboxCreateRequest = {
  name: string
  image?: string
  snapshotId?: string
  persistent: boolean
  environment?: Record<string, string>
  ports?: number[]
  networkPolicy: SandboxNetworkPolicy
  credentials?: SandboxCredentialBinding[]
  /** Provider idle-stop setting. Zero disables it. */
  idleTimeoutMs: number
  /** Absolute provider/session runtime ceiling. */
  hardTimeoutMs: number
  resources?: SandboxResources
  metadata?: Record<string, string>
}

export type SandboxCommandRequest = {
  command: string
  args?: string[]
  cwd?: string
  environment?: Record<string, string>
  /** Start durably without opening a long-lived log stream in the caller. */
  detached?: boolean
  timeoutMs: number
  signal?: AbortSignal
}

export type SandboxCommandEvent = {
  sequence: number
  stream: 'stdout' | 'stderr'
  data: string
  occurredAt: number
}

export type SandboxCommandResult = {
  commandId: string
  exitCode: number
  stdout: string
  stderr: string
  startedAt: number
  endedAt: number
}

export interface SandboxCommandHandle {
  readonly id: string
  events(): AsyncIterable<SandboxCommandEvent>
  wait(): Promise<SandboxCommandResult>
  cancel(): Promise<void>
}

export type SandboxFileEntry = {
  path: string
  kind: 'file' | 'directory' | 'symlink' | 'other'
  size?: number
}

export type SandboxPort = {
  port: number
  url: string
  access: 'private' | 'public'
  expiresAt?: number
}

export type SandboxSnapshot = {
  id: string
  createdAt: number
  expiresAt?: number
}

export type SandboxUsage = {
  wallTimeMs?: number
  activeCpuTimeMs?: number
  cpuPercent?: number
  memoryBytes?: number
  ingressBytes?: number
  egressBytes?: number
  providerMetrics?: Record<string, number | string | boolean | null>
}

export type SandboxCapabilities = {
  commandStreaming: boolean
  files: boolean
  environmentVariables: boolean
  ports: boolean
  snapshots: boolean
  persistence: boolean
  networkPolicy: boolean
  networkPolicyUpdates: boolean
  credentialBrokering: boolean
  hardTimeout: boolean
  idleStop: boolean
  usage: boolean
}

export interface SandboxInstance {
  readonly provider: SandboxProviderId
  readonly reference: string
  readonly name: string
  readonly capabilities: SandboxCapabilities
  status(): Promise<SandboxLifecycleState>
  workingDirectory(): Promise<string>
  resume(): Promise<void>
  stop(): Promise<void>
  delete(): Promise<void>
  runCommand(request: SandboxCommandRequest): Promise<SandboxCommandHandle>
  writeFiles(files: Array<{ path: string; contents: Uint8Array; mode?: number }>): Promise<void>
  readFile(path: string): Promise<Uint8Array | null>
  listFiles(path: string): Promise<SandboxFileEntry[]>
  updateEnvironment(environment: Record<string, string>, unset?: string[]): Promise<void>
  updateNetworkPolicy(policy: SandboxNetworkPolicy): Promise<void>
  port(port: number): Promise<SandboxPort>
  snapshot(options?: { expiresInMs?: number }): Promise<SandboxSnapshot>
  usage(): Promise<SandboxUsage>
  /** Operator-only. Never serialize this value or expose it through Overlay's public API. */
  rawProviderDiagnosticHandle(): unknown
}

export interface SandboxRuntime {
  readonly provider: SandboxProviderId
  readonly capabilities: SandboxCapabilities
  create(request: SandboxCreateRequest): Promise<SandboxInstance>
  reconnect(reference: string): Promise<SandboxInstance>
  restore(snapshotId: string, request: Omit<SandboxCreateRequest, 'snapshotId'>): Promise<SandboxInstance>
  deleteSnapshot(snapshotId: string): Promise<void>
}

export const OVERLAY_AGENT_HOST_STATE_DIRECTORY = '/var/lib/overlay-agent-host'
export const OVERLAY_AGENT_HOST_WORKSPACE = '/workspace'

/** The same bootstrap is used for user-owned and managed hosts; only the surrounding machine differs. */
export function managedAgentHostCommand(input: {
  enrollmentCode: string
  serverUrl: string
  name: string
  adapters?: Array<'codex' | 'claude-code'>
}): SandboxCommandRequest {
  const adapters = input.adapters?.length ? input.adapters : ['codex', 'claude-code']
  return {
    command: 'overlay-agent-host',
    args: [
      'connect', input.enrollmentCode,
      '--server', input.serverUrl,
      '--state-dir', OVERLAY_AGENT_HOST_STATE_DIRECTORY,
      '--name', input.name,
      '--kind', 'overlay_cloud',
      '--run',
      ...adapters.flatMap((adapter) => ['--adapter', adapter]),
    ],
    cwd: OVERLAY_AGENT_HOST_WORKSPACE,
    detached: true,
    timeoutMs: 24 * 60 * 60_000,
  }
}

import { desktopAppJson } from './app-api-client'

/**
 * Minimal connected-agent shapes mirrored from `@overlay/workspace-contracts`
 * and the `AgentEnvironmentResource` in `@overlay/api-client`. Desktop vendors
 * its own copy so environment plumbing needs no new workspace package.
 */
export type EnvironmentKind = 'local' | 'vps' | 'overlay_cloud' | 'external'
export type EnvironmentStatus = 'pending' | 'online' | 'offline' | 'revoked'

export interface DesktopAgentEnvironment {
  id: string
  workspaceId: string
  kind: EnvironmentKind
  name: string
  status: EnvironmentStatus
  hostVersion?: string
  platform?: string
  capabilities?: Record<string, unknown>
  filesystemGrant?: { mode: 'selected_roots'; roots: string[] } | { mode: 'all_user_files' }
  verificationPhrase?: string
  lastSeenAt?: number
  createdAt: number
  updatedAt: number
}

export interface DesktopAgentBinding {
  id: string
  workspaceId: string
  agentId: string
  environmentId: string
  protocolAdapter: string
  adapterConfig: Record<string, unknown>
  enabled: boolean
}

export interface DesktopAgentDirectoryItem {
  id: string
  name: string
  kind?: string
  modelId?: string
}

export type DisplayEnvironmentStatus = EnvironmentStatus

/**
 * Offline threshold shared with the web settings surface: an `online` row
 * becomes effectively `offline` after 45 seconds without a heartbeat. The
 * server remains the source of truth; this only keeps the UI honest between
 * polls.
 */
export const ENVIRONMENT_OFFLINE_AFTER_MS = 45_000

export function deriveDisplayStatus(
  environment: Pick<DesktopAgentEnvironment, 'status' | 'lastSeenAt'>,
  now: number = Date.now()
): DisplayEnvironmentStatus {
  if (environment.status !== 'online') return environment.status
  if (
    typeof environment.lastSeenAt === 'number' &&
    now - environment.lastSeenAt > ENVIRONMENT_OFFLINE_AFTER_MS
  ) {
    return 'offline'
  }
  return 'online'
}

export function lastSeenLabel(lastSeenAt: number | undefined, now: number = Date.now()): string | null {
  if (typeof lastSeenAt !== 'number') return null
  const elapsed = Math.max(0, now - lastSeenAt)
  if (elapsed < 60_000) return 'seen just now'
  if (elapsed < 60 * 60_000) return `seen ${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 24 * 60 * 60_000) return `seen ${Math.floor(elapsed / (60 * 60_000))}h ago`
  return `seen ${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(['local', 'vps', 'overlay_cloud', 'external'])
const KNOWN_STATUSES: ReadonlySet<string> = new Set(['pending', 'online', 'offline', 'revoked'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeEnvironment(value: unknown): DesktopAgentEnvironment | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const name = asString(value.name)
  const kind = asString(value.kind)
  const status = asString(value.status)
  const createdAt = asNumber(value.createdAt)
  if (!id || !name || !kind || !status || createdAt === undefined) return null
  if (!KNOWN_KINDS.has(kind) || !KNOWN_STATUSES.has(status)) return null
  return {
    id,
    workspaceId: asString(value.workspaceId) ?? '',
    kind: kind as EnvironmentKind,
    name,
    status: status as EnvironmentStatus,
    hostVersion: asString(value.hostVersion),
    platform: asString(value.platform),
    capabilities: isRecord(value.capabilities)
      ? (value.capabilities as Record<string, unknown>)
      : undefined,
    filesystemGrant: isRecord(value.filesystemGrant)
      ? (value.filesystemGrant as DesktopAgentEnvironment['filesystemGrant'])
      : undefined,
    verificationPhrase: asString(value.verificationPhrase),
    lastSeenAt: asNumber(value.lastSeenAt),
    createdAt,
    updatedAt: asNumber(value.updatedAt) ?? createdAt
  }
}

function normalizeBinding(value: unknown): DesktopAgentBinding | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const agentId = asString(value.agentId)
  const environmentId = asString(value.environmentId)
  if (!id || !agentId || !environmentId) return null
  return {
    id,
    workspaceId: asString(value.workspaceId) ?? '',
    agentId,
    environmentId,
    protocolAdapter: asString(value.protocolAdapter) ?? 'acp',
    adapterConfig: isRecord(value.adapterConfig)
      ? (value.adapterConfig as Record<string, unknown>)
      : {},
    enabled: value.enabled !== false
  }
}

function normalizeAgentItem(value: unknown): DesktopAgentDirectoryItem | null {
  if (!isRecord(value)) return null
  const id = asString(value.id) ?? asString(value.agentId)
  const name = asString(value.name) ?? asString(value.title)
  if (!id || !name) return null
  return {
    id,
    name,
    kind: asString(value.kind),
    modelId: asString(value.modelId)
  }
}

function arrayField(value: unknown, field: string): unknown[] {
  if (!isRecord(value)) return []
  const fieldValue = value[field]
  return Array.isArray(fieldValue) ? fieldValue : []
}

export async function listEnvironments(): Promise<DesktopAgentEnvironment[]> {
  const raw = await desktopAppJson<unknown>('/api/v1/agent-environments')
  return arrayField(raw, 'environments')
    .map(normalizeEnvironment)
    .filter((environment): environment is DesktopAgentEnvironment => environment !== null)
}

export async function listBindings(agentId?: string): Promise<DesktopAgentBinding[]> {
  const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''
  const raw = await desktopAppJson<unknown>(`/api/v1/agent-bindings${query}`)
  return arrayField(raw, 'bindings')
    .map(normalizeBinding)
    .filter((binding): binding is DesktopAgentBinding => binding !== null)
}

export async function listAgents(): Promise<DesktopAgentDirectoryItem[]> {
  const raw = await desktopAppJson<unknown>('/api/v1/agents')
  const items = arrayField(raw, 'agents')
  const directory = items.length > 0 ? items : arrayField(raw, 'data')
  return directory
    .map(normalizeAgentItem)
    .filter((agent): agent is DesktopAgentDirectoryItem => agent !== null)
}

export type BuiltInHarnessId = 'codex' | 'claude-code' | 'hermes'

export const BUILT_IN_HARNESSES: ReadonlyArray<{ id: BuiltInHarnessId; label: string }> = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'hermes', label: 'Hermes' }
]

export interface EnrollmentSession {
  enrollmentSessionId: string
  code: string
  command: string
  expiresAt: number
}

export function parseRoots(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((root) => root.trim())
    .filter(Boolean)
}

/** Absolute roots only — the server rejects anything else, so fail fast locally. */
export function validateRoots(value: string): { roots: string[]; error: string | null } {
  const roots = parseRoots(value)
  if (roots.length === 0) return { roots, error: 'Enter at least one absolute project root.' }
  const relative = roots.find((root) => !root.startsWith('/'))
  if (relative) return { roots, error: `Roots must be absolute paths: ${relative}` }
  return { roots, error: null }
}

export async function createEnrollment(adapterId: BuiltInHarnessId): Promise<EnrollmentSession> {
  const raw = await desktopAppJson<unknown>('/api/v1/agent-environments/enrollment-sessions', {
    method: 'POST',
    body: JSON.stringify({ adapterId })
  })
  if (!isRecord(raw)) throw new Error('Could not create the connection command.')
  const command = asString(raw.command)
  const code = asString(raw.code)
  if (!command || !code) throw new Error('Could not create the connection command.')
  return {
    enrollmentSessionId: asString(raw.enrollmentSessionId) ?? '',
    code,
    command,
    expiresAt: asNumber(raw.expiresAt) ?? 0
  }
}

export async function approveEnvironment(
  environmentId: string,
  roots: string[]
): Promise<void> {
  await desktopAppJson<unknown>(
    `/api/v1/agent-environments/${encodeURIComponent(environmentId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ filesystemGrant: { mode: 'selected_roots', roots } })
    }
  )
}

export async function updateEnvironmentRoots(
  environmentId: string,
  roots: string[]
): Promise<void> {
  await desktopAppJson<unknown>(
    `/api/v1/agent-environments/${encodeURIComponent(environmentId)}/roots`,
    {
      method: 'PATCH',
      body: JSON.stringify({ filesystemGrant: { mode: 'selected_roots', roots } })
    }
  )
}

export async function revokeEnvironment(environmentId: string): Promise<void> {
  await desktopAppJson<unknown>(
    `/api/v1/agent-environments/${encodeURIComponent(environmentId)}/revoke`,
    { method: 'POST' }
  )
}

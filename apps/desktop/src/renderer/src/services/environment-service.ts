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
  description?: string
  instructions: string
  harness: 'overlay' | 'claude-code'
  modelId: string
  avatarColor?: string
  visibility: 'creator' | 'workspace'
  roomCount: number
  teamIds: string[]
  createdByDisplayName?: string
}

export interface DesktopAgentDirectory {
  agents: DesktopAgentDirectoryItem[]
  canCreate: boolean
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
  const harness = asString(value.harness)
  const visibility = asString(value.visibility)
  const teamIds = Array.isArray(value.teamIds)
    ? value.teamIds.filter((teamId): teamId is string => typeof teamId === 'string')
    : []
  return {
    id,
    name,
    description: asString(value.description),
    instructions: asString(value.instructions) ?? '',
    harness: harness === 'claude-code' ? 'claude-code' : 'overlay',
    modelId: asString(value.modelId) ?? '',
    avatarColor: asString(value.avatarColor),
    visibility: visibility === 'workspace' ? 'workspace' : 'creator',
    roomCount: asNumber(value.roomCount) ?? 0,
    teamIds,
    createdByDisplayName: asString(value.createdByDisplayName)
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

export async function fetchAgentDirectory(): Promise<DesktopAgentDirectory> {
  const raw = await desktopAppJson<unknown>('/api/v1/agents')
  const items = arrayField(raw, 'agents')
  const directory = items.length > 0 ? items : arrayField(raw, 'data')
  return {
    agents: directory
      .map(normalizeAgentItem)
      .filter((agent): agent is DesktopAgentDirectoryItem => agent !== null),
    canCreate: !isRecord(raw) || raw.canCreate !== false
  }
}

export async function listAgents(): Promise<DesktopAgentDirectoryItem[]> {
  return (await fetchAgentDirectory()).agents
}

export async function getAgent(agentId: string): Promise<DesktopAgentDirectoryItem> {
  const raw = await desktopAppJson<unknown>(
    `/api/v1/agents/${encodeURIComponent(agentId)}`
  )
  const agent = normalizeAgentItem(isRecord(raw) ? raw.agent ?? raw : null)
  if (!agent) throw new Error('Agent not found.')
  return agent
}

/* BYO harness helpers (ported from the web `byo-agent-setup` lib). */

export interface AcpAdapterCapability {
  id: string
  label: string
}

export interface ByoHarnessOption {
  id: string
  label: string
  description: string
  connectable: boolean
}

const HARNESS_DESCRIPTIONS: Record<BuiltInHarnessId, string> = {
  codex: 'Run OpenAI Codex through the Agent Client Protocol.',
  'claude-code': 'Run Anthropic Claude Code through the Agent Client Protocol.',
  hermes: 'Run Hermes 0.20.6 or newer through its official Agent Client Protocol server.'
}

export function acpAdaptersForEnvironment(
  environment: Pick<DesktopAgentEnvironment, 'capabilities'>
): AcpAdapterCapability[] {
  const adapters = environment.capabilities?.adapters
  if (!Array.isArray(adapters)) return []
  return (adapters as Array<Record<string, unknown>>).flatMap((adapter) =>
    adapter.protocol === 'acp' && typeof adapter.id === 'string'
      ? [
          {
            id: adapter.id,
            label: typeof adapter.displayName === 'string' ? adapter.displayName : adapter.id
          }
        ]
      : []
  )
}

export function availableByoHarnesses(
  environments: readonly DesktopAgentEnvironment[]
): ByoHarnessOption[] {
  const options = new Map<string, ByoHarnessOption>(
    BUILT_IN_HARNESSES.map((harness) => [
      harness.id,
      { id: harness.id, label: harness.label, description: HARNESS_DESCRIPTIONS[harness.id], connectable: true }
    ])
  )
  for (const environment of environments) {
    for (const adapter of acpAdaptersForEnvironment(environment)) {
      if (!options.has(adapter.id)) {
        options.set(adapter.id, {
          id: adapter.id,
          label: adapter.label,
          description: 'Use the ACP-compatible harness advertised by this environment.',
          connectable: false
        })
      }
    }
  }
  return [...options.values()]
}

export function environmentSupportsHarness(
  environment: DesktopAgentEnvironment,
  harnessId: string
): boolean {
  return acpAdaptersForEnvironment(environment).some((adapter) => adapter.id === harnessId)
}

export function defaultWorkingDirectory(
  environment: DesktopAgentEnvironment | undefined
): string {
  if (!environment?.filesystemGrant || environment.filesystemGrant.mode !== 'selected_roots') {
    return ''
  }
  return environment.filesystemGrant.roots[0] ?? ''
}

export function workspaceHarnessForByo(harnessId: string): 'overlay' | 'claude-code' {
  return harnessId === 'claude-code' ? 'claude-code' : 'overlay'
}

export function generatedByoInstructions(harnessLabel: string): string {
  return `Run delegated work through ${harnessLabel} in the connected environment. Stream user-visible progress and return a concise final result to Overlay.`
}

export function workspaceAgentUsesByo(
  agent: Pick<DesktopAgentDirectoryItem, 'harness' | 'modelId'> | null | undefined
): boolean {
  return Boolean(agent && (agent.harness !== 'overlay' || agent.modelId.startsWith('byo/')))
}

const HARNESS_LABELS: Record<string, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  hermes: 'Hermes'
}

export function harnessLabel(adapterId: string): string {
  return HARNESS_LABELS[adapterId] ?? adapterId
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

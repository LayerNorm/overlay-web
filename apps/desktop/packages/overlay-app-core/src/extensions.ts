import type {
  CreateMcpServerRequest,
  CreateSkillRequest,
  IntegrationProviderCapabilities,
  IntegrationSummary,
  McpAuthConfig,
  McpAuthType,
  McpServerSummary,
  McpToolPolicyMode,
  McpTransport,
  OverlayIntegrationRegistration,
  OverlayModelProviderRegistration,
  OverlayPolicyGate,
  OverlayToolRegistration,
  SkillSummary,
  TestMcpServerRequest,
  TestMcpServerResponse,
  UpdateMcpServerRequest,
  UpdateSkillRequest,
} from './contracts'

export const SKILLS_CHANGED_EVENT = 'overlay:skills-changed'
export const MCPS_CHANGED_EVENT = 'overlay:mcps-changed'
export const EXTENSIONS_CHANGED_EVENT = 'overlay:extensions-changed'

export interface ConnectorCatalogItem {
  id: string
  providerKey: string
  slug: string
  name: string
  description: string
  icon: string
  logoUrl?: string | null
  isConnected?: boolean
  connectedAccountId?: string | null
  provider?: IntegrationSummary['provider']
  capabilities?: IntegrationSummary['capabilities']
  authenticationState?: IntegrationSummary['authenticationState']
  connectionSetupUrl?: string | null
  componentKey?: string
  policyGateId?: string
}

export interface SkillFormValues {
  name: string
  description: string
  instructions: string
  enabled: boolean
}

export interface McpServerFormValues {
  name: string
  description: string
  transport: McpTransport
  url: string
  enabled: boolean
  authType: McpAuthType
  bearerToken: string
  headerName: string
  headerValue: string
  timeoutMs: number | ''
  defaultToolPolicy: McpToolPolicyMode
}

export interface McpTestResultState {
  ok: boolean
  message: string
}

export type ExtensionCatalogItem =
  | ({ kind: 'integration' } & IntegrationSummary)
  | ({ kind: 'skill' } & SkillSummary)
  | ({ kind: 'mcp' } & McpServerSummary)
  | ({ kind: 'tool' } & OverlayToolRegistration)
  | ({ kind: 'modelProvider' } & OverlayModelProviderRegistration)

export const DEFAULT_CONNECTOR_CATALOG: readonly ConnectorCatalogItem[] = [
  { id: 'gmail', providerKey: 'gmail', slug: 'gmail', name: 'Gmail', description: 'Compose, send, and search emails', icon: '📧' },
  { id: 'google-calendar', providerKey: 'googlecalendar', slug: 'googlecalendar', name: 'Google Calendar', description: 'Read and create calendar events', icon: '📅' },
  { id: 'google-sheets', providerKey: 'googlesheets', slug: 'googlesheets', name: 'Google Sheets', description: 'Read, update, and create spreadsheets', icon: '📊' },
  { id: 'google-drive', providerKey: 'googledrive', slug: 'googledrive', name: 'Google Drive', description: 'Search and manage Drive files', icon: '📁' },
  { id: 'notion', providerKey: 'notion', slug: 'notion', name: 'Notion', description: 'Create pages and manage workspace', icon: '📝' },
  { id: 'outlook', providerKey: 'outlook', slug: 'outlook', name: 'Outlook', description: 'Send emails and manage calendar', icon: '📨' },
  { id: 'x-twitter', providerKey: 'twitter', slug: 'twitter', name: 'X (Twitter)', description: 'Post tweets and manage your account', icon: '🐦' },
  { id: 'asana', providerKey: 'asana', slug: 'asana', name: 'Asana', description: 'Create tasks and manage projects', icon: '✅' },
  { id: 'linkedin', providerKey: 'linkedin', slug: 'linkedin', name: 'LinkedIn', description: 'Manage posts and profile actions', icon: '💼' },
] as const

const KNOWN_INTEGRATION_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  googlecalendar: 'Google Calendar',
  googlesheets: 'Google Sheets',
  googledrive: 'Google Drive',
  googlemeet: 'Google Meet',
  notion: 'Notion',
  outlook: 'Outlook',
  twitter: 'X (Twitter)',
  asana: 'Asana',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  composio: 'Composio',
}

export function sanitizeIntegrationName(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function resolveIntegrationName(slug: string, apiName: string): string {
  const resolvedApiName = sanitizeIntegrationName(apiName)
  if (resolvedApiName) return resolvedApiName
  if (KNOWN_INTEGRATION_NAMES[slug]) return KNOWN_INTEGRATION_NAMES[slug]
  const base = sanitizeIntegrationName(slug)
  return base
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function truncateIntegrationDescription(description: string, maxLength = 84): string {
  const compact = description.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}...`
}

export function normalizeIntegrationProviderKey(providerKey: string): string {
  const key = providerKey.trim().toLowerCase()
  return key.startsWith('google_') ? key.replace(/_/g, '') : key
}

export function integrationRegistryToConnectorCatalog(
  registry: readonly OverlayIntegrationRegistration[] = [],
): ConnectorCatalogItem[] {
  return registry.map((item) => {
    const slug = normalizeIntegrationProviderKey(item.providerKey || item.id)
    return {
      id: item.id,
      providerKey: slug,
      slug,
      name: item.label,
      description: item.description ?? '',
      icon: '🔌',
      logoUrl: item.logoSrc ?? null,
      componentKey: item.componentKey,
      policyGateId: item.policyGateId,
    }
  })
}

export function mergeConnectorCatalogEntries(
  current: readonly ConnectorCatalogItem[],
  incoming: readonly ConnectorCatalogItem[],
): ConnectorCatalogItem[] {
  const merged = new Map<string, ConnectorCatalogItem>()
  for (const item of current) merged.set(item.slug, item)
  for (const item of incoming) {
    const existing = merged.get(item.slug)
    merged.set(item.slug, {
      ...existing,
      ...item,
      name: resolveIntegrationName(item.slug, item.name || existing?.name || ''),
      description: item.description?.trim() || existing?.description || '',
      logoUrl: item.logoUrl ?? existing?.logoUrl ?? null,
      icon: item.icon || existing?.icon || '🔌',
    })
  }
  return [...merged.values()]
}

export function connectorFromIntegrationSummary(
  item: IntegrationSummary,
  fallback?: ConnectorCatalogItem,
): ConnectorCatalogItem {
  return {
    id: fallback?.id ?? item.slug,
    providerKey: item.providerKey,
    slug: item.slug,
    name: resolveIntegrationName(item.slug, item.name || fallback?.name || ''),
    description: item.description?.trim() || fallback?.description || '',
    icon: fallback?.icon || '🔌',
    logoUrl: item.logoUrl ?? fallback?.logoUrl ?? null,
    isConnected: item.isConnected,
    connectedAccountId: item.connectedAccountId,
    provider: item.provider,
    capabilities: item.capabilities,
    authenticationState: item.authenticationState,
    connectionSetupUrl: item.connectionSetupUrl,
    componentKey: fallback?.componentKey,
    policyGateId: fallback?.policyGateId,
  }
}

export function resolveConnectorForSlug(
  slug: string,
  catalogItems: readonly ConnectorCatalogItem[],
  presets: readonly ConnectorCatalogItem[] = DEFAULT_CONNECTOR_CATALOG,
): ConnectorCatalogItem {
  const catalog = catalogItems.find((item) => item.slug === slug || item.providerKey === slug)
  const preset = presets.find((item) => item.slug === slug || item.providerKey === slug)
  if (catalog) {
    return {
      ...catalog,
      id: catalog.id || slug,
      providerKey: catalog.providerKey || slug,
      slug,
      name: resolveIntegrationName(slug, catalog.name),
      description: catalog.description?.trim() || preset?.description || 'Connected integration',
      icon: catalog.icon || preset?.icon || '🔌',
      logoUrl: catalog.logoUrl ?? preset?.logoUrl ?? null,
    }
  }
  if (preset) return preset
  return {
    id: slug,
    providerKey: slug,
    slug,
    name: resolveIntegrationName(slug, slug),
    description: 'Connected integration',
    icon: '🔌',
  }
}

export function getConnectedConnectorRows(
  connected: ReadonlySet<string>,
  catalogItems: readonly ConnectorCatalogItem[],
): ConnectorCatalogItem[] {
  return Array.from(connected)
    .map((slug) => resolveConnectorForSlug(slug, catalogItems))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getAvailableConnectorRows(
  connected: ReadonlySet<string>,
  catalogItems: readonly ConnectorCatalogItem[],
  presets: readonly ConnectorCatalogItem[] = DEFAULT_CONNECTOR_CATALOG,
): ConnectorCatalogItem[] {
  const bySlug = new Map<string, ConnectorCatalogItem>()
  for (const item of presets) {
    if (!connected.has(item.providerKey)) bySlug.set(item.providerKey, item)
  }
  for (const item of catalogItems) {
    if (connected.has(item.slug)) continue
    const existing = bySlug.get(item.slug)
    bySlug.set(item.slug, {
      id: item.id,
      providerKey: item.providerKey || item.slug,
      slug: item.slug,
      name: resolveIntegrationName(item.slug, item.name || existing?.name || ''),
      description: item.description?.trim() || existing?.description || '',
      icon: item.icon || existing?.icon || '🔌',
      logoUrl: item.logoUrl ?? existing?.logoUrl ?? null,
      componentKey: item.componentKey ?? existing?.componentKey,
      policyGateId: item.policyGateId ?? existing?.policyGateId,
    })
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function filterConnectorCatalog(
  items: readonly ConnectorCatalogItem[],
  query: string,
): ConnectorCatalogItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter((item) =>
    [item.name, item.description, item.slug, item.providerKey]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
}

export function skillToFormValues(skill?: SkillSummary | null): SkillFormValues {
  return {
    name: skill?.name ?? '',
    description: skill?.description ?? '',
    instructions: skill?.instructions ?? '',
    enabled: skill?.enabled !== false,
  }
}

export function createSkillCreateRequest(values: SkillFormValues): CreateSkillRequest {
  return {
    name: values.name || 'New Skill',
    description: values.description,
    instructions: values.instructions,
  }
}

export function createSkillUpdateRequest(skillId: string, values: SkillFormValues): UpdateSkillRequest {
  return {
    skillId,
    name: values.name,
    description: values.description,
    instructions: values.instructions,
    enabled: values.enabled,
  }
}

export function createSkillSummaryFromForm(id: string, values: SkillFormValues, now = Date.now()): SkillSummary {
  return {
    _id: id,
    name: values.name || 'New Skill',
    description: values.description,
    instructions: values.instructions,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateSkillSummaryFromForm(skill: SkillSummary, values: SkillFormValues, now = Date.now()): SkillSummary {
  return {
    ...skill,
    name: values.name,
    description: values.description,
    instructions: values.instructions,
    enabled: values.enabled,
    updatedAt: now,
  }
}

export function upsertSkillSummary(skills: readonly SkillSummary[], skill: SkillSummary): SkillSummary[] {
  const index = skills.findIndex((item) => item._id === skill._id)
  if (index < 0) return [skill, ...skills]
  const next = [...skills]
  next[index] = skill
  return next
}

export function removeSkillSummary(skills: readonly SkillSummary[], skillId: string): SkillSummary[] {
  return skills.filter((skill) => skill._id !== skillId)
}

export function filterSkillSummaries(skills: readonly SkillSummary[], query: string): SkillSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...skills]
  return skills.filter((skill) =>
    [skill.name, skill.description, skill.instructions]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
}

export function mcpServerToFormValues(server?: McpServerSummary | null): McpServerFormValues {
  return {
    name: server?.name ?? '',
    description: server?.description ?? '',
    transport: server?.transport ?? 'streamable-http',
    url: server?.url ?? '',
    enabled: server?.enabled ?? true,
    authType: server?.authType ?? 'none',
    bearerToken: '',
    headerName: '',
    headerValue: '',
    timeoutMs: server?.timeoutMs ?? '',
    defaultToolPolicy: server?.defaultToolPolicy ?? 'allow',
  }
}

export function createMcpAuthConfig(values: McpServerFormValues): McpAuthConfig | undefined {
  if (values.authType === 'bearer' && values.bearerToken) return { bearerToken: values.bearerToken }
  if (values.authType === 'header' && values.headerName && values.headerValue) {
    return { headerName: values.headerName, headerValue: values.headerValue }
  }
  return undefined
}

export function createMcpCreateRequest(values: McpServerFormValues): CreateMcpServerRequest {
  const authConfig = createMcpAuthConfig(values)
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    transport: values.transport,
    url: values.url.trim(),
    enabled: values.enabled,
    authType: values.authType,
    defaultToolPolicy: values.defaultToolPolicy,
    ...(authConfig ? { authConfig } : {}),
    ...(values.timeoutMs !== '' ? { timeoutMs: Number(values.timeoutMs) } : {}),
  }
}

export function createMcpUpdateRequest(mcpServerId: string, values: McpServerFormValues): UpdateMcpServerRequest {
  const authConfig = createMcpAuthConfig(values)
  return {
    mcpServerId,
    name: values.name.trim(),
    description: values.description.trim(),
    transport: values.transport,
    url: values.url.trim(),
    enabled: values.enabled,
    authType: values.authType,
    defaultToolPolicy: values.defaultToolPolicy,
    ...(authConfig ? { authConfig } : { authConfig: null }),
    ...(values.timeoutMs !== '' ? { timeoutMs: Number(values.timeoutMs) } : {}),
  }
}

export function createMcpTestRequest(
  values: McpServerFormValues,
  options?: { mcpServerId?: string },
): TestMcpServerRequest {
  return {
    url: values.url.trim(),
    transport: values.transport,
    authType: values.authType,
    authConfig: createMcpAuthConfig(values),
    ...(options?.mcpServerId ? { mcpServerId: options.mcpServerId } : {}),
    ...(values.timeoutMs !== '' ? { timeoutMs: Number(values.timeoutMs) } : {}),
  }
}

export function createMcpSummaryFromForm(id: string, values: McpServerFormValues, now = Date.now()): McpServerSummary {
  const authConfig = createMcpAuthConfig(values)
  return {
    _id: id,
    name: values.name.trim(),
    description: values.description.trim(),
    transport: values.transport,
    url: values.url.trim(),
    enabled: values.enabled,
    authType: values.authType,
    hasAuth: Boolean(authConfig),
    timeoutMs: values.timeoutMs !== '' ? Number(values.timeoutMs) : undefined,
    defaultToolPolicy: values.defaultToolPolicy,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateMcpSummaryFromForm(server: McpServerSummary, values: McpServerFormValues, now = Date.now()): McpServerSummary {
  const authConfig = createMcpAuthConfig(values)
  return {
    ...server,
    name: values.name.trim(),
    description: values.description.trim(),
    transport: values.transport,
    url: values.url.trim(),
    enabled: values.enabled,
    authType: values.authType,
    hasAuth: values.authType === 'none' ? false : Boolean(authConfig) || server.hasAuth,
    timeoutMs: values.timeoutMs !== '' ? Number(values.timeoutMs) : undefined,
    defaultToolPolicy: values.defaultToolPolicy,
    updatedAt: now,
  }
}

export function upsertMcpServerSummary(servers: readonly McpServerSummary[], server: McpServerSummary): McpServerSummary[] {
  const index = servers.findIndex((item) => item._id === server._id)
  if (index < 0) return [server, ...servers]
  const next = [...servers]
  next[index] = server
  return next
}

export function removeMcpServerSummary(servers: readonly McpServerSummary[], serverId: string): McpServerSummary[] {
  return servers.filter((server) => server._id !== serverId)
}

export function filterMcpServers(servers: readonly McpServerSummary[], query: string): McpServerSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...servers]
  return servers.filter((server) =>
    [server.name, server.description, server.url]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
}

export function formatMcpTestResult(response: TestMcpServerResponse, ok: boolean): McpTestResultState {
  return {
    ok: ok && response.ok,
    message: ok && response.ok ? `Connected — ${response.toolCount ?? 0} tools available` : (response.error || 'Connection failed'),
  }
}

export function setSkillEnabled(skill: SkillSummary, enabled: boolean, now = Date.now()): SkillSummary {
  return { ...skill, enabled, updatedAt: now }
}

export function setMcpServerEnabled(server: McpServerSummary, enabled: boolean, now = Date.now()): McpServerSummary {
  return { ...server, enabled, updatedAt: now }
}

export function buildExtensionRegistryCatalog(input: {
  tools?: readonly OverlayToolRegistration[]
  integrations?: readonly OverlayIntegrationRegistration[]
  modelProviders?: readonly OverlayModelProviderRegistration[]
}): ExtensionCatalogItem[] {
  return [
    ...(input.integrations ?? []).map((item) => ({
      kind: 'integration' as const,
      slug: normalizeIntegrationProviderKey(item.providerKey || item.id),
      providerKey: normalizeIntegrationProviderKey(item.providerKey || item.id),
      name: item.label,
      description: item.description ?? '',
      logoUrl: item.logoSrc ?? null,
      provider: 'composio' as const,
      capabilities: {
        provider: 'composio' as const,
        hosted: true,
        selfHosted: false,
        oauthOwnership: 'provider-managed' as const,
        connectionSetup: 'in-app-oauth' as const,
        connectionLifecycle: 'overlay-managed' as const,
        supportsApprovals: false,
        supportsDisconnect: true,
        supportedSchemas: ['native'],
      } satisfies IntegrationProviderCapabilities,
      isConnected: false,
    })),
    ...(input.tools ?? []).map((item) => ({ ...item, kind: 'tool' as const })),
    ...(input.modelProviders ?? []).map((item) => ({ ...item, kind: 'modelProvider' as const })),
  ]
}

export function policyDisabledExtensionIds(
  items: readonly ExtensionCatalogItem[],
  policyGates: readonly OverlayPolicyGate[] = [],
): Set<string> {
  const disabledGates = new Set(
    policyGates.filter((gate) => !gate.defaultEnabled && gate.enforcement !== 'warn').map((gate) => gate.id),
  )
  const ids = new Set<string>()
  for (const item of items) {
    const policyGateId = 'policyGateId' in item ? item.policyGateId : undefined
    if (policyGateId && disabledGates.has(policyGateId)) {
      ids.add(extensionCatalogItemKey(item))
    }
  }
  return ids
}

export function extensionCatalogItemKey(item: ExtensionCatalogItem): string {
  if (item.kind === 'integration') return item.slug
  if (item.kind === 'skill' || item.kind === 'mcp') return item._id
  return item.id
}

export function filterExtensionCatalog(
  items: readonly ExtensionCatalogItem[],
  options: { query?: string; kind?: ExtensionCatalogItem['kind'] | 'all'; enabledOnly?: boolean } = {},
): ExtensionCatalogItem[] {
  const q = options.query?.trim().toLowerCase()
  return items.filter((item) => {
    if (options.kind && options.kind !== 'all' && item.kind !== options.kind) return false
    if (options.enabledOnly) {
      const enabled =
        item.kind === 'integration'
          ? item.isConnected
          : item.kind === 'skill'
            ? item.enabled !== false
            : item.kind === 'mcp'
              ? item.enabled
              : true
      if (!enabled) return false
    }
    if (!q) return true
    const text = [
      item.kind,
      'name' in item ? item.name : undefined,
      'label' in item ? item.label : undefined,
      'description' in item ? item.description : undefined,
      item.kind === 'integration' ? item.slug : undefined,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return text.includes(q)
  })
}

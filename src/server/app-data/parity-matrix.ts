import type { AppDataCapabilities } from './capabilities'

export type AppDataCapabilityKey = Exclude<keyof AppDataCapabilities, 'provider'>
export type OnPremParityPhase =
  | 'P0'
  | 'P1'
  | 'P2'
  | 'P3'
  | 'P3a'
  | 'P3b'
  | 'P3c'
  | 'P4'
  | 'P5'
  | 'P6'
  | 'P7'
  | 'P8'
  | 'P9'

export type OnPremParityCapabilityTarget = {
  key: AppDataCapabilityKey
  expectedAtParity: boolean
  runtimeConfigured?: boolean
}

export type OnPremParityDomain = {
  id: string
  name: string
  targetPhase: OnPremParityPhase
  capabilities: readonly OnPremParityCapabilityTarget[]
  routeRuleIds: readonly string[]
  exitGate: string
}

/**
 * The source of truth for measuring Postgres parity. Every app-data capability
 * and every Postgres route-support rule must belong to exactly one domain.
 */
export const ON_PREM_PARITY_MATRIX: readonly OnPremParityDomain[] = [
  {
    id: 'runtime-isolation',
    name: 'Runtime isolation',
    targetPhase: 'P0',
    capabilities: [{ key: 'requiresConvexClient', expectedAtParity: false }],
    routeRuleIds: [],
    exitGate: 'Postgres browser and server flows make no Convex requests and require no Convex configuration.',
  },
  {
    id: 'identity-account-lifecycle',
    name: 'Identity and account lifecycle',
    targetPhase: 'P0',
    capabilities: [{ key: 'supportsAccountDeletion', expectedAtParity: true }],
    routeRuleIds: [],
    exitGate: 'Authentication, identity sync, sign-out, and verified account deletion behave identically for enabled auth providers.',
  },
  {
    id: 'app-shell',
    name: 'App shell, settings, and onboarding',
    targetPhase: 'P0',
    capabilities: [
      { key: 'supportsSettings', expectedAtParity: true },
      { key: 'supportsOnboarding', expectedAtParity: true },
    ],
    routeRuleIds: ['bootstrap', 'capabilities', 'settings', 'onboarding'],
    exitGate: 'Bootstrap is no longer degraded and settings/onboarding pass shared route and browser tests.',
  },
  {
    id: 'model-catalog',
    name: 'Model catalog',
    targetPhase: 'P1',
    capabilities: [],
    routeRuleIds: ['model-catalog'],
    exitGate: 'Catalog refresh and stale fallback survive restarts without Convex.',
  },
  {
    id: 'chat',
    name: 'Chat, realtime, and recovery',
    targetPhase: 'P2',
    capabilities: [
      { key: 'supportsRealtime', expectedAtParity: true },
      { key: 'supportsStreamResume', expectedAtParity: true },
      { key: 'supportsChatPersistence', expectedAtParity: true },
    ],
    routeRuleIds: [
      'conversations',
      'conversations-act',
      'conversation-title-generation',
      'conversation-realtime-and-mutations',
    ],
    exitGate: 'All chat routes are supported and refresh, reconnect, second-tab, stop, share, and resume tests pass.',
  },
  {
    id: 'files-notes',
    name: 'Files and notes',
    targetPhase: 'P3b',
    capabilities: [
      { key: 'supportsFileMetadata', expectedAtParity: true },
      { key: 'supportsFileUploads', expectedAtParity: true },
      { key: 'supportsNotes', expectedAtParity: true },
    ],
    routeRuleIds: ['notes', 'files'],
    exitGate: 'File and note routes are fully supported, including atomic ingestion, durable object cleanup, reconciliation, sharing, and deletion.',
  },
  {
    id: 'projects',
    name: 'Projects',
    targetPhase: 'P3a',
    capabilities: [{ key: 'supportsProjects', expectedAtParity: true }],
    routeRuleIds: ['projects'],
    exitGate: 'Project CRUD, hierarchy, resource association, authorization, and UI pass shared tests.',
  },
  {
    id: 'outputs-media',
    name: 'Generated outputs and media',
    targetPhase: 'P3c',
    capabilities: [],
    routeRuleIds: ['outputs', 'generation-usage-and-outputs'],
    exitGate: 'Generated media and tool artifacts persist, authorize, retry, and clean up without Convex.',
  },
  {
    id: 'knowledge-memory',
    name: 'Knowledge, memory, and vector search',
    targetPhase: 'P4',
    capabilities: [{ key: 'supportsVectorSearch', expectedAtParity: true, runtimeConfigured: true }],
    routeRuleIds: ['knowledge-memory-vector-search'],
    exitGate: 'Upload, extract, embed, retrieve, cite, reindex, and delete pass shared pgvector and Convex characterization.',
  },
  {
    id: 'stabilization-resilience',
    name: 'Completed-phase stabilization and resilience',
    targetPhase: 'P5',
    capabilities: [],
    routeRuleIds: ['chat-suggestions'],
    exitGate: 'P0-P4 routes are honestly classified; security, deletion, no-Convex, recovery, backup, migration, observability, capacity, and rollback gates are rehearsed.',
  },
  {
    id: 'integrations-extensions',
    name: 'Integrations and extensions',
    targetPhase: 'P7',
    capabilities: [{ key: 'supportsIntegrations', expectedAtParity: true }],
    routeRuleIds: ['integrations', 'extension-proxy', 'chat-extension-plan'],
    exitGate: 'Connector state, OAuth lifecycle, proxy execution, scoping, and audits work without Convex.',
  },
  {
    id: 'skills-mcp',
    name: 'Skills and MCP servers',
    targetPhase: 'P7',
    capabilities: [
      { key: 'supportsSkills', expectedAtParity: true },
      { key: 'supportsMcpServers', expectedAtParity: true },
    ],
    routeRuleIds: ['mcp-and-skills'],
    exitGate: 'Skill and MCP configuration, discovery, authorization, and execution audits pass shared tests.',
  },
  {
    id: 'automations',
    name: 'Automations',
    targetPhase: 'P6',
    capabilities: [{ key: 'supportsAutomations', expectedAtParity: true }],
    routeRuleIds: ['automations'],
    exitGate: 'Schedules and runs survive worker replacement, retry safely, and produce auditable execution records.',
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    targetPhase: 'P6',
    capabilities: [{ key: 'supportsWebhooks', expectedAtParity: true }],
    routeRuleIds: ['webhooks'],
    exitGate: 'Webhook subscriptions, signed delivery, retries, and dead-letter handling work without Convex.',
  },
  {
    id: 'usage-billing',
    name: 'Usage and billing records',
    targetPhase: 'P7',
    capabilities: [
      { key: 'supportsUsageAccounting', expectedAtParity: true },
      { key: 'supportsBillingRecords', expectedAtParity: true },
    ],
    routeRuleIds: ['subscription-and-billing-records', 'generation-usage-only', 'notebook-agent'],
    exitGate: 'Usage, reservations, budgets, subscriptions, and Stripe replay protection pass shared tests.',
  },
  {
    id: 'api-keys',
    name: 'API keys',
    targetPhase: 'P7',
    capabilities: [{ key: 'supportsApiKeys', expectedAtParity: true }],
    routeRuleIds: ['auth-api-keys'],
    exitGate: 'Hashed keys, scopes, expiry, revocation, and audit behavior match Convex mode.',
  },
  {
    id: 'background-runtime',
    name: 'Background runtime and production safety',
    targetPhase: 'P1',
    capabilities: [
      { key: 'supportsBackgroundMaintenance', expectedAtParity: true },
      { key: 'supportsManagedScheduler', expectedAtParity: true },
      { key: 'supportsPersistentIdempotency', expectedAtParity: true },
      { key: 'supportsServiceAuthReplayStore', expectedAtParity: true },
    ],
    routeRuleIds: [],
    exitGate: 'Two app instances and competing workers prove shared limits, replay rejection, idempotency, leases, retry, and cleanup.',
  },
]

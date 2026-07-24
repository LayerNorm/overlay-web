import type {
  AppDestinationConfig,
  AppFeatureFlags,
  OverlayAppConfig,
  OverlayAppShellRegistry,
  OverlayBrandConfig,
  OverlayFeatureFlag,
  OverlayFeatureFlagId,
  OverlayFeatureModule,
  OverlayIntegrationRegistration,
  OverlayNavigationItem,
  OverlayModelProviderRegistration,
  OverlayPolicyGate,
  OverlaySettingsSection,
  OverlaySettingsPanel,
  OverlaySidebarAction,
  OverlayThemeMetadata,
  OverlayToolRegistration,
  ThemePresetId,
} from './contracts'
import {
  areOverlayCapabilitiesEnabled,
  isAnyOverlayCapabilityEnabled,
  deriveOverlayCapabilities,
  type CapabilityCheck,
  type OverlayCapability,
} from './capabilities'
import { LIGHT_PRESETS, DARK_PRESETS, PRESET_CSS_VAR_KEYS, PRESETS } from './theme'

export const DEFAULT_OVERLAY_BRAND_CONFIG: OverlayBrandConfig = {
  name: 'overlay',
  shortName: 'overlay',
  logoSrc: '/assets/overlay-logo.png',
  logoAlt: '',
  homeHref: '/app/chat',
  supportEmail: 'divyansh@layernorm.co',
  organizationName: 'Overlay',
}

export const DEFAULT_OVERLAY_FEATURE_FLAGS: readonly OverlayFeatureFlag[] = [
  {
    id: 'voiceTranscription',
    label: 'Voice transcription',
    enabled: true,
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    enabled: true,
  },
  {
    id: 'projects',
    label: 'Projects',
    enabled: true,
    requiredCapabilities: ['projects'],
  },
  {
    id: 'automations',
    label: 'Automations',
    enabled: true,
    requiredCapabilities: ['automations'],
  },
  {
    id: 'extensions',
    label: 'Extensions',
    enabled: true,
    requiredAnyCapabilities: ['integrations', 'skills', 'mcpServers'],
  },
] as const

export const DEFAULT_OVERLAY_NAVIGATION: readonly OverlayNavigationItem[] = [
  { id: 'chat', href: '/app/chat', label: 'Chat', icon: 'message-square', requiredCapabilities: ['chat'] },
  { id: 'files', href: '/app/files', label: 'Files', icon: 'file-text', requiredCapabilities: ['files', 'knowledge'] },
  {
    id: 'extensions',
    href: '/app/tools',
    label: 'Extensions',
    icon: 'puzzle',
    featureFlagId: 'extensions',
    requiredAnyCapabilities: ['integrations', 'skills', 'mcpServers'],
    subviews: ['connectors', 'skills', 'mcps', 'apps', 'all'],
  },
  {
    id: 'projects',
    href: '/app/projects',
    label: 'Projects',
    icon: 'folder-open',
    featureFlagId: 'projects',
    requiredCapabilities: ['projects'],
  },
  {
    id: 'automations',
    href: '/app/automations',
    label: 'Automations',
    icon: 'workflow',
    featureFlagId: 'automations',
    requiredCapabilities: ['automations'],
  },
] as const

export const DEFAULT_OVERLAY_SETTINGS_SECTIONS: readonly OverlaySettingsSection[] = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'customization', label: 'Customization' },
  { id: 'memories', label: 'Memories', featureFlagId: 'knowledge', requiredCapabilities: ['memory', 'vectorSearch'] },
  { id: 'models', label: 'Models', requiredCapabilities: ['modelRouting'] },
  { id: 'webhooks', label: 'Webhooks', requiredCapabilities: ['webhooks'] },
  { id: 'contact', label: 'Contact' },
] as const

export const DEFAULT_OVERLAY_FEATURE_MODULES: readonly OverlayFeatureModule[] = [
  {
    id: 'files-knowledge',
    label: 'Files and knowledge',
    description: 'Files, memories, generated outputs, and knowledge search surfaces.',
    navigationItemId: 'files',
    routePatterns: ['/app/files', '/app/knowledge', '/app/memories', '/app/outputs'],
    componentKey: 'overlay.modules.filesKnowledge',
    packageName: '@overlay/modules-react',
    featureFlagId: 'knowledge',
    requiredCapabilities: ['files', 'knowledge'],
    order: 10,
  },
  {
    id: 'notes',
    label: 'Notes',
    description: 'Notebook editor and note-backed file workflows.',
    navigationItemId: 'notes',
    routePatterns: ['/app/notes'],
    componentKey: 'overlay.modules.notes',
    packageName: '@overlay/modules-react',
    order: 20,
  },
  {
    id: 'projects',
    label: 'Projects',
    description: 'Project hierarchy and scoped workspace resources.',
    navigationItemId: 'projects',
    routePatterns: ['/app/projects'],
    componentKey: 'overlay.modules.projects',
    packageName: '@overlay/modules-react',
    featureFlagId: 'projects',
    requiredCapabilities: ['projects'],
    order: 30,
  },
  {
    id: 'tools-extensions',
    label: 'Tools and extensions',
    description: 'Integrations, skills, MCP servers, and tool catalog surfaces.',
    navigationItemId: 'extensions',
    routePatterns: ['/app/tools', '/app/integrations'],
    componentKey: 'overlay.modules.toolsExtensions',
    packageName: '@overlay/modules-react',
    featureFlagId: 'extensions',
    requiredAnyCapabilities: ['integrations', 'skills', 'mcpServers'],
    order: 40,
  },
  {
    id: 'settings-account',
    label: 'Settings and account',
    description: 'Settings, account, billing, customization, and policy panels.',
    navigationItemId: 'settings',
    routePatterns: ['/app/settings', '/account'],
    componentKey: 'overlay.modules.settingsAccount',
    packageName: '@overlay/modules-react',
    order: 50,
  },
] as const

export const DEFAULT_OVERLAY_SIDEBAR_ACTIONS: readonly OverlaySidebarAction[] = [
  {
    id: 'chat.create',
    label: 'New chat',
    actionKey: 'chat.create',
    navigationItemId: 'chat',
    routePatterns: ['/app/chat'],
    searchCategory: 'chat',
    requiresAuth: true,
    order: 10,
  },
  {
    id: 'files.create-note',
    label: 'New Note',
    actionKey: 'notes.create',
    navigationItemId: 'notes',
    featureModuleId: 'notes',
    routePatterns: ['/app/files', '/app/notes'],
    searchCategory: 'file',
    requiresAuth: true,
    featureFlagId: 'knowledge',
    requiredCapabilities: ['knowledge'],
    order: 20,
  },
  {
    id: 'projects.create',
    label: 'New project',
    actionKey: 'projects.create',
    navigationItemId: 'projects',
    featureModuleId: 'projects',
    routePatterns: ['/app/projects'],
    requiresAuth: true,
    featureFlagId: 'projects',
    requiredCapabilities: ['projects'],
    order: 30,
  },
  {
    id: 'automations.create',
    label: 'New automation',
    actionKey: 'automations.create',
    navigationItemId: 'automations',
    routePatterns: ['/app/automations'],
    requiresAuth: true,
    featureFlagId: 'automations',
    requiredCapabilities: ['automations'],
    order: 40,
  },
] as const

export const DEFAULT_OVERLAY_SETTINGS_PANELS: readonly OverlaySettingsPanel[] = [
  { id: 'general', sectionId: 'general', label: 'General', componentKey: 'overlay.settings.general', order: 10 },
  { id: 'account', sectionId: 'account', label: 'Account', componentKey: 'overlay.settings.account', order: 20 },
  { id: 'customization', sectionId: 'customization', label: 'Customization', componentKey: 'overlay.settings.customization', order: 30 },
  { id: 'memories', sectionId: 'memories', label: 'Memories', componentKey: 'overlay.settings.memories', featureFlagId: 'knowledge', requiredCapabilities: ['memory', 'vectorSearch'], order: 40 },
  { id: 'models', sectionId: 'models', label: 'Models', componentKey: 'overlay.settings.models', requiredCapabilities: ['modelRouting'], order: 50 },
  { id: 'webhooks', sectionId: 'webhooks', label: 'Webhooks', componentKey: 'overlay.settings.webhooks', requiredCapabilities: ['webhooks'], order: 60 },
  { id: 'contact', sectionId: 'contact', label: 'Contact', componentKey: 'overlay.settings.contact', order: 70 },
] as const

export const DEFAULT_OVERLAY_TOOL_REGISTRY: readonly OverlayToolRegistration[] = [
  {
    id: 'browser-control',
    label: 'Browser control',
    description: 'Run browser tasks and interactive browser sessions.',
    category: 'browser',
    componentKey: 'overlay.tools.browserControl',
    policyGateId: 'browser-tools',
    requiredCapabilities: ['browserUse'],
  },
  {
    id: 'knowledge-search',
    label: 'Knowledge search',
    description: 'Search files, memories, notes, and generated outputs.',
    category: 'knowledge',
    componentKey: 'overlay.tools.knowledgeSearch',
    featureFlagId: 'knowledge',
    requiredCapabilities: ['knowledge', 'vectorSearch'],
  },
  {
    id: 'automation-runner',
    label: 'Automation runner',
    description: 'Run, test, and monitor scheduled automations.',
    category: 'automation',
    componentKey: 'overlay.tools.automationRunner',
    featureFlagId: 'automations',
    requiredCapabilities: ['automations'],
  },
] as const

export const DEFAULT_OVERLAY_INTEGRATION_REGISTRY: readonly OverlayIntegrationRegistration[] = [
  { id: 'gmail', label: 'Gmail', providerKey: 'gmail', componentKey: 'overlay.integrations.gmail', featureFlagId: 'extensions', requiredCapabilities: ['integrations'] },
  { id: 'google-drive', label: 'Google Drive', providerKey: 'google_drive', componentKey: 'overlay.integrations.googleDrive', featureFlagId: 'extensions', requiredCapabilities: ['integrations'] },
  { id: 'slack', label: 'Slack', providerKey: 'slack', componentKey: 'overlay.integrations.slack', featureFlagId: 'extensions', requiredCapabilities: ['integrations'] },
  { id: 'github', label: 'GitHub', providerKey: 'github', componentKey: 'overlay.integrations.github', featureFlagId: 'extensions', requiredCapabilities: ['integrations'] },
] as const

export const DEFAULT_OVERLAY_MODEL_PROVIDER_REGISTRY: readonly OverlayModelProviderRegistration[] = [
  { id: 'openai', label: 'OpenAI', providerKey: 'openai', componentKey: 'overlay.modelProviders.openai', requiredCapabilities: ['modelRouting'] },
  { id: 'anthropic', label: 'Anthropic', providerKey: 'anthropic', componentKey: 'overlay.modelProviders.anthropic', requiredCapabilities: ['modelRouting'] },
  { id: 'google', label: 'Google', providerKey: 'google', componentKey: 'overlay.modelProviders.google', requiredCapabilities: ['modelRouting'] },
  { id: 'openrouter', label: 'OpenRouter', providerKey: 'openrouter', componentKey: 'overlay.modelProviders.openrouter', requiredCapabilities: ['modelRouting'] },
] as const

export const DEFAULT_OVERLAY_POLICY_GATES: readonly OverlayPolicyGate[] = [
  {
    id: 'browser-tools',
    label: 'Browser tools',
    description: 'Controls whether browser automation tools are visible or disabled.',
    defaultEnabled: true,
    enforcement: 'warn',
  },
  {
    id: 'external-integrations',
    label: 'External integrations',
    description: 'Controls connector-backed tools and account linking surfaces.',
    defaultEnabled: true,
    enforcement: 'disable',
  },
] as const

export const DEFAULT_OVERLAY_THEME_METADATA: OverlayThemeMetadata = {
  defaultLightPreset: 'default-light',
  defaultDarkPreset: 'default-dark',
  presets: PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    variant: preset.variant,
    previewColors: preset.previewColors,
  })),
  cssVarKeys: PRESET_CSS_VAR_KEYS,
}

export const DEFAULT_OVERLAY_APP_CONFIG: OverlayAppConfig = {
  brand: DEFAULT_OVERLAY_BRAND_CONFIG,
  navigation: DEFAULT_OVERLAY_NAVIGATION,
  settingsSections: DEFAULT_OVERLAY_SETTINGS_SECTIONS,
  featureFlags: DEFAULT_OVERLAY_FEATURE_FLAGS,
  featureModules: DEFAULT_OVERLAY_FEATURE_MODULES,
  sidebarActions: DEFAULT_OVERLAY_SIDEBAR_ACTIONS,
  settingsPanels: DEFAULT_OVERLAY_SETTINGS_PANELS,
  tools: DEFAULT_OVERLAY_TOOL_REGISTRY,
  integrations: DEFAULT_OVERLAY_INTEGRATION_REGISTRY,
  modelProviders: DEFAULT_OVERLAY_MODEL_PROVIDER_REGISTRY,
  policyGates: DEFAULT_OVERLAY_POLICY_GATES,
  theme: DEFAULT_OVERLAY_THEME_METADATA,
}

const FEATURE_FLAG_TO_APP_FLAG: Partial<Record<OverlayFeatureFlagId, keyof AppFeatureFlags>> = {
  voiceTranscription: 'canUseVoiceTranscription',
  knowledge: 'canUseKnowledge',
  projects: 'canUseProjects',
  automations: 'canUseAutomations',
  extensions: 'canUseExtensions',
}

export function defineOverlayAppConfig(config: OverlayAppConfig): OverlayAppConfig {
  return config
}

export function overlayFeatureFlagsToAppFeatureFlags(
  flags: readonly OverlayFeatureFlag[],
): AppFeatureFlags {
  const next: AppFeatureFlags = {
    canUseVoiceTranscription: true,
    canUseKnowledge: true,
    canUseProjects: true,
    canUseAutomations: true,
    canUseExtensions: true,
  }

  for (const flag of flags) {
    const key = FEATURE_FLAG_TO_APP_FLAG[flag.id]
    if (key) next[key] = flag.enabled
  }

  return next
}

export function isOverlayFeatureEnabled(
  featureFlagId: OverlayFeatureFlagId | undefined,
  flags: readonly OverlayFeatureFlag[],
  capabilities: CapabilityCheck = deriveOverlayCapabilities(),
): boolean {
  if (!featureFlagId) return true
  const flag = flags.find((item) => item.id === featureFlagId)
  if (!flag) return true
  return flag.enabled &&
    areOverlayCapabilitiesEnabled(capabilities, flag.requiredCapabilities) &&
    isAnyOverlayCapabilityEnabled(capabilities, flag.requiredAnyCapabilities)
}

function mergeRegistryById<T extends { id: string }>(
  defaults: readonly T[],
  overrides: readonly T[] | undefined,
): readonly T[] {
  if (!overrides) return defaults
  const byId = new Map<string, T>()
  const order: string[] = []
  for (const item of defaults) {
    byId.set(item.id, item)
    order.push(item.id)
  }
  for (const item of overrides) {
    if (!byId.has(item.id)) order.push(item.id)
    byId.set(item.id, { ...(byId.get(item.id) ?? {}), ...item })
  }
  return order.map((id) => byId.get(id)!).filter(Boolean)
}

function filterFeatureRegistry<T extends {
  featureFlagId?: OverlayFeatureFlagId
  requiredCapabilities?: readonly OverlayCapability[]
  requiredAnyCapabilities?: readonly OverlayCapability[]
}>(
  registry: readonly T[],
  featureFlags: readonly OverlayFeatureFlag[],
  capabilities: CapabilityCheck,
): readonly T[] {
  return registry.filter((item) =>
    isOverlayFeatureEnabled(item.featureFlagId, featureFlags, capabilities) &&
    areOverlayCapabilitiesEnabled(capabilities, item.requiredCapabilities) &&
    isAnyOverlayCapabilityEnabled(capabilities, item.requiredAnyCapabilities),
  )
}

export interface ResolveOverlayAppShellOptions {
  capabilities?: Partial<CapabilityCheck>
}

export function resolveOverlayAppShellConfig(
  config: OverlayAppConfig = DEFAULT_OVERLAY_APP_CONFIG,
  options: ResolveOverlayAppShellOptions = {},
): OverlayAppShellRegistry {
  const capabilities = deriveOverlayCapabilities(options.capabilities)
  const featureFlags = mergeRegistryById(DEFAULT_OVERLAY_FEATURE_FLAGS, config.featureFlags)
  const brand = {
    ...DEFAULT_OVERLAY_BRAND_CONFIG,
    ...config.brand,
  }
  const theme = {
    ...DEFAULT_OVERLAY_THEME_METADATA,
    ...config.theme,
    presets: config.theme?.presets ?? DEFAULT_OVERLAY_THEME_METADATA.presets,
    cssVarKeys: config.theme?.cssVarKeys ?? DEFAULT_OVERLAY_THEME_METADATA.cssVarKeys,
  }
  const navigation = filterFeatureRegistry(
    mergeRegistryById(DEFAULT_OVERLAY_NAVIGATION, config.navigation),
    featureFlags,
    capabilities,
  )
  const settingsSections = filterFeatureRegistry(
    mergeRegistryById(DEFAULT_OVERLAY_SETTINGS_SECTIONS, config.settingsSections),
    featureFlags,
    capabilities,
  )
  const featureModules = filterFeatureRegistry(
    mergeRegistryById(DEFAULT_OVERLAY_FEATURE_MODULES, config.featureModules),
    featureFlags,
    capabilities,
  )
  const sidebarActions = filterFeatureRegistry(
    mergeRegistryById(DEFAULT_OVERLAY_SIDEBAR_ACTIONS, config.sidebarActions),
    featureFlags,
    capabilities,
  )
  const settingsPanels = filterFeatureRegistry(
    mergeRegistryById(DEFAULT_OVERLAY_SETTINGS_PANELS, config.settingsPanels),
    featureFlags,
    capabilities,
  )
  const tools = filterFeatureRegistry(
    mergeRegistryById(DEFAULT_OVERLAY_TOOL_REGISTRY, config.tools),
    featureFlags,
    capabilities,
  )
  const integrations = filterFeatureRegistry(
    mergeRegistryById(DEFAULT_OVERLAY_INTEGRATION_REGISTRY, config.integrations),
    featureFlags,
    capabilities,
  )
  const modelProviders = mergeRegistryById(
    DEFAULT_OVERLAY_MODEL_PROVIDER_REGISTRY,
    config.modelProviders,
  )
  const policyGates = mergeRegistryById(DEFAULT_OVERLAY_POLICY_GATES, config.policyGates)

  return {
    brand,
    navigation,
    settingsSections,
    featureFlags,
    featureModules,
    sidebarActions,
    settingsPanels,
    tools,
    integrations,
    modelProviders,
    policyGates,
    appFeatureFlags: overlayFeatureFlagsToAppFeatureFlags(
      featureFlags.map((flag) => ({
        ...flag,
        enabled: flag.enabled && areOverlayCapabilitiesEnabled(capabilities, flag.requiredCapabilities),
      })),
    ),
    capabilities,
    theme,
  }
}

export function appShellRouteMatches(pathname: string, routePattern: string): boolean {
  if (pathname === routePattern) return true
  return pathname.startsWith(`${routePattern}/`)
}

export function resolveSidebarActionForPath(
  pathname: string,
  actions: readonly OverlaySidebarAction[],
): OverlaySidebarAction | null {
  return [...actions]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .find((action) => action.routePatterns.some((pattern) => appShellRouteMatches(pathname, pattern))) ?? null
}

export function resolveFeatureModuleForPath(
  pathname: string,
  modules: readonly OverlayFeatureModule[],
): OverlayFeatureModule | null {
  return [...modules]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .find((module) => module.routePatterns.some((pattern) => appShellRouteMatches(pathname, pattern))) ?? null
}

export function overlayNavigationToDestinations(
  navigation: readonly OverlayNavigationItem[],
  settingsSections: readonly OverlaySettingsSection[] = DEFAULT_OVERLAY_SETTINGS_SECTIONS,
): AppDestinationConfig[] {
  const destinations: AppDestinationConfig[] = navigation.map((item) => ({
    id: item.id as AppDestinationConfig['id'],
    label: item.label,
    href: item.href,
    ...(item.subviews?.length ? { subviews: item.subviews } : {}),
  }))

  destinations.push({
    id: 'settings',
    label: 'Settings',
    href: '/app/settings',
    subviews: settingsSections.map((section) => section.id),
  })
  destinations.push({ id: 'account', label: 'Account', href: '/account' })

  return destinations
}

export const DEFAULT_LIGHT_THEME_PRESET_IDS: readonly ThemePresetId[] = LIGHT_PRESETS.map(
  (preset) => preset.id,
)
export const DEFAULT_DARK_THEME_PRESET_IDS: readonly ThemePresetId[] = DARK_PRESETS.map(
  (preset) => preset.id,
)

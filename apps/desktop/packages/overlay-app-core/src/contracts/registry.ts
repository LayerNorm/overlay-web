import type { LLMGateway as CoreLLMGateway } from '@overlay/llm-gateway'
import type { AuthProvider, AuthUser } from '@overlay/auth-contracts'
import type { ObjectStore, VectorStore } from '@overlay/storage-contracts'
import type { BillingProvider, Entitlements } from '@overlay/billing'
import type { CapabilityCheck, OverlayCapability } from '../capabilities'
import type { AppSettings, ChatModel, ImageModel, VideoModel, ThemePreference, ThemePresetId } from './settings'
import type { AppDestinationConfig, AppDestinationId, AppFeatureFlags, SettingsSubview } from './navigation'
import type { EventBus, RateLimiter } from './server-runtime'

export type OverlayIconName =
  | 'arrow-up'
  | 'chrome'
  | 'file-text'
  | 'folder-open'
  | 'mail'
  | 'message-square'
  | 'monitor'
  | 'palette'
  | 'package'
  | 'panels-left-right'
  | 'play'
  | 'plug'
  | 'puzzle'
  | 'server'
  | 'settings'
  | 'shield-check'
  | 'smartphone'
  | 'sparkles'
  | 'user'
  | 'workflow'

export type OverlayFeatureFlagId =
  | 'voiceTranscription'
  | 'knowledge'
  | 'projects'
  | 'automations'
  | 'extensions'
  | (string & {})

export interface OverlayFeatureFlag {
  id: OverlayFeatureFlagId
  label: string
  enabled: boolean
  description?: string
  requiredCapabilities?: readonly OverlayCapability[]
  requiredAnyCapabilities?: readonly OverlayCapability[]
}

export interface OverlayBrandConfig {
  name: string
  shortName?: string
  logoSrc: string
  logoAlt?: string
  homeHref: string
  supportEmail?: string
  organizationName?: string
}

export interface OverlayNavigationItem {
  id: AppDestinationId | (string & {})
  label: string
  href: string
  icon: OverlayIconName
  componentKey?: string
  disabled?: boolean
  featureFlagId?: OverlayFeatureFlagId
  requiredCapabilities?: readonly OverlayCapability[]
  requiredAnyCapabilities?: readonly OverlayCapability[]
  subviews?: readonly string[]
}

export interface OverlaySettingsSection {
  id: SettingsSubview | (string & {})
  label: string
  href?: string
  icon?: OverlayIconName
  componentKey?: string
  disabled?: boolean
  featureFlagId?: OverlayFeatureFlagId
  requiredCapabilities?: readonly OverlayCapability[]
}

export type OverlayFeatureModuleId =
  | 'files-knowledge'
  | 'notes'
  | 'projects'
  | 'tools-extensions'
  | 'settings-account'
  | (string & {})

export interface OverlayFeatureModule {
  id: OverlayFeatureModuleId
  label: string
  description?: string
  navigationItemId?: OverlayNavigationItem['id']
  routePatterns: readonly string[]
  componentKey: string
  packageName?: string
  featureFlagId?: OverlayFeatureFlagId
  requiredCapabilities?: readonly OverlayCapability[]
  requiredAnyCapabilities?: readonly OverlayCapability[]
  order?: number
}

export type OverlaySidebarActionKey =
  | 'chat.create'
  | 'notes.create'
  | 'projects.create'
  | 'automations.create'
  | (string & {})

export type OverlaySidebarSearchCategory =
  | 'file'
  | 'connector'
  | 'automation'
  | 'skill'
  | 'mcp'
  | 'chat'
  | (string & {})

export interface OverlaySidebarAction {
  id: string
  label: string
  actionKey: OverlaySidebarActionKey
  navigationItemId?: OverlayNavigationItem['id']
  featureModuleId?: OverlayFeatureModuleId
  routePatterns: readonly string[]
  searchCategory?: OverlaySidebarSearchCategory
  requiresAuth?: boolean
  primaryNavAction?: boolean
  featureFlagId?: OverlayFeatureFlagId
  requiredCapabilities?: readonly OverlayCapability[]
  order?: number
}

export interface OverlaySettingsPanel {
  id: SettingsSubview | (string & {})
  label: string
  sectionId: OverlaySettingsSection['id']
  componentKey: string
  description?: string
  featureFlagId?: OverlayFeatureFlagId
  requiredCapabilities?: readonly OverlayCapability[]
  order?: number
}

export interface OverlayToolRegistration {
  id: string
  label: string
  description?: string
  category?: 'browser' | 'knowledge' | 'integration' | 'automation' | 'developer' | (string & {})
  componentKey?: string
  featureFlagId?: OverlayFeatureFlagId
  requiredCapabilities?: readonly OverlayCapability[]
  policyGateId?: string
}

export interface OverlayIntegrationRegistration {
  id: string
  label: string
  providerKey: string
  description?: string
  logoSrc?: string
  componentKey?: string
  featureFlagId?: OverlayFeatureFlagId
  requiredCapabilities?: readonly OverlayCapability[]
  policyGateId?: string
}

export interface OverlayModelProviderRegistration {
  id: string
  label: string
  providerKey: string
  description?: string
  logoSrc?: string
  componentKey?: string
  requiredCapabilities?: readonly OverlayCapability[]
  policyGateId?: string
}

export interface OverlayPolicyGate {
  id: string
  label: string
  description?: string
  defaultEnabled: boolean
  enforcement: 'hide' | 'disable' | 'warn'
  reason?: string
}

export interface OverlayThemePresetSummary {
  id: ThemePresetId
  name: string
  variant: ThemePreference
  previewColors: {
    background: string
    accent: string
  }
}

export interface OverlayThemeMetadata {
  defaultLightPreset: ThemePresetId
  defaultDarkPreset: ThemePresetId
  presets: readonly OverlayThemePresetSummary[]
  cssVarKeys: readonly string[]
}

export interface OverlayModelPolicyContext {
  user: AuthUser | null
  entitlements: Entitlements | null
}

export interface OverlayModelPolicyHooks {
  filterChatModels?: (
    models: readonly ChatModel[],
    context: OverlayModelPolicyContext,
  ) => readonly ChatModel[]
  filterImageModels?: (
    models: readonly ImageModel[],
    context: OverlayModelPolicyContext,
  ) => readonly ImageModel[]
  filterVideoModels?: (
    models: readonly VideoModel[],
    context: OverlayModelPolicyContext,
  ) => readonly VideoModel[]
  getDefaultChatModelId?: (
    models: readonly ChatModel[],
    context: OverlayModelPolicyContext,
  ) => string | undefined
  getDefaultImageModelId?: (
    models: readonly ImageModel[],
    context: OverlayModelPolicyContext,
  ) => string | undefined
  getDefaultVideoModelId?: (
    models: readonly VideoModel[],
    context: OverlayModelPolicyContext,
  ) => string | undefined
}

export interface OverlayAppConfig {
  brand?: Partial<OverlayBrandConfig>
  navigation?: readonly OverlayNavigationItem[]
  settingsSections?: readonly OverlaySettingsSection[]
  featureFlags?: readonly OverlayFeatureFlag[]
  featureModules?: readonly OverlayFeatureModule[]
  sidebarActions?: readonly OverlaySidebarAction[]
  settingsPanels?: readonly OverlaySettingsPanel[]
  tools?: readonly OverlayToolRegistration[]
  integrations?: readonly OverlayIntegrationRegistration[]
  modelProviders?: readonly OverlayModelProviderRegistration[]
  policyGates?: readonly OverlayPolicyGate[]
  theme?: Partial<OverlayThemeMetadata>
  modelPolicy?: OverlayModelPolicyHooks
  authProvider?: AuthProvider
  billingProvider?: BillingProvider
  objectStore?: ObjectStore
  vectorStore?: VectorStore
  llmGateway?: CoreLLMGateway
  rateLimiter?: RateLimiter
  eventBus?: EventBus
}

export interface OverlayAppShellRegistry {
  brand: OverlayBrandConfig
  navigation: readonly OverlayNavigationItem[]
  settingsSections: readonly OverlaySettingsSection[]
  featureFlags: readonly OverlayFeatureFlag[]
  featureModules: readonly OverlayFeatureModule[]
  sidebarActions: readonly OverlaySidebarAction[]
  settingsPanels: readonly OverlaySettingsPanel[]
  tools: readonly OverlayToolRegistration[]
  integrations: readonly OverlayIntegrationRegistration[]
  modelProviders: readonly OverlayModelProviderRegistration[]
  policyGates: readonly OverlayPolicyGate[]
  appFeatureFlags: AppFeatureFlags
  capabilities: CapabilityCheck
  theme: OverlayThemeMetadata
}

export interface AppBootstrapDefaults {
  chatModelId?: string
  imageModelId?: string
  videoModelId?: string
}

export interface AppBootstrapResponse {
  user: AuthUser | null
  entitlements: Entitlements | null
  uiSettings: AppSettings
  chatModels: ChatModel[]
  imageModels: ImageModel[]
  videoModels: VideoModel[]
  brand?: OverlayBrandConfig
  navigation?: OverlayNavigationItem[]
  settingsSections?: OverlaySettingsSection[]
  featureFlagRegistry?: OverlayFeatureFlag[]
  featureModules?: OverlayFeatureModule[]
  sidebarActions?: OverlaySidebarAction[]
  settingsPanels?: OverlaySettingsPanel[]
  toolRegistry?: OverlayToolRegistration[]
  integrationRegistry?: OverlayIntegrationRegistration[]
  modelProviderRegistry?: OverlayModelProviderRegistration[]
  policyGates?: OverlayPolicyGate[]
  theme?: OverlayThemeMetadata
  featureFlags: AppFeatureFlags
  capabilities: CapabilityCheck
  destinations: AppDestinationConfig[]
  defaults?: AppBootstrapDefaults
}

export type AppBootstrap = AppBootstrapResponse

import {
  DEFAULT_OVERLAY_BRAND_CONFIG,
  DEFAULT_OVERLAY_FEATURE_FLAGS,
  DEFAULT_OVERLAY_FEATURE_MODULES,
  DEFAULT_OVERLAY_INTEGRATION_REGISTRY,
  DEFAULT_OVERLAY_MODEL_PROVIDER_REGISTRY,
  DEFAULT_OVERLAY_NAVIGATION,
  DEFAULT_OVERLAY_POLICY_GATES,
  DEFAULT_OVERLAY_SETTINGS_SECTIONS,
  DEFAULT_OVERLAY_SETTINGS_PANELS,
  DEFAULT_OVERLAY_SIDEBAR_ACTIONS,
  DEFAULT_OVERLAY_THEME_METADATA,
  DEFAULT_OVERLAY_TOOL_REGISTRY,
  defineOverlayAppConfig,
  resolveOverlayAppShellConfig,
} from '@overlay/app-core'
import { extendOverlayAppConfig } from '@overlay/extension-sdk'
import { DEFAULT_OVERLAY_RUNTIME_CONFIG } from './shared/config/defaultOverlayRuntimeConfig'
import { overlayExtensions } from './extensions/app-registry'

const baseOverlayAppConfig = defineOverlayAppConfig({
  brand: {
    ...DEFAULT_OVERLAY_BRAND_CONFIG,
  },
  navigation: [...DEFAULT_OVERLAY_NAVIGATION],
  settingsSections: [
    ...DEFAULT_OVERLAY_SETTINGS_SECTIONS.slice(0, 1),
    { id: 'workspace', label: 'Workspace' },
    ...DEFAULT_OVERLAY_SETTINGS_SECTIONS.slice(1),
  ],
  featureFlags: DEFAULT_OVERLAY_FEATURE_FLAGS.map((flag) => (
    flag.id === 'workspaces' || flag.id === 'collaborativeChats'
      ? { ...flag, enabled: true }
      : flag
  )),
  featureModules: [...DEFAULT_OVERLAY_FEATURE_MODULES],
  sidebarActions: [...DEFAULT_OVERLAY_SIDEBAR_ACTIONS],
  settingsPanels: [...DEFAULT_OVERLAY_SETTINGS_PANELS],
  tools: [...DEFAULT_OVERLAY_TOOL_REGISTRY],
  integrations: [...DEFAULT_OVERLAY_INTEGRATION_REGISTRY],
  modelProviders: [...DEFAULT_OVERLAY_MODEL_PROVIDER_REGISTRY],
  policyGates: [...DEFAULT_OVERLAY_POLICY_GATES],
  theme: {
    ...DEFAULT_OVERLAY_THEME_METADATA,
  },
  modelPolicy: {
    filterChatModels: (models) => models,
    filterImageModels: (models) => models,
    filterVideoModels: (models) => models,
  },
})

export const overlayAppConfig = extendOverlayAppConfig(baseOverlayAppConfig, overlayExtensions)

export const overlayAppShell = resolveOverlayAppShellConfig(overlayAppConfig)

export const overlayRuntimeConfigDefaults = DEFAULT_OVERLAY_RUNTIME_CONFIG

export default overlayAppConfig

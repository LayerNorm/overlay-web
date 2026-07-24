export interface CapabilityCheck {
  chat: boolean
  files: boolean
  memory: boolean
  knowledge: boolean
  integrations: boolean
  projects: boolean
  skills: boolean
  mcpServers: boolean
  browserUse: boolean
  sandboxes: boolean
  webSearch: boolean
  analytics: boolean
  errorReporting: boolean
  modelRouting: boolean
  billing: boolean
  sso: boolean
  apiKeys: boolean
  webhooks: boolean
  vectorSearch: boolean
  automations: boolean
  multiTenant: boolean
}

export type OverlayCapability = keyof CapabilityCheck

export const DEFAULT_OVERLAY_CAPABILITIES: CapabilityCheck = {
  chat: true,
  files: true,
  memory: true,
  knowledge: true,
  integrations: true,
  projects: true,
  skills: true,
  mcpServers: true,
  browserUse: true,
  sandboxes: true,
  webSearch: true,
  analytics: true,
  errorReporting: true,
  modelRouting: true,
  billing: true,
  sso: true,
  apiKeys: false,
  webhooks: false,
  vectorSearch: true,
  automations: true,
  multiTenant: false,
}

export function deriveOverlayCapabilities(
  input?: Partial<CapabilityCheck> | {
    capabilities?: Partial<CapabilityCheck>
    features?: Partial<CapabilityCheck>
  } | null,
): CapabilityCheck {
  const capabilities =
    input && ('capabilities' in input || 'features' in input)
      ? input.capabilities
      : input
  const features =
    input && ('capabilities' in input || 'features' in input)
      ? input.features
      : undefined

  return {
    ...DEFAULT_OVERLAY_CAPABILITIES,
    ...(capabilities ?? {}),
    ...(features ?? {}),
  }
}

export function areOverlayCapabilitiesEnabled(
  capabilities: CapabilityCheck,
  requiredCapabilities: readonly OverlayCapability[] | undefined,
): boolean {
  if (!requiredCapabilities || requiredCapabilities.length === 0) return true
  return requiredCapabilities.every((capability) => capabilities[capability])
}

export function isAnyOverlayCapabilityEnabled(
  capabilities: CapabilityCheck,
  requiredAnyCapabilities: readonly OverlayCapability[] | undefined,
): boolean {
  if (!requiredAnyCapabilities || requiredAnyCapabilities.length === 0) return true
  return requiredAnyCapabilities.some((capability) => capabilities[capability])
}

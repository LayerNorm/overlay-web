import 'server-only'

import type { NextRequest, NextResponse } from 'next/server'
import { NextResponse as NextJsonResponse } from 'next/server'
import {
  deriveOverlayCapabilities,
  type CapabilityCheck,
  type OverlayCapability,
} from '@overlay/app-core'
import {
  formatOverlayConfigError,
  getOverlayRuntimeConfig,
  getOverlayRuntimeConfigSync,
} from '@/server/config'
import {
  applyAppDataCapabilitiesToOverlayCapabilities,
  deriveAppDataCapabilities,
  type AppDataCapabilities,
} from '@/server/app-data/capabilities'
import {
  getCapabilityDisabledError,
  getRequiredCapabilityForRoute,
} from './capabilities-core'
import {
  computerProviderFromEnv,
  computerRuntimeForProvider,
} from '@/server/computers/computer-runtimes'
import type { OverlayRuntimeConfig } from '@/shared/config'

export { getRequiredCapabilityForRoute } from './capabilities-core'

export function getOverlayCapabilitiesSync(): CapabilityCheck {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return deriveOverlayCapabilities()
  }
  const runtimeConfig = getOverlayRuntimeConfigSync()
  const appDataCapabilities = deriveAppDataCapabilities(runtimeConfig)
  return applyAppDataCapabilitiesToOverlayCapabilities(
    withObservabilityProviderCapabilities(deriveOverlayCapabilities(runtimeConfig), runtimeConfig),
    appDataCapabilities,
  )
}

export function getAppDataCapabilitiesSync(): AppDataCapabilities {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return deriveAppDataCapabilities(null)
  }
  return deriveAppDataCapabilities(getOverlayRuntimeConfigSync())
}

export async function getOverlayCapabilities(): Promise<CapabilityCheck> {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return deriveOverlayCapabilities()
  }
  const runtimeConfig = await getOverlayRuntimeConfig()
  const appDataCapabilities = deriveAppDataCapabilities(runtimeConfig)
  return applyAppDataCapabilitiesToOverlayCapabilities(
    withObservabilityProviderCapabilities(deriveOverlayCapabilities(runtimeConfig), runtimeConfig),
    appDataCapabilities,
  )
}

export function withObservabilityProviderCapabilities(
  capabilities: CapabilityCheck,
  runtimeConfig: OverlayRuntimeConfig,
): CapabilityCheck {
  const analyticsProvider = runtimeConfig.providers.analytics?.provider ?? 'posthog'
  const errorReportingProvider = runtimeConfig.providers.errorReporting?.provider ?? 'sentry'
  const externalAgentsEnabled = runtimeConfig.features?.externalAgents === true
    && runtimeConfig.features?.connectedAgentControlPlane === true
    && runtimeConfig.features?.remoteAgentRuns === true
  return {
    ...capabilities,
    analytics: capabilities.analytics && analyticsProvider === 'posthog',
    errorReporting: capabilities.errorReporting && errorReportingProvider === 'sentry',
    connectedAgents: externalAgentsEnabled,
    externalAgents: externalAgentsEnabled,
    cloudAgents: false,
    computers: runtimeConfig.features?.computers === true
      && computerRuntimeForProvider(computerProviderFromEnv()) !== undefined,
  }
}

export function withWorkspaceExternalAgentCapabilities(
  capabilities: CapabilityCheck,
  launchEnabled: boolean,
): CapabilityCheck {
  return {
    ...capabilities,
    connectedAgents: capabilities.connectedAgents && launchEnabled,
    externalAgents: capabilities.externalAgents && launchEnabled,
    cloudAgents: false,
  }
}

export async function getAppDataCapabilities(): Promise<AppDataCapabilities> {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return deriveAppDataCapabilities(null)
  }
  return deriveAppDataCapabilities(await getOverlayRuntimeConfig())
}

export function capabilityDisabledResponse(capability: OverlayCapability): NextResponse {
  return NextJsonResponse.json(
    getCapabilityDisabledError(capability),
    { status: 403 },
  )
}

export function runtimeConfigErrorResponse(error: unknown): NextResponse {
  const formatted = formatOverlayConfigError(error)
  return NextJsonResponse.json(
    {
      error: 'Runtime configuration is invalid',
      code: 'runtime_config_invalid',
      issues: formatted.issues,
    },
    { status: 500 },
  )
}

export async function requireOverlayCapability(
  capability: OverlayCapability,
): Promise<NextResponse | null> {
  try {
    const capabilities = await getOverlayCapabilities()
    return capabilities[capability] ? null : capabilityDisabledResponse(capability)
  } catch (error) {
    return runtimeConfigErrorResponse(error)
  }
}

export async function requireOverlayRouteCapability(
  request: NextRequest,
): Promise<NextResponse | null> {
  const capability = getRequiredCapabilityForRoute(request.method, request.nextUrl.pathname)
  return capability ? requireOverlayCapability(capability) : null
}

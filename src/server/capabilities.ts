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

export { getRequiredCapabilityForRoute } from './capabilities-core'

export function getOverlayCapabilitiesSync(): CapabilityCheck {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return deriveOverlayCapabilities()
  }
  const runtimeConfig = getOverlayRuntimeConfigSync()
  return applyAppDataCapabilitiesToOverlayCapabilities(
    deriveOverlayCapabilities(runtimeConfig),
    deriveAppDataCapabilities(runtimeConfig),
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
  return applyAppDataCapabilitiesToOverlayCapabilities(
    deriveOverlayCapabilities(runtimeConfig),
    deriveAppDataCapabilities(runtimeConfig),
  )
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

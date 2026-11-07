import { NextResponse } from 'next/server'
import {
  deriveOverlayCapabilities,
  overlayNavigationToDestinations,
  resolveOverlayAppShellConfig,
} from '@overlay/app-core'
import overlayAppConfig from '@/overlay.config'
import { runtimeConfigErrorResponse } from '@/server/capabilities'
import {
  getOverlayRuntimeConfig,
  getRedactedOverlayRuntimeConfigSummary,
} from '@/server/config'
import { isRuntimeConfigSummaryVisible } from '@/shared/config'

export async function GET() {
  try {
    const runtimeConfig = await getOverlayRuntimeConfig()
    const capabilities = deriveOverlayCapabilities(runtimeConfig)
    const appShell = resolveOverlayAppShellConfig(overlayAppConfig, { capabilities })

    return NextResponse.json({
      capabilities,
      featureFlags: appShell.appFeatureFlags,
      navigation: appShell.navigation,
      settingsSections: appShell.settingsSections,
      sidebarActions: appShell.sidebarActions,
      destinations: overlayNavigationToDestinations(appShell.navigation, appShell.settingsSections),
      ...(isRuntimeConfigSummaryVisible(runtimeConfig)
        ? { system: getRedactedOverlayRuntimeConfigSummary(runtimeConfig) }
        : {}),
    })
  } catch (error) {
    return runtimeConfigErrorResponse(error)
  }
}

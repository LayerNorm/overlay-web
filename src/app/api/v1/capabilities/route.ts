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
import {
  applyAppDataCapabilitiesToOverlayCapabilities,
  deriveAppDataCapabilities,
} from '@/server/app-data/capabilities'
import { isRuntimeConfigSummaryVisible } from '@/shared/config'
import { getSelectedIntegrationProviderId } from '@/server/integrations'

export async function GET() {
  try {
    const runtimeConfig = await getOverlayRuntimeConfig()
    const appDataCapabilities = deriveAppDataCapabilities(runtimeConfig)
    const capabilities = applyAppDataCapabilitiesToOverlayCapabilities(
      deriveOverlayCapabilities(runtimeConfig),
      appDataCapabilities,
    )
    const appShell = resolveOverlayAppShellConfig(overlayAppConfig, { capabilities })

    return NextResponse.json({
      capabilities,
      appDataCapabilities,
      integrationProvider: getSelectedIntegrationProviderId(),
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

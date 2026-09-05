import { logger } from '@/server/observability/logger'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import {
  DEFAULT_APP_SETTINGS,
  overlayNavigationToDestinations,
  resolveOverlayAppShellConfig,
  type AppBootstrapResponse,
  type AppSettings,
  type Entitlements,
} from '@overlay/app-core'
import overlayAppConfig from '@/overlay.config'
import { getOverlaySession } from '@/server/auth/session'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
} from '@/shared/ai/gateway/model-types'
import {
  AVAILABLE_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
  registerGatewayCatalogModels,
} from '@/shared/ai/gateway/model-data'
import { getGatewayCatalog } from '@/server/ai/gateway/gateway-catalog'
import {
  formatOverlayConfigError,
  getOverlayRuntimeConfig,
  getRedactedOverlayRuntimeConfigSummary,
} from '@/server/config'
import { isRuntimeConfigSummaryVisible } from '@/shared/config'
import { getOverlayCapabilities } from '@/server/capabilities'
import { deriveAppDataCapabilities, type AppDataCapabilities } from '@/server/app-data/capabilities'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { BillingEntitlementsRecord } from '@/server/billing/BillingRepository'
import { getPersonalPlanPresentation } from '@/shared/billing/billing-pricing'

export async function GET(request: NextRequest, context: AppApiRouteContext) {
  let runtimeConfig
  try {
    runtimeConfig = await getOverlayRuntimeConfig()
  } catch (error) {
    const formatted = formatOverlayConfigError(error)
    return NextResponse.json(
      {
        error: 'Runtime configuration is invalid',
        issues: formatted.issues,
      },
      { status: 500 },
    )
  }

  try {
    const { auth } = context

    const serverSecret = getInternalApiSecret()
    const browserSession = await getOverlaySession(request)
    const appDataCapabilities = deriveAppDataCapabilities(runtimeConfig)
    const isPostgresAppData = appDataCapabilities.provider === 'postgres'
    const serverContext = getOverlayServerContext()
    const billingPayer = await serverContext.billingPayerResolver.resolve({
      userId: auth.userId,
      workspaceId: context.workspace.workspace.id,
    })
    const rawEntitlementsPromise: Promise<Entitlements | null> = billingPayer.scope === 'workspace'
      ? serverContext.appData.repositories.billing.getBillingAccountEntitlementsByServer({
          billingAccountId: billingPayer.billingAccountId,
        }).then((value) => value
          ? toAppEntitlements(value)
          : null)
      : isPostgresAppData
        ? serverContext.appData.repositories.usage.getEntitlements({ userId: auth.userId })
        : convex.query<Entitlements | null>('platform/usage:getEntitlementsByServer', {
          userId: auth.userId,
          serverSecret,
        })
    const entitlementsPromise = rawEntitlementsPromise.then((value) =>
      value && billingPayer.scope === 'personal'
        ? { ...value, ...getPersonalPlanPresentation(value) }
        : value,
    )

    const [profile, entitlements, uiSettings, gatewayModels] = await Promise.all([
      !isPostgresAppData && auth.accessToken
        ? convex.query<{
            profile?: {
              userId: string
              email: string
              firstName?: string
              lastName?: string
              profilePictureUrl?: string
            }
          } | null>('auth/users:getUserProfile', {
            accessToken: auth.accessToken,
            userId: auth.userId,
          })
        : Promise.resolve(null),
      entitlementsPromise,
      isPostgresAppData
        ? serverContext.appData.repositories.settings.getByUserId(auth.userId)
        : convex.query<AppSettings>(
          'platform/uiSettings:getByServer',
          {
            userId: auth.userId,
            serverSecret,
          },
          { throwOnError: true },
        ).catch((_error) => DEFAULT_APP_SETTINGS),
      getGatewayCatalog().catch((error) => {
        logger.warn('[app/bootstrap] gateway model catalog unavailable; using curated fallback', error)
        return null
      }),
    ])
    // Only register when the catalog fetch succeeds. Registering `[]` would leave
    // AVAILABLE_MODELS as the curated fallback and cause enabled-model filters to
    // drop most user-enabled gateway IDs until the next successful load.
    if (gatewayModels) {
      registerGatewayCatalogModels(gatewayModels)
    }

    const user =
      browserSession?.user ??
      (profile?.profile
        ? {
            id: profile.profile.userId,
            email: profile.profile.email,
            firstName: profile.profile.firstName,
            lastName: profile.profile.lastName,
            profilePictureUrl: profile.profile.profilePictureUrl,
            emailVerified: false,
          }
        : null)
    const modelPolicyContext = { user, entitlements }
    const chatModels = [
      ...(overlayAppConfig.modelPolicy?.filterChatModels?.(AVAILABLE_MODELS, modelPolicyContext) ??
        AVAILABLE_MODELS),
    ]
    const imageModels = [
      ...(overlayAppConfig.modelPolicy?.filterImageModels?.(IMAGE_MODELS, modelPolicyContext) ??
        IMAGE_MODELS),
    ]
    const videoModels = [
      ...(overlayAppConfig.modelPolicy?.filterVideoModels?.(VIDEO_MODELS, modelPolicyContext) ??
        VIDEO_MODELS),
    ]
    const capabilities = await getOverlayCapabilities()
    const appShell = resolveOverlayAppShellConfig(overlayAppConfig, { capabilities })

    const response: AppBootstrapResponse & {
      appDataCapabilities: AppDataCapabilities
      system?: ReturnType<typeof getRedactedOverlayRuntimeConfigSummary>
    } = {
      user,
      entitlements,
      uiSettings: uiSettings ?? DEFAULT_APP_SETTINGS,
      chatModels,
      imageModels,
      videoModels,
      brand: appShell.brand,
      navigation: [...appShell.navigation],
      settingsSections: [...appShell.settingsSections],
      featureFlagRegistry: [...appShell.featureFlags],
      featureModules: [...appShell.featureModules],
      sidebarActions: [...appShell.sidebarActions],
      settingsPanels: [...appShell.settingsPanels],
      toolRegistry: [...appShell.tools],
      integrationRegistry: [...appShell.integrations],
      modelProviderRegistry: [...appShell.modelProviders],
      policyGates: [...appShell.policyGates],
      theme: appShell.theme,
      featureFlags: appShell.appFeatureFlags,
      capabilities,
      appDataCapabilities,
      destinations: overlayNavigationToDestinations(appShell.navigation, appShell.settingsSections),
      defaults: {
        chatModelId:
          overlayAppConfig.modelPolicy?.getDefaultChatModelId?.(chatModels, modelPolicyContext) ??
          DEFAULT_MODEL_ID,
        imageModelId:
          overlayAppConfig.modelPolicy?.getDefaultImageModelId?.(imageModels, modelPolicyContext) ??
          DEFAULT_IMAGE_MODEL_ID,
        videoModelId:
          overlayAppConfig.modelPolicy?.getDefaultVideoModelId?.(videoModels, modelPolicyContext) ??
          DEFAULT_VIDEO_MODEL_ID,
      },
    }

    if (isRuntimeConfigSummaryVisible(runtimeConfig)) {
      response.system = getRedactedOverlayRuntimeConfigSummary(runtimeConfig)
    }

    return NextResponse.json(response)
  } catch (error) {
    logger.error('[app/bootstrap] GET error:', error)
    return NextResponse.json({ error: 'Failed to load app bootstrap' }, { status: 500 })
  }
}

function toAppEntitlements(value: BillingEntitlementsRecord): Entitlements {
  const dailyLimits = value.dailyLimits
    ? {
        ask: numericLimit(value.dailyLimits.ask),
        write: numericLimit(value.dailyLimits.write),
        agent: numericLimit(value.dailyLimits.agent),
      }
    : undefined
  return {
    tier: value.tier,
    planKind: value.planKind,
    planAmountCents: value.planAmountCents,
    status: value.status,
    stripeQuantity: value.stripeQuantity,
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    creditsUsed: value.creditsUsed,
    creditsTotal: value.creditsTotal,
    budgetUsedCents: value.budgetUsedCents,
    budgetTotalCents: value.budgetTotalCents,
    budgetRemainingCents: value.budgetRemainingCents,
    allowanceTotalCents: value.allowanceTotalCents,
    allowanceUsedCents: value.allowanceUsedCents,
    allowancePercentUsed: value.allowancePercentUsed,
    topUpBalanceCents: value.topUpBalanceCents,
    autoTopUpEnabled: value.autoTopUpEnabled,
    autoTopUpAmountCents: value.autoTopUpAmountCents,
    autoTopUpConsentGranted: value.autoTopUpConsentGranted,
    dailyUsage: value.dailyUsage ?? { ask: 0, write: 0, agent: 0 },
    ...(dailyLimits ? { dailyLimits } : {}),
    ...(value.overlayStorageBytesUsed === undefined
      ? {}
      : { overlayStorageBytesUsed: value.overlayStorageBytesUsed }),
    ...(value.overlayStorageBytesLimit === undefined
      ? {}
      : { overlayStorageBytesLimit: value.overlayStorageBytesLimit }),
    ...(value.transcriptionSecondsUsed === undefined
      ? {}
      : { transcriptionSecondsUsed: value.transcriptionSecondsUsed }),
    ...(value.transcriptionSecondsLimit === undefined
      ? {}
      : { transcriptionSecondsLimit: value.transcriptionSecondsLimit }),
    ...(value.localTranscriptionEnabled === undefined
      ? {}
      : { localTranscriptionEnabled: value.localTranscriptionEnabled }),
    ...(value.resetAt === undefined
      ? {}
      : { resetAt: new Date(value.resetAt).toISOString() }),
    ...(value.billingPeriodEnd ? { billingPeriodEnd: value.billingPeriodEnd } : {}),
    ...(value.lastSyncedAt === undefined ? {} : { lastSyncedAt: value.lastSyncedAt }),
  }
}

function numericLimit(value: number | string): number {
  if (value === 'Infinity' || value === Infinity) return Number.MAX_SAFE_INTEGER
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

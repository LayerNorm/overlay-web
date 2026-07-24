import { NextRequest, NextResponse } from 'next/server'
import type { OverlayServerDiscovery } from '@overlay/api-client'
import { isHostedProviderAccessDisabled } from '@/server/ai/gateway/hosted-provider-kill-switch'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
} as const

export async function GET(request: NextRequest) {
  const deploymentId =
    process.env.OVERLAY_PUBLIC_DEPLOYMENT_ID?.trim() ||
    new URL(request.url).origin

  const discovery: OverlayServerDiscovery = {
    api: {
      currentVersion: 'v1',
      supportedVersions: ['v1'],
    },
    capabilities: {
      byok: true,
      hostedInference: !isHostedProviderAccessDisabled(),
    },
    deployment: {
      id: deploymentId,
    },
    minimumDesktopVersion: '0.1.23',
    nativeAuth: {
      authorizationPath: '/api/auth/native/authorize',
      browserHandoffPath: '/account',
      flow: 'system_browser_pkce',
      refreshPath: '/api/auth/native/refresh',
      supported: true,
      tokenPath: '/api/auth/native/exchange',
    },
  }

  return NextResponse.json(discovery, { headers: NO_STORE_HEADERS })
}

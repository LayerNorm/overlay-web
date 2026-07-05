import { NextRequest, NextResponse } from 'next/server'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'
import { resolveAuthenticatedAppUser } from '@/server/auth/app-api-auth'
import { logger } from '@/server/observability/logger'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch((_error) => ({}))) as { providers?: unknown }
    const auth = await resolveAuthenticatedAppUser(request, {})
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: NO_STORE_HEADERS }
      )
    }

    const providers = Array.isArray(body.providers)
      ? body.providers.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        )
      : []

    if (providers.length === 0) {
      return NextResponse.json(
        { error: 'providers is required' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    const keys = Object.fromEntries(
      await Promise.all(
        providers.map(async (provider) => [
          provider,
          await getServerProviderKey(provider.trim()),
        ] as const)
      )
    )

    return NextResponse.json({ keys }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    logger.error('[NativeProviderKeys] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch provider keys' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import type { AuthSession } from '@/shared/auth/session-types'
import { previewOrigin } from '@/shared/web/preview-origin'

// This endpoint is scoped to Overlay's sandbox AuthKit environment, never prod.
export const PREVIEW_WORKOS_CLIENT_ID = 'client_01KJ9A19X317J7VWRWQ6XBME9Z'

type Dependencies = {
  authenticate: (email: string, password: string) => Promise<AuthSession>
  saveSession: (session: AuthSession) => Promise<void>
  rateLimit: (request: Request) => Promise<Response | null>
}

export async function previewLoginResponse(
  request: Request,
  env: Record<string, string | undefined>,
  dependencies: Dependencies,
): Promise<Response> {
  const unavailable = () => Response.json({ error: 'Not found' }, {
    status: 404, headers: { 'Cache-Control': 'no-store' },
  })
  const secret = env.PREVIEW_LOGIN_SECRET ?? ''
  if (env.VERCEL_ENV !== 'preview' || env.OVERLAY_DEPLOYMENT_ENV !== 'preview'
    || env.WORKOS_CLIENT_ID !== PREVIEW_WORKOS_CLIENT_ID || !env.WORKOS_API_KEY?.trim()
    || secret.length < 32) return unavailable()
  try { if (!previewOrigin(env)) return unavailable() } catch (_error) { return unavailable() }
  const provided = request.headers.get('x-overlay-preview-secret') ?? ''
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (!timingSafeEqual(digest(provided), digest(secret))) return unavailable()
  // Select only pre-provisioned identities; callers cannot supply a user id.
  const identity = request.headers.get('x-overlay-preview-identity') ?? 'owner'
  if (!['owner', 'member', 'outsider'].includes(identity)) return unavailable()
  const prefix = identity === 'owner' ? 'PREVIEW_LOGIN' : `PREVIEW_${identity.toUpperCase()}_LOGIN`
  const email = env[prefix + '_EMAIL']?.trim()
  const password = env[prefix + '_PASSWORD']
  const userId = env[prefix + '_USER_ID']?.trim()
  if (!email || !password || !userId?.startsWith('user_')) return unavailable()

  const limited = await dependencies.rateLimit(request)
  if (limited) return limited
  try {
    const session = await dependencies.authenticate(email, password)
    if (session.user.id !== userId || !session.user.emailVerified || !session.accessToken || !session.refreshToken) return unavailable()
    await dependencies.saveSession(session)
    return Response.json({ success: true, userId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (_error) {
    return Response.json({ error: 'Preview authentication failed' }, {
      status: 401, headers: { 'Cache-Control': 'no-store' },
    })
  }
}

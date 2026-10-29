import 'server-only'

import type { AuthSession } from '@/shared/auth/session-types'
import { isValidPkceVerifier } from '@/server/auth/native-auth-validation'

// The desktop web shell signs its window in by redeeming the one-time session
// transfer token the browser created for it (POST /api/auth/desktop-link).
// Only the desktop holds the PKCE verifier and can attach it as a header to
// its own window navigation, so a bare link cannot sign anyone in.

export const DESKTOP_WEB_SESSION_VERIFIER_HEADER = 'x-overlay-code-verifier'

type Dependencies = {
  consumeToken: (token: string, codeVerifier: string) => Promise<string | null>
  saveSession: (session: AuthSession) => Promise<void>
  rateLimit: (request: Request) => Promise<Response | null>
}

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' } as const

function redirect(request: Request, path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...NO_STORE_HEADERS, Location: new URL(path, request.url).toString() },
  })
}

export function parseTransferredSession(json: string): AuthSession | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch (_error) {
    return null
  }
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  const accessToken = text(data.accessToken)
  const refreshToken = text(data.refreshToken)
  const userId = text(data.userId)
  const email = text(data.email)
  if (!accessToken || !refreshToken || !userId || !email) return null
  if (typeof data.expiresAt !== 'number' || data.expiresAt <= Date.now()) return null
  return {
    accessToken,
    refreshToken,
    expiresAt: data.expiresAt,
    user: {
      id: userId,
      email,
      firstName: text(data.firstName),
      lastName: text(data.lastName),
      emailVerified: data.emailVerified === true,
    },
  }
}

export async function desktopWebSessionResponse(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  const failed = () => redirect(request, '/auth/sign-in?error=desktop_sign_in_failed')
  const token = new URL(request.url).searchParams.get('token')?.trim() ?? ''
  const codeVerifier = request.headers.get(DESKTOP_WEB_SESSION_VERIFIER_HEADER)?.trim() ?? ''
  if (!/^[a-f0-9]{32}$/i.test(token) || !isValidPkceVerifier(codeVerifier)) return failed()

  const limited = await dependencies.rateLimit(request)
  if (limited) return limited

  const payload = await dependencies.consumeToken(token, codeVerifier)
  const session = payload ? parseTransferredSession(payload) : null
  if (!session) return failed()

  await dependencies.saveSession(session)
  return redirect(request, '/app')
}

import 'server-only'
import type { Session, TokenClaims } from '@overlay/app-core'

export function nativeConvexAuthEnabled(provider: string, explicit?: string): boolean {
  if (explicit === 'false') return false
  // Existing hosted backends already trust WorkOS. Private installations opt in
  // after deploying their additive native provider config, preserving web-first upgrades.
  return provider === 'workos' || explicit === 'true'
}

export async function resolveNativeConvexToken(
  session: Session,
  verify: (token: string) => Promise<TokenClaims | null>,
): Promise<string | null> {
  const claims = await verify(session.accessToken)
  if (!claims || claims.sub !== session.user.id || claims.exp * 1000 <= Date.now()) return null
  return session.accessToken
}

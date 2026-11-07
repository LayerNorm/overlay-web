import 'server-only'
import type { Session, TokenClaims } from '@overlay/app-core'

export async function resolveNativeConvexToken(
  session: Session,
  verify: (token: string) => Promise<TokenClaims | null>,
): Promise<string | null> {
  const claims = await verify(session.accessToken)
  if (!claims || claims.sub !== session.user.id || claims.exp * 1000 <= Date.now()) return null
  return session.accessToken
}

export const ACCOUNT_DELETION_TOKEN_MAX_AGE_SECONDS = 5 * 60

export async function isFreshAccountDeletionBearer(
  request: Request,
  auth: { userId: string; accessToken: string; authType: string },
  verifyAccessToken: (token: string) => Promise<{ sub?: unknown; iat?: unknown } | null>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (auth.authType !== 'access-token' || request.headers.has('cookie')) return false
  const authorization = request.headers.get('authorization')
  if (!authorization?.toLowerCase().startsWith('bearer ')) return false
  const token = authorization.slice(7).trim()
  if (!token || token !== auth.accessToken) return false
  const claims = await verifyAccessToken(token).catch((_error) => null)
  if (claims?.sub !== auth.userId || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat))
    return false
  const ageSeconds = nowSeconds - claims.iat
  return ageSeconds >= 0 && ageSeconds <= ACCOUNT_DELETION_TOKEN_MAX_AGE_SECONDS
}

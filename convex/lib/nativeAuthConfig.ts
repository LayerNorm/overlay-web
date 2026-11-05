import type { AuthConfig } from 'convex/server'

// Convex auth-config evaluation throws on missing env reads, even with ??/?.
// Read only the selected provider's explicit deployment settings.
export function deployedNativeAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const selected = env.OVERLAY_PROVIDER_AUTH?.trim()
  const fields: Record<string, string[]> = {
    none: [],
    workos: ['WORKOS_CLIENT_ID'],
    oidc: ['OIDC_ISSUER_URL', 'OIDC_AUDIENCE'],
    'better-auth': ['BETTER_AUTH_URL', 'BETTER_AUTH_JWT_ISSUER', 'BETTER_AUTH_JWT_AUDIENCE', 'BETTER_AUTH_JWKS_URL'],
  }
  if (!selected || !Object.hasOwn(fields, selected)) throw new Error('Set OVERLAY_PROVIDER_AUTH on the Convex deployment')
  const values: Record<string, string> = { OVERLAY_PROVIDER_AUTH: selected }
  for (const name of fields[selected]) {
    const value = env[name]?.trim()
    if (!value) throw new Error(`Native auth requires ${name}`)
    values[name] = value
  }
  return nativeAuthConfig(values)
}

export function nativeAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const selected = env.OVERLAY_PROVIDER_AUTH?.trim() || env.AUTH_PROVIDER?.trim() || 'workos'
  if (selected === 'none') return { providers: [] }
  if (selected === 'oidc') {
    const domain = env.OIDC_ISSUER_URL?.trim()
    const applicationID = env.OIDC_AUDIENCE?.trim() || env.OIDC_CLIENT_ID?.trim()
    if (!domain || !applicationID) throw new Error('Native OIDC auth requires issuer and audience')
    return { providers: [{ domain, applicationID }] }
  }
  if (selected === 'better-auth') {
    const base = env.BETTER_AUTH_URL?.trim() || env.BETTER_AUTH_BASE_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim()
    if (!base) throw new Error('Native Better Auth requires its application origin')
    const origin = new URL(base).origin
    const issuer = new URL(env.BETTER_AUTH_JWT_ISSUER?.trim() || origin).origin
    const applicationID = env.BETTER_AUTH_JWT_AUDIENCE?.trim() || origin
    const configuredPath = env.BETTER_AUTH_BASE_PATH?.trim() || '/api/better-auth'
    const basePath = `/${configuredPath.replace(/^\/+|\/+$/g, '')}`
    const jwks = env.BETTER_AUTH_JWKS_URL?.trim() || `${origin}${basePath}/jwks`
    return { providers: [{ type: 'customJwt', issuer, applicationID, jwks, algorithm: 'RS256' }] }
  }
  if (selected !== 'workos') throw new Error('Unsupported native Convex auth provider')
  const clientId = env.WORKOS_CLIENT_ID?.trim()
  if (!clientId) return { providers: [] }
  const jwks = `https://api.workos.com/sso/jwks/${clientId}`
  return { providers: [
    ...['https://api.workos.com', 'https://api.workos.com/'].map((issuer) => ({
      type: 'customJwt' as const, issuer, jwks, applicationID: clientId, algorithm: 'RS256' as const,
    })),
    {
      type: 'customJwt', issuer: `https://api.workos.com/user_management/${clientId}`,
      // WorkOS's scoped issuer and client-specific keys bind tokens without aud.
      jwks, algorithm: 'RS256',
    },
  ] }
}

const workosClientId = process.env.WORKOS_CLIENT_ID?.trim()

const workosJwks = workosClientId
  ? `https://api.workos.com/sso/jwks/${workosClientId}`
  : ''

// WorkOS access tokens carry either `iss=https://api.workos.com` or the
// user-management-scoped issuer; both verify against the same JWKS.
const workosProviders = workosClientId
  ? [
      {
        type: 'customJwt' as const,
        issuer: 'https://api.workos.com',
        jwks: workosJwks,
        applicationID: workosClientId,
        algorithm: 'RS256' as const,
      },
      {
        type: 'customJwt' as const,
        issuer: `https://api.workos.com/user_management/${workosClientId}`,
        jwks: workosJwks,
        applicationID: workosClientId,
        algorithm: 'RS256' as const,
      },
    ]
  : []

const config = {
  providers: workosProviders,
}

export default config

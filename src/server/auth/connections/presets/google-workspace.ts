import type { BetterAuthPresetResolver } from '../types'
import { resolvedOidcConnection } from './shared'

const GOOGLE_ISSUER = 'https://accounts.google.com'

export const resolveGoogleWorkspaceConnection: BetterAuthPresetResolver = (input) =>
  resolvedOidcConnection(input, {
    issuerUrl: GOOGLE_ISSUER,
    discoveryEndpoint: `${GOOGLE_ISSUER}/.well-known/openid-configuration`,
    trustedOrigins: [
      'https://oauth2.googleapis.com',
      'https://openidconnect.googleapis.com',
      'https://www.googleapis.com',
    ],
    label: 'Continue with Google',
    icon: 'google',
  })

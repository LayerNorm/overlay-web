import type { BetterAuthPresetResolver } from '../types'
import { resolvedOidcConnection } from './shared'

const GOOGLE_ISSUER = 'https://accounts.google.com'

export const resolveGoogleWorkspaceConnection: BetterAuthPresetResolver = (input) =>
  resolvedOidcConnection(input, {
    issuerUrl: GOOGLE_ISSUER,
    discoveryEndpoint: `${GOOGLE_ISSUER}/.well-known/openid-configuration`,
    label: 'Continue with Google Workspace',
    icon: 'google',
  })

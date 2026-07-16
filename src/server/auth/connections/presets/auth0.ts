import type { BetterAuthPresetResolver } from '../types'
import { requiredIssuer, resolvedOidcConnection } from './shared'

export const resolveAuth0Connection: BetterAuthPresetResolver = (input) =>
  resolvedOidcConnection(input, {
    issuerUrl: requiredIssuer(input),
    label: 'Continue with Auth0',
    icon: 'sso',
  })

import type { BetterAuthPresetResolver } from '../types'
import { requiredIssuer, resolvedOidcConnection } from './shared'

export const resolveGenericOidcConnection: BetterAuthPresetResolver = (input) =>
  resolvedOidcConnection(input, {
    issuerUrl: requiredIssuer(input),
    label: 'Continue with SSO',
    icon: 'sso',
  })

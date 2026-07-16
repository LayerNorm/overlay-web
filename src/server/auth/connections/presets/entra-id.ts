import type { BetterAuthPresetResolver } from '../types'
import { resolvedOidcConnection } from './shared'

const MICROSOFT_LOGIN_ORIGIN = 'https://login.microsoftonline.com'

export const resolveEntraIdConnection: BetterAuthPresetResolver = (input) => {
  const issuerUrl = input.connection.issuerUrl ?? entraIssuer(input.connection.tenantId)
  return resolvedOidcConnection(input, {
    issuerUrl,
    label: 'Continue with Microsoft Entra ID',
    icon: 'microsoft',
  })
}

function entraIssuer(tenantId: string | undefined): string {
  if (!tenantId) {
    throw new Error('entra-id connection requires tenantId or issuerUrl')
  }
  return `${MICROSOFT_LOGIN_ORIGIN}/${encodeURIComponent(tenantId)}/v2.0`
}

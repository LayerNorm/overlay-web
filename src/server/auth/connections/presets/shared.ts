import type {
  BetterAuthConnectionIcon,
  BetterAuthPresetResolverInput,
  ResolvedBetterAuthOidcConnection,
} from '../types'

export const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile']

export function resolvedOidcConnection(
  input: BetterAuthPresetResolverInput,
  defaults: {
    issuerUrl: string
    discoveryEndpoint?: string
    label: string
    icon: BetterAuthConnectionIcon
  },
): ResolvedBetterAuthOidcConnection {
  const { connection, clientId, clientSecret } = input
  const issuerWithoutTrailingSlash = defaults.issuerUrl.replace(/\/+$/, '')

  return {
    id: connection.id,
    protocol: 'oidc',
    preset: connection.preset,
    label: connection.label ?? defaults.label,
    icon: defaults.icon,
    domains: [...connection.domains],
    issuerUrl: defaults.issuerUrl,
    discoveryEndpoint:
      connection.discoveryEndpoint ??
      defaults.discoveryEndpoint ??
      `${issuerWithoutTrailingSlash}/.well-known/openid-configuration`,
    clientId,
    clientSecret,
    scopes: [...DEFAULT_OIDC_SCOPES],
  }
}

export function requiredIssuer(input: BetterAuthPresetResolverInput): string {
  const issuerUrl = input.connection.issuerUrl
  if (!issuerUrl) {
    throw new Error(`${input.connection.preset} connection ${input.connection.id} requires issuerUrl`)
  }
  return issuerUrl
}

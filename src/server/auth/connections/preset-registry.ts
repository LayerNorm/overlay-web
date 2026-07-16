import {
  OverlayBetterAuthConnectionSchema,
  type OverlayBetterAuthConnection,
  type OverlayBetterAuthConnectionPreset,
} from '@/shared/config'
import { resolveAuth0Connection } from './presets/auth0'
import { resolveEntraIdConnection } from './presets/entra-id'
import { resolveGenericOidcConnection } from './presets/generic-oidc'
import { resolveGoogleWorkspaceConnection } from './presets/google-workspace'
import type {
  BetterAuthConfig,
  BetterAuthCredentialSource,
  BetterAuthPresetResolver,
  ResolvedBetterAuthConnectionSet,
  ResolvedBetterAuthOidcConnection,
} from './types'

const PRESET_REGISTRY: Record<OverlayBetterAuthConnectionPreset, BetterAuthPresetResolver> = {
  'google-workspace': resolveGoogleWorkspaceConnection,
  auth0: resolveAuth0Connection,
  'entra-id': resolveEntraIdConnection,
  'generic-oidc': resolveGenericOidcConnection,
}

export function resolveBetterAuthConnectionSet(
  config: BetterAuthConfig,
  env: BetterAuthCredentialSource = process.env,
): ResolvedBetterAuthConnectionSet {
  const configuredConnections = config.connections.length > 0
    ? config.connections
    : legacyConnection(config)
  const source = config.connections.length > 0
    ? 'connections'
    : configuredConnections.length > 0
      ? 'legacy'
      : 'none'
  const connections = configuredConnections.map((connection) =>
    resolveBetterAuthConnection(connection, env),
  )
  const configuredPolicyDomains = config.accessPolicy.allowedEmailDomains
  const allowedEmailDomains = configuredPolicyDomains.length > 0
    ? [...configuredPolicyDomains]
    : unique(connections.flatMap((connection) => connection.domains))

  return {
    connections,
    accessPolicy: {
      requireVerifiedEmail: config.accessPolicy.requireVerifiedEmail,
      allowedEmailDomains,
    },
    source,
  }
}

export function resolveBetterAuthConnection(
  connection: OverlayBetterAuthConnection,
  env: BetterAuthCredentialSource = process.env,
): ResolvedBetterAuthOidcConnection {
  const resolver = PRESET_REGISTRY[connection.preset]
  return resolver({
    connection,
    clientId: resolveCredential(connection, 'clientId', 'clientIdEnv', env),
    clientSecret: resolveCredential(connection, 'clientSecret', 'clientSecretEnv', env),
  })
}

function legacyConnection(config: BetterAuthConfig): OverlayBetterAuthConnection[] {
  if (
    !config.defaultSsoProviderId ||
    !config.defaultSsoDomain ||
    !config.oidcIssuerUrl ||
    !config.oidcClientId ||
    !config.oidcClientSecret
  ) {
    return []
  }

  return [OverlayBetterAuthConnectionSchema.parse({
    id: config.defaultSsoProviderId,
    protocol: 'oidc',
    preset: 'generic-oidc',
    domains: config.defaultSsoDomain
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
    issuerUrl: config.oidcIssuerUrl,
    discoveryEndpoint: config.oidcDiscoveryEndpoint,
    clientId: config.oidcClientId,
    clientSecret: config.oidcClientSecret,
  })]
}

function resolveCredential(
  connection: OverlayBetterAuthConnection,
  valueKey: 'clientId' | 'clientSecret',
  envKey: 'clientIdEnv' | 'clientSecretEnv',
  env: BetterAuthCredentialSource,
): string {
  const configuredValue = connection[valueKey]
  if (configuredValue) return configuredValue

  const variableName = connection[envKey]
  const envValue = variableName ? env[variableName]?.trim() : undefined
  if (!envValue) {
    throw new Error(
      `Better Auth connection ${connection.id} requires ${valueKey}` +
      (variableName ? ` from ${variableName}` : ''),
    )
  }
  return envValue
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

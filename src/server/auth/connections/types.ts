import type {
  OverlayBetterAuthAccessPolicy,
  OverlayBetterAuthConnection,
  OverlayBetterAuthConnectionPreset,
  OverlayRuntimeConfig,
} from '@/shared/config'

export type BetterAuthConfig = OverlayRuntimeConfig['auth']['betterAuth']
export type BetterAuthConnectionIcon = 'google' | 'microsoft' | 'sso'
export type BetterAuthCredentialSource = Record<string, string | undefined>

export interface ResolvedBetterAuthOidcConnection {
  id: string
  protocol: 'oidc'
  preset: OverlayBetterAuthConnectionPreset
  label: string
  icon: BetterAuthConnectionIcon
  domains: string[]
  issuerUrl: string
  discoveryEndpoint: string
  trustedOrigins: string[]
  clientId: string
  clientSecret: string
  scopes: string[]
}

export interface ResolvedBetterAuthConnectionSet {
  connections: ResolvedBetterAuthOidcConnection[]
  accessPolicy: OverlayBetterAuthAccessPolicy
  source: 'connections' | 'legacy' | 'none'
}

export interface BetterAuthPresetResolverInput {
  connection: OverlayBetterAuthConnection
  clientId: string
  clientSecret: string
}

export type BetterAuthPresetResolver = (
  input: BetterAuthPresetResolverInput,
) => ResolvedBetterAuthOidcConnection

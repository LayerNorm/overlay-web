export const AUTH_SSO_PROVIDER_ICONS = [
  'google',
  'apple',
  'microsoft',
  'sso',
] as const

export type AuthSsoProviderIcon = (typeof AUTH_SSO_PROVIDER_ICONS)[number]

export interface AuthSsoProviderOption {
  id: string
  label: string
  icon: AuthSsoProviderIcon
}

export interface AuthUiOptions {
  provider: string
  supportsSso: boolean
  supportsPasswordSignIn: boolean
  supportsPasswordSignUp: boolean
  supportsPasswordReset: boolean
  supportsEmailVerification: boolean
  ssoProviders: AuthSsoProviderOption[]
}

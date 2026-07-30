export type HostedProviderEnvironment = Readonly<Record<string, string | undefined>>

export class HostedProviderAccessDisabledError extends Error {
  readonly code = 'hosted_provider_access_disabled'

  constructor() {
    super('Hosted provider access is disabled by the emergency kill switch.')
    this.name = 'HostedProviderAccessDisabledError'
  }
}

export function isHostedProviderAccessDisabled(
  env: HostedProviderEnvironment = process.env,
): boolean {
  return env.OVERLAY_HOSTED_PROVIDER_KILL_SWITCH?.trim() === '1'
}

export function assertHostedProviderAccessEnabled(
  env: HostedProviderEnvironment = process.env,
): void {
  if (isHostedProviderAccessDisabled(env)) {
    throw new HostedProviderAccessDisabledError()
  }
}

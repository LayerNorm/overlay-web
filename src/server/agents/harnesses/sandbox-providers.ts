import 'server-only'

/**
 * Sandbox-provider seam for managed HarnessAgents.
 *
 * v1 supports Vercel Sandbox only, through the official
 * `@ai-sdk/sandbox-vercel` provider. Daytona and Box arrive via the
 * `createOverlaySandboxProvider` bridge in Phase 4
 * (`docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`) — until then they are absent
 * from `managedHarnessSandboxProviders()` so callers cannot select a provider
 * the deployment cannot actually create.
 */
import type { HarnessV1SandboxProvider } from '@ai-sdk/harness'
import type { SandboxProviderId } from '@overlay/sandbox-runtime'

export type ManagedHarnessSandboxProviderId = Extract<SandboxProviderId, 'vercel'>

export const MANAGED_HARNESS_DEFAULT_SANDBOX_PROVIDER: ManagedHarnessSandboxProviderId = 'vercel'

/**
 * Providers the deployment can create HarnessAgent sandbox sessions on,
 * derived from which provider credentials are configured. Order is the UI's
 * preferred default order.
 */
export function managedHarnessSandboxProviders(): ManagedHarnessSandboxProviderId[] {
  return vercelHarnessCredentialsConfigured() ? ['vercel'] : []
}

/**
 * The provider to use for a managed harness, honoring the
 * `OVERLAY_HARNESS_SANDBOX_PROVIDER` override. Throws when the selected
 * provider is not configured so misconfiguration is loud at provision time.
 */
export function resolveManagedHarnessSandboxProvider(
  override?: string,
): ManagedHarnessSandboxProviderId {
  const selected = override?.trim().toLowerCase()
    || process.env.OVERLAY_HARNESS_SANDBOX_PROVIDER?.trim().toLowerCase()
    || MANAGED_HARNESS_DEFAULT_SANDBOX_PROVIDER
  if (selected !== 'vercel') {
    throw new Error(
      `Managed harness sandbox provider '${selected}' is not supported yet; supported: vercel`,
    )
  }
  if (!vercelHarnessCredentialsConfigured()) {
    throw new Error(
      'Vercel Sandbox is not configured: set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID',
    )
  }
  return 'vercel'
}

/**
 * Loads the `HarnessV1SandboxProvider` for a managed harness turn. Dynamic
 * import keeps `@vercel/sandbox` out of module scope.
 */
export async function loadHarnessSandboxProvider(
  settings?: Parameters<typeof import('@ai-sdk/sandbox-vercel').createVercelSandbox>[0],
): Promise<HarnessV1SandboxProvider> {
  resolveManagedHarnessSandboxProvider()
  const { createVercelSandbox } = await import('@ai-sdk/sandbox-vercel')
  return createVercelSandbox(settings)
}

/**
 * Deploy-time signal for "can this deployment create Vercel sandboxes". The
 * `@vercel/sandbox` SDK can also resolve auth from a local Vercel CLI/plugin
 * session (verified by the Phase 0 smoke), but env credentials are the
 * supported production path and the only one the picker should advertise.
 */
function vercelHarnessCredentialsConfigured(): boolean {
  return Boolean(
    process.env.VERCEL_TOKEN?.trim()
      && process.env.VERCEL_TEAM_ID?.trim()
      && process.env.VERCEL_PROJECT_ID?.trim(),
  )
}

import 'server-only'

/**
 * Sandbox-provider seam for managed HarnessAgents.
 *
 * - `vercel` runs through the official `@ai-sdk/sandbox-vercel` provider —
 *   the only sandbox with request transformations, so it is the only provider
 *   that can serve Overlay-funded or BYOK model credentials without placing
 *   real keys inside the sandbox environment.
 * - `daytona` runs through `createOverlayHarnessSandboxProvider` — the
 *   `SandboxRuntime` → `HarnessV1SandboxProvider` bridge in
 *   `@overlay/sandbox-runtime/harness-bridge`. Daytona sessions have no
 *   request-transformation surface, so credential env vars are forwarded as
 *   real values inside the sandbox (host credentials only — never customer
 *   BYOK material, which is refused for non-Vercel providers).
 * - `box` is intentionally absent: it has no egress allowlist primitive
 *   (`networkPolicy` is unsupported) and would place raw credential values in
 *   the sandbox env. It stays the Computers provider until both gaps close.
 *
 * See `docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`, Phase 4.
 */
import type { HarnessV1SandboxProvider } from '@ai-sdk/harness'
import type { SandboxProviderId } from '@overlay/sandbox-runtime'

export type ManagedHarnessSandboxProviderId = Extract<SandboxProviderId, 'vercel' | 'daytona'>

export const MANAGED_HARNESS_DEFAULT_SANDBOX_PROVIDER: ManagedHarnessSandboxProviderId = 'vercel'

/**
 * Providers the deployment can create HarnessAgent sandbox sessions on,
 * derived from which provider credentials are configured. Order is the UI's
 * preferred default order.
 */
export function managedHarnessSandboxProviders(): ManagedHarnessSandboxProviderId[] {
  const providers: ManagedHarnessSandboxProviderId[] = []
  if (vercelHarnessCredentialsConfigured()) providers.push('vercel')
  if (daytonaHarnessCredentialsConfigured()) providers.push('daytona')
  return providers
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
  if (selected === 'vercel') {
    if (!vercelHarnessCredentialsConfigured()) {
      throw new Error(
        'Vercel Sandbox is not configured: set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID',
      )
    }
    return 'vercel'
  }
  if (selected === 'daytona') {
    if (!daytonaHarnessCredentialsConfigured()) {
      throw new Error('Daytona Sandbox is not configured: set DAYTONA_API_KEY')
    }
    return 'daytona'
  }
  if (selected === 'box') {
    throw new Error(
      'Box is not offered for managed harnesses: it has no egress allowlist primitive and would place raw model credentials in the sandbox environment.',
    )
  }
  throw new Error(
    `Managed harness sandbox provider '${selected}' is not supported; supported: ${managedHarnessSandboxProviders().join(', ') || 'none'}`,
  )
}

/**
 * Loads the `HarnessV1SandboxProvider` for a managed harness turn. Dynamic
 * imports keep provider SDKs out of module scope. For Daytona the provider
 * wraps the Overlay `SandboxRuntime` via the harness bridge.
 */
export async function loadHarnessSandboxProvider(
  provider?: ManagedHarnessSandboxProviderId,
): Promise<HarnessV1SandboxProvider> {
  const resolved = provider ?? resolveManagedHarnessSandboxProvider()
  if (resolved === 'vercel') {
    const { createVercelSandbox } = await import('@ai-sdk/sandbox-vercel')
    return createVercelSandbox()
  }
  const { createOverlayHarnessSandboxProvider } = await import('@overlay/sandbox-runtime/harness-bridge')
  const { managedSandboxRuntimeFromEnv } = await import('@/server/agents/ManagedAgentSandboxService')
  return createOverlayHarnessSandboxProvider({
    runtime: managedSandboxRuntimeFromEnv(resolved),
  })
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

function daytonaHarnessCredentialsConfigured(): boolean {
  return Boolean(process.env.DAYTONA_API_KEY?.trim())
}

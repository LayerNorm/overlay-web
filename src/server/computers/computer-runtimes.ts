import 'server-only'

import type { SandboxRuntime } from '@overlay/sandbox-runtime'
import { BoxSandboxRuntime } from '@overlay/sandbox-runtime/box'

/**
 * Which computer provider this deployment operates. A computer row stores the
 * provider that created its machine; only rows matching the configured
 * provider can be operated — mixed-provider workspaces resolve per row.
 */
export function computerProviderFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.OVERLAY_COMPUTER_PROVIDER?.trim().toLowerCase() || 'box'
}

/** Build a fresh runtime for the selected provider, or undefined when its credentials are absent. */
export function computerRuntimeFromEnv(
  providerOverride?: string,
  env: NodeJS.ProcessEnv = process.env,
): SandboxRuntime | undefined {
  const provider = providerOverride?.trim().toLowerCase() || computerProviderFromEnv(env)
  if (provider === 'box') {
    // Admin-scope preset required (box.create/resume/fork/delete) — the
    // `full-box` preset lacks them.
    const apiKey = env.BOX_API_KEY?.trim()
    return apiKey ? new BoxSandboxRuntime({ apiKey }) : undefined
  }
  return undefined
}

/**
 * The `runtimeFor` closure `ComputerService` consumes: resolves a computer
 * row's provider to a cached runtime. Returns undefined when the row's
 * provider is not the configured one or its credentials are absent — the
 * service maps that to `provider_unavailable` (503), which is also the state
 * every computer lands in on a deployment that never configured box.
 */
export function createComputerRuntimeResolver(env: NodeJS.ProcessEnv = process.env) {
  const runtimes = new Map<string, SandboxRuntime>()
  return function computerRuntimeForProvider(provider: string): SandboxRuntime | undefined {
    const key = provider.trim().toLowerCase()
    if (!key || key !== computerProviderFromEnv(env)) return undefined
    const cached = runtimes.get(key)
    if (cached) return cached
    const runtime = computerRuntimeFromEnv(key, env)
    if (runtime) runtimes.set(key, runtime)
    return runtime
  }
}

/** Process-env singleton shared by bootstrap and the capability derivation. */
export const computerRuntimeForProvider = createComputerRuntimeResolver()

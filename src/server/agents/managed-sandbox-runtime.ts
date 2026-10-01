import 'server-only'

import type { SandboxRuntime } from '@overlay/sandbox-runtime'
import { BoxSandboxRuntime } from '@overlay/sandbox-runtime/box'

/** Idle window after which the lease meter stops an Overlay Cloud machine. */
export const MANAGED_SANDBOX_IDLE_TIMEOUT_MS = 15 * 60_000

export class ManagedSandboxError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'ManagedSandboxError'
  }
}

/**
 * The runtime that owns a managed sandbox lease. Overlay Cloud is Box; leases
 * written for providers that have since been removed (Vercel Sandbox) are
 * refused rather than guessed at.
 */
export function managedSandboxRuntimeFromEnv(providerOverride?: string): SandboxRuntime {
  const provider = providerOverride?.trim().toLowerCase() || 'box'
  if (provider === 'box') {
    const apiKey = process.env.BOX_API_KEY?.trim()
    if (!apiKey) {
      throw new ManagedSandboxError('Box is not configured: set BOX_API_KEY', 503, 'managed_sandbox_provider_invalid')
    }
    return new BoxSandboxRuntime({ apiKey })
  }
  throw new ManagedSandboxError(`Unsupported managed sandbox provider: ${provider}`, 503, 'managed_sandbox_provider_invalid')
}

import 'server-only'

import type { SandboxRuntime } from '@overlay/sandbox-runtime'
import { Sandbox as E2BSdkSandbox } from 'e2b'
import { BoxSandboxRuntime, boatApiKeyFromEnv } from '@overlay/sandbox-runtime/box'
import { E2BSandboxRuntime, e2bApiKeyFromEnv, type E2BSandboxClass } from '@overlay/sandbox-runtime/e2b'

/** Idle window after which the lease meter stops an Overlay Cloud machine. */
export const MANAGED_SANDBOX_IDLE_TIMEOUT_MS = 15 * 60_000

export class ManagedSandboxError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'ManagedSandboxError'
  }
}

/**
 * The provider new managed machines are created on. Overlay Cloud is Box; a self-hosted deployment sets
 * `OVERLAY_MANAGED_SANDBOX_PROVIDER=e2b` (with `E2B_API_KEY`). Existing leases keep the provider they were created on.
 */
export function defaultManagedSandboxProvider(env: Record<string, string | undefined> = process.env): string {
  return env.OVERLAY_MANAGED_SANDBOX_PROVIDER?.trim().toLowerCase() || 'box'
}

/**
 * The runtime that owns a managed sandbox lease. Leases written for providers that have since been removed (Vercel
 * Sandbox) are refused rather than guessed at.
 */
export function managedSandboxRuntimeFromEnv(providerOverride?: string): SandboxRuntime {
  const provider = providerOverride?.trim().toLowerCase() || defaultManagedSandboxProvider()
  if (provider === 'e2b') {
    const apiKey = e2bApiKeyFromEnv()
    if (!apiKey) {
      throw new ManagedSandboxError('E2B is not configured: set E2B_API_KEY', 503, 'managed_sandbox_provider_invalid')
    }
    return new E2BSandboxRuntime({
      apiKey,
      ...(process.env.E2B_DOMAIN?.trim() ? { domain: process.env.E2B_DOMAIN.trim() } : {}),
      sandbox: E2BSdkSandbox as unknown as E2BSandboxClass,
    })
  }
  if (provider === 'box') {
    const apiKey = boatApiKeyFromEnv()
    if (!apiKey) {
      throw new ManagedSandboxError('Box is not configured: set BOAT_API_KEY', 503, 'managed_sandbox_provider_invalid')
    }
    return new BoxSandboxRuntime({ apiKey })
  }
  throw new ManagedSandboxError(`Unsupported managed sandbox provider: ${provider}`, 503, 'managed_sandbox_provider_invalid')
}

import type { SandboxInstance } from './contracts'

/** Overlay-owned idle policy used when a provider has no native idle-stop primitive. */
export async function enforceSandboxIdleStop(input: {
  sandbox: SandboxInstance
  lastActivityAt: number
  idleTimeoutMs: number
  now?: number
}): Promise<boolean> {
  if (input.idleTimeoutMs <= 0) return false
  const now = input.now ?? Date.now()
  if (now - input.lastActivityAt < input.idleTimeoutMs) return false
  if (await input.sandbox.status() !== 'running') return false
  await input.sandbox.stop()
  return true
}

/** Overlay-owned absolute deadline guard; provider hard timeouts remain defense in depth. */
export async function enforceSandboxHardTimeout(input: {
  sandbox: SandboxInstance
  createdAt: number
  hardTimeoutMs: number
  now?: number
}): Promise<boolean> {
  const now = input.now ?? Date.now()
  if (now - input.createdAt < input.hardTimeoutMs) return false
  if (await input.sandbox.status() === 'deleted') return false
  await input.sandbox.delete()
  return true
}

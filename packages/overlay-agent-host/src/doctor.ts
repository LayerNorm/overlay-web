import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import type { AgentAdapter } from './adapter.js'
import type { AgentHostConfig } from './config.js'
import { loadOrCreateDeviceKeyPair } from './device-key.js'
import { SqliteHostStateStore } from './state.js'

export type DoctorCheck = { name: string; ok: boolean; detail: string }

export async function diagnoseHost(config: AgentHostConfig, adapters: AgentAdapter[]): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []
  checks.push({
    name: 'credential', ok: Boolean(config.credential),
    detail: config.credential ? `Loaded from ${config.credentialEnv}` : `Missing environment variable ${config.credentialEnv}`,
  })
  try {
    await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 })
    await access(config.stateDirectory, constants.R_OK | constants.W_OK)
    checks.push({ name: 'state-directory', ok: true, detail: config.stateDirectory })
  } catch (error) { checks.push({ name: 'state-directory', ok: false, detail: safeError(error) }) }
  try {
    const keys = await loadOrCreateDeviceKeyPair(config.stateDirectory)
    checks.push({ name: 'device-key', ok: keys.publicKey.includes('PUBLIC KEY'), detail: 'Ed25519 device key is available' })
  } catch (error) { checks.push({ name: 'device-key', ok: false, detail: safeError(error) }) }
  try {
    const store = new SqliteHostStateStore(join(config.stateDirectory, 'host.sqlite'))
    store.close()
    checks.push({ name: 'sqlite', ok: true, detail: 'SQLite state and outbox are writable' })
  } catch (error) { checks.push({ name: 'sqlite', ok: false, detail: safeError(error) }) }
  for (const adapter of adapters) {
    try {
      const capability = await adapter.discover()
      checks.push({ name: `adapter:${capability.id}`, ok: true, detail: `${capability.protocol} adapter discovered` })
    } catch (error) { checks.push({ name: `adapter:${adapter.capability.id}`, ok: false, detail: safeError(error) }) }
  }
  return checks
}

function safeError(error: unknown): string { return error instanceof Error ? error.message : 'unknown error' }

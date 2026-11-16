import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { AgentHostConfig } from './config.js'
import { loadOrCreateDeviceKeyPair } from './device-key.js'
import type { LocalToolExecutor } from './local-tools.js'

export type DoctorCheck = { name: string; ok: boolean; detail: string }

export async function diagnoseHost(config: AgentHostConfig, localTools: LocalToolExecutor): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []
  checks.push({
    name: 'credential', ok: Boolean(config.credential),
    detail: config.credential ? `Loaded from ${config.credentialEnv} or the connection store` : `Missing environment variable ${config.credentialEnv}`,
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
  const capability = await localTools.capability()
  checks.push({ name: 'local-tools', ok: capability.features.length > 0, detail: capability.features.join(', ') })
  return checks
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import 'server-only'

import { WorkOS } from '@workos-inc/node'
import { assertHostedProviderAccessEnabled } from './hosted-provider-kill-switch'

// Maps provider name → vault object name (= env var name, as stored in WorkOS Vault dashboard)
const PROVIDER_VAULT_NAMES: Record<string, string> = {
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  composio: 'COMPOSIO_API_KEY',
  ai_gateway: 'AI_GATEWAY_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
}

const CACHE_TTL_MS = 5 * 60 * 1000

// name → vault object id, rebuilt every CACHE_TTL_MS
let vaultIndex: Record<string, string> | null = null
let vaultIndexBuiltAt = 0

// per-provider value cache
const valueCache = new Map<string, { value: string | null; expiresAt: number }>()

function getWorkOSClient(): WorkOS | null {
  const apiKey = process.env.WORKOS_API_KEY?.trim()
  return apiKey ? new WorkOS(apiKey) : null
}

async function getVaultIndex(workos: WorkOS): Promise<Record<string, string>> {
  const now = Date.now()
  if (vaultIndex && now - vaultIndexBuiltAt < CACHE_TTL_MS) return vaultIndex

  type VaultListItem = { id: string; name: string }
  type VaultListResult = { data: VaultListItem[] } | VaultListItem[]
  const result = (await workos.vault.listObjects()) as unknown as VaultListResult
  const objects: VaultListItem[] = Array.isArray(result) ? result : result.data

  const index: Record<string, string> = {}
  for (const obj of objects) index[obj.name] = obj.id

  vaultIndex = index
  vaultIndexBuiltAt = now
  return index
}

async function readFromVault(vaultName: string): Promise<string | null> {
  const workos = getWorkOSClient()
  if (!workos) return null

  try {
    const index = await getVaultIndex(workos)
    const id = index[vaultName]
    if (!id) return null

    type VaultObject = { value?: unknown }
    const obj = await (workos.vault.readObject as (args: { id: string }) => Promise<VaultObject>)({
      id,
    })
    const val = typeof obj.value === 'string' ? obj.value.trim() : ''
    return val.length > 0 ? val : null
  } catch (_error) {
    return null
  }
}

export async function getServerProviderKey(provider: string): Promise<string | null> {
  // Check before the in-memory cache so activating the switch takes effect on
  // the next operation without a process restart.
  assertHostedProviderAccessEnabled()

  const cached = valueCache.get(provider)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const vaultName = PROVIDER_VAULT_NAMES[provider]
  if (!vaultName) return null

  // 1. Try WorkOS Vault (primary)
  let value = await readFromVault(vaultName)

  // 2. Fall back to env vars (local dev / vault miss)
  if (!value) {
    value = process.env[vaultName]?.trim() || null
  }

  valueCache.set(provider, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

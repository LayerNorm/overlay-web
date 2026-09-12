/**
 * smoke-vault.ts
 *
 * Tests WorkOS Vault connectivity: lists all objects and reads their values.
 * Run: npm run test:vault:smoke
 */

import { WorkOS } from '@workos-inc/node'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function logStep(step: string) { console.log(`\n[VaultSmoke] ▶ ${step}`) }
function logOk(msg: string)   { console.log(`[VaultSmoke] ✓ ${msg}`) }
function logErr(msg: string, err?: unknown) { console.error(`[VaultSmoke] ✗ ${msg}`, err ?? '') }

// Vault object names as stored in WorkOS dashboard (confirmed by smoke test)
const EXPECTED_VAULT_NAMES = [
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'COMPOSIO_API_KEY',
  'AI_GATEWAY_API_KEY',
]

async function main() {
  console.log('[VaultSmoke] Starting WorkOS Vault smoke test...')

  const apiKey = requireEnv('WORKOS_API_KEY')
  console.log(`[VaultSmoke] API key : ${apiKey.slice(0, 15)}...`)
  console.log(`[VaultSmoke] Env     : ${apiKey.startsWith('sk_test_') ? 'STAGING' : 'PRODUCTION'}`)

  const workos = new WorkOS(apiKey)

  // ── 1. List all vault objects ───────────────────────────────────────────
  logStep('Listing all vault objects')
  let objects: Array<{ id: string; name: string }>
  try {
    const result = await workos.vault.listObjects()
    objects = (result as unknown as { data: typeof objects }).data ?? (result as unknown as typeof objects)
    logOk(`Found ${objects.length} vault object(s)`)
    for (const obj of objects) {
      console.log(`    id=${obj.id}  name=${obj.name}`)
    }
  } catch (err) {
    logErr('listObjects() failed', err)
    process.exit(1)
  }

  if (objects.length === 0) {
    console.warn('[VaultSmoke] ⚠ No vault objects found — create them in the WorkOS dashboard first.')
    process.exit(1)
  }

  // ── 2. Read each object value ───────────────────────────────────────────
  logStep('Reading values for each object')
  const valueMap: Record<string, string | null> = {}
  for (const obj of objects) {
    try {
      const full = await (workos.vault.readObject as (args: { id: string }) => Promise<{ value?: unknown }>)({ id: obj.id })
      const val = typeof full.value === 'string' ? full.value.trim() : ''
      valueMap[obj.name] = val.length > 0 ? val : null
      const preview = val.length > 0 ? `${val.slice(0, 10)}... (${val.length} chars)` : '(empty)'
      logOk(`${obj.name}: ${preview}`)
    } catch (err) {
      logErr(`readObject failed for "${obj.name}" (${obj.id})`, err)
      valueMap[obj.name] = null
    }
  }

  // ── 3. Check expected vault objects are present ─────────────────────────
  logStep('Checking expected vault objects are present')
  const names = new Set(objects.map(o => o.name))
  let allFound = true
  for (const vaultName of EXPECTED_VAULT_NAMES) {
    if (names.has(vaultName)) {
      logOk(`${vaultName}: present`)
    } else {
      logErr(`${vaultName}: NOT found — add it in the WorkOS Vault dashboard`)
      allFound = false
    }
  }

  console.log('\n[VaultSmoke] ── Object name → value summary ──────────────────────────────')
  for (const [name, val] of Object.entries(valueMap)) {
    const status = val ? '✓' : '✗ (empty)'
    console.log(`  ${status}  ${name}`)
  }

  if (allFound) {
    console.log('\n[VaultSmoke] ✅ All checks passed — WorkOS Vault is accessible and all expected keys are present.\n')
  } else {
    console.warn('\n[VaultSmoke] ⚠ Some expected provider keys are missing from the vault (see above).\n')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[VaultSmoke] Fatal error:', err)
  process.exit(1)
})

/**
 * One-time: deletes the vault secrets of Claude Code / Codex agent accounts and imported agent config values left by
 * the removed third-party agent feature, then their rows. Run with the target deployment's server environment; see
 * convex/migrations/purgeConnectedAgents.ts for the full purge order. Pass --dry-run to only count.
 */
import { lazyConvex as convex } from '../../src/server/database/lazy-convex'
import { getInternalApiSecret } from '../../src/server/shared/internal-api-secret'
import { createByokCredentialStore } from '../../src/server/ai/gateway/byok-credential-store'
import { getOverlayRuntimeConfig } from '../../src/server/config'

type Row = { table: string; id: string; credentialRef: string }

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const store = createByokCredentialStore(await getOverlayRuntimeConfig())
  let total = 0
  for (;;) {
    const rows = await convex.query<Row[]>('migrations/purgeConnectedAgents:listRetiredCredentialsByServer',
      { serverSecret: getInternalApiSecret() }, { throwOnError: true }) ?? []
    if (rows.length === 0) break
    total += rows.length
    if (dryRun) break
    // A failed vault delete stops the run before its row is removed, so a rerun retries it.
    for (const row of rows) await store.delete(row.credentialRef)
    await convex.mutation('migrations/purgeConnectedAgents:deleteRetiredCredentialRowsByServer',
      { serverSecret: getInternalApiSecret(), ids: rows.map((row) => row.id) }, { throwOnError: true })
  }
  console.log(JSON.stringify({ dryRun, credentials: total }))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

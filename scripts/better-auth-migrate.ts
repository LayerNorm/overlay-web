import { getMigrations } from 'better-auth/db/migration'
import { Pool } from 'pg'
import {
  createBetterAuthOptions,
  resolveBetterAuthRuntimeConfig,
} from '../src/server/auth/better-auth'
import { getOverlayRuntimeConfigSync } from '../src/server/config'

async function main() {
  const runtimeConfig = getOverlayRuntimeConfigSync()
  const betterAuthConfig = resolveBetterAuthRuntimeConfig(runtimeConfig)
  const pool = new Pool({
    connectionString: betterAuthConfig.databaseUrl,
  })

  try {
    const migrations = await getMigrations(createBetterAuthOptions(betterAuthConfig, pool))
    const pendingTables = migrations.toBeCreated.map((table) => table.table)
    const pendingFieldTables = migrations.toBeAdded.map((table) => table.table)

    if (pendingTables.length === 0 && pendingFieldTables.length === 0) {
      console.log(JSON.stringify({
        ok: true,
        migrated: false,
        message: 'Better Auth schema is already up to date.',
      }, null, 2))
      return
    }

    await migrations.runMigrations()

    console.log(JSON.stringify({
      ok: true,
      migrated: true,
      createdTables: pendingTables,
      alteredTables: pendingFieldTables,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

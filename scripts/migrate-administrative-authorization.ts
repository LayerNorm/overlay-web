import { ConvexAdministrativeRepository } from '../src/server/admin/ConvexAdministrativeRepository'
import { PostgresAdministrativeRepository } from '../src/server/admin/PostgresAdministrativeRepository'
import {
  createConvexAuthorizationRepositories,
} from '../src/server/authorization/ConvexAuthorizationRepositories'
import { FixedRoleAuthorizationBridge } from '../src/server/authorization/FixedRoleAuthorizationBridge'
import {
  createPostgresAuthorizationRepositories,
} from '../src/server/authorization/PostgresAuthorizationRepositories'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (connectionString) {
    const pool = createOverlayPostgresPool({
      connectionString,
      sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
    })
    try {
      const db = createOverlayPostgresDb(pool)
      const principals = await new PostgresAdministrativeRepository(db).list()
      const result = await new FixedRoleAuthorizationBridge(
        createPostgresAuthorizationRepositories(db),
      ).migrate(principals)
      console.log(JSON.stringify({ ok: true, provider: 'postgres', ...result }, null, 2))
    } finally {
      await pool.end()
    }
    return
  }

  const principals = await new ConvexAdministrativeRepository().list()
  const result = await new FixedRoleAuthorizationBridge(
    createConvexAuthorizationRepositories(),
  ).migrate(principals)
  console.log(JSON.stringify({ ok: true, provider: 'convex', ...result }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

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
import { sql } from 'drizzle-orm'
import { getInternalApiSecret } from '../src/server/shared/internal-api-secret'

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
      const bridge = new FixedRoleAuthorizationBridge(
        createPostgresAuthorizationRepositories(db),
      )
      const userRows = await db.execute<{ id: string }>(sql`SELECT id FROM users ORDER BY id`)
      const assignedUsers = await bridge.migrateUsers(userRows.rows.map(({ id }) => id))
      const result = await bridge.migrate(principals)
      console.log(JSON.stringify({ ok: true, provider: 'postgres', assignedUsers, ...result }, null, 2))
    } finally {
      await pool.end()
    }
    return
  }

  const principals = await new ConvexAdministrativeRepository().list()
  const { convex } = await import('../src/server/database/convex')
  const userIds = await convex.query<string[]>('auth/users:listUserIdsByServer', {
    serverSecret: getInternalApiSecret(),
  }, { throwOnError: true }) ?? []
  const bridge = new FixedRoleAuthorizationBridge(
    createConvexAuthorizationRepositories(),
  )
  const assignedUsers = await bridge.migrateUsers(userIds)
  const result = await bridge.migrate(principals)
  console.log(JSON.stringify({ ok: true, provider: 'convex', assignedUsers, ...result }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

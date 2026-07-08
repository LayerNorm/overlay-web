import { migrate } from 'drizzle-orm/node-postgres/migrator'

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL
  if (!connectionString) {
    throw new Error('OVERLAY_DATABASE_URL is required to migrate the Overlay app-data database')
  }

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)

  try {
    await migrate(db, {
      migrationsFolder: 'migrations/app-data',
    })
    console.log(JSON.stringify({
      ok: true,
      message: 'Overlay app-data Postgres migrations are up to date.',
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import { PostgresBackgroundMaintenanceService } from '../src/server/app-data/PostgresBackgroundMaintenanceService'

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL
  if (!connectionString) {
    throw new Error('OVERLAY_DATABASE_URL is required to run Overlay app-data maintenance')
  }

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const service = new PostgresBackgroundMaintenanceService(db)

  try {
    const summary = await service.runAll({
      emptyConversationCutoffMinutes: numberArg('empty-conversation-cutoff-minutes'),
      limit: numberArg('limit'),
    })
    console.log(JSON.stringify({
      ok: true,
      provider: 'postgres',
      summary,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

function numberArg(name: string): number | undefined {
  const prefix = `--${name}=`
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

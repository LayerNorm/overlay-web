import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '../src/server/database/postgres/client'
import { assertAppDataSchemaCompatible } from '../src/server/database/postgres/schema-compatibility'
import { PostgresKnowledgeMaintenanceService } from '../src/server/knowledge/PostgresKnowledgeMaintenanceService'

void main()

async function main() {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OVERLAY_DATABASE_URL is required')
  const modelVersion = process.env.OVERLAY_EMBEDDING_MODEL_VERSION?.trim() || 'text-embedding-3-small-v1'
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  try {
    await assertAppDataSchemaCompatible(pool)
    const service = new PostgresKnowledgeMaintenanceService(createOverlayPostgresDb(pool))
    const queued = await service.enqueueModelBackfill({
      limit: numberArg('limit', 2_000),
      modelVersion,
    })
    console.log(JSON.stringify({ modelVersion, ok: true, queued }, null, 2))
  } finally {
    await pool.end()
  }
}

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const raw = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length)
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback
}

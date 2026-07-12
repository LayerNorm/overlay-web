import { createOverlayPostgresDb, createOverlayPostgresPool } from '../src/server/database/postgres/client'
import { sql } from 'drizzle-orm'

async function main(): Promise<void> {
  const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()
  if (!connectionString) throw new Error('OVERLAY_DATABASE_URL is required')
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 2,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)

  try {
    const result = await db.execute<Record<string, number>>(sql`
    SELECT
      (SELECT count(*)::int FROM auth_identities child LEFT JOIN users owner ON owner.id = child.user_id WHERE owner.id IS NULL) AS orphan_auth_identities,
      (SELECT count(*)::int FROM user_settings child LEFT JOIN users owner ON owner.id = child.user_id WHERE owner.id IS NULL) AS orphan_user_settings,
      (SELECT count(*)::int FROM conversations child LEFT JOIN users owner ON owner.id = child.user_id WHERE owner.id IS NULL) AS orphan_conversations,
      (SELECT count(*)::int FROM conversation_messages child LEFT JOIN users owner ON owner.id = child.user_id WHERE owner.id IS NULL) AS orphan_messages,
      (SELECT count(*)::int FROM projects child LEFT JOIN users owner ON owner.id = child.user_id WHERE owner.id IS NULL) AS orphan_projects,
      (SELECT count(*)::int FROM files child LEFT JOIN users owner ON owner.id = child.user_id WHERE owner.id IS NULL) AS orphan_files,
      (SELECT count(*)::int FROM notes child LEFT JOIN users owner ON owner.id = child.user_id WHERE owner.id IS NULL) AS orphan_notes,
      (SELECT count(*)::int FROM memories child LEFT JOIN users owner ON owner.id = child.user_id WHERE owner.id IS NULL) AS orphan_memories,
      (SELECT count(*)::int FROM knowledge_chunks child LEFT JOIN users owner ON owner.id = child.user_id WHERE owner.id IS NULL) AS orphan_chunks,
      (SELECT count(*)::int FROM knowledge_chunk_embeddings child LEFT JOIN knowledge_chunks chunk ON chunk.id = child.chunk_id WHERE chunk.id IS NULL) AS orphan_embeddings,
      (SELECT count(*)::int FROM knowledge_chunks chunk LEFT JOIN files source ON source.id = chunk.source_id AND source.deleted_at IS NULL WHERE chunk.source_kind = 'file' AND source.id IS NULL) AS stale_file_chunks,
      (SELECT count(*)::int FROM knowledge_chunks chunk LEFT JOIN memories source ON source.id = chunk.source_id AND source.deleted_at IS NULL WHERE chunk.source_kind = 'memory' AND source.id IS NULL) AS stale_memory_chunks,
      (SELECT count(*)::int FROM files child JOIN projects project ON project.id = child.project_id WHERE child.deleted_at IS NULL AND project.deleted_at IS NOT NULL) AS active_files_in_deleted_projects,
      (SELECT count(*)::int FROM notes child JOIN projects project ON project.id = child.project_id WHERE child.deleted_at IS NULL AND project.deleted_at IS NOT NULL) AS active_notes_in_deleted_projects,
      (SELECT count(*)::int FROM memories child JOIN projects project ON project.id = child.project_id WHERE child.deleted_at IS NULL AND project.deleted_at IS NOT NULL) AS active_memories_in_deleted_projects
    `)
    const counts = Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]))
    const failures = Object.entries(counts).filter(([, count]) => count !== 0)
    console.log(JSON.stringify({ ok: failures.length === 0, counts }, null, 2))
    if (failures.length > 0) {
      throw new Error(
        `Deletion audit found residual rows: ${failures.map(([key, count]) => `${key}=${count}`).join(', ')}`,
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

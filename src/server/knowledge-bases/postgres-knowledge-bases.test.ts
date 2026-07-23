import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { conversations, users } from '@/server/database/postgres/schema'
import { createPostgresKnowledgeBaseRepositories } from './PostgresKnowledgeBaseRepositories'
import { runKnowledgeBaseRepositoryContract } from './knowledge-base-repository-contract'
import { PostgresUserRepository } from '@/server/users'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('real Postgres knowledge-base repository contract', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres knowledge-base contracts',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const scope = `kb_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_user`
  const conversationId = `${scope}_conversation`

  try {
    await db.insert(users).values({
      id: ownerUserId,
      email: `${ownerUserId}@example.com`,
      emailVerified: true,
    })
    await db.insert(conversations).values({
      id: conversationId,
      userId: ownerUserId,
      title: 'Knowledge-base contract chat',
      lastMode: 'ask',
      askModelIds: [],
      actModelId: 'openrouter/free',
    })
    await runKnowledgeBaseRepositoryContract(t, {
      repositories: createPostgresKnowledgeBaseRepositories(db),
      scope,
      ownerUserId,
      conversationId,
    })
    const directory = await new PostgresUserRepository(db).listDirectory()
    assert.ok(directory.some(({ id, email }) => id === ownerUserId && email === `${ownerUserId}@example.com`))

    const residue = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM knowledge_base_sources
      WHERE knowledge_base_id LIKE ${`${scope}%`}
    `)
    assert.equal(residue.rows[0]?.count, '0')
  } finally {
    await db.execute(sql`DELETE FROM users WHERE id = ${ownerUserId}`)
    await pool.end()
  }
})

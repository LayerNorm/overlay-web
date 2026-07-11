import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { PostgresConversationEventNotifier } from '@/server/conversations/PostgresConversationEventNotifier'
import { UnlimitedUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import { PostgresFileRepository } from '@/server/files/PostgresFileRepository'
import { PostgresNoteRepository } from '@/server/notes'
import { PostgresProjectRepository } from '@/server/projects/PostgresProjectRepository'
import { PostgresUserRepository } from '@/server/users/PostgresUserRepository'
import { runAppDataRepositoryContractSuite } from './app-data-repository-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres app-data repository contracts', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres app-data contracts',
}, async (t) => {
  if (!connectionString) return

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const notifier = new PostgresConversationEventNotifier(pool)

  try {
    await t.test('Postgres project hierarchy constraints are installed', async () => {
      const result = await db.execute(sql`
        SELECT conname
        FROM pg_constraint
        WHERE conname IN (
          'projects_parent_id_projects_id_fk',
          'projects_parent_not_self_check'
        )
      `)
      assert.deepEqual(
        result.rows.map((row) => String(row.conname)).sort(),
        ['projects_parent_id_projects_id_fk', 'projects_parent_not_self_check'],
      )
    })
    await runAppDataRepositoryContractSuite(t, {
      name: 'postgres',
      provider: 'postgres',
      authProvider: 'better-auth',
      accountDeletionRepository: new PostgresAccountDataDeletionRepository(db),
      conversations: new PostgresActConversationRepository(
        db,
        notifier,
      ),
      files: new PostgresFileRepository(db),
      notes: new PostgresNoteRepository(db),
      projects: new PostgresProjectRepository(db),
      usagePolicy: new UnlimitedUsagePolicy(),
      users: new PostgresUserRepository(db),
    })
  } finally {
    await notifier.close()
    await pool.end()
  }
})

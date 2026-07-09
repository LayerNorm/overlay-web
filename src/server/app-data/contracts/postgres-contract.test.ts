import 'server-only'

import test from 'node:test'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { PostgresActConversationRepository } from '@/server/conversations/PostgresActConversationRepository'
import { UnlimitedUsagePolicy } from '@/server/conversations/ActUsagePolicy'
import { PostgresFileRepository } from '@/server/files/PostgresFileRepository'
import { PostgresNoteRepository } from '@/server/notes'
import { PostgresUserRepository } from '@/server/users/PostgresUserRepository'
import { runAppDataRepositoryContractSuite } from './app-data-repository-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Docker Postgres app-data repository contracts', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres app-data contracts',
}, async (t) => {
  if (!connectionString) return

  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)

  try {
    await runAppDataRepositoryContractSuite(t, {
      name: 'postgres',
      provider: 'postgres',
      authProvider: 'better-auth',
      accountDeletionRepository: new PostgresAccountDataDeletionRepository(db),
      conversations: new PostgresActConversationRepository(db),
      files: new PostgresFileRepository(db),
      notes: new PostgresNoteRepository(db),
      usagePolicy: new UnlimitedUsagePolicy(),
      users: new PostgresUserRepository(db),
    })
  } finally {
    await pool.end()
  }
})

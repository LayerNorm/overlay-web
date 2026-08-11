import 'server-only'

import test from 'node:test'
import { eq } from 'drizzle-orm'
import { PostgresBillingRepository } from '@/server/billing/PostgresBillingRepository'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users, workspaces } from '@/server/database/postgres/schema'
import { PostgresUsageRepository } from '@/server/usage/PostgresUsageRepository'
import { PostgresWorkspaceRepository } from '@/server/workspaces/PostgresWorkspaceRepository'
import { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import { runWorkspaceBillingProviderContract } from './workspace-billing-provider-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('real Postgres workspace billing provider contract', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({ connectionString, sslMode: process.env.OVERLAY_DATABASE_SSL_MODE })
  const db = createOverlayPostgresDb(pool)
  try {
    await runWorkspaceBillingProviderContract(t, {
      billing: new PostgresBillingRepository(db),
      cleanupWorkspace: async (workspaceId) => {
        await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
      },
      cleanupUser: async (userId) => {
        await new PostgresAccountDataDeletionRepository(db).deleteUserAccount({ userId })
      },
      prepareUser: async (userId, email) => { await db.insert(users).values({ id: userId, email }).onConflictDoNothing() },
      provider: 'postgres',
      usage: new PostgresUsageRepository(db),
      workspaces: new WorkspaceService(new PostgresWorkspaceRepository(db)),
    })
  } finally {
    await pool.end()
  }
})

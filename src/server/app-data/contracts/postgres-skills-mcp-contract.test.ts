import 'server-only'

import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import test from 'node:test'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import { McpCredentialCipher, PostgresMcpServerRepository, PostgresSkillRepository } from '@/server/extensions'
import { PostgresProjectRepository } from '@/server/projects/PostgresProjectRepository'
import { runSkillsMcpContract } from './skills-mcp-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('real Postgres skills and MCP provider contract', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    max: 4,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  try {
    await runSkillsMcpContract(t, {
      cleanupUser: async (userId) => { await db.delete(users).where(eq(users.id, userId)) },
      mcpServers: new PostgresMcpServerRepository(
        db,
        new McpCredentialCipher(['p7i-contract-encryption-key-that-is-long-enough']),
      ),
      prepareUser: async (userId) => {
        await db.insert(users).values({ email: `${userId}@example.test`, id: userId })
      },
      projects: new PostgresProjectRepository(db),
      provider: 'postgres',
      skills: new PostgresSkillRepository(db),
    })

    await t.test('Postgres account deletion proves skill, MCP, and execution cleanup', async () => {
      const userId = `p7i_delete_${Date.now()}`
      await db.insert(users).values({ email: `${userId}@example.test`, id: userId })
      const skills = new PostgresSkillRepository(db)
      const mcps = new PostgresMcpServerRepository(
        db,
        new McpCredentialCipher(['p7i-contract-encryption-key-that-is-long-enough']),
      )
      await skills.create({
        description: 'Deletion proof',
        instructions: 'Deletion proof',
        name: 'Deletion proof',
        userId,
      })
      const mcpServerId = await mcps.create({
        name: 'Deletion proof',
        transport: 'streamable-http',
        url: 'https://mcp.example.test/deletion-proof',
        userId,
      })
      await mcps.recordExecution({
        argumentsHash: 'deletion-proof',
        mcpServerId,
        policyDecision: 'allow',
        status: 'succeeded',
        toolName: 'read',
        userId,
      })
      const result = await new PostgresAccountDataDeletionRepository(db).deleteUserAccount({ userId })
      assert.equal(result.verification.orphanedRowCount, 0)
      assert.equal(result.verification.remainingRowsByTable.skills, 0)
      assert.equal(result.verification.remainingRowsByTable.mcpServers, 0)
      assert.equal(result.verification.remainingRowsByTable.mcpToolExecutions, 0)
    })
  } finally {
    await pool.end()
  }
})

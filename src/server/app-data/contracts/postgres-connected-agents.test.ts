import 'server-only'

import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { eq } from 'drizzle-orm'
import { PostgresConnectedAgentRepository } from '@/server/agents/PostgresConnectedAgentRepository'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { agentRuns, conversationMessages, conversations, users, workspaces } from '@/server/database/postgres/schema'
import { verifyConnectedAgentRepositoryContract } from '@/shared/agents/connected-agent-repository-contract'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres connected-agent provider contract', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres connected-agent contracts',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({ connectionString, sslMode: process.env.OVERLAY_DATABASE_SSL_MODE })
  const db = createOverlayPostgresDb(pool)
  const suffix = randomUUID()
  const userId = `connected_user_${suffix}`
  const workspaceId = `connected_workspace_${suffix}`
  const otherWorkspaceId = `connected_other_workspace_${suffix}`
  const conversationId = `connected_conversation_${suffix}`
  const userMessageId = `connected_user_message_${suffix}`
  const assistantMessageId = `connected_assistant_message_${suffix}`
  const runId = `connected_run_${suffix}`
  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.com` })
    await db.insert(workspaces).values([
      { id: workspaceId, kind: 'team', name: 'Connected contract', slug: `connected-${suffix}` },
      { id: otherWorkspaceId, kind: 'team', name: 'Foreign contract', slug: `connected-other-${suffix}` },
    ])
    await db.insert(conversations).values({
      id: conversationId, userId, title: 'Connected agent contract', lastMode: 'act',
      askModelIds: [], actModelId: 'openrouter/free', workspaceId,
    })
    await db.insert(conversationMessages).values([
      { id: userMessageId, conversationId, userId, turnId: `turn_${suffix}`, role: 'user', mode: 'act', content: 'Run', contentType: 'text', authorKind: 'human' },
      { id: assistantMessageId, conversationId, userId, turnId: `turn_${suffix}`, role: 'assistant', mode: 'act', content: '', contentType: 'text', authorKind: 'agent' },
    ])
    await db.insert(agentRuns).values({
      id: runId, conversationId, turnId: `turn_${suffix}`, userId, userMessageId, assistantMessageId,
      mode: 'room', runner: 'remote', status: 'queued',
    })
    await verifyConnectedAgentRepositoryContract({
      repository: new PostgresConnectedAgentRepository(db), prefix: `postgres_${suffix}`,
      workspaceId, otherWorkspaceId, runId,
    })
  } finally {
    await db.delete(agentRuns).where(eq(agentRuns.id, runId))
    await db.delete(conversations).where(eq(conversations.id, conversationId))
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
    await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId))
    await db.delete(users).where(eq(users.id, userId))
    await pool.end()
  }
})

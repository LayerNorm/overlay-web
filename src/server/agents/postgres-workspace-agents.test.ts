import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import { createOverlayPostgresDb, createOverlayPostgresPool } from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import { PostgresWorkspaceRepository } from '@/server/workspaces/PostgresWorkspaceRepository'
import { PostgresWorkspaceAgentRepository } from './PostgresWorkspaceAgentRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres named agents preserve workspace identity, team, room, and archive invariants', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres workspace agent contracts',
}, async () => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const workspaces = new PostgresWorkspaceRepository(db)
  const agents = new PostgresWorkspaceAgentRepository(db)
  const scope = `agent_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const workspaceId = `${scope}_workspace`
  const ownerPrincipalId = `${scope}_owner`
  const agentId = `${scope}_definition`
  const agentPrincipalId = `${scope}_principal`

  try {
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, emailVerified: true })
    await workspaces.createOrganization({
      workspaceId, ownerPrincipalId, actorUserId: userId, ownerDisplayName: 'Owner',
      name: 'Agent contracts', slug: workspaceId, now: 100,
    })
    const team = await workspaces.createTeam({
      id: `${scope}_team`, workspaceId, name: 'Research', createdByPrincipalId: ownerPrincipalId, now: 110,
    })
    const created = await agents.create({
      agentId, principalId: agentPrincipalId, workspaceId, name: 'Scout',
      description: 'Finds evidence', instructions: 'Find primary evidence and cite it.',
      harness: 'overlay', modelId: 'openrouter/free', avatarColor: '#2563eb',
      allowedToolIds: ['web.search'], teamIds: [team.id], visibility: 'creator',
      createdByPrincipalId: ownerPrincipalId, now: 120,
    })
    assert.equal(created.principalId, agentPrincipalId)
    assert.equal(created.visibility, 'creator')
    assert.deepEqual(created.teamIds, [team.id])
    // Creator-only agents join no channels implicitly.
    assert.equal(created.roomCount, 0)
    assert.equal((await workspaces.getPrincipal(agentPrincipalId))?.agentId, agentId)
    assert.equal((await workspaces.getResourceWorkspace({ resourceType: 'agent', resourceId: agentId }))?.workspaceId, workspaceId)

    const updated = await agents.update({
      agentId, workspaceId, name: 'Scout Prime', instructions: 'Find and compare primary evidence.', now: 130,
    })
    assert.equal(updated?.name, 'Scout Prime')
    assert.equal((await agents.update({ agentId, workspaceId, visibility: 'workspace', now: 132 }))?.visibility, 'workspace')
    // Flipping to workspace-visible grants no retroactive channel joins.
    assert.equal((await agents.get({ agentId, workspaceId }))?.roomCount, 0)
    // A workspace-visible agent still auto-joins public channels on create.
    const sharedAgentId = `${scope}_shared`
    const shared = await agents.create({
      agentId: sharedAgentId, principalId: `${scope}_shared_principal`, workspaceId,
      name: 'Herald', description: 'Announces releases',
      instructions: 'Announce releases briefly.', harness: 'overlay', modelId: 'openrouter/free',
      allowedToolIds: [], teamIds: [], visibility: 'workspace',
      createdByPrincipalId: ownerPrincipalId, now: 134,
    })
    assert.equal(shared.roomCount, 1)

    assert.equal(await agents.archive({ agentId, workspaceId, now: 140 }), true)
    assert.equal(await agents.archive({ agentId: sharedAgentId, workspaceId, now: 142 }), true)
    assert.equal((await workspaces.getPrincipal(agentPrincipalId))?.displayName, 'Scout Prime')

    assert.equal(await agents.archive({ agentId, workspaceId, now: 140 }), true)
    assert.equal((await agents.list({ workspaceId })).length, 0)
    assert.ok((await agents.get({ workspaceId, agentId }))?.archivedAt)
    assert.equal((await workspaces.getMembership({ workspaceId, principalId: agentPrincipalId }))?.status, 'suspended')
  } finally {
    await db.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`).catch(() => undefined)
    await db.delete(users).where(sql`${users.id} = ${userId}`).catch(() => undefined)
    await pool.end()
  }
})

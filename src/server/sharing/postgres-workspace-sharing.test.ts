import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { inArray, sql } from 'drizzle-orm'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import { PostgresWorkspaceRepository } from '@/server/workspaces/PostgresWorkspaceRepository'
import { PostgresWorkspaceSharingRepository } from './PostgresWorkspaceSharingRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres sharing repository keeps grants inside one workspace', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres sharing contracts',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const workspaces = new PostgresWorkspaceRepository(db)
  const sharing = new PostgresWorkspaceSharingRepository(db)
  const scope = `sharing_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const memberUserId = `${scope}_member`
  const personalWorkspaceId = `${scope}_personal`
  const orgWorkspaceId = `${scope}_org`
  const otherWorkspaceId = `${scope}_other`
  const workspaceIds = [personalWorkspaceId, orgWorkspaceId, otherWorkspaceId]
  const resourceId = `${scope}_file`
  let ownerPrincipalId = ''
  let memberPrincipalId = ''
  let teamId = ''

  try {
    await db.insert(users).values([
      { id: ownerUserId, email: `${ownerUserId}@example.com`, emailVerified: true },
      { id: memberUserId, email: `${memberUserId}@example.com`, emailVerified: true },
    ])
    await workspaces.ensurePersonalWorkspace({
      workspaceId: personalWorkspaceId,
      slug: personalWorkspaceId,
      principalId: `${scope}_personal_principal`,
      userId: memberUserId,
      displayName: 'Member',
      now: Date.now(),
    })
    const org = await workspaces.createOrganization({
      workspaceId: orgWorkspaceId,
      ownerPrincipalId: `${scope}_owner_principal`,
      actorUserId: ownerUserId,
      ownerDisplayName: 'Owner',
      ownerEmail: `${ownerUserId}@example.com`,
      name: 'Sharing org',
      slug: orgWorkspaceId,
      now: Date.now(),
    })
    ownerPrincipalId = org.principal.id
    const other = await workspaces.createOrganization({
      workspaceId: otherWorkspaceId,
      ownerPrincipalId: `${scope}_other_principal`,
      actorUserId: ownerUserId,
      ownerDisplayName: 'Owner',
      ownerEmail: `${ownerUserId}@example.com`,
      name: 'Other org',
      slug: otherWorkspaceId,
      now: Date.now(),
    })
    const member = await workspaces.createPrincipal({
      id: `${scope}_member_principal`,
      workspaceId: orgWorkspaceId,
      type: 'human',
      userId: memberUserId,
      displayName: 'Member',
      now: Date.now(),
    })
    memberPrincipalId = member.id
    const team = await workspaces.createTeam({
      id: `${scope}_team`,
      workspaceId: orgWorkspaceId,
      name: 'Research team',
      createdByPrincipalId: ownerPrincipalId,
      now: Date.now(),
    })
    teamId = team.id
    await workspaces.bindResource({
      workspaceId: orgWorkspaceId,
      resourceType: 'file',
      resourceId,
      now: Date.now(),
    })

    await t.test('a grant is upserted per target rather than duplicated', async () => {
      const first = await sharing.upsert({
        id: `${scope}_grant_1`,
        workspaceId: orgWorkspaceId,
        resourceType: 'file',
        resourceId,
        targetType: 'principal',
        targetId: memberPrincipalId,
        accessRole: 'viewer',
        grantedByPrincipalId: ownerPrincipalId,
        now: 1_000,
      })
      const upgraded = await sharing.upsert({
        id: `${scope}_grant_1_duplicate`,
        workspaceId: orgWorkspaceId,
        resourceType: 'file',
        resourceId,
        targetType: 'principal',
        targetId: memberPrincipalId,
        accessRole: 'editor',
        grantedByPrincipalId: ownerPrincipalId,
        now: 2_000,
      })
      assert.equal(upgraded.id, first.id)
      assert.equal(upgraded.accessRole, 'editor')
      assert.equal(upgraded.createdAt, 1_000)
      assert.equal(upgraded.updatedAt, 2_000)
      const grants = await sharing.listForResource({
        workspaceId: orgWorkspaceId,
        resourceType: 'file',
        resourceId,
      })
      assert.equal(grants.length, 1)
    })

    await t.test('grants are found by principal, team, and room targets', async () => {
      await sharing.upsert({
        id: `${scope}_grant_team`,
        workspaceId: orgWorkspaceId,
        resourceType: 'file',
        resourceId,
        targetType: 'team',
        targetId: teamId,
        accessRole: 'viewer',
        grantedByPrincipalId: ownerPrincipalId,
        now: 3_000,
      })
      const byTeam = await sharing.listForTargets({
        workspaceId: orgWorkspaceId,
        resourceType: 'file',
        principalIds: [],
        teamIds: [teamId],
        roomIds: [],
      })
      assert.deepEqual(byTeam.map((grant) => grant.targetType), ['team'])
      const byPrincipal = await sharing.listForTargets({
        workspaceId: orgWorkspaceId,
        principalIds: [memberPrincipalId],
        teamIds: [],
        roomIds: [],
      })
      assert.deepEqual(byPrincipal.map((grant) => grant.accessRole), ['editor'])
      assert.deepEqual(await sharing.listForTargets({
        workspaceId: orgWorkspaceId,
        principalIds: [],
        teamIds: [],
        roomIds: [],
      }), [])
    })

    await t.test('another workspace never sees or removes these grants', async () => {
      assert.deepEqual(await sharing.listForResource({
        workspaceId: otherWorkspaceId,
        resourceType: 'file',
        resourceId,
      }), [])
      assert.deepEqual(await sharing.listForTargets({
        workspaceId: otherWorkspaceId,
        principalIds: [memberPrincipalId],
        teamIds: [teamId],
        roomIds: [],
      }), [])
      assert.equal(await sharing.remove({
        grantId: `${scope}_grant_team`,
        workspaceId: otherWorkspaceId,
      }), false)
    })

    await t.test('a resource bound to another workspace cannot be granted', async () => {
      await assert.rejects(() => sharing.upsert({
        id: `${scope}_grant_cross`,
        workspaceId: otherWorkspaceId,
        resourceType: 'file',
        resourceId,
        targetType: 'principal',
        targetId: other.principal.id,
        accessRole: 'viewer',
        grantedByPrincipalId: other.principal.id,
        now: 4_000,
      }))
    })

    await t.test('unbinding the resource cascades its grants away', async () => {
      await db.execute(sql`
        DELETE FROM workspace_resource_scopes
        WHERE resource_type = 'file' AND resource_id = ${resourceId}
      `)
      assert.deepEqual(await sharing.listForResource({
        workspaceId: orgWorkspaceId,
        resourceType: 'file',
        resourceId,
      }), [])
    })

    await t.test('sharing policy defaults to absent and records who changed it', async () => {
      assert.equal(await workspaces.getSharingPolicy(orgWorkspaceId), null)
      const disabled = await workspaces.setSharingPolicy({
        workspaceId: orgWorkspaceId,
        patch: { publicLinksEnabled: false },
        updatedByPrincipalId: ownerPrincipalId,
        now: 5_000,
      })
      assert.equal(disabled.publicLinksEnabled, false)
      assert.equal(disabled.updatedByPrincipalId, ownerPrincipalId)
      const reEnabled = await workspaces.setSharingPolicy({
        workspaceId: orgWorkspaceId,
        patch: { publicLinksEnabled: true },
        updatedByPrincipalId: ownerPrincipalId,
        now: 6_000,
      })
      assert.equal(reEnabled.publicLinksEnabled, true)
      assert.equal(reEnabled.updatedAt, 6_000)
      // Policy is per workspace: another workspace keeps its own default.
      assert.equal(await workspaces.getSharingPolicy(otherWorkspaceId), null)
    })
  } finally {
    await db.execute(sql`DELETE FROM workspaces WHERE id IN (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`)
      .catch(() => undefined)
    await db.delete(users).where(inArray(users.id, [ownerUserId, memberUserId])).catch(() => undefined)
    await pool.end()
  }
})

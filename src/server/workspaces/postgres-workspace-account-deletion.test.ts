import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { sql } from 'drizzle-orm'
import { PostgresAccountDataDeletionRepository } from '@/server/account/PostgresAccountDataDeletionRepository'
import {
  createOverlayPostgresDb,
  createOverlayPostgresPool,
} from '@/server/database/postgres/client'
import { users } from '@/server/database/postgres/schema'
import { PostgresWorkspaceRepository } from './PostgresWorkspaceRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres account deletion preserves organization history without orphaning ownership', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const workspaces = new PostgresWorkspaceRepository(db)
  const deletion = new PostgresAccountDataDeletionRepository(db)
  const scope = `workspace_delete_${randomUUID().replaceAll('-', '')}`
  const deletingUserId = `${scope}_deleting`
  const retainedOwnerId = `${scope}_retained`
  const finalOwnerId = `${scope}_final`
  const personalWorkspaceId = `${scope}_personal`
  const organizationId = `${scope}_organization`
  const finalOwnerWorkspaceId = `${scope}_final_org`
  const deletingPrincipalId = `${scope}_deleting_principal`
  const retainedPrincipalId = `${scope}_retained_principal`
  const finalOwnerPrincipalId = `${scope}_final_principal`

  try {
    await db.insert(users).values([
      { id: deletingUserId, email: `${deletingUserId}@example.com`, emailVerified: true },
      { id: retainedOwnerId, email: `${retainedOwnerId}@example.com`, emailVerified: true },
      { id: finalOwnerId, email: `${finalOwnerId}@example.com`, emailVerified: true },
    ])
    await workspaces.ensurePersonalWorkspace({
      workspaceId: personalWorkspaceId,
      slug: personalWorkspaceId,
      principalId: `${scope}_personal_principal`,
      userId: deletingUserId,
      displayName: 'Deleting user',
      now: 100,
    })
    await workspaces.createOrganization({
      workspaceId: organizationId,
      ownerPrincipalId: deletingPrincipalId,
      actorUserId: deletingUserId,
      ownerDisplayName: 'Deleting user',
      ownerEmail: `${deletingUserId}@example.com`,
      name: 'Retained organization',
      slug: organizationId,
      now: 200,
    })
    const invite = await workspaces.createInvitationReplacingPending({
      id: `${scope}_invite`,
      workspaceId: organizationId,
      email: `${retainedOwnerId}@example.com`,
      role: 'admin',
      invitedByPrincipalId: deletingPrincipalId,
      expiresAt: 1_000,
      now: 210,
    })
    const accepted = await workspaces.acceptInvitation({
      invitationId: invite.id,
      principalId: retainedPrincipalId,
      userId: retainedOwnerId,
      email: invite.email,
      displayName: 'Retained owner',
      now: 220,
    })
    assert.equal(accepted.status, 'accepted')
    await workspaces.setMembershipRole({
      workspaceId: organizationId,
      principalId: retainedPrincipalId,
      role: 'owner',
      now: 230,
    })
    await workspaces.createTeam({
      id: `${scope}_team`,
      workspaceId: organizationId,
      name: 'Created by departing owner',
      createdByPrincipalId: deletingPrincipalId,
      now: 240,
    })

    await t.test('Personal workspace is erased and organization principal is scrubbed', async () => {
      const result = await deletion.deleteUserAccount({ userId: deletingUserId })
      assert.equal(result.verification.orphanedRowCount, 0)
      assert.equal(await workspaces.getWorkspace(personalWorkspaceId), null)
      assert.ok(await workspaces.getWorkspace(organizationId))
      assert.equal(await workspaces.getMembership({
        workspaceId: organizationId,
        principalId: deletingPrincipalId,
      }), null)
      const scrubbed = await workspaces.getPrincipal(deletingPrincipalId)
      assert.equal(scrubbed?.userId, undefined)
      assert.equal(scrubbed?.email, undefined)
      assert.equal(scrubbed?.displayName, 'Deleted member')
      assert.ok(scrubbed?.archivedAt)
      assert.equal((await workspaces.getMembership({
        workspaceId: organizationId,
        principalId: retainedPrincipalId,
      }))?.role, 'owner')
    })

    await workspaces.createOrganization({
      workspaceId: finalOwnerWorkspaceId,
      ownerPrincipalId: finalOwnerPrincipalId,
      actorUserId: finalOwnerId,
      ownerDisplayName: 'Final owner',
      ownerEmail: `${finalOwnerId}@example.com`,
      name: 'Needs transfer',
      slug: finalOwnerWorkspaceId,
      now: 300,
    })

    await t.test('active final organization owner must transfer ownership first', async () => {
      await assert.rejects(
        () => deletion.deleteUserAccount({ userId: finalOwnerId }),
        /Transfer ownership of Needs transfer/,
      )
      assert.ok(await workspaces.getAccess({
        workspaceId: finalOwnerWorkspaceId,
        userId: finalOwnerId,
      }))
    })
  } finally {
    await db.execute(sql`
      DELETE FROM workspaces
      WHERE id IN (${organizationId}, ${finalOwnerWorkspaceId}, ${personalWorkspaceId})
    `).catch(() => undefined)
    await db.execute(sql`
      DELETE FROM users
      WHERE id IN (${deletingUserId}, ${retainedOwnerId}, ${finalOwnerId})
    `).catch(() => undefined)
    await pool.end()
  }
})

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
import { PostgresWorkspaceRepository } from './PostgresWorkspaceRepository'

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres workspace repository enforces isolation and lifecycle invariants', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for Postgres workspace contracts',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const repository = new PostgresWorkspaceRepository(db)
  const scope = `workspace_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const invitedUserId = `${scope}_invited`
  const personalWorkspaceId = `${scope}_personal`
  const orgWorkspaceId = `${scope}_org`
  const ownerPrincipalId = `${scope}_owner_principal`
  const invitedPrincipalId = `${scope}_invited_principal`
  const workspaceIds = [personalWorkspaceId, orgWorkspaceId]

  try {
    await db.insert(users).values([
      { id: ownerUserId, email: `${ownerUserId}@example.com`, emailVerified: true },
      { id: invitedUserId, email: `${invitedUserId}@example.com`, emailVerified: true },
    ])

    await t.test('creates one Personal workspace and rejects cross-workspace selection', async () => {
      const created = await repository.ensurePersonalWorkspace({
        workspaceId: personalWorkspaceId,
        slug: personalWorkspaceId,
        principalId: `${scope}_personal_principal`,
        userId: ownerUserId,
        displayName: 'Owner',
        email: `${ownerUserId}@example.com`,
        now: 100,
      })
      const repeated = await repository.ensurePersonalWorkspace({
        workspaceId: `${personalWorkspaceId}_duplicate`,
        slug: `${personalWorkspaceId}-duplicate`,
        principalId: `${scope}_duplicate_principal`,
        userId: ownerUserId,
        displayName: 'Owner',
        now: 101,
      })
      assert.equal(created.workspace.id, personalWorkspaceId)
      assert.equal(repeated.workspace.id, personalWorkspaceId)
      assert.equal(await repository.getAccess({
        workspaceId: personalWorkspaceId,
        userId: invitedUserId,
      }), null)
    })

    await t.test('creates an organization with one active human owner', async () => {
      const created = await repository.createOrganization({
        workspaceId: orgWorkspaceId,
        ownerPrincipalId,
        actorUserId: ownerUserId,
        ownerDisplayName: 'Owner',
        ownerEmail: `${ownerUserId}@example.com`,
        name: 'Acme',
        slug: orgWorkspaceId,
        now: 200,
      })
      assert.equal(created.membership.role, 'owner')
      assert.equal(created.membership.status, 'active')
      assert.equal(created.principal.type, 'human')
      assert.equal((await repository.listForUser(ownerUserId)).length, 2)
    })

    await t.test('invitation acceptance is email-bound, expiring, and single-use', async () => {
      const expired = await repository.createInvitationReplacingPending({
        id: `${scope}_expired_invite`,
        workspaceId: orgWorkspaceId,
        email: `expired-${scope}@example.com`,
        role: 'member',
        invitedByPrincipalId: ownerPrincipalId,
        expiresAt: 250,
        now: 210,
      })
      assert.equal((await repository.acceptInvitation({
        invitationId: expired.id,
        principalId: `${scope}_expired_principal`,
        userId: invitedUserId,
        email: expired.email,
        displayName: 'Expired',
        now: 251,
      })).status, 'expired')

      const invitation = await repository.createInvitationReplacingPending({
        id: `${scope}_invite`,
        workspaceId: orgWorkspaceId,
        email: `${invitedUserId}@example.com`,
        role: 'admin',
        invitedByPrincipalId: ownerPrincipalId,
        expiresAt: 1_000,
        now: 300,
      })
      assert.equal((await repository.acceptInvitation({
        invitationId: invitation.id,
        principalId: invitedPrincipalId,
        userId: invitedUserId,
        email: `wrong-${scope}@example.com`,
        displayName: 'Invited',
        now: 310,
      })).status, 'email_mismatch')
      const accepted = await repository.acceptInvitation({
        invitationId: invitation.id,
        principalId: invitedPrincipalId,
        userId: invitedUserId,
        email: invitation.email,
        displayName: 'Invited',
        now: 320,
      })
      assert.equal(accepted.status, 'accepted')
      if (accepted.status !== 'accepted') return
      assert.equal(accepted.access.membership.role, 'admin')
      assert.equal((await repository.acceptInvitation({
        invitationId: invitation.id,
        principalId: `${invitedPrincipalId}_again`,
        userId: invitedUserId,
        email: invitation.email,
        displayName: 'Invited',
        now: 330,
      })).status, 'not_pending')
    })

    await t.test('cannot remove the final owner and transfers ownership atomically', async () => {
      assert.equal((await repository.setMembershipRole({
        workspaceId: orgWorkspaceId,
        principalId: ownerPrincipalId,
        role: 'member',
        now: 400,
      })).status, 'last_owner')
      const transfer = await repository.transferOwnership({
        workspaceId: orgWorkspaceId,
        fromPrincipalId: ownerPrincipalId,
        toPrincipalId: invitedPrincipalId,
        now: 410,
      })
      assert.equal(transfer.status, 'transferred')
      if (transfer.status !== 'transferred') return
      assert.equal(transfer.newOwnerMembership.role, 'owner')
      assert.equal(transfer.previousOwnerMembership.role, 'admin')
    })

    await t.test('teams accept human and agent principals and resource guests revoke durably', async () => {
      const agent = await repository.createPrincipal({
        id: `${scope}_agent_principal`,
        workspaceId: orgWorkspaceId,
        type: 'agent',
        agentId: `${scope}_agent`,
        displayName: 'Research agent',
        createdByPrincipalId: invitedPrincipalId,
        now: 500,
      })
      const team = await repository.createTeam({
        id: `${scope}_team`,
        workspaceId: orgWorkspaceId,
        name: 'Research',
        createdByPrincipalId: invitedPrincipalId,
        now: 510,
      })
      await repository.addTeamMember({
        teamId: team.id,
        workspaceId: orgWorkspaceId,
        principalId: agent.id,
        principalType: 'agent',
        addedByPrincipalId: invitedPrincipalId,
        now: 520,
      })
      assert.deepEqual(
        (await repository.listTeamMembers(team.id)).map(({ principalType }) => principalType),
        ['agent'],
      )
      const guest = await repository.createResourceGuest({
        id: `${scope}_guest`,
        workspaceId: orgWorkspaceId,
        resourceType: 'project',
        resourceId: `${scope}_project`,
        principalId: ownerPrincipalId,
        accessRole: 'viewer',
        status: 'active',
        grantedByPrincipalId: invitedPrincipalId,
        now: 530,
      })
      assert.equal((await repository.revokeResourceGuest({
        id: guest.id,
        revokedByPrincipalId: invitedPrincipalId,
        now: 540,
      }))?.status, 'revoked')
    })

    await t.test('resource ownership is idempotent and rejects cross-workspace rebinding', async () => {
      const resourceId = `${scope}_project`
      const bound = await repository.bindResource({
        workspaceId: orgWorkspaceId,
        resourceType: 'project',
        resourceId,
        now: 550,
      })
      assert.equal(bound.workspaceId, orgWorkspaceId)
      assert.equal((await repository.bindResource({
        workspaceId: orgWorkspaceId,
        resourceType: 'project',
        resourceId,
        now: 551,
      })).createdAt, bound.createdAt)
      assert.equal((await repository.getResourceWorkspace({
        resourceType: 'project',
        resourceId,
      }))?.workspaceId, orgWorkspaceId)
      await assert.rejects(
        () => repository.bindResource({
          workspaceId: personalWorkspaceId,
          resourceType: 'project',
          resourceId,
          now: 552,
        }),
        /already bound to another workspace/,
      )
    })

    await t.test('database trigger rejects direct final-owner deletion under concurrency-safe lock', async () => {
      const result = await db.execute<{ role: string }>(sql`
        SELECT role
        FROM workspace_memberships
        WHERE workspace_id = ${orgWorkspaceId} AND principal_id = ${invitedPrincipalId}
      `)
      assert.equal(result.rows[0]?.role, 'owner')
      await assert.rejects(
        () => db.execute(sql`
          DELETE FROM workspace_memberships
          WHERE workspace_id = ${orgWorkspaceId} AND principal_id = ${invitedPrincipalId}
        `),
        (error) => {
          const cause = (error as { cause?: { message?: string } }).cause
          return /final workspace owner/i.test(cause?.message ?? '')
        },
      )
    })
  } finally {
    await db.execute(sql`DELETE FROM workspaces WHERE id IN (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`)
      .catch(() => undefined)
    await db.delete(users).where(inArray(users.id, [ownerUserId, invitedUserId])).catch(() => undefined)
    await pool.end()
  }
})

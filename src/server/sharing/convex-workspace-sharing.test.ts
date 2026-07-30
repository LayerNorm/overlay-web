import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexWorkspaceRepository } from '@/server/workspaces/ConvexWorkspaceRepository'
import { ConvexWorkspaceSharingRepository } from './ConvexWorkspaceSharingRepository'

const enabled = process.env.WORKSPACE_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(
  process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL,
)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('Convex sharing repository matches the Postgres sharing contract', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set WORKSPACE_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  const workspaces = new ConvexWorkspaceRepository()
  const sharing = new ConvexWorkspaceSharingRepository()
  const scope = `sharing_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const memberUserId = `${scope}_member`
  const orgWorkspaceId = `${scope}_org`
  const otherWorkspaceId = `${scope}_other`
  const resourceId = `${scope}_file`
  let ownerPrincipalId = ''
  let otherPrincipalId = ''
  let memberPrincipalId = ''
  let teamId = ''

  try {
    const org = await workspaces.createOrganization({
      workspaceId: orgWorkspaceId,
      ownerPrincipalId: `${scope}_owner_principal`,
      actorUserId: ownerUserId,
      ownerDisplayName: 'Owner',
      ownerEmail: `${ownerUserId}@example.com`,
      name: `Sharing org ${scope}`,
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
      name: `Other org ${scope}`,
      slug: otherWorkspaceId,
      now: Date.now(),
    })
    otherPrincipalId = other.principal.id
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
      name: `Research team ${scope}`,
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
      assert.equal((await sharing.listForResource({
        workspaceId: orgWorkspaceId,
        resourceType: 'file',
        resourceId,
      })).length, 1)
    })

    await t.test('grants are found by principal and team targets', async () => {
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
        targetId: otherPrincipalId,
        accessRole: 'viewer',
        grantedByPrincipalId: otherPrincipalId,
        now: 4_000,
      }))
    })

    await t.test('grants to unknown targets are rejected', async () => {
      for (const target of [
        { targetType: 'principal' as const, targetId: `${scope}_ghost_principal` },
        { targetType: 'team' as const, targetId: `${scope}_ghost_team` },
        { targetType: 'room' as const, targetId: `${scope}_ghost_room` },
      ]) {
        await assert.rejects(() => sharing.upsert({
          id: `${scope}_grant_${target.targetType}_ghost`,
          workspaceId: orgWorkspaceId,
          resourceType: 'file',
          resourceId,
          ...target,
          accessRole: 'viewer',
          grantedByPrincipalId: ownerPrincipalId,
          now: 5_000,
        }))
      }
    })

    await t.test('sharing policy defaults to absent and records who changed it', async () => {
      assert.equal(await workspaces.getSharingPolicy(orgWorkspaceId), null)
      const disabled = await workspaces.setSharingPolicy({
        workspaceId: orgWorkspaceId,
        patch: { publicLinksEnabled: false },
        updatedByPrincipalId: ownerPrincipalId,
        now: 6_000,
      })
      assert.equal(disabled.publicLinksEnabled, false)
      assert.equal(disabled.updatedByPrincipalId, ownerPrincipalId)
      const reEnabled = await workspaces.setSharingPolicy({
        workspaceId: orgWorkspaceId,
        patch: { publicLinksEnabled: true },
        updatedByPrincipalId: ownerPrincipalId,
        now: 7_000,
      })
      assert.equal(reEnabled.publicLinksEnabled, true)
      assert.equal(reEnabled.updatedAt, 7_000)
      assert.equal(await workspaces.getSharingPolicy(otherWorkspaceId), null)
      await assert.rejects(() => workspaces.setSharingPolicy({
        workspaceId: orgWorkspaceId,
        patch: { publicLinksEnabled: false },
        updatedByPrincipalId: otherPrincipalId,
        now: 8_000,
      }))
    })

    await t.test('removing a grant is idempotent', async () => {
      assert.equal(await sharing.remove({
        grantId: `${scope}_grant_team`,
        workspaceId: orgWorkspaceId,
      }), true)
      assert.equal(await sharing.remove({
        grantId: `${scope}_grant_team`,
        workspaceId: orgWorkspaceId,
      }), false)
    })
  } finally {
    for (const workspaceId of [orgWorkspaceId, otherWorkspaceId]) {
      await workspaces.archiveWorkspace({
        workspaceId,
        archivedByPrincipalId: workspaceId === orgWorkspaceId ? ownerPrincipalId : otherPrincipalId,
        now: Date.now(),
      }).catch(() => undefined)
      await convex.mutation(
        'collaboration/workspaces:purgeArchivedWorkspaceByServer',
        { serverSecret: getInternalApiSecret(), workspaceId },
        { throwOnError: true },
      ).catch(() => undefined)
    }
  }
})

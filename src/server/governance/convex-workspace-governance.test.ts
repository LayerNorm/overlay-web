import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexWorkspaceRepository } from '@/server/workspaces/ConvexWorkspaceRepository'

const enabled = process.env.WORKSPACE_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(
  process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL,
)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('Convex governance repository matches the Postgres governance contract', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set WORKSPACE_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  const repository = new ConvexWorkspaceRepository()
  const scope = `governance_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const orgWorkspaceId = `${scope}_org`
  const otherWorkspaceId = `${scope}_other`
  let ownerPrincipalId = ''
  let otherPrincipalId = ''

  try {
    const org = await repository.createOrganization({
      workspaceId: orgWorkspaceId,
      ownerPrincipalId: `${scope}_owner_principal`,
      actorUserId: ownerUserId,
      ownerDisplayName: 'Owner',
      ownerEmail: `${ownerUserId}@example.com`,
      name: `Governance org ${scope}`,
      slug: orgWorkspaceId,
      now: Date.now(),
    })
    ownerPrincipalId = org.principal.id
    const other = await repository.createOrganization({
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

    await t.test('a policy patch changes only the fields it names', async () => {
      const first = await repository.setSharingPolicy({
        workspaceId: orgWorkspaceId,
        patch: { memberCanCreateChannels: false, channelRetentionDays: 90 },
        updatedByPrincipalId: ownerPrincipalId,
        now: 1_000,
      })
      assert.equal(first.memberCanCreateChannels, false)
      assert.equal(first.channelRetentionDays, 90)
      assert.equal(first.publicLinksEnabled, true)
      assert.equal(first.rolloutStage, 'general')

      const second = await repository.setSharingPolicy({
        workspaceId: orgWorkspaceId,
        patch: { legalHold: true },
        updatedByPrincipalId: ownerPrincipalId,
        now: 2_000,
      })
      assert.equal(second.memberCanCreateChannels, false)
      assert.equal(second.channelRetentionDays, 90)
      assert.equal(second.legalHold, true)
      assert.equal(second.updatedAt, 2_000)

      const stored = await repository.getSharingPolicy(orgWorkspaceId)
      assert.equal(stored?.legalHold, true)
      assert.equal(stored?.memberCanCreateChannels, false)
    })

    await t.test('rollout stage is stored and defaults are applied on read', async () => {
      const staged = await repository.setSharingPolicy({
        workspaceId: orgWorkspaceId,
        patch: { rolloutStage: 'invited' },
        updatedByPrincipalId: ownerPrincipalId,
        now: 3_000,
      })
      assert.equal(staged.rolloutStage, 'invited')
      assert.equal((await repository.getSharingPolicy(otherWorkspaceId)), null)
    })

    await t.test('directory identity maps once per external id and can be re-linked', async () => {
      const mapping = await repository.upsertIdentityMapping({
        id: `${scope}_mapping`,
        workspaceId: orgWorkspaceId,
        principalId: ownerPrincipalId,
        directory: 'okta',
        externalId: 'ext_1',
        externalGroupIds: ['group_eng'],
        now: 4_000,
      })
      assert.equal(mapping.status, 'active')
      const relinked = await repository.upsertIdentityMapping({
        id: `${scope}_mapping_duplicate`,
        workspaceId: orgWorkspaceId,
        principalId: ownerPrincipalId,
        directory: 'okta',
        externalId: 'ext_1',
        externalGroupIds: ['group_eng', 'group_ops'],
        now: 5_000,
      })
      assert.equal(relinked.id, mapping.id)
      assert.deepEqual(relinked.externalGroupIds, ['group_eng', 'group_ops'])
      assert.equal((await repository.listIdentityMappings({ workspaceId: orgWorkspaceId })).length, 1)
    })

    await t.test('platform installs upsert per team and resolve team-first', async () => {
      const installation = await repository.upsertPlatformInstallation({
        installationId: `${scope}_team`,
        workspaceId: orgWorkspaceId,
        directory: 'slack',
        externalTeamId: `${scope}_team`,
        teamName: 'Acme',
        botUserId: 'Ubot',
        botTokenCipher: 'cipher-1',
        installedByPrincipalId: ownerPrincipalId,
        now: 8_000,
      })
      assert.equal(installation.botTokenCipher, 'cipher-1')
      const relinked = await repository.upsertPlatformInstallation({
        installationId: `${scope}_team`,
        workspaceId: orgWorkspaceId,
        directory: 'slack',
        externalTeamId: `${scope}_team`,
        botTokenCipher: 'cipher-2',
        installedByPrincipalId: ownerPrincipalId,
        now: 8_100,
      })
      assert.equal(relinked.id, installation.id)
      assert.equal(
        (await repository.getPlatformInstallationByTeam({ directory: 'slack', externalTeamId: `${scope}_team` }))?.botTokenCipher,
        'cipher-2',
      )
      assert.equal(
        (await repository.listPlatformInstallations({ workspaceId: orgWorkspaceId })).length,
        1,
      )
      assert.equal(await repository.claimPlatformEvent({
        workspaceId: orgWorkspaceId,
        directory: 'slack',
        externalTeamId: `${scope}_team`,
        eventId: `${scope}_event`,
        now: 8_200,
      }), true)
      assert.equal(await repository.claimPlatformEvent({
        workspaceId: orgWorkspaceId,
        directory: 'slack',
        externalTeamId: `${scope}_team`,
        eventId: `${scope}_event`,
        now: 8_201,
      }), false)
      assert.equal(
        await repository.deletePlatformInstallation({
          workspaceId: orgWorkspaceId,
          directory: 'slack',
          externalTeamId: `${scope}_team`,
        }),
        true,
      )
      assert.equal(
        await repository.getPlatformInstallationByTeam({ directory: 'slack', externalTeamId: `${scope}_team` }),
        null,
      )
    })

    await t.test('a principal from another workspace cannot be mapped', async () => {
      await assert.rejects(() => repository.upsertIdentityMapping({
        id: `${scope}_mapping_cross`,
        workspaceId: orgWorkspaceId,
        principalId: otherPrincipalId,
        directory: 'okta',
        externalId: 'ext_cross',
        now: 5_500,
      }))
    })

    await t.test('deprovisioning is idempotent and hidden from active listings', async () => {
      const deprovisioned = await repository.deprovisionIdentityMapping({
        workspaceId: orgWorkspaceId,
        directory: 'okta',
        externalId: 'ext_1',
        now: 6_000,
      })
      assert.equal(deprovisioned?.status, 'deprovisioned')
      assert.equal(await repository.deprovisionIdentityMapping({
        workspaceId: orgWorkspaceId,
        directory: 'okta',
        externalId: 'ext_1',
        now: 7_000,
      }), null)
      assert.deepEqual(await repository.listIdentityMappings({ workspaceId: orgWorkspaceId }), [])
      assert.equal((await repository.listIdentityMappings({
        workspaceId: orgWorkspaceId,
        includeDeprovisioned: true,
      })).length, 1)
    })

    await t.test('another workspace cannot see these identities', async () => {
      assert.deepEqual(await repository.listIdentityMappings({
        workspaceId: otherWorkspaceId,
        includeDeprovisioned: true,
      }), [])
      assert.equal(await repository.getIdentityMapping({
        workspaceId: otherWorkspaceId,
        directory: 'okta',
        externalId: 'ext_1',
      }), null)
    })

    await t.test('audit export history is append-only per workspace', async () => {
      await repository.recordAuditExport({
        id: `${scope}_export_1`,
        workspaceId: orgWorkspaceId,
        requestedByPrincipalId: ownerPrincipalId,
        toRecordedAt: 8_000,
        eventCount: 12,
        now: 8_000,
      })
      await repository.recordAuditExport({
        id: `${scope}_export_2`,
        workspaceId: orgWorkspaceId,
        requestedByPrincipalId: ownerPrincipalId,
        fromRecordedAt: 8_000,
        toRecordedAt: 9_000,
        eventCount: 3,
        now: 9_000,
      })
      const exports = await repository.listAuditExports({ workspaceId: orgWorkspaceId })
      assert.deepEqual(exports.map((row) => row.eventCount), [3, 12])
      assert.deepEqual(await repository.listAuditExports({ workspaceId: otherWorkspaceId }), [])
    })
  } finally {
    for (const workspaceId of [orgWorkspaceId, otherWorkspaceId]) {
      await repository.archiveWorkspace({
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

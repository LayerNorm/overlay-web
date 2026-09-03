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

const connectionString = process.env.OVERLAY_DATABASE_URL?.trim()

test('Postgres governance repository scopes policy, identity, and exports per workspace', {
  skip: connectionString ? false : 'OVERLAY_DATABASE_URL is required for governance contracts',
}, async (t) => {
  if (!connectionString) return
  const pool = createOverlayPostgresPool({
    connectionString,
    sslMode: process.env.OVERLAY_DATABASE_SSL_MODE,
  })
  const db = createOverlayPostgresDb(pool)
  const repository = new PostgresWorkspaceRepository(db)
  const scope = `governance_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const orgWorkspaceId = `${scope}_org`
  const otherWorkspaceId = `${scope}_other`
  const workspaceIds = [orgWorkspaceId, otherWorkspaceId]
  let ownerPrincipalId = ''
  let otherPrincipalId = ''

  try {
    await db.insert(users).values([
      { id: ownerUserId, email: `${ownerUserId}@example.com`, emailVerified: true },
    ])
    const org = await repository.createOrganization({
      workspaceId: orgWorkspaceId,
      ownerPrincipalId: `${scope}_owner_principal`,
      actorUserId: ownerUserId,
      ownerDisplayName: 'Owner',
      ownerEmail: `${ownerUserId}@example.com`,
      name: 'Governance org',
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
      name: 'Other org',
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
      // The earlier fields survive an unrelated patch.
      assert.equal(second.memberCanCreateChannels, false)
      assert.equal(second.channelRetentionDays, 90)
      assert.equal(second.legalHold, true)
      assert.equal(second.updatedAt, 2_000)
    })

    await t.test('rollout stage and ranges are enforced by the database', async () => {
      await assert.rejects(() => db.execute(sql`
        UPDATE workspace_sharing_policies SET rollout_stage = 'everyone'
        WHERE workspace_id = ${orgWorkspaceId}
      `))
      await assert.rejects(() => db.execute(sql`
        UPDATE workspace_sharing_policies SET guest_expiration_days = 0
        WHERE workspace_id = ${orgWorkspaceId}
      `))
      await assert.rejects(() => db.execute(sql`
        UPDATE workspace_sharing_policies SET agent_run_budget_cents = -1
        WHERE workspace_id = ${orgWorkspaceId}
      `))
    })

    await t.test('policy is per workspace', async () => {
      assert.equal(await repository.getSharingPolicy(otherWorkspaceId), null)
      const otherPolicy = await repository.setSharingPolicy({
        workspaceId: otherWorkspaceId,
        patch: { publicLinksEnabled: false },
        updatedByPrincipalId: otherPrincipalId,
        now: 3_000,
      })
      assert.equal(otherPolicy.publicLinksEnabled, false)
      assert.equal((await repository.getSharingPolicy(orgWorkspaceId))?.publicLinksEnabled, true)
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

    await t.test('deprovisioning is idempotent and hidden from active listings', async () => {
      const deprovisioned = await repository.deprovisionIdentityMapping({
        workspaceId: orgWorkspaceId,
        directory: 'okta',
        externalId: 'ext_1',
        now: 6_000,
      })
      assert.equal(deprovisioned?.status, 'deprovisioned')
      assert.equal(deprovisioned?.deprovisionedAt, 6_000)
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

    await t.test('another workspace cannot see or retire these identities', async () => {
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
      assert.equal(exports[0]?.fromRecordedAt, 8_000)
      assert.deepEqual(await repository.listAuditExports({ workspaceId: otherWorkspaceId }), [])
    })

    await t.test('archiving a workspace removes its governance rows', async () => {
      await db.execute(sql`DELETE FROM workspaces WHERE id = ${otherWorkspaceId}`)
      assert.deepEqual(await repository.listAuditExports({ workspaceId: otherWorkspaceId }), [])
      assert.equal(await repository.getSharingPolicy(otherWorkspaceId), null)
    })
  } finally {
    await db.execute(sql`DELETE FROM workspaces WHERE id IN (${sql.join(workspaceIds.map((id) => sql`${id}`), sql`, `)})`)
      .catch(() => undefined)
    await db.delete(users).where(inArray(users.id, [ownerUserId])).catch(() => undefined)
    await pool.end()
  }
})

import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceGovernanceService } from './WorkspaceGovernanceService'
import { WorkspaceServiceError } from '@/server/workspaces/WorkspaceService'

const WORKSPACE = 'workspace_acme'
const OWNER = 'user_owner'
const MEMBER = 'user_member'
const OWNER_PRINCIPAL = 'principal_owner'
const MEMBER_PRINCIPAL = 'principal_member'

type AuditRow = {
  id: string
  action: string
  actorUserId?: string
  outcome: string
  resourceType: string
  resourceId?: string
  createdAt: number
  metadata: Record<string, unknown>
}

function createService(options: {
  audit?: AuditRow[]
  allow?: boolean
  policy?: Record<string, unknown>
  suspendFails?: boolean
} = {}) {
  const audit = [...(options.audit ?? [])]
  const exports: unknown[] = []
  const mappings = new Map<string, Record<string, unknown>>()
  const installs = new Map<string, Record<string, unknown>>()
  const claims = new Set<string>()
  const suspended: string[] = []
  const limitChecks: string[] = []
  const service = new WorkspaceGovernanceService({
    audit: {
      async append(row: Omit<AuditRow, 'id' | 'createdAt'>) {
        const record = { ...row, id: `audit_${audit.length + 1}`, createdAt: 5_000 } as AuditRow
        audit.push(record)
        return record
      },
      async list() {
        return audit
      },
    } as never,
    rateLimiter: {
      async check(key: string) {
        limitChecks.push(key)
        return { allowed: options.allow ?? true, remaining: 1, resetAt: 0 }
      },
    } as never,
    repository: {
      async getPrincipal(principalId: string) {
        if (principalId === 'principal_ghost') return null
        if (principalId === 'principal_other_workspace') {
          return { id: principalId, workspaceId: 'workspace_rival', type: 'human' }
        }
        if (principalId === 'principal_archived') {
          return { id: principalId, workspaceId: WORKSPACE, type: 'human', userId: 'user_archived', archivedAt: 1_000 }
        }
        if (principalId === 'principal_service') {
          return { id: principalId, workspaceId: WORKSPACE, type: 'service' }
        }
        return { id: principalId, workspaceId: WORKSPACE, type: 'human', userId: `user_${principalId}` }
      },
      async upsertIdentityMapping(input: Record<string, unknown>) {
        const mapping = {
          ...input,
          status: 'active',
          externalGroupIds: input.externalGroupIds ?? [],
          createdAt: 1_000,
          updatedAt: 1_000,
        }
        mappings.set(`${input.directory}:${input.externalId}`, mapping)
        return mapping
      },
      async deprovisionIdentityMapping({ directory, externalId, now }: {
        directory: string
        externalId: string
        now: number
      }) {
        const key = `${directory}:${externalId}`
        const mapping = mappings.get(key)
        if (!mapping || mapping.status === 'deprovisioned') return null
        const updated = { ...mapping, status: 'deprovisioned', deprovisionedAt: now, updatedAt: now }
        mappings.set(key, updated)
        return updated
      },
      async listIdentityMappings({ includeDeprovisioned }: { includeDeprovisioned?: boolean }) {
        return [...mappings.values()].filter((mapping) => (
          includeDeprovisioned || mapping.status === 'active'
        ))
      },
      async getIdentityMapping({ workspaceId, directory, externalId }: {
        workspaceId: string
        directory: string
        externalId: string
      }) {
        const mapping = mappings.get(`${directory}:${externalId}`)
        return mapping && mapping.workspaceId === workspaceId ? mapping : null
      },
      async upsertPlatformInstallation(input: Record<string, unknown>) {
        const record = {
          ...input,
          id: input.installationId,
          createdAt: 1_000,
          updatedAt: 1_000,
        }
        installs.set(`${input.directory}:${input.externalTeamId}`, record)
        return record
      },
      async listPlatformInstallations() {
        return [...installs.values()]
      },
      async getPlatformInstallationByTeam({ directory, externalTeamId }: {
        directory: string
        externalTeamId: string
      }) {
        return installs.get(`${directory}:${externalTeamId}`) ?? null
      },
      async deletePlatformInstallation({ directory, externalTeamId }: {
        directory: string
        externalTeamId: string
      }) {
        return installs.delete(`${directory}:${externalTeamId}`)
      },
      async claimPlatformEvent({ directory, externalTeamId, eventId }: {
        directory: string
        externalTeamId: string
        eventId: string
      }) {
        const key = `${directory}:${externalTeamId}:${eventId}`
        if (claims.has(key)) return false
        claims.add(key)
        return true
      },
      async recordAuditExport(input: Record<string, unknown>) {
        const record = { ...input, createdAt: input.now }
        exports.push(record)
        return record
      },
      async listAuditExports() {
        return exports
      },
    } as never,
    workspaces: {
      async resolveActiveWorkspace(actorUserId: string) {
        if (actorUserId === OWNER) {
          return {
            workspace: { id: WORKSPACE },
            principal: { id: OWNER_PRINCIPAL },
            membership: { role: 'owner', status: 'active' },
          }
        }
        if (actorUserId === MEMBER) {
          return {
            workspace: { id: WORKSPACE },
            principal: { id: MEMBER_PRINCIPAL },
            membership: { role: 'member', status: 'active' },
          }
        }
        throw new WorkspaceServiceError('Workspace not found', 404, 'not_found')
      },
      async getSharingPolicy() {
        return {
          workspaceId: WORKSPACE,
          publicLinksEnabled: true,
          memberCanCreateChannels: true,
          memberCanCreateAgents: true,
          memberCanInvite: false,
          legalHold: false,
          rolloutStage: 'general',
          updatedAt: 0,
          ...options.policy,
        }
      },
      async setMembershipStatus({ principalId }: { principalId: string }) {
        if (options.suspendFails) {
          throw new WorkspaceServiceError('Last owner cannot be suspended', 409, 'last_owner')
        }
        suspended.push(principalId)
        return { principalId, status: 'suspended' }
      },
    } as never,
    appDataProvider: 'postgres',
    requiresConvexClient: false,
    id: () => 'export_1',
    now: () => 9_000,
  })
  return { service, audit, exports, mappings, installs, suspended, limitChecks }
}

function auditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'audit_seed',
    action: 'workspace.membership',
    actorUserId: OWNER,
    outcome: 'success',
    resourceType: 'workspace',
    createdAt: 1_000,
    metadata: { workspaceId: WORKSPACE },
    ...overrides,
  }
}

test('only owners and admins may use governance controls', async () => {
  const { service } = createService()
  for (const call of [
    () => service.exportAudit({ actorUserId: MEMBER, workspaceId: WORKSPACE }),
    () => service.collectMetrics({ actorUserId: MEMBER, workspaceId: WORKSPACE }),
    () => service.listDirectoryIdentities({ actorUserId: MEMBER, workspaceId: WORKSPACE }),
    () => service.linkDirectoryIdentity({
      actorUserId: MEMBER,
      workspaceId: WORKSPACE,
      principalId: MEMBER_PRINCIPAL,
      directory: 'okta',
      externalId: 'ext_1',
    }),
  ]) {
    await assert.rejects(call, (error: unknown) => (
      error instanceof WorkspaceServiceError && error.statusCode === 403
    ))
  }
})

test('audit export contains only this workspace and records its window', async () => {
  const { service, exports } = createService({
    audit: [
      auditRow({ id: 'a1', createdAt: 1_000 }),
      auditRow({ id: 'a2', createdAt: 2_000, action: 'workspace.grant' }),
      auditRow({ id: 'other', createdAt: 3_000, metadata: { workspaceId: 'workspace_rival' } }),
      auditRow({ id: 'no_workspace', createdAt: 4_000, metadata: {} }),
    ],
  })
  const { record, events } = await service.exportAudit({ actorUserId: OWNER, workspaceId: WORKSPACE })
  assert.deepEqual(events.map((event) => event.id), ['a1', 'a2'])
  assert.equal(record.eventCount, 2)
  assert.equal(record.toRecordedAt, 9_000)
  assert.equal(exports.length, 1)
})

test('audit export reconciles with membership and grant history', async () => {
  const { service } = createService({
    audit: [
      auditRow({ id: 'm1', action: 'workspace.membership', metadata: { workspaceId: WORKSPACE, event: 'invited' } }),
      auditRow({ id: 'g1', action: 'workspace.grant', metadata: { workspaceId: WORKSPACE, grantId: 'grant_1' } }),
      auditRow({ id: 'r1', action: 'workspace.agent_run', metadata: { workspaceId: WORKSPACE, agentId: 'agent_1' } }),
    ],
  })
  const { events } = await service.exportAudit({ actorUserId: OWNER, workspaceId: WORKSPACE })
  const actions = new Set(events.map((event) => event.action))
  for (const expected of ['workspace.membership', 'workspace.grant', 'workspace.agent_run']) {
    assert.equal(actions.has(expected), true, `${expected} must appear in the export`)
  }
  // Every exported event carries the workspace it belongs to, so an operator can
  // reconcile the export against workspace state without guessing.
  for (const event of events) assert.equal(event.metadata.workspaceId, WORKSPACE)
})

test('an export can resume from a watermark', async () => {
  const { service } = createService({
    audit: [auditRow({ id: 'a1', createdAt: 1_000 }), auditRow({ id: 'a2', createdAt: 8_000 })],
  })
  const { events } = await service.exportAudit({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    fromRecordedAt: 5_000,
  })
  assert.deepEqual(events.map((event) => event.id), ['a2'])
})

test('exports are rate limited per workspace and principal', async () => {
  const { service, limitChecks } = createService()
  await service.exportAudit({ actorUserId: OWNER, workspaceId: WORKSPACE })
  assert.equal(limitChecks.some((key) => key.includes(`workspace:${WORKSPACE}`)), true)
  assert.equal(limitChecks.some((key) => key.includes(OWNER_PRINCIPAL)), true)

  const blocked = createService({ allow: false })
  await assert.rejects(
    () => blocked.service.exportAudit({ actorUserId: OWNER, workspaceId: WORKSPACE }),
    (error: unknown) => error instanceof WorkspaceServiceError && error.statusCode === 429,
  )
})

test('directory identity maps to a principal without conferring any role', async () => {
  const { service, audit } = createService()
  const mapping = await service.linkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    principalId: MEMBER_PRINCIPAL,
    directory: 'okta',
    externalId: 'ext_1',
    externalGroupIds: ['group_admins', 'group_admins', 'group_eng'],
  })
  assert.equal(mapping.principalId, MEMBER_PRINCIPAL)
  // Group claims are recorded for reference only; no role is derived from them.
  assert.deepEqual(mapping.externalGroupIds, ['group_admins', 'group_eng'])
  assert.equal('role' in mapping, false)
  assert.equal(audit.some((row) => row.metadata.event === 'identity_linked'), true)
})

test('a principal from another workspace cannot be mapped', async () => {
  const { service } = createService()
  await assert.rejects(() => service.linkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    principalId: 'principal_other_workspace',
    directory: 'okta',
    externalId: 'ext_2',
  }), (error: unknown) => error instanceof WorkspaceServiceError && error.statusCode === 404)
})

test('SCIM deprovisioning retires the mapping and suspends the membership', async () => {
  const { service, suspended, mappings } = createService()
  await service.linkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    principalId: MEMBER_PRINCIPAL,
    directory: 'okta',
    externalId: 'ext_1',
  })
  const mapping = await service.deprovisionDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'okta',
    externalId: 'ext_1',
  })
  assert.equal(mapping.status, 'deprovisioned')
  assert.deepEqual(suspended, [MEMBER_PRINCIPAL])
  assert.equal(mappings.get('okta:ext_1')?.status, 'deprovisioned')
  await assert.rejects(() => service.deprovisionDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'okta',
    externalId: 'ext_1',
  }), (error: unknown) => error instanceof WorkspaceServiceError && error.statusCode === 404)
})

test('deprovisioning still retires the mapping when the member is the last owner', async () => {
  const { service, mappings } = createService({ suspendFails: true })
  await service.linkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    principalId: OWNER_PRINCIPAL,
    directory: 'okta',
    externalId: 'ext_owner',
  })
  const mapping = await service.deprovisionDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'okta',
    externalId: 'ext_owner',
  })
  assert.equal(mapping.status, 'deprovisioned')
  assert.equal(mappings.get('okta:ext_owner')?.status, 'deprovisioned')
})

test('legal hold suspends retention deletion entirely', async () => {
  const held = createService({ policy: { legalHold: true, channelRetentionDays: 30 } })
  const retention = await held.service.resolveRetention({ actorUserId: OWNER, workspaceId: WORKSPACE })
  assert.equal(retention.legalHold, true)
  assert.equal(retention.deleteBefore, undefined)

  const sweeping = createService({ policy: { channelRetentionDays: 30 } })
  const active = await sweeping.service.resolveRetention({ actorUserId: OWNER, workspaceId: WORKSPACE })
  assert.equal(active.deleteBefore, 9_000 - 30 * 24 * 60 * 60 * 1_000)

  const none = createService()
  assert.equal(
    (await none.service.resolveRetention({ actorUserId: OWNER, workspaceId: WORKSPACE })).deleteBefore,
    undefined,
  )
})

test('metrics report denials, invitation failures, and provider parity', async () => {
  const { service } = createService({
    audit: [
      auditRow({ id: 'd1', outcome: 'denied' }),
      auditRow({ id: 'i1', action: 'workspace.invitation.create', outcome: 'failure' }),
      auditRow({ id: 'ok', action: 'workspace.invitation.create', outcome: 'success' }),
      auditRow({ id: 'other_ws', outcome: 'denied', metadata: { workspaceId: 'workspace_rival' } }),
    ],
  })
  const metrics = await service.collectMetrics({ actorUserId: OWNER, workspaceId: WORKSPACE })
  assert.equal(metrics.authorizationDenials, 1)
  assert.equal(metrics.invitationFailures, 1)
  assert.deepEqual(metrics.providerParity, { provider: 'postgres', requiresConvexClient: false })
  assert.equal(metrics.workspaceId, WORKSPACE)
})

test('platform actor resolution maps a linked chat identity to its principal', async () => {
  const { service } = createService()
  await service.linkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    principalId: MEMBER_PRINCIPAL,
    directory: 'slack',
    externalId: 'U123',
  })
  const actor = await service.resolvePlatformActor({
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalId: 'U123',
  })
  assert.deepEqual(actor, { principalId: MEMBER_PRINCIPAL, userId: 'user_principal_member' })
})

test('platform actor resolution hides unknown and retired identities alike', async () => {
  const { service } = createService()
  await service.linkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    principalId: MEMBER_PRINCIPAL,
    directory: 'slack',
    externalId: 'U123',
  })
  await service.deprovisionDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalId: 'U123',
  })
  const notFound = (error: unknown) => error instanceof WorkspaceServiceError && error.code === 'not_found'
  await assert.rejects(() => service.resolvePlatformActor({
    workspaceId: WORKSPACE, directory: 'slack', externalId: 'U999',
  }), notFound)
  await assert.rejects(() => service.resolvePlatformActor({
    workspaceId: WORKSPACE, directory: 'slack', externalId: 'U123',
  }), notFound)
})

test('platform actor resolution rejects archived and non-human principals', async () => {  const { service, mappings } = createService()
  mappings.set('slack:Uarch', {
    id: 'mapping_arch', workspaceId: WORKSPACE, principalId: 'principal_archived',
    directory: 'slack', externalId: 'Uarch', externalGroupIds: [],
    status: 'active', createdAt: 1_000, updatedAt: 1_000,
  })
  mappings.set('msteams:Usvc', {
    id: 'mapping_svc', workspaceId: WORKSPACE, principalId: 'principal_service',
    directory: 'msteams', externalId: 'Usvc', externalGroupIds: [],
    status: 'active', createdAt: 1_000, updatedAt: 1_000,
  })
  const notFound = (error: unknown) => error instanceof WorkspaceServiceError && error.code === 'not_found'
  await assert.rejects(() => service.resolvePlatformActor({
    workspaceId: WORKSPACE, directory: 'slack', externalId: 'Uarch',
  }), notFound)
  await assert.rejects(() => service.resolvePlatformActor({
    workspaceId: WORKSPACE, directory: 'msteams', externalId: 'Usvc',
  }), notFound)
})

test('platform installs link, list, resolve by team, and unlink', async () => {
  const { service, installs, audit } = createService()
  const installation = await service.linkPlatformInstallation({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalTeamId: 'T123',
    teamName: 'Acme',
    botUserId: 'Ubot',
    botTokenCipher: 'cipher-1',
  })
  assert.equal(installation.id, 'T123')
  assert.equal(installation.workspaceId, WORKSPACE)
  assert.equal(audit.some((row) => row.metadata.event === 'platform_install_linked'), true)

  // Reinstall overwrites the token row in place.
  await service.linkPlatformInstallation({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalTeamId: 'T123',
    botTokenCipher: 'cipher-2',
  })
  assert.equal(installs.get('slack:T123')?.botTokenCipher, 'cipher-2')

  const listed = await service.listPlatformInstallations({ actorUserId: OWNER, workspaceId: WORKSPACE })
  assert.deepEqual(listed.map((entry) => entry.id), ['T123'])

  const byTeam = await service.getPlatformInstallationByTeam({ directory: 'slack', externalTeamId: 'T123' })
  assert.equal(byTeam?.botTokenCipher, 'cipher-2')
  assert.equal(
    await service.getPlatformInstallationByTeam({ directory: 'slack', externalTeamId: 'T999' }),
    null,
  )

  await service.unlinkPlatformInstallation({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalTeamId: 'T123',
  })
  assert.equal(installs.has('slack:T123'), false)
  await assert.rejects(() => service.unlinkPlatformInstallation({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalTeamId: 'T123',
  }), (error: unknown) => error instanceof WorkspaceServiceError && error.code === 'not_found')
})


test('unlinking a chat identity retires the mapping without suspending membership', async () => {
  const { service, suspended, mappings } = createService()
  await service.linkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    principalId: MEMBER_PRINCIPAL,
    directory: 'slack',
    externalId: 'U123',
  })
  const unlinked = await service.unlinkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalId: 'U123',
  })
  assert.equal(unlinked.status, 'deprovisioned')
  assert.equal(mappings.get('slack:U123')?.status, 'deprovisioned')
  // Membership is untouched: unlinking chat access is not offboarding.
  assert.deepEqual(suspended, [])
  await assert.rejects(() => service.unlinkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalId: 'U123',
  }), (error: unknown) => error instanceof WorkspaceServiceError && error.code === 'not_found')
})

test('non-managers cannot unlink chat identities', async () => {
  const { service } = createService()
  await assert.rejects(() => service.unlinkDirectoryIdentity({
    actorUserId: MEMBER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalId: 'U123',
  }), (error: unknown) => error instanceof WorkspaceServiceError && error.code === 'forbidden')
})

test('platform event claims are first-writer-wins', async () => {
  const { service } = createService()
  assert.equal(await service.claimPlatformEvent({
    workspaceId: WORKSPACE, directory: 'slack', externalTeamId: 'T123', eventId: 'Ev1',
  }), true)
  assert.equal(await service.claimPlatformEvent({
    workspaceId: WORKSPACE, directory: 'slack', externalTeamId: 'T123', eventId: 'Ev1',
  }), false)
  assert.equal(await service.claimPlatformEvent({
    workspaceId: WORKSPACE, directory: 'slack', externalTeamId: 'T123', eventId: 'Ev2',
  }), true)
})

test('members can self-link and self-unlink their own chat identity', async () => {
  const { service, mappings, audit } = createService()
  const linked = await service.linkOwnDirectoryIdentity({
    actorUserId: MEMBER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalId: 'Uself',
  })
  assert.equal(linked.principalId, MEMBER_PRINCIPAL)
  assert.equal(linked.status, 'active')
  assert.equal(audit.some((row) => row.metadata.event === 'identity_self_linked'), true)

  await service.unlinkOwnDirectoryIdentity({
    actorUserId: MEMBER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalId: 'Uself',
  })
  assert.equal(mappings.get('slack:Uself')?.status, 'deprovisioned')
})

test('self-link rejects other platforms and foreign identities', async () => {
  const { service } = createService()
  await assert.rejects(() => service.linkOwnDirectoryIdentity({
    actorUserId: MEMBER,
    workspaceId: WORKSPACE,
    directory: 'irc',
    externalId: 'someone',
  }), (error: unknown) => error instanceof WorkspaceServiceError && error.code === 'validation')
  // Someone else's mapping cannot be unlinked as self.
  await service.linkDirectoryIdentity({
    actorUserId: OWNER,
    workspaceId: WORKSPACE,
    principalId: OWNER_PRINCIPAL,
    directory: 'slack',
    externalId: 'Uowner',
  })
  await assert.rejects(() => service.unlinkOwnDirectoryIdentity({
    actorUserId: MEMBER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalId: 'Uowner',
  }), (error: unknown) => error instanceof WorkspaceServiceError && error.code === 'not_found')
})

test('members may list installs but not link them', async () => {
  const { service } = createService()
  const listed = await service.listPlatformInstallations({ actorUserId: MEMBER, workspaceId: WORKSPACE })
  assert.deepEqual(listed, [])
})

test('non-managers cannot manage platform installs', async () => {
  const { service } = createService()
  const forbidden = (error: unknown) => error instanceof WorkspaceServiceError && error.code === 'forbidden'
  await assert.rejects(() => service.linkPlatformInstallation({
    actorUserId: MEMBER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalTeamId: 'T123',
    botTokenCipher: 'cipher',
  }), forbidden)
  await assert.rejects(() => service.unlinkPlatformInstallation({
    actorUserId: MEMBER,
    workspaceId: WORKSPACE,
    directory: 'slack',
    externalTeamId: 'T123',
  }), forbidden)
})

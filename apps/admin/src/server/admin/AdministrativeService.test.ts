import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AdministrativePrincipal,
  AdministrativeRepository,
  AdministrativeRole,
} from './AdministrativeRepository'
import { AdministrativeService } from './AdministrativeService'
import type { AuditRepository } from './AuditRepository'
import { AuditService } from './AuditService'

// The capability-backed administration layer was reverted in e02a88843; these
// tests cover the fixed-role service that is live today.

test('fixed administrative roles grant only their own controls', async () => {
  const { service } = createService([
    principal('admin_1', 'admin'),
    principal('auditor_1', 'auditor'),
    principal('billing_1', 'billing_admin'),
    principal('support_1', 'support'),
  ])

  assert.deepEqual(await checks(service, 'admin_1'), [true, true, true, true])
  assert.deepEqual(await checks(service, 'auditor_1'), [false, true, false, false])
  assert.deepEqual(await checks(service, 'billing_1'), [false, false, true, false])
  assert.deepEqual(await checks(service, 'support_1'), [false, false, false, true])
  assert.deepEqual(await checks(service, 'nobody'), [false, false, false, false])
})

test('a revoked principal loses every administrative control', async () => {
  const { service } = createService([
    { ...principal('former_admin', 'admin'), revokedAt: 2, revokedBy: 'admin_1' },
  ])

  assert.deepEqual(await checks(service, 'former_admin'), [false, false, false, false])
  await assert.rejects(service.list('former_admin'), /Administrative authorization required/)
})

test('only administrators can grant roles, and every grant is audited', async () => {
  const fixture = createService([principal('admin_1', 'admin'), principal('auditor_1', 'auditor')])

  await assert.rejects(
    fixture.service.grant({ actorUserId: 'auditor_1', userId: 'someone', role: 'admin' }),
    /Administrative authorization required/,
  )
  assert.deepEqual(fixture.auditActions, [])

  const granted = await fixture.service.grant({
    actorUserId: 'admin_1',
    userId: 'support_1',
    role: 'support',
  })
  assert.equal(granted.role, 'support')
  assert.equal(await fixture.service.canAccessSupportControls('support_1'), true)
  assert.deepEqual(fixture.auditActions, ['administration.principal.grant'])
})

test('administrators cannot revoke their own role', async () => {
  const fixture = createService([principal('admin_1', 'admin'), principal('auditor_1', 'auditor')])

  await assert.rejects(
    fixture.service.revoke({ actorUserId: 'admin_1', userId: 'admin_1' }),
    /cannot revoke their own active role/,
  )
  assert.equal(await fixture.service.revoke({ actorUserId: 'admin_1', userId: 'auditor_1' }), true)
  assert.equal(await fixture.service.canViewAudit('auditor_1'), false)
  assert.deepEqual(fixture.auditActions, ['administration.principal.revoke'])
})

function principal(userId: string, role: AdministrativeRole): AdministrativePrincipal {
  return { userId, role, createdAt: 1, updatedAt: 1 }
}

async function checks(service: AdministrativeService, userId: string) {
  return [
    await service.canManageAdministrators(userId),
    await service.canViewAudit(userId),
    await service.canManageBilling(userId),
    await service.canAccessSupportControls(userId),
  ]
}

function createService(initial: AdministrativePrincipal[]) {
  const principals = new Map(initial.map((entry) => [entry.userId, entry]))
  const repository: AdministrativeRepository = {
    async get({ userId }) { return principals.get(userId) ?? null },
    async list() { return [...principals.values()] },
    async grant(input) {
      const granted: AdministrativePrincipal = {
        ...input,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      principals.set(input.userId, granted)
      return granted
    },
    async revoke({ revokedBy, userId }) {
      const existing = principals.get(userId)
      if (!existing) return false
      principals.set(userId, { ...existing, revokedAt: Date.now(), revokedBy })
      return true
    },
  }
  const auditActions: string[] = []
  const auditRepository: AuditRepository = {
    async append(input) {
      auditActions.push(input.action)
      return { ...input, id: `audit_${auditActions.length}`, createdAt: Date.now() }
    },
    async list() { return [] },
  }
  const service = new AdministrativeService({
    repository,
    audit: new AuditService(auditRepository),
  })
  return { auditActions, service }
}

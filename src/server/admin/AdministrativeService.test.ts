import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthorizationCapability } from '@overlay/authz-contracts'
import type { AdministrativePrincipal, AdministrativeRepository } from './AdministrativeRepository'
import { AdministrativeService } from './AdministrativeService'
import type { AuditRepository } from './AuditRepository'
import { AuditService } from './AuditService'

test('custom capabilities authorize legacy administration checks', async () => {
  const service = createService({
    allowedCapabilities: new Set<AuthorizationCapability>([
      'roles.manage',
      'audit.read',
      'usage.manage',
      'support.access',
    ]),
  }).service

  assert.equal(await service.canManageAdministrators('custom_admin'), true)
  assert.equal(await service.canViewAudit('custom_admin'), true)
  assert.equal(await service.canManageBilling('custom_admin'), true)
  assert.equal(await service.canAccessSupportControls('custom_admin'), true)
})

test('legacy roles remain authoritative when custom authorization is absent or unavailable', async () => {
  const principal: AdministrativePrincipal = {
    userId: 'legacy_auditor',
    role: 'auditor',
    createdAt: 1,
    updatedAt: 1,
  }
  const service = createService({ principal, authorizationThrows: true }).service

  assert.equal(await service.canViewAudit('legacy_auditor'), true)
  assert.equal(await service.canManageAdministrators('legacy_auditor'), false)
})

test('legacy grants remain successful when compatibility synchronization temporarily fails', async () => {
  const fixture = createService({
    principal: {
      userId: 'admin_1',
      role: 'admin',
      createdAt: 1,
      updatedAt: 1,
    },
    compatibilityThrows: true,
  })

  const principal = await fixture.service.grant({
    actorUserId: 'admin_1',
    userId: 'auditor_1',
    role: 'auditor',
  })
  assert.equal(principal.role, 'auditor')
  assert.ok(fixture.auditActions.includes('authorization.compatibility.sync'))
  assert.ok(fixture.auditActions.includes('administration.principal.grant'))
})

function createService(options: {
  allowedCapabilities?: Set<AuthorizationCapability>
  authorizationThrows?: boolean
  compatibilityThrows?: boolean
  principal?: AdministrativePrincipal
}) {
  const principals = new Map<string, AdministrativePrincipal>()
  if (options.principal) principals.set(options.principal.userId, options.principal)
  const repository: AdministrativeRepository = {
    async get({ userId }) { return principals.get(userId) ?? null },
    async list() { return [...principals.values()] },
    async grant(input) {
      const principal: AdministrativePrincipal = {
        ...input,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      principals.set(input.userId, principal)
      return principal
    },
    async revoke({ revokedBy, userId }) {
      const principal = principals.get(userId)
      if (!principal) return false
      principals.set(userId, { ...principal, revokedAt: Date.now(), revokedBy })
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
    authorization: {
      async checkCapability({ capability }) {
        if (options.authorizationThrows) throw new Error('authorization unavailable')
        return {
          allowed: options.allowedCapabilities?.has(capability) ?? false,
          capability,
          reason: options.allowedCapabilities?.has(capability)
            ? 'resource_access_granted'
            : 'capability_missing',
        }
      },
    },
    compatibility: {
      async syncPrincipal() {
        if (options.compatibilityThrows) throw new Error('compatibility unavailable')
      },
      async revokePrincipal() {},
      async migrate() { return { active: 0, revoked: 0, total: 0 } },
    },
  })
  return { auditActions, service }
}

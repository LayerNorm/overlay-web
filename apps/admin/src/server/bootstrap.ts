import 'server-only'

import { AdministrativeService } from '@/server/admin/AdministrativeService'
import { AuditService } from '@/server/admin/AuditService'
import { ConvexAdministrativeRepository } from '@/server/admin/ConvexAdministrativeRepository'
import { ConvexAuditRepository } from '@/server/admin/ConvexAuditRepository'
import { AuthorizationService } from '@/server/authorization/AuthorizationService'
import { AuthorizationAdministrationService } from '@/server/authorization/AuthorizationAdministrationService'
import { FixedRoleAuthorizationBridge } from '@/server/authorization/FixedRoleAuthorizationBridge'
import { createConvexAuthorizationRepositories } from '@/server/authorization/ConvexAuthorizationRepositories'

let cached: {
  administrativeService: AdministrativeService
  auditService: AuditService
  authorizationService: AuthorizationService
  authorizationAdministrationService: AuthorizationAdministrationService
  fixedRoleBridge: FixedRoleAuthorizationBridge
} | null = null

export function adminServices() {
  if (cached) return cached

  const auditService = new AuditService(new ConvexAuditRepository())
  const administrativeService = new AdministrativeService({
    audit: auditService,
    repository: new ConvexAdministrativeRepository(),
  })

  const repositories = createConvexAuthorizationRepositories()
  const authorizationService = new AuthorizationService({ repositories })
  const fixedRoleBridge = new FixedRoleAuthorizationBridge(repositories)
  const authorizationAdministrationService = new AuthorizationAdministrationService({
    assertCapability: async (userId, capability) => {
      await authorizationService.assertCapability({ userId, capability })
    },
    audit: auditService,
    prepareAuthorization: async () => {
      await fixedRoleBridge.ensureSystemRoles()
    },
    repositories,
  })

  cached = {
    administrativeService,
    auditService,
    authorizationService,
    authorizationAdministrationService,
    fixedRoleBridge,
  }
  return cached
}

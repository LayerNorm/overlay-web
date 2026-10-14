import 'server-only'

import type { AuthorizationCapability } from '@overlay/authz-contracts'

import { AdministrativeAuthorizationError, AdministrativeService } from './admin/AdministrativeService'
import { AuditService } from './admin/AuditService'
import { ConvexAdministrativeRepository } from './admin/ConvexAdministrativeRepository'
import { ConvexAuditRepository } from './admin/ConvexAuditRepository'
import { AuthorizationAdministrationService } from './authorization/AuthorizationAdministrationService'
import { AuthorizationDeniedError, AuthorizationService } from './authorization/AuthorizationService'
import { createConvexAuthorizationRepositories } from './authorization/ConvexAuthorizationRepositories'
import { FixedRoleAuthorizationBridge } from './authorization/FixedRoleAuthorizationBridge'

export type AdminServerContext = {
  administrativeService: AdministrativeService
  auditService: AuditService
  authorizationAdministrationService: AuthorizationAdministrationService
  authorizationService: AuthorizationService
}

let cached: AdminServerContext | null = null

function buildContext(): AdminServerContext {
  const auditService = new AuditService(new ConvexAuditRepository())
  const administrativeService = new AdministrativeService({
    audit: auditService,
    repository: new ConvexAdministrativeRepository(),
  })
  const repositories = createConvexAuthorizationRepositories()
  const bridge = new FixedRoleAuthorizationBridge(repositories)
  const authorizationService = new AuthorizationService({
    isDeploymentOwner: () => false,
    repositories,
  })
  // Web bootstrap passes AuthorizationDeniedError through; the routes' error
  // mapper turns it into a 403. Do the same translation here.
  const assertCapability = async (userId: string, capability: AuthorizationCapability) => {
    await authorizationService.assertCapability({ capability, userId })
  }
  const authorizationAdministrationService = new AuthorizationAdministrationService({
    assertCapability,
    audit: auditService,
    prepareAuthorization: () => bridge.ensureSystemRoles(),
    repositories,
  })
  return {
    administrativeService,
    auditService,
    authorizationAdministrationService,
    authorizationService,
  }
}

export function getAdminServerContext(): AdminServerContext {
  return (cached ??= buildContext())
}

export { AdministrativeAuthorizationError, AuthorizationDeniedError }

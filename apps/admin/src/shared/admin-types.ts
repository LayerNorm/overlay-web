export type AdminCatalogResourceType = 'connector' | 'model' | 'tool'

export type AdminCatalogResource = {
  category?: string
  description?: string
  id: string
  label: string
  resourceType: AdminCatalogResourceType
}

export type AdminUsageRow = {
  email?: string
  userId: string
}

export type AdminAuditRow = {
  action: string
  actorUserId?: string
  createdAt: number
  id: string
  outcome: string
  resourceId?: string
  resourceType: string
}

export const ADMINISTRATIVE_ROLES = ['admin', 'auditor', 'billing_admin', 'support'] as const
export type AdministrativeRole = (typeof ADMINISTRATIVE_ROLES)[number]

export type AdminPrincipal = {
  createdAt: number
  grantedBy?: string
  reason?: string
  revokedAt?: number
  revokedBy?: string
  role: AdministrativeRole
  updatedAt: number
  userId: string
}

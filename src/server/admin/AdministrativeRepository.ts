import 'server-only'

export const ADMINISTRATIVE_ROLES = ['admin', 'auditor', 'billing_admin', 'support'] as const
export type AdministrativeRole = (typeof ADMINISTRATIVE_ROLES)[number]

export type AdministrativePrincipal = {
  userId: string
  role: AdministrativeRole
  grantedBy?: string
  reason?: string
  createdAt: number
  updatedAt: number
  revokedAt?: number
  revokedBy?: string
}

export function isAdministrativeRole(value: unknown): value is AdministrativeRole {
  return typeof value === 'string' && ADMINISTRATIVE_ROLES.includes(value as AdministrativeRole)
}

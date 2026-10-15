import 'server-only'

import { adminConvexClient as convex } from '../convex-admin'
import type {
  AdministrativePrincipal,
  AdministrativeRepository,
  AdministrativeRole,
} from './AdministrativeRepository'

export class ConvexAdministrativeRepository implements AdministrativeRepository {
  async get(args: { userId: string }): Promise<AdministrativePrincipal | null> {
    return normalize(await convex.query<AdministrativePrincipal | null>(
      'admin/console:getPrincipal',
      { ...args },
      { throwOnError: true },
    ))
  }

  async list(): Promise<AdministrativePrincipal[]> {
    const rows = await convex.query<AdministrativePrincipal[]>(
      'admin/console:listPrincipals',
      {},
      { throwOnError: true },
    ) ?? []
    return rows.map((row) => normalize(row)!)
  }

  async grant(args: {
    grantedBy: string
    reason?: string
    role: AdministrativeRole
    userId: string
  }): Promise<AdministrativePrincipal> {
    const row = await convex.mutation<AdministrativePrincipal | null>(
      'admin/console:grantPrincipal',
      { ...args },
      { throwOnError: true },
    )
    if (!row) throw new Error('Failed to grant administrative principal')
    return normalize(row)!
  }

  async revoke(args: { revokedBy: string; userId: string }): Promise<boolean> {
    const result = await convex.mutation<{ revoked: boolean }>(
      'admin/console:revokePrincipal',
      { ...args },
      { throwOnError: true },
    )
    return result?.revoked === true
  }
}

function normalize(row: AdministrativePrincipal | null): AdministrativePrincipal | null {
  if (!row) return null
  const { _id: _, _creationTime: __, ...principal } = row as AdministrativePrincipal & {
    _id?: string
    _creationTime?: number
  }
  return principal
}

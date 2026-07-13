import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type {
  AdministrativePrincipal,
  AdministrativeRepository,
  AdministrativeRole,
} from './AdministrativeRepository'

export class ConvexAdministrativeRepository implements AdministrativeRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async get(args: { userId: string }): Promise<AdministrativePrincipal | null> {
    return normalize(await convex.query<AdministrativePrincipal | null>(
      'admin/administration:getPrincipalByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    ))
  }

  async list(): Promise<AdministrativePrincipal[]> {
    const rows = await convex.query<AdministrativePrincipal[]>(
      'admin/administration:listPrincipalsByServer',
      { serverSecret: this.serverSecret },
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
      'admin/administration:grantPrincipalByServer',
      { ...args, serverSecret: this.serverSecret },
      { throwOnError: true },
    )
    if (!row) throw new Error('Failed to grant administrative principal')
    return normalize(row)!
  }

  async revoke(args: { revokedBy: string; userId: string }): Promise<boolean> {
    const result = await convex.mutation<{ revoked: boolean }>(
      'admin/administration:revokePrincipalByServer',
      { ...args, serverSecret: this.serverSecret },
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

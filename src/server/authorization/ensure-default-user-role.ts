import 'server-only'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export async function ensureDefaultUserRole(userId: string): Promise<void> {
  await lazyConvex.mutation('authorization/defaults:ensureDefaultUserRoleByServer', {
    userId, serverSecret: getInternalApiSecret(),
  }, { throwOnError: true })
}

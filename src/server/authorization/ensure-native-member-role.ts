import 'server-only'
import { ensureDefaultUserRole } from './ensure-default-user-role'
import { logger } from '@/server/observability/logger'

/**
 * Native apps read workspace data straight from Convex, which checks the
 * signed-in user's saved roles. The web shell saves the default member role on
 * every page load; native sign-in and refresh do the same so a person who only
 * uses the mobile or desktop app is not denied access. Never blocks sign-in.
 */
export async function ensureNativeMemberRole(
  userId: string | undefined,
  ensure: (userId: string) => Promise<void> = ensureDefaultUserRole,
): Promise<void> {
  if (!userId) return
  try {
    await ensure(userId)
  } catch (error) {
    logger.error('[Auth] Could not save the default member role for a native session:', error)
  }
}

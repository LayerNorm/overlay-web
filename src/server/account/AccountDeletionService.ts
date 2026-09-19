import 'server-only'

import { logger } from '@/server/observability/logger'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { OverlayServerContext } from '@/server/bootstrap'
import type { AccountDataDeletionVerification } from './AccountDataDeletionRepository'
import {
  getIntegrationProvider,
  getSelectedIntegrationProviderId,
  IntegrationService,
} from '@/server/integrations'

export type AccountDeletionResult = {
  deletedRowCount: number
  email?: string
  r2Keys: string[]
  storageIds: string[]
  stripeSubscriptionId?: string
  stripeCustomerId?: string
  verification?: AccountDataDeletionVerification
}

export class AccountDeletionService {
  constructor(private readonly ctx: OverlayServerContext) {}

  async deleteAccount(args: { userId: string; request?: Request }): Promise<AccountDeletionResult> {
    await this.deleteIntegrationConnectionsBestEffort(args.userId)

    const { convex } = await import('@/server/database/convex')
    const convexResult = await convex.mutation<AccountDeletionResult>(
      'auth/users:deleteUserAccountByServer',
      {
        serverSecret: getInternalApiSecret(),
        userId: args.userId,
      },
      { throwOnError: true },
    )
    if (!convexResult) {
      throw new Error('Account deletion did not return a result')
    }

    if (convexResult.stripeSubscriptionId) {
      await this.ctx.billing.cancelSubscription?.(convexResult.stripeSubscriptionId).catch((error) => {
        logger.error(
          `[account/delete] Billing subscription cancel failed for ${convexResult.stripeSubscriptionId}:`,
          error,
        )
      })
    }

    await this.deleteObjectsBestEffort(convexResult.r2Keys)
    await this.ctx.auth.deleteUser?.(args.userId, args.request).catch((error) => {
      logger.error(`[account/delete] Auth user deletion failed for ${args.userId}:`, error)
    })

    return convexResult
  }

  private async deleteIntegrationConnectionsBestEffort(userId: string): Promise<void> {
    try {
      if (getSelectedIntegrationProviderId() === 'none') return
      await new IntegrationService(getIntegrationProvider(), this.ctx.auditService)
        .deleteConnectionsForUser({ userId })
    } catch (error) {
      logger.error(`[account/delete] Integration connection cleanup failed for ${userId}:`, error)
    }
  }

  private async deleteObjectsBestEffort(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.ctx.objectStore.deleteObject(key).catch((error) => {
        logger.error(`[account/delete] Object deletion failed for ${key}:`, error)
      })
    }
  }
}

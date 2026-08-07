import 'server-only'

import { logger } from '@/server/observability/logger'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { OverlayServerContext } from '@/server/bootstrap'
import type {
  AccountDataDeletionResult,
  AccountDataDeletionVerification,
} from './AccountDataDeletionRepository'
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
    if (this.ctx.appDataCapabilities.provider === 'postgres') {
      return await this.deletePostgresAccount(args)
    }

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

  private async deletePostgresAccount(args: {
    userId: string
    request?: Request
  }): Promise<AccountDeletionResult> {
    if (!this.ctx.auth.deleteUser) {
      throw new Error('The selected auth provider does not support account deletion.')
    }
    await this.ctx.auth.deleteUser(args.userId, args.request)

    const result = await this.ctx.appData.repositories.accountDeletion.deleteUserAccount({
      userId: args.userId,
    })
    if (result.verification.orphanedRowCount > 0) {
      throw new Error(
        `Postgres account deletion left ${result.verification.orphanedRowCount} orphaned user-owned rows.`,
      )
    }

    await this.deleteObjectsBestEffort(result.r2Keys)
    return postgresDeletionResultToAccountDeletionResult(result)
  }

  private async deleteObjectsBestEffort(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.ctx.objectStore.deleteObject(key).catch((error) => {
        logger.error(`[account/delete] Object deletion failed for ${key}:`, error)
      })
    }
  }
}

function postgresDeletionResultToAccountDeletionResult(
  result: AccountDataDeletionResult,
): AccountDeletionResult {
  return {
    deletedRowCount: result.deletedRowCount,
    email: result.email,
    r2Keys: result.r2Keys,
    storageIds: result.storageIds,
    verification: result.verification,
  }
}

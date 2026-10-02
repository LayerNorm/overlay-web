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
    // Ends every other-AI-app connection the person made; their tokens stop working at once.
    await this.ctx.appData.repositories.mcpGrants.deleteAllForUser({ userId: args.userId }).catch((error) => {
      logger.error(`[account/delete] MCP grant cleanup failed for ${args.userId}:`, error instanceof Error ? error.name : 'unknown')
    })
    // Before the rows that point at them are gone: a secret nothing references can never be removed.
    await this.deleteStoredCredentials(args.userId)

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

  /**
   * Removes every credential the user stored (model-provider keys and the
   * Claude Code / Codex accounts) from the credential vault. Unlike the
   * best-effort cleanups below, a failure stops the deletion: the vault
   * reference lives in the rows the deletion is about to remove, so leaving
   * the secret behind would orphan it permanently. Deleting is idempotent, so
   * the person can simply retry.
   */
  private async deleteStoredCredentials(userId: string): Promise<void> {
    const repositories = this.ctx.appData.repositories
    const refs = [...new Set([
      ...await repositories.providerConnections.listCredentialRefs({ userId }),
      ...await repositories.agentProviderAccounts.listCredentialRefs({ userId }),
    ])]
    const failures = (await Promise.all(refs.map(async (ref) => {
      try {
        await this.ctx.byokCredentialStore.delete(ref)
        return false
      } catch (error) {
        logger.error(`[account/delete] Credential deletion failed for ${userId}:`, error instanceof Error ? error.name : 'unknown')
        return true
      }
    }))).filter(Boolean).length
    if (failures > 0) {
      throw new Error(`Could not delete ${failures} stored credential${failures === 1 ? '' : 's'}. Nothing else was deleted; try again.`)
    }
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
    await Promise.all(keys.map((key) =>
      this.ctx.objectStore.deleteObject(key).catch((error) => {
        logger.error(`[account/delete] Object deletion failed for ${key}:`, error)
      })))
  }
}

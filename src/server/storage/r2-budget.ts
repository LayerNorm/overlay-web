import 'server-only'

import { logger } from '@/server/observability/logger'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export class R2GlobalBudgetError extends Error {
  constructor(usedBytes: number, capBytes: number) {
    super(`r2_global_budget_exceeded: used=${usedBytes} cap=${capBytes}`)
    this.name = 'R2GlobalBudgetError'
  }
}

function getGlobalBudgetCap(): number {
  const raw = process.env['R2_GLOBAL_BUDGET_BYTES']?.trim()
  if (raw && /^\d+$/.test(raw)) return parseInt(raw, 10)
  return 8 * 1024 * 1024 * 1024
}

function formatGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/**
 * Checks whether a proposed upload of `requiredAdditionalBytes` would push
 * total R2 usage over the global cap. Logs warnings at 60%, 80%, 95%.
 *
 * Throws R2GlobalBudgetError if the upload would exceed the cap.
 * Called in every upload path before generating a presigned URL or uploading a buffer.
 */
export async function checkGlobalR2Budget(requiredAdditionalBytes: number): Promise<void> {
  const cap = getGlobalBudgetCap()
  const serverSecret = getInternalApiSecret()

  let totalUsed = 0
  try {
    totalUsed = (await convex.query('files/storageAdmin:getTotalStorageBytesUsedByServer', {
      serverSecret,
    })) ?? 0
  } catch (err) {
    logger.error('[R2-Budget] Could not fetch total storage bytes — blocking upload (fail-closed):', err)
    throw new Error('r2_budget_check_failed')
  }

  const afterBytes = totalUsed + requiredAdditionalBytes
  const pctUsed = (totalUsed / cap) * 100

  if (pctUsed >= 95) {
    logger.error(
      `[R2-Budget] 🚨 CRITICAL: global R2 usage at ${pctUsed.toFixed(1)}% (${formatGB(totalUsed)} / ${formatGB(cap)})`,
    )
  } else if (pctUsed >= 80) {
    logger.warn(
      `[R2-Budget] ⚠️  WARNING: global R2 usage at ${pctUsed.toFixed(1)}% (${formatGB(totalUsed)} / ${formatGB(cap)})`,
    )
  } else if (pctUsed >= 60) {
    logger.info(
      `[R2-Budget] ℹ️  INFO: global R2 usage at ${pctUsed.toFixed(1)}% (${formatGB(totalUsed)} / ${formatGB(cap)})`,
    )
  }

  if (afterBytes > cap) {
    logger.error(
      `[R2-Budget] 🚫 BLOCKED upload: ${formatGB(requiredAdditionalBytes)} would push total to ${formatGB(afterBytes)} (cap: ${formatGB(cap)})`,
    )
    throw new R2GlobalBudgetError(totalUsed, cap)
  }

  logger.info(
    `[R2-Budget] Upload allowed: after=${formatGB(afterBytes)} (${((afterBytes / cap) * 100).toFixed(1)}% of cap)`,
  )
}

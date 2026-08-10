import {
  callConvex,
  getInternalApiSecret,
  loadLocalEnv,
  readArg,
  type DeploymentTarget,
} from './convex-admin-utils.ts'
import type { UsageReconciliationQueueItem } from '../src/server/usage/UsageRepository.ts'

loadLocalEnv()

function targetFromArgs(): DeploymentTarget {
  const target = readArg('target', 'dev')?.toLowerCase()
  if (target !== 'dev' && target !== 'prod') throw new Error('target must be dev or prod')
  if (target === 'prod' && readArg('allow-prod') !== 'true') {
    throw new Error('Production reconciliation audit requires --allow-prod=true')
  }
  return target
}

async function main(): Promise<void> {
  const target = targetFromArgs()
  const limit = Math.min(Math.max(Number(readArg('limit', '500')), 1), 1_000)
  const rows = await callConvex<UsageReconciliationQueueItem[]>(
    target,
    'query',
    'platform/usage:listBudgetReservationReconciliationByServer',
    {
      limit,
      serverSecret: getInternalApiSecret(),
    },
  )
  const byKind = countBy(rows, (row) => row.kind)
  const byError = countBy(rows, (row) => row.errorMessage ?? 'unspecified')
  const oldestUpdatedAt = rows[0]?.updatedAt
  console.log(JSON.stringify({
    byError,
    byKind,
    inspectedAt: new Date().toISOString(),
    limit,
    oldestAgeMs: oldestUpdatedAt === undefined ? undefined : Math.max(0, Date.now() - oldestUpdatedAt),
    oldestUpdatedAt: oldestUpdatedAt === undefined ? undefined : new Date(oldestUpdatedAt).toISOString(),
    pending: rows.length,
    target,
    truncated: rows.length === limit,
  }, null, 2))
}

function countBy(
  rows: UsageReconciliationQueueItem[],
  keyFor: (row: UsageReconciliationQueueItem) => string,
): Record<string, number> {
  return Object.fromEntries(
    [...rows.reduce((counts, row) => {
      const key = keyFor(row)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      return counts
    }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right)),
  )
}

void main().catch((error) => {
  console.error('[usage-reconciliation-audit] Failed:', error)
  process.exitCode = 1
})

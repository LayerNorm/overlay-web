import {
  callConvex,
  getInternalApiSecret,
  loadLocalEnv,
  readArg,
  type DeploymentTarget,
} from './convex-admin-utils.ts'
import type {
  BillingBalanceParityReport,
} from '../src/shared/billing/billing-account-migration.ts'
import type { PersonalBillingBackfillResult } from '../src/server/billing/BillingRepository.ts'

loadLocalEnv()

type CandidatePage = {
  done: boolean
  nextAfterUserId?: string
  userIds: string[]
}

function targetFromArgs(): DeploymentTarget {
  const target = readArg('target', 'dev')?.toLowerCase()
  if (target !== 'dev' && target !== 'prod') throw new Error('target must be dev or prod')
  if (target === 'prod' && readArg('allow-prod') !== 'true') {
    throw new Error('Production billing backfill requires --allow-prod=true')
  }
  return target
}

async function main(): Promise<void> {
  const target = targetFromArgs()
  const apply = readArg('apply', 'false') === 'true'
  const serverSecret = getInternalApiSecret()
  const userIds: string[] = []
  let afterUserId: string | undefined
  do {
    const page = await callConvex<CandidatePage>(
      target,
      'query',
      'billing/accountMigration:listPersonalBackfillCandidatesByServer',
      { afterUserId, limit: 100, serverSecret },
    )
    userIds.push(...page.userIds)
    afterUserId = page.done ? undefined : page.nextAfterUserId
    if (!page.done && !afterUserId) throw new Error('Backfill candidate cursor did not advance')
    if (page.done) break
  } while (true)

  if (!apply) {
    console.log(JSON.stringify({ apply: false, candidateUsers: userIds.length, target }, null, 2))
    console.log('Dry run only. Re-run with --apply=true after reviewing the candidate count.')
    return
  }

  const results: PersonalBillingBackfillResult[] = []
  const parity: BillingBalanceParityReport[] = []
  for (const userId of userIds) {
    let result: PersonalBillingBackfillResult
    do {
      result = await callConvex<PersonalBillingBackfillResult>(
        target,
        'mutation',
        'billing/accountMigration:backfillPersonalByUserByServer',
        { serverSecret, userId },
      )
      results.push(result)
    } while (!result.complete)
    const report = await callConvex<BillingBalanceParityReport | null>(
      target,
      'query',
      'billing/accountMigration:getPersonalBalanceParityByServer',
      { serverSecret, userId },
    )
    if (!report) throw new Error(`Missing parity report for ${userId}`)
    parity.push(report)
  }

  const mismatches = parity.filter((report) => !report.matches)
  console.log(JSON.stringify({
    accounts: userIds.length,
    apply: true,
    attachmentPasses: results.length,
    mismatches: mismatches.map((report) => ({
      billingAccountId: report.billingAccountId,
      differences: report.differences,
      userId: report.userId,
    })),
    parityMatches: parity.length - mismatches.length,
    target,
  }, null, 2))
  if (mismatches.length > 0) throw new Error('Personal billing balance parity failed')
}

void main().catch((error) => {
  console.error('[personal-billing-account-backfill] Failed:', error)
  process.exitCode = 1
})

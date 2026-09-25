import { benchUserId } from './config'
import { listMemories, purgeBenchUser } from './convex-client'
import { loadConvomem } from './datasets/convomem'
import { loadLocomo } from './datasets/locomo'

/**
 * Post-run cleanup sweep — reconstructs every bench userId from the dataset
 * case lists and purges them fully (loops past the 100-row list cap).
 *
 *   npx tsx benchmarks/memory/src/cleanup.ts locomo convomem
 *   npx tsx benchmarks/memory/src/cleanup.ts locomo --items 15
 */

async function main(): Promise<void> {
  const datasets = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const itemsIdx = process.argv.indexOf('--items')
  const itemsPerCategory = itemsIdx !== -1 ? Number(process.argv[itemsIdx + 1]) : 15
  // Runner userIds are run-scoped; --scope <runId> sweeps that run's stores,
  // omitted sweeps the legacy unscoped ones.
  const scopeIdx = process.argv.indexOf('--scope')
  const scope = scopeIdx !== -1 ? process.argv[scopeIdx + 1] : undefined

  let totalRows = 0
  for (const name of datasets) {
    let caseIds: string[] = []
    if (name === 'locomo') caseIds = loadLocomo().cases.map((c) => c.caseId)
    else if (name === 'convomem') caseIds = loadConvomem({ itemsPerCategory: itemsPerCategory }).cases.map((c) => c.caseId)
    else continue

    for (const caseId of caseIds) {
      const userId = benchUserId(name, caseId, scope)
      const before = (await listMemories({ userId })).length
      if (!before) continue
      const removed = await purgeBenchUser(userId)
      const after = (await listMemories({ userId })).length
      console.log(`${userId}: removed ${removed}, ${after} live remain`)
      totalRows += removed
    }
  }
  console.log(`sweep complete — ${totalRows} memories removed`)
}

main().catch((err) => {
  console.error('cleanup failed:', err)
  process.exit(1)
})

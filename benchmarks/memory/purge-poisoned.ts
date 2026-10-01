import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { purgeBenchUser, purgeMessageSource, sweepOrphanedChunks } from './src/convex-client'
import { benchUserId } from './src/config'

/**
 * Purge cases ingested during the broken-model windows (bad id → 404s, then
 * sante-free before the reasoning/normalize fixes → partial writes).
 *
 *   npx tsx benchmarks/memory/purge-poisoned.ts <runId> <keepN>
 *
 * keeps the first <keepN> ingest rows (pre-window) and purges the rest.
 */
async function main() {
  const [runId, keepN] = process.argv.slice(2)
  if (!runId || keepN === undefined) throw new Error('usage: purge-poisoned.ts <runId> <keepN>')
  const keep = Number(keepN)

  const ingestPath = `results/${runId}/convomem-ingest.jsonl`
  if (!existsSync(ingestPath)) return
  const rows = readFileSync(ingestPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const poisoned = rows.slice(keep)
  const good = rows.slice(0, keep)
  console.log(`${runId}: ${rows.length} rows, keeping ${good.length}, purging ${poisoned.length}`)

  for (const row of poisoned) {
    const userId = benchUserId('convomem', row.id, runId)
    const knownIds = [...new Set(Object.values(row.turnMemory ?? {}).flat())] as string[]
    const removed = await purgeBenchUser(userId, knownIds)
    const msgIds = [
      ...Array.from({ length: row.messages ?? 0 }, (_, i) => `${row.id}:msg:${i}`),
      ...Array.from({ length: row.bulkMessages ?? 0 }, (_, i) => `${row.id}:bulk:${i}`),
    ]
    let msg = 0
    for (const sourceId of msgIds) {
      await purgeMessageSource({ userId, sourceId }).then(() => msg++).catch(() => {})
    }
    const swept = await sweepOrphanedChunks({ userId }).catch(() => null)
    console.log(`  ${row.id}: ${removed} memories, ${msg}/${msgIds.length} msg sources, swept ${swept?.deleted ?? '?'}`)
  }
  writeFileSync(ingestPath, good.map((r) => JSON.stringify(r)).join('\n') + (good.length ? '\n' : ''))

  const qaPath = `results/${runId}/convomem-qa.jsonl`
  if (existsSync(qaPath)) {
    const poisonedIds = new Set(poisoned.map((p) => p.id))
    const qa = readFileSync(qaPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const qaKeep = qa.filter((r) => r.verdict !== 'error' && !poisonedIds.has(r.caseId))
    if (qaKeep.length !== qa.length) {
      writeFileSync(qaPath, qaKeep.map((r) => JSON.stringify(r)).join('\n') + '\n')
      console.log(`  qa: stripped ${qa.length - qaKeep.length} rows`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })

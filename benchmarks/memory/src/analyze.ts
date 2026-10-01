import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { benchUserId, config } from './config'
import { listAllMemories } from './convex-client'
import { loadConvomem } from './datasets/convomem'
import { loadLocomo } from './datasets/locomo'
import type { BenchQuestion } from './datasets/types'

/**
 * Extraction-coverage diagnostic: for every scored question, did the gold
 * evidence turn produce ANY memory? Splits failures into
 *   never-extracted (write path) vs extracted-but-missed (read/answer path).
 * Works post-run because purge soft-deletes — tombstones still carry turnId.
 *
 *   npx tsx benchmarks/memory/src/analyze.ts <run-id> locomo
 */

type QaRow = { id: string; caseId: string; category: string; verdict: string }

async function main(): Promise<void> {
  const runId = process.argv[2]
  const dataset = process.argv[3] ?? 'locomo'
  if (!runId) {
    console.log('usage: analyze.ts <run-id> [locomo|convomem]')
    process.exit(1)
  }

  const rows: QaRow[] = readFileSync(
    path.join(config.resultsDir, runId, `${dataset}-qa.jsonl`), 'utf8',
  ).split('\n').filter(Boolean).map((l) => JSON.parse(l))

  const ds = dataset === 'convomem'
    ? loadConvomem({ itemsPerCategory: 15 })
    : loadLocomo()
  const questionById = new Map<string, BenchQuestion>()
  const caseById = new Map(ds.cases.map((c) => [c.caseId, c]))
  for (const c of ds.cases) for (const q of c.questions) questionById.set(q.questionId, q)

  // Prefer the turnId→memoryIds map recorded at ingest (accurate). Fallback:
  // tombstone list — capped at 100 newest rows, so coverage is UNDER-counted.
  const ingestFile = path.join(config.resultsDir, runId, `${dataset}-ingest.jsonl`)
  const ingestRows: Array<{ id: string; turnMemory?: Record<string, string[]>; memoriesWritten?: number }> =
    existsSync(ingestFile)
      ? readFileSync(ingestFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : []
  const turnSets = new Map<string, Set<string>>()
  let degraded = false
  for (const caseId of [...new Set(rows.map((r) => r.caseId))]) {
    const ingest = ingestRows.find((r) => r.id === caseId)
    if (ingest?.turnMemory) {
      turnSets.set(caseId, new Set(Object.keys(ingest.turnMemory)))
      console.log(`${caseId}: ${Object.keys(ingest.turnMemory).length} turns covered (ingest map)`)
    } else {
      degraded = true
      // Runs scope bench users by runId; --legacy opts into the unscoped shape.
      const scope = process.argv.includes('--legacy') ? undefined : runId
      const userId = benchUserId(dataset, caseId, scope)
      const mems = await listAllMemories({ userId, includeDeleted: true })
      turnSets.set(caseId, new Set(mems.map((m) => m.turnId ?? '').filter(Boolean)))
      console.log(`${caseId}: ${mems.length} rows visible (100-row cap — coverage undercounted)`)
    }
  }
  if (degraded) {
    console.log('\nNOTE: some cases lack ingest turnMemory — coverage below is a LOWER BOUND (list cap).')
  }

  let covered = 0, uncovered = 0
  let coveredCorrect = 0, uncoveredCorrect = 0
  const perCategory = new Map<string, { covered: number; total: number; coveredCorrect: number }>()
  for (const row of rows) {
    const q = questionById.get(row.id)
    const evid = q?.evidenceTurnIds ?? []
    if (!evid.length) continue
    const set = turnSets.get(row.caseId) ?? new Set<string>()
    const hit = evid.some((id) => set.has(id))
    const cat = perCategory.get(row.category) ?? { covered: 0, total: 0, coveredCorrect: 0 }
    cat.total++
    if (hit) {
      covered++; cat.covered++
      if (row.verdict === 'correct') { coveredCorrect++; cat.coveredCorrect++ }
    } else {
      uncovered++
      if (row.verdict === 'correct') uncoveredCorrect++
    }
    perCategory.set(row.category, cat)
  }

  const total = covered + uncovered
  const lines = [
    `# Extraction coverage — ${dataset} (${runId})`,
    '',
    `Evidence turns extracted into memory: **${((covered / Math.max(1, total)) * 100).toFixed(1)}%** of scored questions (${covered}/${total})`,
    `- Accuracy when evidence WAS extracted: ${((coveredCorrect / Math.max(1, covered)) * 100).toFixed(1)}% (${coveredCorrect}/${covered}) — read/answer-side failures`,
    `- Accuracy when evidence was NOT extracted: ${((uncoveredCorrect / Math.max(1, uncovered)) * 100).toFixed(1)}% (${uncoveredCorrect}/${uncovered}) — write-side failures`,
    '',
    '| Category | Evidence extracted | Acc. when extracted |',
    '|---|---|---|',
    ...[...perCategory.entries()].sort().map(([cat, s]) =>
      `| ${cat} | ${((s.covered / s.total) * 100).toFixed(0)}% (${s.covered}/${s.total}) | ${((s.coveredCorrect / Math.max(1, s.covered)) * 100).toFixed(0)}% |`),
  ].join('\n')

  console.log('\n' + lines)
  const out = path.join(config.resultsDir, runId, `${dataset}-coverage.md`)
  writeFileSync(out, lines)
  console.log(`\nwrote ${out}`)
}

main().catch((err) => {
  console.error('analyze failed:', err)
  process.exit(1)
})

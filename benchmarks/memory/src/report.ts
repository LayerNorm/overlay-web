import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config } from './config'

/**
 * Aggregates checkpoint JSONL into a markdown report.
 *
 *   npx tsx benchmarks/memory/src/report.ts <run-id> [run-id...]
 *
 * Multiple run-ids produce a side-by-side pre/post comparison table.
 */

type QaRow = {
  id: string
  caseId: string
  category: string
  verdict: 'correct' | 'incorrect' | 'abstained' | 'error'
  retrievedChunkCount: number
  evidenceRecalled: boolean | null
  searches?: Array<{ tool: string; query: string; hits: number; newHits: number }>
  latencyMs: { retrieve: number; answer: number; judge: number }
  truncated: boolean
}
type IngestRow = { id: string; memoryCountAfter: number; memoriesWritten: number; indexWaitMs: number; indexed: boolean; durationMs: number; extractionCalls: number }

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T)
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(1)}%` : '—'
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

function reportFor(runId: string): { markdown: string; table: Map<string, { correct: number; total: number }> } {
  const dir = path.join(config.resultsDir, runId)
  const lines: string[] = [`# Memory benchmark — run \`${runId}\``, '']
  const overall = new Map<string, { correct: number; total: number }>()

  const qaFiles = readdirSync(dir).filter((f) => f.endsWith('-qa.jsonl'))
  for (const qaFile of qaFiles) {
    const dataset = qaFile.replace('-qa.jsonl', '')
    const rows = readJsonl<QaRow>(path.join(dir, qaFile))
    const ingests = readJsonl<IngestRow>(path.join(dir, `${dataset}-ingest.jsonl`))
    if (!rows.length) continue

    const correct = rows.filter((r) => r.verdict === 'correct').length
    const abstained = rows.filter((r) => r.verdict === 'abstained').length
    const errors = rows.filter((r) => r.verdict === 'error').length
    overall.set(dataset, { correct, total: rows.length })

    lines.push(`## ${dataset}`)
    lines.push('')
    lines.push(`- **Overall accuracy: ${pct(correct, rows.length)}** (${correct}/${rows.length} correct, ${abstained} abstained, ${errors} errors)`)
    lines.push(`- Median latency: retrieve ${median(rows.map((r) => r.latencyMs.retrieve))}ms · answer ${median(rows.map((r) => r.latencyMs.answer))}ms · judge ${median(rows.map((r) => r.latencyMs.judge))}ms`)
    const recall = rows.filter((r) => r.evidenceRecalled !== null)
    if (recall.length) {
      lines.push(`- Retrieval recall (evidence turn surfaced): ${pct(recall.filter((r) => r.evidenceRecalled).length, recall.length)} of questions with evidence ids`)
    }
    const agentic = rows.filter((r) => r.searches && r.searches.length > 0)
    if (agentic.length) {
      const modelSearches = agentic.map((r) => r.searches!.length - 1)
      const freshHits = agentic.map((r) => r.searches!.slice(1).reduce((a, s) => a + s.newHits, 0))
      const byTool = new Map<string, number>()
      for (const r of agentic) for (const s of r.searches!.slice(1)) byTool.set(s.tool, (byTool.get(s.tool) ?? 0) + 1)
      const mean = (xs: number[]) => (xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(1)
      lines.push(`- Agentic loop: ${mean(modelSearches)} model searches/question (cap 4), ${mean(freshHits)} new evidence chunks/question · tools: ${[...byTool.entries()].map(([t, n]) => `${t}×${n}`).join(', ')}`)
    }
    const truncated = rows.filter((r) => r.truncated).length
    if (truncated) lines.push(`- ${truncated} questions on truncated haystacks`)
    const unindexed = ingests.filter((i) => !i.indexed).length
    if (unindexed) lines.push(`- ⚠ ${unindexed} cases never confirmed indexing — scores may be depressed`)
    lines.push('')
    lines.push('| Category | Correct | Total | Accuracy | Median retrieve ms |')
    lines.push('|---|---|---|---|---|')
    const cats = [...new Set(rows.map((r) => r.category))].sort()
    for (const cat of cats) {
      const cr = rows.filter((r) => r.category === cat)
      const cc = cr.filter((r) => r.verdict === 'correct').length
      lines.push(`| ${cat} | ${cc} | ${cr.length} | ${pct(cc, cr.length)} | ${median(cr.map((r) => r.latencyMs.retrieve))} |`)
    }
    lines.push('')
    const ingestMs = ingests.reduce((a, i) => a + i.durationMs, 0)
    lines.push(`Ingestion: ${ingests.length} cases, ${(ingestMs / 60000).toFixed(1)} min total, avg ${ingests.length ? (ingests.reduce((a, i) => a + i.memoriesWritten, 0) / ingests.length).toFixed(0) : 0} memories/case`)
    lines.push('')
  }
  return { markdown: lines.join('\n'), table: overall }
}

const runIds = process.argv.slice(2)
if (!runIds.length) {
  console.log('usage: report.ts <run-id> [run-id...]')
  process.exit(1)
}

const combined: string[] = []
const perRun = new Map<string, Map<string, { correct: number; total: number }>>()
for (const runId of runIds) {
  const { markdown, table } = reportFor(runId)
  perRun.set(runId, table)
  combined.push(markdown)
}

if (runIds.length > 1) {
  combined.push('## Comparison', '')
  combined.push('| Dataset | ' + runIds.join(' | ') + ' |')
  combined.push('|---|' + runIds.map(() => '---').join('|') + '|')
  const datasets = [...new Set([...perRun.values()].flatMap((t) => [...t.keys()]))]
  for (const ds of datasets) {
    combined.push(`| ${ds} | ${runIds.map((id) => { const t = perRun.get(id)!.get(ds); return t ? pct(t.correct, t.total) : '—' }).join(' | ')} |`)
  }
}

const outDir = path.join(config.resultsDir, runIds[0]!)
mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, runIds.length > 1 ? 'comparison-report.md' : 'report.md')
writeFileSync(outFile, combined.join('\n'))
console.log(combined.join('\n'))
console.log(`\nwrote ${outFile}`)

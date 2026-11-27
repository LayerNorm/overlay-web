#!/usr/bin/env node
/**
 * Splits recent GitHub Actions jobs into waiting, setup and running time.
 *
 *   waiting  job created -> runner picked it up
 *   setup    checkout, toolchain, dependency and cache steps
 *   running  everything else
 *
 * Usage (needs an authenticated `gh`):
 *   node scripts/ci/ci-timing-audit.mjs                       # last 150 Security Checks runs
 *   node scripts/ci/ci-timing-audit.mjs --runs 50 --workflow codeql.yml
 *   node scripts/ci/ci-timing-audit.mjs --branch codex/foo    # one branch only
 *   node scripts/ci/ci-timing-audit.mjs --cache-hits          # also count dependency cache notices
 *   node scripts/ci/ci-timing-audit.mjs --created 2026-10-01..2026-10-27  # a date range
 *
 * Wall time is first job queued -> last job finished, for successful runs.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const repo = option('--repo', 'LayerNorm/overlay')
const workflow = option('--workflow', 'security.yml')
const wanted = Number(option('--runs', '150'))
const branch = option('--branch', '')
const created = option('--created', '')
const cacheHits = args.includes('--cache-hits')
if (!Number.isInteger(wanted) || wanted < 1) throw new Error('--runs must be a positive integer')

const SETUP = /^(Set up job|Check out|Prepare dependencies|Set up |Pin npm|Restore |Install |Mount |Post |Complete job|Save )/
const seconds = (value) => new Date(value).getTime() / 1000

async function gh(path) {
  const { stdout } = await run('gh', ['api', path], { maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(stdout)
}

async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
    }
  }))
  return results
}

const runs = []
for (let page = 1; runs.length < wanted; page++) {
  const query = `per_page=100&page=${page}&status=completed${branch ? `&branch=${encodeURIComponent(branch)}` : ''}${created ? `&created=${encodeURIComponent(created)}` : ''}`
  const body = await gh(`repos/${repo}/actions/workflows/${workflow}/runs?${query}`)
  if (!body.workflow_runs.length) break
  runs.push(...body.workflow_runs)
}
runs.length = Math.min(runs.length, wanted)
if (!runs.length) throw new Error('No completed runs found')

const jobsByRun = await pool(runs, 8, async (r) => (await gh(`repos/${repo}/actions/runs/${r.id}/jobs?per_page=100&filter=latest`)).jobs)

const perJob = new Map()
const wall = new Map()
let jobMinutes = 0
const cacheSamples = []
runs.forEach((r, index) => {
  let first = Infinity
  let last = 0
  for (const job of jobsByRun[index]) {
    if (!job.started_at || !job.completed_at || job.conclusion === 'skipped') continue
    const created = seconds(job.created_at)
    const started = seconds(job.started_at)
    const completed = seconds(job.completed_at)
    first = Math.min(first, created)
    last = Math.max(last, completed)
    jobMinutes += Math.max(0, completed - started) / 60
    if (job.steps?.some((step) => step.name === 'Prepare dependencies')) cacheSamples.push(job.id)
    if (job.conclusion !== 'success') continue
    let setup = 0
    for (const step of job.steps ?? []) {
      if (step.started_at && step.completed_at && SETUP.test(step.name)) setup += seconds(step.completed_at) - seconds(step.started_at)
    }
    const name = job.name.replace(/\(\d+\/(\d+)\)/, '(n/$1)')
    if (!perJob.has(name)) perJob.set(name, [])
    perJob.get(name).push({ waiting: started - created, setup, running: completed - started - setup, total: completed - started })
  }
  if (r.conclusion === 'success' && last > 0) {
    if (!wall.has(r.event)) wall.set(r.event, [])
    wall.get(r.event).push(last - first)
  }
})

const percentile = (values, p) => {
  if (!values.length) return '-'
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))])
}
const pair = (rows, key) => `${percentile(rows.map((row) => row[key]), 0.5)} / ${percentile(rows.map((row) => row[key]), 0.95)}`

const span = (seconds(runs[0].created_at) - seconds(runs.at(-1).created_at)) / 86400
console.log(`${workflow}: ${runs.length} runs, ${runs.at(-1).created_at} -> ${runs[0].created_at} (${span.toFixed(1)} days)`)
console.log('\nSeconds, successful jobs, p50 / p95')
console.log(['Job'.padEnd(42), 'n'.padStart(4), 'Waiting'.padStart(12), 'Setup'.padStart(10), 'Running'.padStart(10), 'Total'.padStart(10)].join(' '))
for (const [name, rows] of [...perJob].sort(([a], [b]) => a.localeCompare(b))) {
  console.log([name.slice(0, 42).padEnd(42), String(rows.length).padStart(4), pair(rows, 'waiting').padStart(12), pair(rows, 'setup').padStart(10), pair(rows, 'running').padStart(10), pair(rows, 'total').padStart(10)].join(' '))
}
console.log('\nWall time, successful runs, seconds')
for (const [event, values] of wall) console.log(`  ${event.padEnd(14)} n=${values.length} p50=${percentile(values, 0.5)} p95=${percentile(values, 0.95)}`)
console.log(`\nJob-minutes, all jobs: ${Math.round(jobMinutes)} (${Math.round(jobMinutes / Math.max(span, 1 / 24))}/day)`)

if (cacheHits) {
  const notices = await pool(cacheSamples, 8, async (id) => {
    const annotations = await gh(`repos/${repo}/check-runs/${id}/annotations?per_page=100`)
    return annotations.find((a) => a.title === 'CI dependency cache')?.message ?? 'unknown'
  })
  const counts = notices.reduce((all, value) => ({ ...all, [value]: (all[value] ?? 0) + 1 }), {})
  console.log('\nDependency cache:', Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(' '))
}

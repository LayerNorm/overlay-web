#!/usr/bin/env bun
/**
 * Production dependency audit gate (`bun run security:audit`).
 *
 * `bun audit` checks every package in the shared lockfile, including the dev
 * tooling of every app, and cannot leave dev dependencies out. This gate walks
 * bun.lock from the chosen workspaces' production dependencies, keeps the exact
 * versions they install, and fails on any high or critical advisory affecting one
 * of those versions unless it is listed in AUDIT_EXCEPTIONS below. Exceptions are
 * narrow (one package version, named advisories), carry a reason, and expire: an
 * expired exception fails the gate so it cannot silently become permanent.
 * Fix with overrides or upgrades whenever possible.
 *
 * Usage: bun scripts/ci/security-audit.mjs [--workspace <dir>]...
 * Without --workspace it audits the web app: the root, apps/admin and every
 * workspace package they reach.
 */
import { spawnSync } from 'node:child_process'
import { productionPackages, readBunLock, REPOSITORY_ROOT } from './bun-lock.mjs'

const TODAY = new Date().toISOString().slice(0, 10)

// GHSA-fc5q-39xc-vjpf (picomatch ReDoS, every release through 4.0.7, no patched
// version yet). These copies run only at build time, on patterns from our own
// build config: Sentry's webpack wrapping loader (@rollup/plugin-commonjs) and
// the Workflow builder's file discovery (tinyglobby). No production request path
// passes user input to them. Remove when a patched picomatch is published.
const AUDIT_EXCEPTIONS = [
  {
    package: 'picomatch@4.0.7',
    advisories: ['GHSA-fc5q-39xc-vjpf'],
    expires: '2026-12-01',
    reason: 'Build-time glob matching on our own config patterns; no patched picomatch exists yet.',
  },
]

const BLOCKING = new Set(['high', 'critical'])

const args = process.argv.slice(2)
const selected = []
for (let i = 0; i < args.length; i++) if (args[i] === '--workspace') selected.push(args[++i].replace(/\/$/, ''))
const roots = selected.length > 0 ? selected : ['', 'apps/admin']
const installed = productionPackages(readBunLock(), roots)

const audit = spawnSync('bun', ['audit', '--json'], { cwd: REPOSITORY_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
let report
try {
  report = JSON.parse(audit.stdout)
} catch {
  console.error('bun audit did not return JSON:\n', audit.stderr || audit.stdout)
  process.exit(1)
}

const failures = []
const allowed = []
for (const [name, advisories] of Object.entries(report)) {
  for (const [id, { name: installedName, version, chains }] of installed) {
    if (installedName !== name) continue
    const hits = advisories.filter((a) => BLOCKING.has(a.severity) && Bun.semver.satisfies(version, a.vulnerable_versions))
    if (hits.length === 0) continue
    const ids = [...new Set(hits.map((a) => a.url.split('/').pop()))]
    const exception = AUDIT_EXCEPTIONS.find((entry) => entry.package === id)
    const uncovered = ids.filter((advisory) => !exception?.advisories.includes(advisory))
    const via = chains.join('\n      ')
    if (!exception || uncovered.length > 0) failures.push(`${id}: ${(exception ? uncovered : ids).join(', ')}\n      ${via}`)
    else if (exception.expires < TODAY) failures.push(`${id}: exception expired ${exception.expires} (${ids.join(', ')})`)
    else allowed.push(`${id} until ${exception.expires}: ${ids.join(', ')}`)
  }
}

for (const entry of allowed) console.log(`allowed (reviewed exception) ${entry}`)
const scope = roots.map((dir) => dir || '(root)').join(', ')
if (failures.length > 0) {
  console.error(`High or critical production advisories without a valid exception (${scope}):`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log(`No unexcepted high or critical production advisories (${installed.size} packages from ${scope}).`)

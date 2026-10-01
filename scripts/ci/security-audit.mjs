#!/usr/bin/env node
/**
 * Production dependency audit gate (`npm run security:audit`).
 *
 * Fails on any high or critical advisory in production dependencies unless the
 * exact package install path is listed in AUDIT_EXCEPTIONS below. Exceptions are
 * narrow (one install path, named advisories), carry a reason, and expire: an
 * expired exception fails the gate so it cannot silently become permanent.
 * Fix with overrides or upgrades whenever possible; add an exception only when
 * a dependency pins the vulnerable version in a way overrides cannot reach.
 */
import { spawnSync } from 'node:child_process'

const TODAY = new Date().toISOString().slice(0, 10)

const AUDIT_EXCEPTIONS = [
  {
    path: 'node_modules/eve/node_modules/undici',
    advisories: ['GHSA-rfgv-xxqx-mfg5', 'GHSA-w293-vg96-wgc3'],
    expires: '2026-10-14',
    reason: 'Every eve release pins undici 8.9.0 exactly. eve is imported only by the '
      + '@layernorm/overlay-agent-host CLI (eve adapter), never by the web app runtime.',
  },
]

const BLOCKING = new Set(['high', 'critical'])

const run = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
let report
try {
  report = JSON.parse(run.stdout)
} catch (_error) {
  console.error('npm audit did not return JSON:\n', run.stderr || run.stdout)
  process.exit(1)
}

const failures = []
const allowed = []
for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  // Advisories attach to the vulnerable package itself; parents that only
  // depend on it carry string `via` entries and are covered by that package.
  const advisories = vulnerability.via.filter((via) => typeof via === 'object' && BLOCKING.has(via.severity))
  if (advisories.length === 0) continue
  const ids = [...new Set(advisories.map((via) => via.url.split('/').pop()))]
  for (const path of vulnerability.nodes) {
    const exception = AUDIT_EXCEPTIONS.find((entry) => entry.path === path)
    const uncovered = ids.filter((id) => !exception?.advisories.includes(id))
    if (!exception || uncovered.length > 0) {
      failures.push(`${name} at ${path}: ${(exception ? uncovered : ids).join(', ')}`)
    } else if (exception.expires < TODAY) {
      failures.push(`${name} at ${path}: exception expired ${exception.expires} (${ids.join(', ')})`)
    } else {
      allowed.push(`${name} at ${path} until ${exception.expires}: ${ids.join(', ')}`)
    }
  }
}

for (const entry of allowed) console.log(`allowed (reviewed exception) ${entry}`)
if (failures.length > 0) {
  console.error('High or critical production advisories without a valid exception:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log('No unexcepted high or critical production advisories.')

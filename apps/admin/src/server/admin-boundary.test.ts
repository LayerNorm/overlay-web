import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

/**
 * Boundary tests matching docs/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md:
 *  - ADMIN_CONVEX_SECRET / ADMIN_API_SECRET may only be read inside
 *    src/server/convex-admin.ts.
 *  - Web-app secrets (INTERNAL_API_SECRET, SESSION_SECRET, STRIPE_*, provider
 *    keys) must not appear anywhere in the app.
 *  - Nothing outside src/server may import the Convex module.
 *  - The app must not reach into the customer app's src/** tree.
 */
const SRC = join(__dirname, '..')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      yield* walk(path)
    } else if (/\.(ts|tsx|js|jsx|mts)$/.test(entry) && !entry.endsWith('.d.ts')) {
      yield path
    }
  }
}

const CLIENT_DIRS = [join(SRC, 'features'), join(SRC, 'components')]

test('only convex-admin.ts reads the admin Convex secret', () => {
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    if (file.endsWith('server/convex-admin.ts') || file.endsWith('.test.ts')) continue
    const text = readFileSync(file, 'utf8')
    if (/process\.env\.(?:ADMIN_CONVEX_SECRET|ADMIN_API_SECRET)/.test(text)) {
      offenders.push(relative(SRC, file))
    }
  }
  assert.deepEqual(offenders, [])
})

test('web-app and provider secrets are never read by the admin app', () => {
  // Matches process.env.<NAME> reads — literal mentions in comments explaining
  // the boundary are fine (the ESLint rule has the same semantics).
  const banned = /process\.env\.(?:INTERNAL_API_SECRET|INTERNAL_SERVICE_AUTH_SECRET|SESSION_SECRET|STRIPE_SECRET_KEY|PROVIDER_KEYS_SECRET|COMPOSIO_API_KEY|SESSION_COOKIE_ENCRYPTION_KEY)/
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    if (file.endsWith('.test.ts')) continue
    if (banned.test(readFileSync(file, 'utf8'))) offenders.push(relative(SRC, file))
  }
  assert.deepEqual(offenders, [])
})

test('the Convex module is not imported by client-side code', () => {
  const offenders: string[] = []
  for (const dir of CLIENT_DIRS) {
    for (const file of walk(dir)) {
      if (/convex-admin/.test(readFileSync(file, 'utf8'))) offenders.push(relative(SRC, file))
    }
  }
  // Server Components under app/ are allowed to reach the gate (which reads
  // services, not the Convex module directly); route handlers may use it.
  assert.deepEqual(offenders, [])
})

test('no file escapes the app into the customer src/** tree', () => {
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    // Relative imports that climb above apps/admin/src (../../../src,
    // ../../../../src, ...) point at the web app's tree.
    if (/from\s+['"](?:\.\.\/){3,}src\//.test(text) || /require\(['"](?:\.\.\/){3,}src\//.test(text)) {
      offenders.push(relative(SRC, file))
    }
  }
  assert.deepEqual(offenders, [])
})

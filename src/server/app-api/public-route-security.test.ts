import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PUBLIC_V1_ROUTE_SECURITY_EXCEPTIONS } from './public-route-security'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app')
const v1Root = join(appRoot, 'api', 'v1')

/**
 * These pre-v1 routes are legacy compatibility/framework boundaries. Keep the
 * inventory explicit so a new generic side-effecting route cannot bypass the
 * v1 security contract by being added under a new path.
 */
const NON_V1_ROUTE_INVENTORY: Record<string, string[]> = {
  '/api/account/delete': ['POST'],
  '/api/auth/callback': ['GET'],
  '/api/auth/convex-token': ['GET'],
  '/api/auth/desktop-link': ['GET', 'POST'],
  '/api/auth/forgot-password': ['POST'],
  '/api/auth/native/authorize': ['POST'],
  '/api/auth/native/exchange': ['POST'],
  '/api/auth/native/refresh': ['POST'],
  '/api/auth/native/subscription': ['GET'],
  '/api/auth/options': ['GET'],
  '/api/auth/reset-password': ['POST'],
  '/api/auth/session': ['GET'],
  '/api/auth/sign-in': ['POST'],
  '/api/auth/sign-out': ['POST'],
  '/api/auth/sign-up': ['POST'],
  '/api/auth/sso/[provider]': ['GET'],
  '/api/auth/sync-profile': ['POST'],
  '/api/auth/verify-email': ['POST'],
  '/api/better-auth/[...all]': [],
  '/api/checkout': ['POST'],
  '/api/checkout/verify': ['POST'],
  '/api/convex/[type]': ['POST'],
  '/api/entitlements': ['GET'],
  '/api/latest-release': ['GET'],
  '/api/latest-release/download': ['GET'],
  '/api/portal': ['POST'],
  '/api/security/csp-report': ['POST'],
  '/api/share/file/[token]': ['GET'],
  '/api/subscription': ['GET'],
  '/api/subscription/change-plan': ['POST'],
  '/api/subscription/settings': ['GET', 'POST'],
  '/api/topups/checkout': ['POST'],
  '/api/topups/history': ['GET'],
  '/api/topups/verify': ['POST'],
  '/api/webhooks/slack': ['POST'],
  '/api/webhooks/slack/oauth': ['GET'],
  '/api/webhooks/stripe': ['POST'],
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    return entry.isFile() && entry.name === 'route.ts' ? [path] : []
  })
}

function routePath(file: string): string {
  const routeDirectory = dirname(relative(appRoot, file))
  return `/${routeDirectory.split(sep).join('/')}`.replace(/\/route$/, '')
}

function exportedMethods(source: string): string[] {
  return [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)]
    .map((match) => match[1]!)
    .sort()
}

test('every public v1 route uses the security BFF or declares complete replacement controls', () => {
  for (const file of routeFiles(v1Root)) {
    const source = readFileSync(file, 'utf8')
    if (/handleBffRoute\s*\(/.test(source)) continue

    const path = routePath(file)
    const exception = PUBLIC_V1_ROUTE_SECURITY_EXCEPTIONS[
      path as keyof typeof PUBLIC_V1_ROUTE_SECURITY_EXCEPTIONS
    ]
    assert.ok(exception, `${path} must use handleBffRoute or declare replacement controls`)
    assert.deepEqual(exportedMethods(source), [...exception.methods].sort(), `${path} method list drifted`)
    for (const control of Object.values(exception.controls)) {
      assert.ok(control.trim(), `${path} must declare every security control`)
    }
    if (path === '/api/v1/mcps/oauth/callback') {
      assert.match(source, /enforceRateLimits\s*\(/)
      assert.match(source, /consumeOAuthSession\s*\(/)
      assert.match(source, /auditService\.record\s*\(/)
    }
  }
})

test('every declared exception has a route file', () => {
  for (const path of Object.keys(PUBLIC_V1_ROUTE_SECURITY_EXCEPTIONS)) {
    const file = join(appRoot, path.slice(1), 'route.ts')
    assert.equal(existsSync(file), true, `${path} no longer has a route file`)
  }
})

test('non-v1 API route inventory is explicit', () => {
  const actual = Object.fromEntries(
    routeFiles(join(appRoot, 'api'))
      .map((file) => [routePath(file), exportedMethods(readFileSync(file, 'utf8'))] as const)
      .filter(([path]) => !path.startsWith('/api/v1'))
      .sort(([left], [right]) => left.localeCompare(right)),
  )

  assert.deepEqual(actual, NON_V1_ROUTE_INVENTORY)
})

test('removed development-only side-effecting routes stay absent', () => {
  assert.equal(existsSync(join(appRoot, 'api', 'email', 'send', 'route.ts')), false)
  assert.equal(existsSync(join(appRoot, 'api', 'v1', 'workflows', 'spike', 'route.ts')), false)
  assert.equal(existsSync(join(dirname(dirname(appRoot)), 'workflows', 'spike.ts')), false)
})

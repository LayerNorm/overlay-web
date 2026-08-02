import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PUBLIC_V1_ROUTE_SECURITY_EXCEPTIONS } from './public-route-security'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app')
const v1Root = join(appRoot, 'api', 'v1')

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

import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  AUTHORIZATION_ROUTE_POLICIES,
  getAuthorizationRoutePolicy,
} from './authorization-route-policy'

const ROUTE_ROOT = path.join(process.cwd(), 'src/app/api/v1')
const HTTP_METHOD_PATTERN = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g

test('every API v1 route method has an explicit authorization policy', async () => {
  const routeFiles = await findRouteFiles(ROUTE_ROOT)
  const missing: string[] = []
  for (const file of routeFiles) {
    const source = await fs.readFile(file, 'utf8')
    const methods = [...source.matchAll(HTTP_METHOD_PATTERN)].map((match) => match[1])
    const pathname = routePathForFile(file)
    for (const method of methods) {
      if (!getAuthorizationRoutePolicy(method, pathname)) missing.push(`${method} ${pathname}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('route policies are exact and expose typed resource requirements', () => {
  assert.deepEqual(getAuthorizationRoutePolicy('GET', '/api/v1/files'), {
    access: 'resource',
    capabilities: ['files.read'],
    resource: { action: 'view', optional: true, type: 'file' },
  })
  assert.deepEqual(
    getAuthorizationRoutePolicy('DELETE', '/api/v1/files'),
    {
      access: 'resource',
      capabilities: ['files.delete'],
      resource: { action: 'delete', type: 'file' },
    },
  )
  assert.equal(
    getAuthorizationRoutePolicy('GET', '/api/v1/files/file_1/content')?.resource?.type,
    'file',
  )
  assert.equal(getAuthorizationRoutePolicy('GET', '/api/v1/files-archive'), null)
  assert.equal(getAuthorizationRoutePolicy('POST', '/api/v1/unknown'), null)
  assert.deepEqual(
    getAuthorizationRoutePolicy('POST', '/api/v1/knowledge-bases/kb_1/sources/upload'),
    {
      access: 'resource',
      capabilities: ['knowledge.edit', 'files.upload'],
      resource: { action: 'edit', type: 'knowledge_base' },
    },
  )
})

test('policy registry does not contain duplicate path rules', () => {
  const paths = AUTHORIZATION_ROUTE_POLICIES.map(({ path: routePath }) => routePath)
  assert.equal(new Set(paths).size, paths.length)
})

async function findRouteFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return await findRouteFiles(entryPath)
    return entry.isFile() && entry.name === 'route.ts' ? [entryPath] : []
  }))
  return nested.flat()
}

function routePathForFile(file: string): string {
  const relative = path.relative(path.join(process.cwd(), 'src/app'), file)
    .replaceAll(path.sep, '/')
    .replace(/\/route\.ts$/, '')
  return `/${relative}`
    .replace(/\[\.\.\.([^\]]+)\]/g, '*')
    .replace(/\[([^\]]+)\]/g, ':$1')
}

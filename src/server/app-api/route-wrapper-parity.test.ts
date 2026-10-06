import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
// Found by this test when it was written, not yet decided: the handler exists but nothing serves it (405 today).
// `PATCH conversations/message` is called by the API client. Remove an entry once the wrapper is added or the handler deleted.
const KNOWN_UNWIRED = new Set(['PATCH conversations/message/route.ts', 'PATCH outputs/route.ts'])

const domainRoot = path.resolve(process.cwd(), 'src/server/app-api/v1')
const appRoot = path.resolve(process.cwd(), 'src/app/api/v1')

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return entry === 'route.ts' ? [full] : []
  })
}

function exportedMethods(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return METHODS.filter((method) => new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\b`).test(source))
}

/**
 * Each app route is a thin wrapper that calls the domain handler under `src/server/app-api/v1`. A handler added there
 * without a wrapper answers 405 in production (a rename that worked in every test did exactly that). Wrappers the domain
 * does not use are fine; a domain method with no wrapper is the bug.
 */
test('every method a domain route handler exports is also exported by its app route', () => {
  const missing: string[] = []
  for (const file of routeFiles(domainRoot)) {
    const relative = path.relative(domainRoot, file)
    const wrapper = path.join(appRoot, relative)
    let wrapperMethods: string[]
    try {
      wrapperMethods = exportedMethods(wrapper)
    } catch {
      continue // internal-only domain modules have no app route
    }
    const wrapperSource = readFileSync(wrapper, 'utf8')
    // Only wrappers that delegate to this domain module are comparable.
    if (!wrapperSource.includes('@/server/app-api/v1/')) continue
    for (const method of exportedMethods(file)) {
      if (!wrapperMethods.includes(method) && !KNOWN_UNWIRED.has(`${method} ${relative}`)) missing.push(`${method} ${relative}`)
    }
  }
  assert.deepEqual(missing, [])
})

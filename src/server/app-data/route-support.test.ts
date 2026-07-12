import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appDataRouteUnsupportedResponse,
  findPostgresRouteRule,
  getAppDataRouteSupport,
} from '@/server/app-data/route-support'
import {
  applyAppDataCapabilitiesToOverlayCapabilities,
  POSTGRES_APP_DATA_V1_CAPABILITIES,
} from '@/server/app-data/capabilities'
import { DEFAULT_OVERLAY_CAPABILITIES, resolveOverlayAppShellConfig } from '@overlay/app-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const appApiV1Root = path.join(repoRoot, 'src/app/api/v1')
const HTTP_METHOD_PATTERN = /export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\b/g

type RouteExport = {
  method: string
  pathname: string
  routeFile: string
}

function collectRouteFiles(directory: string): string[] {
  const entries = readdirSync(directory)
  const files: string[] = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry)
    const stat = statSync(absolute)
    if (stat.isDirectory()) {
      files.push(...collectRouteFiles(absolute))
    } else if (entry === 'route.ts') {
      files.push(absolute)
    }
  }
  return files
}

function routeFileToPathname(routeFile: string): string {
  const relative = path.relative(appApiV1Root, path.dirname(routeFile))
  const segments = relative ? relative.split(path.sep) : []
  return `/api/v1${segments.length ? `/${segments.join('/')}` : ''}`
}

function exportedMethods(routeFile: string): string[] {
  const source = readFileSync(routeFile, 'utf8')
  return [...source.matchAll(HTTP_METHOD_PATTERN)].map((match) => match[1]!)
}

function routeExports(): RouteExport[] {
  return collectRouteFiles(appApiV1Root).flatMap((routeFile) => {
    const pathname = routeFileToPathname(routeFile)
    return exportedMethods(routeFile).map((method) => ({ method, pathname, routeFile }))
  })
}

test('Postgres app-data route support classifies every /api/v1 route export', () => {
  const missing = routeExports()
    .filter(({ method, pathname }) => !findPostgresRouteRule(method, pathname))
    .map(({ method, pathname, routeFile }) => `${method} ${pathname} (${path.relative(repoRoot, routeFile)})`)

  assert.deepEqual(missing, [])
})

test('Postgres app-data capabilities expose projects while removing unsupported product surfaces', () => {
  const capabilities = applyAppDataCapabilitiesToOverlayCapabilities(
    DEFAULT_OVERLAY_CAPABILITIES,
    POSTGRES_APP_DATA_V1_CAPABILITIES,
  )
  const shell = resolveOverlayAppShellConfig(undefined, { capabilities })

  assert.equal(capabilities.projects, true)
  assert.equal(capabilities.integrations, false)
  assert.equal(capabilities.skills, false)
  assert.equal(capabilities.mcpServers, false)
  assert.equal(shell.appFeatureFlags.canUseProjects, true)
  assert.equal(shell.navigation.some((item) => item.id === 'extensions'), false)
  assert.equal(shell.navigation.some((item) => item.id === 'projects'), true)
  assert.equal(shell.sidebarActions.some((item) => item.id === 'projects.create'), true)
  assert.equal(shell.featureModules.some((item) => item.id === 'tools-extensions'), false)
  assert.equal(shell.featureModules.some((item) => item.id === 'projects'), true)
})

test('Postgres app-data mode supports project hierarchy routes', () => {
  const support = getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/projects',
  })
  assert.equal(support.status, 'supported')
  assert.equal(support.feature, 'projects')
})

test('Postgres app-data mode supports conversation persistence and realtime routes', () => {
  const support = getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/conversations',
  })
  assert.equal(support.status, 'supported')
  assert.equal(support.feature, 'chat-persistence')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/conversations/events',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/conversations/stop',
  }).status, 'supported')
})

test('Postgres app-data mode supports persisted chat suggestions and gates notebook generation', async () => {
  const support = getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/chat-suggestions',
  })
  assert.equal(support.status, 'supported')

  const notebookSupport = getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/notebook-agent',
  })
  assert.equal(notebookSupport.status, 'unsupported')

  const response = appDataRouteUnsupportedResponse({
    databaseProvider: 'postgres',
    method: 'POST',
    pathname: '/api/v1/notebook-agent',
    support: notebookSupport,
  })
  assert.equal(response.status, 501)
  assert.deepEqual(await response.json(), {
    error: 'Route is not available for the selected app-data provider',
    code: 'app_data_route_not_supported',
    provider: 'postgres',
    method: 'POST',
    route: '/api/v1/notebook-agent',
    feature: 'usage-accounting',
    reason: 'Notebook generation still requires the P8 usage reservation and billing-record repository.',
  })
})

test('Postgres app-data mode supports bootstrap and gates external integration routes', () => {
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/bootstrap',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/model-catalog',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/integrations',
  }).status, 'unsupported')
})

test('Postgres app-data mode supports chat title generation', () => {
  const support = getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/generate-title',
  })
  assert.equal(support.status, 'supported')
  assert.equal(support.feature, 'chat-persistence')
})

test('Postgres app-data mode supports settings and onboarding routes', () => {
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/settings',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'PATCH',
    pathname: '/api/v1/settings',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/onboarding/status',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/onboarding/complete',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/onboarding/reset',
  }).status, 'supported')
})

test('Postgres app-data mode supports notes routes', () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    assert.equal(getAppDataRouteSupport({
      appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
      method,
      pathname: '/api/v1/notes',
    }).status, 'supported')
  }
})

test('Postgres app-data mode supports memory and knowledge routes', () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    assert.equal(getAppDataRouteSupport({
      appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
      method,
      pathname: '/api/v1/memory',
    }).status, 'supported')
  }
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/knowledge/search',
  }).status, 'supported')
})

test('Postgres app-data mode supports complete file lifecycle routes', () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    assert.equal(getAppDataRouteSupport({
      appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
      method,
      pathname: '/api/v1/files',
    }).status, 'supported')
  }
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/files/upload-url',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/outputs/some-output/content',
  }).status, 'supported')
})

test('Postgres app-data mode supports generated media, browser, and sandbox outputs', () => {
  for (const pathname of [
    '/api/v1/outputs',
    '/api/v1/generate-image',
    '/api/v1/generate-video',
    '/api/v1/browser-task',
    '/api/v1/daytona/run',
  ]) {
    assert.equal(getAppDataRouteSupport({
      appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
      method: pathname === '/api/v1/outputs' ? 'GET' : 'POST',
      pathname,
    }).status, 'supported', pathname)
  }
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/transcribe',
  }).status, 'unsupported')
})

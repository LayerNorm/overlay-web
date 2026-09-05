import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
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

test('Postgres app-data capabilities hide unsupported integrations while preserving other parity', () => {
  const capabilities = applyAppDataCapabilitiesToOverlayCapabilities(
    DEFAULT_OVERLAY_CAPABILITIES,
    POSTGRES_APP_DATA_V1_CAPABILITIES,
  )
  const shell = resolveOverlayAppShellConfig(undefined, { capabilities })

  assert.equal(capabilities.projects, true)
  assert.equal(capabilities.integrations, false)
  assert.equal(capabilities.skills, true)
  assert.equal(capabilities.mcpServers, true)
  assert.equal(shell.appFeatureFlags.canUseProjects, true)
  assert.equal(shell.navigation.some((item) => item.id === 'extensions'), true)
  assert.equal(shell.navigation.some((item) => item.id === 'projects'), true)
  assert.equal(shell.sidebarActions.some((item) => item.id === 'projects.create'), true)
  assert.equal(shell.featureModules.some((item) => item.id === 'tools-extensions'), true)
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
    method: 'GET',
    pathname: '/api/v1/conversations/events',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'POST',
    pathname: '/api/v1/conversations/stop',
  }).status, 'supported')
})

test('Postgres app-data mode supports persisted chat suggestions and metered notebook generation', () => {
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
  assert.equal(notebookSupport.status, 'supported')
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
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/workspaces/acme',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/conversations/abc/participants',
  }).status, 'supported')
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/slack/installations',
  }).status, 'supported')
})

test('Postgres app-data mode exposes the provider-neutral workspace and agent vertical slice', () => {
  for (const [method, pathname] of [
    ['GET', '/api/v1/workspaces'],
    ['POST', '/api/v1/workspaces/active'],
    ['GET', '/api/v1/agents'],
    ['POST', '/api/v1/conversations/channels'],
    ['POST', '/api/v1/conversations/message'],
  ] as const) {
    const support = getAppDataRouteSupport({
      appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
      method,
      pathname,
    })
    assert.equal(support.status, 'supported', `${method} ${pathname}`)
    assert.notEqual(support.feature, 'workspace-collaboration-gated')
  }
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
  }).status, 'supported')
})

test('Postgres app-data mode supports durable automation routes', () => {
  for (const [method, pathname] of [
    ['GET', '/api/v1/automations'],
    ['POST', '/api/v1/automations/test'],
    ['POST', '/api/v1/automations/run'],
  ] as const) {
    assert.equal(getAppDataRouteSupport({
      appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
      method,
      pathname,
    }).status, 'supported')
  }
})

test('Postgres app-data mode supports webhook subscription and delivery routes', () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    assert.equal(getAppDataRouteSupport({
      appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
      method,
      pathname: '/api/v1/webhooks',
    }).status, 'supported')
  }
})

test('Postgres app-data mode supports skills and MCP independently of gated connectors', () => {
  for (const pathname of ['/api/v1/skills', '/api/v1/mcps', '/api/v1/mcps/test']) {
    assert.equal(getAppDataRouteSupport({
      appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
      method: 'POST',
      pathname,
    }).status, 'supported')
  }
  assert.equal(getAppDataRouteSupport({
    appDataCapabilities: POSTGRES_APP_DATA_V1_CAPABILITIES,
    method: 'GET',
    pathname: '/api/v1/integrations',
  }).status, 'unsupported')
})

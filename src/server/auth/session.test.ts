import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connection: vi.fn(), headers: vi.fn(), cookies: vi.fn(), getSession: vi.fn(), refreshSession: vi.fn(),
  hasRefresh: true,
}))
vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ connection: mocks.connection }))
vi.mock('next/headers', () => ({ headers: mocks.headers, cookies: mocks.cookies }))
vi.mock('@/server/bootstrap', () => ({
  getOverlayServerContext: () => ({ auth: { getSession: mocks.getSession,
    ...(mocks.hasRefresh ? { refreshSession: mocks.refreshSession } : {}),
  } }),
}))
vi.mock('react', async () => {
  const { createRequire } = await import('node:module')
  return createRequire(import.meta.url)('react')
})

import { getOverlaySession } from './session'

const require = createRequire(import.meta.url)
const reactServer = require('react') as typeof import('react')
const renderToReadableStream = require('next/dist/compiled/react-server-dom-turbopack/server.node.js')
  .renderToReadableStream as (
    model: unknown,
    moduleMap: Record<string, unknown>,
    options: { onError: (error: unknown) => string },
  ) => ReadableStream<Uint8Array>
const requestContext = new AsyncLocalStorage<{ cookie: string }>()

const session = (id: string) => ({ user: { id, email: `${id}@example.test` }, accessToken: `${id}-test-token` })

async function renderRequest(cookie: string, component: () => Promise<string>) {
  const errors: string[] = []
  const stream = requestContext.run({ cookie }, () => renderToReadableStream(
    reactServer.createElement(component),
    {},
    { onError: error => {
      errors.push(error instanceof Error ? error.message : String(error))
      return 'session-read-error'
    } },
  ))
  return { body: await new Response(stream).text(), errors }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hasRefresh = true
  mocks.connection.mockResolvedValue(undefined)
  mocks.headers.mockResolvedValue(new Headers({ host: 'preview.example.test' }))
  mocks.cookies.mockImplementation(async () => ({
    getAll: () => {
      const cookie = requestContext.getStore()?.cookie
      return cookie ? [{ name: 'overlay_session', value: cookie }] : []
    },
  }))
  mocks.getSession.mockImplementation(async (request: Request) => {
    const id = request.headers.get('cookie')?.match(/overlay_session=([^;]+)/)?.[1]
    return session(id ?? 'alice')
  })
  mocks.refreshSession.mockResolvedValue(session('refreshed'))
})

test('ambient reads deduplicate within, but not between, concurrent React server renders', async () => {
  mocks.getSession.mockImplementation(async (request: Request) => {
    const id = request.headers.get('cookie')?.match(/overlay_session=([^;]+)/)?.[1]
    if (id === 'guest') return null
    if (id === 'broken') throw new Error('synthetic session read error')
    return session(id ?? 'alice')
  })

  async function ReadTwice() {
    const [first, second] = await Promise.all([getOverlaySession(), getOverlaySession()])
    return `${first?.user.id ?? 'null'}|${second?.user.id ?? 'null'}`
  }

  const cookies = ['alice', 'bob', 'guest', 'broken']
  const results = await Promise.all(cookies.map(cookie => renderRequest(cookie, ReadTwice)))

  expect(results[0].body).toContain('alice|alice')
  expect(results[1].body).toContain('bob|bob')
  expect(results[2].body).toContain('null|null')
  expect(results[3].errors).toContain('synthetic session read error')
  expect(mocks.getSession).toHaveBeenCalledTimes(4)
  expect(mocks.connection).toHaveBeenCalledTimes(4)
  expect(mocks.getSession.mock.calls.map(([request]) => request.headers.get('cookie')).sort())
    .toEqual(cookies.map(cookie => `overlay_session=${cookie}`).sort())
})

test('explicit requests bypass the ambient cache and preserve their own cookies', async () => {
  const requests = ['alice', 'bob'].map(id => new Request('https://preview.example.test/api/test', {
    headers: { cookie: `overlay_session=${id}` },
  }))
  async function ReadAroundExplicitRequests() {
    const before = await getOverlaySession()
    const [first, second] = await Promise.all(requests.map(request => getOverlaySession(request)))
    const after = await getOverlaySession()
    return `${before?.user.id}|${first?.user.id}|${second?.user.id}|${after?.user.id}`
  }

  const result = await renderRequest('ordinary', ReadAroundExplicitRequests)
  expect(result.body).toContain('ordinary|alice|bob|ordinary')
  expect(mocks.getSession).toHaveBeenCalledTimes(3)
  expect(mocks.getSession.mock.calls.map(([request]) => request))
    .toEqual(expect.arrayContaining(requests))
  expect(mocks.getSession.mock.calls.map(([request]) => request.headers.get('cookie')))
    .toEqual(expect.arrayContaining(['overlay_session=alice', 'overlay_session=bob', 'overlay_session=ordinary']))
  expect(mocks.connection).toHaveBeenCalledTimes(1)
  expect(mocks.headers).toHaveBeenCalledTimes(1)
  expect(mocks.cookies).toHaveBeenCalledTimes(1)
})

test('refresh remains uncached and does not replace the ordinary ambient result', async () => {
  async function ReadAroundRefresh() {
    const before = await getOverlaySession()
    const refreshed = await getOverlaySession(undefined, { refresh: true })
    const after = await getOverlaySession()
    return `${before?.user.id}|${refreshed?.user.id}|${after?.user.id}`
  }

  const result = await renderRequest('alice', ReadAroundRefresh)
  expect(result.body).toContain('alice|refreshed|alice')
  expect(mocks.getSession).toHaveBeenCalledTimes(1)
  expect(mocks.refreshSession).toHaveBeenCalledTimes(1)

  await getOverlaySession(undefined, { refresh: true })
  await getOverlaySession(undefined, { refresh: true })
  const explicit = new Request('https://preview.example.test/api/refresh', {
    headers: { cookie: 'overlay_session=explicit' },
  })
  await getOverlaySession(explicit, { refresh: true })
  expect(mocks.refreshSession).toHaveBeenCalledTimes(4)
  expect(mocks.refreshSession).toHaveBeenLastCalledWith(explicit)
  expect(mocks.getSession).toHaveBeenCalledTimes(1)
})

test('sessions without a valid user id or access token remain null', async () => {
  const invalidSessions = [
    null,
    { user: {}, accessToken: 'token' },
    { user: { id: 'alice' }, accessToken: '' },
  ]
  for (const invalid of invalidSessions) {
    mocks.getSession.mockResolvedValueOnce(invalid)
    expect(await getOverlaySession(new Request('https://preview.example.test/api/test'))).toBeNull()
  }
})

test('a provider without refresh support still performs an uncached read', async () => {
  mocks.hasRefresh = false
  await getOverlaySession()
  await getOverlaySession(undefined, { refresh: true })
  expect(mocks.getSession).toHaveBeenCalledTimes(2)
  expect(mocks.refreshSession).not.toHaveBeenCalled()
})

import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestCache: new Map<symbol, Promise<unknown>>(),
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
// Model React's request-scoped dispatcher; verify our cache routing, not React's implementation.
vi.mock('react', () => ({ cache: (read: () => Promise<unknown>) => {
  const key = Symbol()
  return () => {
    if (!mocks.requestCache.has(key)) mocks.requestCache.set(key, read())
    return mocks.requestCache.get(key)
  }
} }))

import { getOverlaySession } from './session'

const session = (id: string) => ({ user: { id, email: `${id}@example.test` }, accessToken: `${id}-test-token` })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestCache = new Map()
  mocks.hasRefresh = true
  mocks.headers.mockResolvedValue(new Headers({ host: 'preview.example.test' }))
  mocks.cookies.mockResolvedValue({ getAll: () => [{ name: 'overlay_session', value: 'synthetic' }] })
  mocks.getSession.mockResolvedValue(session('alice'))
  mocks.refreshSession.mockResolvedValue(session('refreshed'))
})

test('ordinary ambient callers share the request-scoped reader and retain session normalization', async () => {
  const [first, second] = await Promise.all([getOverlaySession(), getOverlaySession(undefined, { refresh: false })])
  expect(first).toBe(second)
  expect(first).toMatchObject({ user: { id: 'alice', emailVerified: false }, refreshToken: '', expiresAt: 0 })
  expect(mocks.getSession).toHaveBeenCalledTimes(1)
  expect(mocks.connection).toHaveBeenCalledTimes(1)
  expect(mocks.getSession.mock.calls[0][0].headers.get('cookie')).toBe('overlay_session=synthetic')
  mocks.requestCache = new Map()
  mocks.getSession.mockResolvedValue(session('bob'))
  expect((await getOverlaySession())?.user.id).toBe('bob')
  expect(mocks.getSession).toHaveBeenCalledTimes(2)
})

test('explicit requests bypass the ambient cache and dynamic rendering boundary', async () => {
  const request = new Request('https://preview.example.test/api/test')
  await getOverlaySession(request)
  await getOverlaySession(request)
  expect(mocks.getSession).toHaveBeenCalledTimes(2)
  expect(mocks.getSession).toHaveBeenNthCalledWith(1, request)
  expect(mocks.connection).not.toHaveBeenCalled()
  expect(mocks.headers).not.toHaveBeenCalled()
})

test('refresh stays uncached even after an ordinary ambient read', async () => {
  await getOverlaySession()
  expect((await getOverlaySession(undefined, { refresh: true }))?.user.id).toBe('refreshed')
  await getOverlaySession(undefined, { refresh: true })
  const explicit = new Request('https://preview.example.test/api/refresh')
  await getOverlaySession(explicit, { refresh: true })
  expect(mocks.refreshSession).toHaveBeenCalledTimes(3)
  expect(mocks.refreshSession).toHaveBeenLastCalledWith(explicit)
  expect(mocks.connection).toHaveBeenCalledTimes(3)
  expect(mocks.getSession).toHaveBeenCalledTimes(1)
})

test('unauthenticated sessions remain null', async () => {
  mocks.getSession.mockResolvedValue(null)
  expect(await getOverlaySession()).toBeNull()
})

test('a provider without refresh support still performs an uncached read', async () => {
  mocks.hasRefresh = false
  await getOverlaySession()
  await getOverlaySession(undefined, { refresh: true })
  expect(mocks.getSession).toHaveBeenCalledTimes(2)
  expect(mocks.refreshSession).not.toHaveBeenCalled()
})

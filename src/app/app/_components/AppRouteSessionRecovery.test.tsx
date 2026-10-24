import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { recoverAppRouteSession } from './AppRouteSessionRecovery'

test('a recovered session refreshes Files in place, preserving the workspace, query and hash', async (t) => {
  const destination = '/w/pr320-qa-solo/workspace/files?layout=grid#recent'
  let location = destination
  let refreshes = 0
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(input, '/api/auth/session')
    assert.equal(init?.credentials, 'same-origin')
    return Response.json({ authenticated: true, user: { id: 'user-1', email: 'qa@example.com' } })
  })
  await recoverAppRouteSession({
    isCurrent: () => true,
    refresh: () => { refreshes++ },
    signIn: () => { location = '/app/chat?signin=nav' },
  })
  assert.equal(refreshes, 1)
  assert.equal(location, destination)
})

test('a genuinely signed-out session retains the existing sign-in gate', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ authenticated: false }))
  let signIns = 0
  await recoverAppRouteSession({
    isCurrent: () => true,
    refresh: () => assert.fail('must not refresh an unauthenticated page'),
    signIn: () => { signIns++ },
  })
  assert.equal(signIns, 1)
})

test('transient recovery errors neither redirect nor refresh repeatedly', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => {
    requests++
    return new Response(null, { status: 503 })
  })
  await assert.rejects(recoverAppRouteSession({
    isCurrent: () => true,
    refresh: () => assert.fail('must not refresh'),
    signIn: () => assert.fail('must not redirect'),
  }), /Unable to refresh your session/)
  assert.equal(requests, 1)
})

test('recovery does not navigate after the user leaves the page', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ authenticated: false }))
  await recoverAppRouteSession({
    isCurrent: () => false,
    refresh: () => assert.fail('must not refresh another page'),
    signIn: () => assert.fail('must not redirect another page'),
  })
})

test('protected server pages defer the sign-in redirect until browser recovery settles', () => {
  for (const route of ['files', 'notes', 'tools', 'activity', 'archived', 'integrations', 'x/[...slug]']) {
    const source = readFileSync(new URL(`../${route}/page.tsx`, import.meta.url), 'utf8')
    assert.match(source, /if \(!session\) return <AppRouteSessionRecovery \/>/, route)
    assert.doesNotMatch(source, /redirect\('\/app\/chat\?signin=nav'\)/, route)
  }
})

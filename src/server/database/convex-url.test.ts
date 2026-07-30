import assert from 'node:assert/strict'
import test from 'node:test'
import {
  convexHostLabel,
  convexNetworkFailure,
  normalizeConvexUrl,
  resolveConvexUrl,
} from './convex-url'

const DEPLOYMENT = 'https://different-caiman-77.convex.cloud'

test('a URL pasted with whitespace, quotes, or a trailing slash still resolves', () => {
  for (const raw of [
    `  ${DEPLOYMENT}  `,
    `${DEPLOYMENT}/`,
    `${DEPLOYMENT}///`,
    `"${DEPLOYMENT}"`,
    `'${DEPLOYMENT}'`,
    `${DEPLOYMENT}\n`,
  ]) {
    const resolved = resolveConvexUrl({ NEXT_PUBLIC_CONVEX_URL: raw })
    assert.equal(resolved.url, DEPLOYMENT, `failed for ${JSON.stringify(raw)}`)
    assert.equal(resolved.invalid, undefined)
    assert.equal(resolved.source, 'NEXT_PUBLIC_CONVEX_URL')
  }
})

test('a value that is not a URL is reported as misconfiguration', () => {
  const resolved = resolveConvexUrl({ NEXT_PUBLIC_CONVEX_URL: 'different-caiman-77.convex.cloud' })
  assert.equal(resolved.url, undefined)
  assert.match(String(resolved.invalid), /not a valid absolute URL/)
  // The offending value is echoed so the fix is obvious from the message alone.
  assert.match(String(resolved.invalid), /different-caiman-77\.convex\.cloud/)
  assert.match(String(resolved.invalid), /NEXT_PUBLIC_CONVEX_URL/)
})

test('a non-http protocol is rejected with the protocol named', () => {
  const resolved = resolveConvexUrl({ NEXT_PUBLIC_CONVEX_URL: 'wss://different-caiman-77.convex.cloud' })
  assert.equal(resolved.url, undefined)
  assert.match(String(resolved.invalid), /http or https/)
  assert.match(String(resolved.invalid), /wss:/)
})

test('a doubled scheme is named, with the corrected value', () => {
  // This is what a dashboard field that pre-fills https:// produces, and it
  // parses successfully: host becomes "https" and the real host becomes a path.
  const resolved = resolveConvexUrl({ NEXT_PUBLIC_CONVEX_URL: `https://${DEPLOYMENT}` })
  assert.equal(resolved.url, undefined)
  assert.match(String(resolved.invalid), /contains two schemes/)
  assert.match(String(resolved.invalid), /use https:\/\/different-caiman-77\.convex\.cloud/)
})

test('a host that is only a scheme word is rejected', () => {
  for (const raw of ['https://https', 'http://https', 'https://wss']) {
    const resolved = resolveConvexUrl({ NEXT_PUBLIC_CONVEX_URL: raw })
    assert.equal(resolved.url, undefined, raw)
    assert.match(String(resolved.invalid), /scheme rather than a deployment/)
  }
})

test('self-hosted hosts without a dot still resolve', () => {
  // Docker service names and localhost are legitimate on-prem deployments.
  for (const raw of ['http://convex-backend:3210', 'http://localhost:3210']) {
    const resolved = resolveConvexUrl({ NEXT_PUBLIC_CONVEX_URL: raw })
    assert.equal(resolved.url, raw, raw)
    assert.equal(resolved.invalid, undefined)
  }
})

test('an unset or blank value is not treated as a misconfiguration', () => {
  assert.deepEqual(resolveConvexUrl({}), { source: 'unset' })
  assert.deepEqual(resolveConvexUrl({ NEXT_PUBLIC_CONVEX_URL: '   ' }), { source: 'unset' })
  assert.equal(normalizeConvexUrl(undefined), undefined)
})

test('development prefers the dev deployment and falls back to the shared one', () => {
  const both = resolveConvexUrl({
    DEV_NEXT_PUBLIC_CONVEX_URL: 'https://dev-deployment.convex.cloud',
    NEXT_PUBLIC_CONVEX_URL: DEPLOYMENT,
  }, { isDev: true })
  assert.equal(both.url, 'https://dev-deployment.convex.cloud')
  assert.equal(both.source, 'DEV_NEXT_PUBLIC_CONVEX_URL')

  const fallback = resolveConvexUrl({ NEXT_PUBLIC_CONVEX_URL: DEPLOYMENT }, { isDev: true })
  assert.equal(fallback.url, DEPLOYMENT)
  assert.equal(fallback.source, 'NEXT_PUBLIC_CONVEX_URL')

  // Production never reads the dev override.
  const production = resolveConvexUrl({
    DEV_NEXT_PUBLIC_CONVEX_URL: 'https://dev-deployment.convex.cloud',
  })
  assert.deepEqual(production, { source: 'unset' })
})

test('a transport failure names the host, the variable, and the call', () => {
  const failure = convexNetworkFailure({
    cause: new TypeError('fetch failed'),
    endpoint: `${DEPLOYMENT}/api/query`,
    path: 'admin/authorization:resolveSubject',
    source: 'NEXT_PUBLIC_CONVEX_URL',
    type: 'query',
  })
  // The bare "fetch failed" that reached the app shell must never recur.
  assert.notEqual(failure.message, 'fetch failed')
  assert.match(failure.message, /different-caiman-77\.convex\.cloud/)
  assert.match(failure.message, /NEXT_PUBLIC_CONVEX_URL/)
  assert.match(failure.message, /admin\/authorization:resolveSubject/)
  assert.match(failure.message, /fetch failed/)
  assert.ok(failure.cause instanceof TypeError)
})

test('an unparseable endpoint still produces a readable failure', () => {
  assert.equal(convexHostLabel('not a url'), 'the configured Convex deployment')
  const failure = convexNetworkFailure({
    cause: 'socket hang up',
    endpoint: 'not a url',
    path: 'probe:noop',
    source: 'unset',
    type: 'query',
  })
  assert.match(failure.message, /the configured Convex deployment/)
  assert.match(failure.message, /socket hang up/)
})

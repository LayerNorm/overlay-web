import assert from 'node:assert/strict'
import test from 'node:test'
import { CONFIG } from './preview-control.mjs'
import { PreviewPayments, PREVIEW_STRIPE_EVENTS, stripeTestClient, previewPaymentsFromVercel } from './preview-payments.mjs'

const backend = { name: 'test-backend-123', projectId: CONFIG.convexProjectId, deploymentType: 'preview',
  reference: 'preview/pr-123', previewIdentifier: 'pr-123' }
const endpoint = (patch = {}) => ({ id: 'we_fixture', livemode: false, status: 'enabled',
  url: 'https://test-backend-123.convex.site/stripe/webhook', enabled_events: PREVIEW_STRIPE_EVENTS,
  metadata: { overlayPreviewProject: String(CONFIG.convexProjectId), overlayPreviewPr: '123', overlayPreviewBackend: backend.name }, ...patch })
function fixture({ initial = [], owner = backend, loseDeleteResponse = false, keepDeleted = false } = {}) {
  let rows = initial.map(row => ({ ...row })); let state = {}; let creations = 0
  const calls = []
  const api = async (path, options = {}) => {
    calls.push({ path, ...options })
    if (path === '/webhook_endpoints' && !options.method) return { data: rows, has_more: false }
    if (path === '/webhook_endpoints' && options.method === 'POST') {
      creations++
      const row = rows[0] ?? endpoint()
      if (!rows.length) rows.push(row)
      return { ...row, secret: 'whsec_fixture' }
    }
    const id = path.split('/').at(-1)
    if (options.method === 'DELETE') {
      if (!keepDeleted) rows = rows.filter(row => row.id !== id)
      if (loseDeleteResponse) throw new Error('lost response')
      return { id, deleted: true }
    }
    const row = rows.find(row => row.id === id)
    if (!row) { const error = new Error('missing'); error.status = 404; throw error }
    if (options.method === 'POST') Object.assign(row, { enabled_events: PREVIEW_STRIPE_EVENTS, status: 'enabled' })
    return row
  }
  const payments = new PreviewPayments({ api, backends: { find: async () => owner } })
  const config = { readState: async () => state, saveState: async value => { state = value } }
  return { payments, calls, config, state: () => state, creations: () => creations }
}

test('test endpoint provisioning persists its secret and reuses it on rebuild', async () => {
  const f = fixture()
  assert.deepEqual(await f.payments.provision(123, f.config), { id: 'we_fixture', reused: false })
  assert.deepEqual(f.state(), { id: 'we_fixture', secret: 'whsec_fixture' })
  assert.deepEqual(await f.payments.provision(123, f.config), { id: 'we_fixture', reused: true })
  assert.equal(f.creations(), 1)
  const request = f.calls.find(call => call.method === 'POST')
  assert.equal(request.idempotencyKey, 'overlay-preview-123-test-backend-123')
  assert.equal(request.body.find(([key]) => key === 'metadata[overlayPreviewPr]')[1], '123')
})

test('a persisted endpoint with missing events is repaired and read back', async () => {
  const f = fixture({ initial: [endpoint({ enabled_events: [], status: 'disabled' })] })
  await f.config.saveState({ id: 'we_fixture', secret: 'whsec_existing' })
  await f.payments.provision(123, f.config)
  assert.equal(f.creations(), 0)
  assert.ok(f.calls.some(call => call.path.endsWith('/we_fixture') && call.method === 'POST'))
})

test('a lost persistence response recovers the original creation secret without duplicating endpoints', async () => {
  const f = fixture({ initial: [endpoint()] })
  await f.payments.provision(123, f.config)
  assert.equal(f.state().secret, 'whsec_fixture')
  assert.equal(f.creations(), 1)
})

test('cleanup verifies ownership, preserves foreign endpoints, and confirms deletion after a lost response', async () => {
  const foreign = endpoint({ id: 'we_foreign', metadata: { overlayPreviewProject: 'another-project', overlayPreviewPr: '123' } })
  const f = fixture({ initial: [endpoint(), foreign], loseDeleteResponse: true })
  await f.payments.remove(123)
  assert.deepEqual(f.calls.filter(call => call.method === 'DELETE').map(call => call.path), ['/webhook_endpoints/we_fixture'])
  await f.payments.remove(123)
})

test('cleanup rejects live, dev, production, cross-PR, and mismatched backend ownership before deletion', async () => {
  const cases = [
    { initial: [endpoint({ livemode: true })] },
    { initial: [endpoint({ url: 'https://colorful-chickadee-419.convex.site/stripe/webhook' })] },
    { initial: [endpoint({ metadata: { ...endpoint().metadata, overlayPreviewBackend: 'dev-backend' } })] },
    { initial: [endpoint()], owner: { ...backend, deploymentType: 'dev' } },
    { initial: [endpoint()], owner: { ...backend, name: CONFIG.convexProductionName } },
    { initial: [endpoint()], owner: { ...backend, reference: 'preview/pr-124' } },
    { initial: [endpoint()], owner: null },
  ]
  for (const options of cases) {
    const f = fixture(options)
    await assert.rejects(f.payments.remove(123))
    assert.ok(!f.calls.some(call => call.method === 'DELETE'))
  }
  const f = fixture({ initial: [endpoint()], keepDeleted: true })
  await assert.rejects(f.payments.remove(123), /deletion readback/)
})

test('provisioning refuses ambiguous endpoints and expired idempotency recovery removes only the new duplicate', async () => {
  const ambiguous = fixture({ initial: [endpoint(), endpoint({ id: 'we_other' })] })
  await assert.rejects(ambiguous.payments.provision(123, ambiguous.config), /Ambiguous/)
  const f = fixture({ initial: [endpoint()] })
  const delegate = f.payments.api
  f.payments.api = async (path, options = {}) => path === '/webhook_endpoints' && options.method === 'POST'
    ? endpoint({ id: 'we_duplicate', secret: 'whsec_duplicate' }) : delegate(path, options)
  await assert.rejects(f.payments.provision(123, f.config), /recovery expired/)
  assert.deepEqual(f.calls.filter(call => call.method === 'DELETE').map(call => call.path), ['/webhook_endpoints/we_duplicate'])
})

test('complete inventory follows cursor pages and rejects repeated or incomplete responses', async () => {
  const f = fixture()
  const calls = []
  f.payments.api = async (_path, options) => {
    calls.push(options.query)
    return calls.length === 1 ? { data: [endpoint()], has_more: true } : { data: [endpoint({ id: 'we_second' })], has_more: false }
  }
  assert.equal((await f.payments.list()).length, 2)
  assert.equal(calls[1].starting_after, 'we_fixture')
  f.payments.api = async () => ({ data: [], has_more: true })
  await assert.rejects(f.payments.list(), /incomplete/)
})

test('Stripe client refuses live credentials before any request and masks provider errors', async () => {
  let calls = 0
  const fetcher = async (url, options) => {
    calls++
    assert.equal(url.origin, 'https://api.stripe.com')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.authorization, 'Bearer rk_test_fixture')
    return { ok: false, status: 403, json: async () => ({ error: { message: 'must not appear: secret' } }) }
  }
  for (const key of ['sk_live_fixture', 'rk_live_fixture', '', undefined]) assert.throws(() => stripeTestClient(key, fetcher))
  assert.equal(calls, 0)
  const api = stripeTestClient('rk_test_fixture', fetcher)
  await assert.rejects(api('/webhook_endpoints'), error => error.message === 'Stripe Preview API 403')
  await assert.rejects(api('//attacker.test/'), /Invalid/)
  assert.equal(calls, 1)
})

test('controller reuses only the single Preview-scoped credential and never reads Production values', async () => {
  const paths = []
  const vercel = async path => {
    paths.push(path)
    return path.includes('/v10/') ? { envs: [{ id: 'env_preview', key: 'STRIPE_SECRET_KEY', target: ['preview'] },
      { id: 'env_prod', key: 'STRIPE_SECRET_KEY', target: ['production'] }] } : { value: 'rk_test_fixture' }
  }
  const payments = previewPaymentsFromVercel(vercel, {}, async () => ({ ok: true, json: async () => ({ data: [], has_more: false }) }))
  await payments.remove(123)
  assert.ok(paths.some(path => path.endsWith('/env/env_preview')))
  assert.ok(!paths.some(path => path.includes('env_prod')))
})

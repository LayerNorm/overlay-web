import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getGatewayCreditBalanceUsd,
  isGatewayCreditLow,
  markGatewayCreditLow,
  resetGatewayCreditCacheForTests,
} from './gateway-credits'

process.env.OVERLAY_HOSTED_PROVIDER_ACCESS_ENABLED = '1'
process.env.AI_GATEWAY_API_KEY = 'test-gateway-key'

function creditsResponse(balance: string): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ balance, total_used: '100.00' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

test('reports the USD balance parsed from /v1/credits', async () => {
  resetGatewayCreditCacheForTests()
  const fetchImpl = () => creditsResponse('2.50')
  assert.equal(await getGatewayCreditBalanceUsd(fetchImpl), 2.5)
  assert.equal(await isGatewayCreditLow(), true)
})

test('healthy balance is not low', async () => {
  resetGatewayCreditCacheForTests()
  const fetchImpl = () => creditsResponse('95.50')
  assert.equal(await getGatewayCreditBalanceUsd(fetchImpl), 95.5)
  assert.equal(await isGatewayCreditLow(), false)
})

test('balance exactly at the default 5 USD threshold is not low', async () => {
  resetGatewayCreditCacheForTests()
  const fetchImpl = () => creditsResponse('5.00')
  assert.equal(await getGatewayCreditBalanceUsd(fetchImpl), 5)
  assert.equal(await isGatewayCreditLow(), false)
})

test('honors the AI_GATEWAY_LOW_CREDIT_THRESHOLD_USD override', async () => {
  resetGatewayCreditCacheForTests()
  process.env.AI_GATEWAY_LOW_CREDIT_THRESHOLD_USD = '1'
  try {
    const fetchImpl = () => creditsResponse('2.50')
    assert.equal(await getGatewayCreditBalanceUsd(fetchImpl), 2.5)
    assert.equal(await isGatewayCreditLow(), false)
  } finally {
    delete process.env.AI_GATEWAY_LOW_CREDIT_THRESHOLD_USD
  }
})

test('caches the balance between checks', async () => {
  resetGatewayCreditCacheForTests()
  let calls = 0
  const fetchImpl = () => {
    calls += 1
    return creditsResponse('2.50')
  }
  await getGatewayCreditBalanceUsd(fetchImpl)
  await getGatewayCreditBalanceUsd(fetchImpl)
  assert.equal(calls, 1)
})

test('a 402 marks the cached balance as low until refresh', async () => {
  resetGatewayCreditCacheForTests()
  const fetchImpl = () => creditsResponse('95.50')
  assert.equal(await isGatewayCreditLow(undefined, fetchImpl), false)
  markGatewayCreditLow(process.env.AI_GATEWAY_API_KEY)
  assert.equal(await getGatewayCreditBalanceUsd(fetchImpl), 0)
  assert.equal(await isGatewayCreditLow(), true)
})

test('fails open when the credits endpoint errors', async () => {
  resetGatewayCreditCacheForTests()
  const fetchImpl = () => Promise.resolve(new Response('boom', { status: 500 }))
  assert.equal(await getGatewayCreditBalanceUsd(fetchImpl), null)
  assert.equal(await isGatewayCreditLow(), false)
})

test('fails open when fetch rejects', async () => {
  resetGatewayCreditCacheForTests()
  const fetchImpl = () => Promise.reject(new Error('network down'))
  assert.equal(await getGatewayCreditBalanceUsd(fetchImpl), null)
  assert.equal(await isGatewayCreditLow(), false)
})

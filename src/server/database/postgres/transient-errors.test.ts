import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isTransientPostgresError,
  withTransientPostgresReadRetry,
} from './transient-errors'

test('transient Postgres error detection follows nested causes and connection codes', () => {
  assert.equal(isTransientPostgresError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })), true)
  assert.equal(isTransientPostgresError(new Error('server closed the connection unexpectedly')), true)
  assert.equal(isTransientPostgresError(new Error('validation failed')), false)
  assert.equal(isTransientPostgresError(new Error('wrapped', {
    cause: Object.assign(new Error('failover'), { code: '57P01' }),
  })), true)
})

test('read retry applies bounded retry only to transient failures', async () => {
  let attempts = 0
  const delays: number[] = []
  const result = await withTransientPostgresReadRetry(async () => {
    attempts += 1
    if (attempts < 3) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    return 'recovered'
  }, {
    baseDelayMs: 10,
    maximumDelayMs: 20,
    random: () => 0.5,
    sleep: async (ms) => { delays.push(ms) },
  })

  assert.equal(result, 'recovered')
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [10, 20])

  await assert.rejects(
    withTransientPostgresReadRetry(async () => {
      throw new Error('invalid query')
    }, { sleep: async () => {} }),
    /invalid query/,
  )
})

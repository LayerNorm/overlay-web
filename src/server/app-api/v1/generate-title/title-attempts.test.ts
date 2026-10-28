import assert from 'node:assert/strict'
import test from 'node:test'
import { runTitleAttempts } from './title-attempts'

test('returns the first title without another attempt', async () => {
  let calls = 0
  const result = await runTitleAttempts(async () => {
    calls++
    return 'Ocean Tides'
  }, { maxAttempts: 3, budgetMs: 12_000 })

  assert.deepEqual(result, { title: 'Ocean Tides', failed: false })
  assert.equal(calls, 1)
})

test('continues after a null result', async () => {
  let calls = 0
  const result = await runTitleAttempts(async () => {
    calls++
    return calls === 1 ? null : 'Ocean Tides'
  }, { maxAttempts: 3, budgetMs: 12_000 })

  assert.deepEqual(result, { title: 'Ocean Tides', failed: false })
  assert.equal(calls, 2)
})

test('continues after a thrown attempt and reports the error', async () => {
  let calls = 0
  const thrown = new Error('provider failed')
  const errors: unknown[] = []
  const result = await runTitleAttempts(async () => {
    calls++
    if (calls === 1) throw thrown
    return 'Ocean Tides'
  }, {
    maxAttempts: 3,
    budgetMs: 12_000,
    onError: (error) => errors.push(error),
  })

  assert.deepEqual(result, { title: 'Ocean Tides', failed: false })
  assert.equal(calls, 2)
  assert.deepEqual(errors, [thrown])
})

test('returns null after exactly the maximum number of null attempts', async () => {
  let calls = 0
  const result = await runTitleAttempts(async () => {
    calls++
    return null
  }, { maxAttempts: 3, budgetMs: 12_000 })

  assert.deepEqual(result, { title: null, failed: false })
  assert.equal(calls, 3)
})

test('marks the outcome failed only when the last attempt throws', async () => {
  let calls = 0
  const result = await runTitleAttempts(async () => {
    calls++
    if (calls === 3) throw new Error('last attempt failed')
    return null
  }, { maxAttempts: 3, budgetMs: 12_000 })

  assert.deepEqual(result, { title: null, failed: true })
  assert.equal(calls, 3)
})

test('stops before starting an attempt after the time budget expires', async () => {
  let currentTime = 0
  let calls = 0
  const result = await runTitleAttempts(async () => {
    calls++
    currentTime = 12_000
    return null
  }, { maxAttempts: 3, budgetMs: 12_000, now: () => currentTime })

  assert.deepEqual(result, { title: null, failed: false })
  assert.equal(calls, 1)
})

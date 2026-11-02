import { expect, test } from 'vitest'
import { start, resumeHook } from 'workflow/api'
import { waitForHook, waitForSleep } from '@workflow/vitest'
import { grantResourceFixture, humanResourceWaitFixture, readResourceFixture, resourceBoundaryFixture, resourceWaitFixture } from './resource-wait-fixture'

test('resource polling survives SDK replay and lost wake delivery without trusting a hook payload', async () => {
  const id = crypto.randomUUID()
  const run = await start(resourceWaitFixture, [{ id }])
  await waitForHook(run, { token: `resource:${id}` })
  const timer = await waitForSleep(run)
  expect(await readResourceFixture(id)).toEqual(['completed-step', 'published', 'pending'])

  await resumeHook(`resource:${id}`, { approved: true, maxCostMicros: 100_000_000 })
  await expect.poll(async () => (await readResourceFixture(id)).filter(event => event === 'pending').length, { timeout: 15_000 }).toBe(2)
  expect((await readResourceFixture(id)).includes('consumed')).toBe(false)

  // The grant commits without any hook wake. The retained timer must recover it.
  await grantResourceFixture(id)
  await run.wakeUp({ correlationIds: [timer] })
  expect(await run.returnValue).toBe('consumed')
  expect(await readResourceFixture(id)).toEqual(['completed-step', 'published', 'pending', 'pending', 'consumed'])
}, 60_000)

test('resource boundary resumes from its retained timer after an authoritative fake grant', async () => {
  const id = crypto.randomUUID()
  const run = await start(resourceBoundaryFixture, [{ id }])
  await waitForHook(run, { token: `resource:${id}` })
  const timer = await waitForSleep(run)
  expect(await readResourceFixture(id)).toEqual(['completed-step', 'published', 'pending'])

  await grantResourceFixture(id)
  await run.wakeUp({ correlationIds: [timer] })

  const state = await run.returnValue
  expect(state.status).toBe('running')
  expect(state.runId).toBe(id)
  expect(state.policy).toMatchObject({ actorUserId: 'fixture', resourcePauseVersion: 1, maxCostMicros: 10 })
  expect(state.policy.deadlineAt).toBeGreaterThan(Date.now())
  const events = await readResourceFixture(id)
  expect(events.filter(event => event === 'completed-step')).toHaveLength(1)
  expect(events.filter(event => event === 'published')).toHaveLength(1)
  expect(events.filter(event => event === 'consumed')).toHaveLength(1)
}, 60_000)

test('human reply stays buffered until the retained resource timer observes authorization', async () => {
  const id = crypto.randomUUID()
  const inputToken = `input:${id}`
  const run = await start(humanResourceWaitFixture, [{ id }])
  await waitForHook(run, { token: inputToken })
  await waitForHook(run, { token: `resource:${id}` })
  const timer = await waitForSleep(run)
  expect(await readResourceFixture(id)).toEqual(['completed-step', 'published', 'pending'])

  await resumeHook(inputToken, { text: 'The original film' })
  expect(await readResourceFixture(id)).not.toContain('reply-delivered')

  await grantResourceFixture(id)
  await run.wakeUp({ correlationIds: [timer] })

  expect(await run.returnValue).toEqual({ text: 'The original film' })
  const events = await readResourceFixture(id)
  for (const event of ['completed-step', 'published', 'consumed', 'reply-delivered']) {
    expect(events.filter(item => item === event)).toHaveLength(1)
  }
}, 60_000)

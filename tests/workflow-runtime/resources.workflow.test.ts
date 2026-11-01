import { expect, test } from 'vitest'
import { start, resumeHook } from 'workflow/api'
import { waitForHook, waitForSleep } from '@workflow/vitest'
import { grantResourceFixture, readResourceFixture, resourceWaitFixture } from './resource-wait-fixture'

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

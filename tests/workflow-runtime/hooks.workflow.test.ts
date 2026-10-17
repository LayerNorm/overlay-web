import { expect, test } from 'vitest'
import { start, resumeHook, getRun } from 'workflow/api'
import { waitForHook, waitForSleep } from '@workflow/vitest'
import { lifecycleHookFixture } from './lifecycle'

test('4.8.9 registers before dispatch, persists a decision, replays, and wakes a durable deadline', async () => {
  const id = crypto.randomUUID()
  const run = await start(lifecycleHookFixture, [{ id }])
  const hook = await waitForHook(run, { token: `fixture:${id}` })
  await resumeHook(hook.token, { revision: 7, decision: 'allow' })
  const timer = await waitForSleep(run)
  await getRun(run.runId).wakeUp({ correlationIds: [timer] })
  expect(await run.returnValue).toBe('7:allow')
}, 60_000)

test('duplicate hook tokens detect the owner and cannot consume its decision', async () => {
  const id = crypto.randomUUID()
  const owner = await start(lifecycleHookFixture, [{ id }])
  await waitForHook(owner, { token: `fixture:${id}` })
  const loser = await start(lifecycleHookFixture, [{ id }])
  expect(await loser.returnValue).toBe('duplicate')
  await resumeHook(`fixture:${id}`, { revision: 8, decision: 'deny' })
  const timer = await waitForSleep(owner)
  await owner.wakeUp({ correlationIds: [timer] })
  expect(await owner.returnValue).toBe('8:deny')
}, 60_000)

import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { resumeHook, start } from 'workflow/api'
import { waitForHook } from '@workflow/vitest'
import {
  grantHarnessFundingFixture, harnessFundingFixture, initializeHarnessFundingFixture,
  readHarnessFundingEvents, readHarnessFundingFixture,
} from './harness-funding-fixture'

test('compiled v2 funding wait renews its lease and resumes the same persisted task after a wake', async () => {
  const id = randomUUID()
  await initializeHarnessFundingFixture(id)
  expect((await readHarnessFundingFixture(id)).resourcePause).toMatchObject({
    requiredCents: 38.96, availableCents: 0.98, reservedCents: 0.02,
  })
  const run = await start(harnessFundingFixture, [{ id }])
  const token = `harness-funding:${id}`
  await waitForHook(run, { token })
  await grantHarnessFundingFixture(id)
  await resumeHook(token, { funded: true })

  await expect(run.returnValue).resolves.toEqual({ runId: id, receiptId: 'model:4', status: 'running' })
  const state = await readHarnessFundingFixture(id)
  expect(state).toMatchObject({ runId: id, status: 'running' })
  expect(state.resourcePause).toBeUndefined()
  expect(await readHarnessFundingEvents(id)).toEqual(['lease-renewed'])
})

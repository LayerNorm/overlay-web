import assert from 'node:assert/strict'
import test from 'node:test'
import { createSingleFlightReconciler } from './single-flight-reconciler'

test('single-flight reconciler suppresses overlap and respects visibility', async () => {
  let visible = true
  let release: (() => void) | undefined
  let runs = 0
  const reconciler = createSingleFlightReconciler({
    reconcile: async () => {
      runs += 1
      await new Promise<void>((resolve) => { release = resolve })
    },
    shouldRun: () => visible,
  })

  const first = reconciler.trigger()
  assert.equal(await reconciler.trigger(), false)
  assert.equal(runs, 1)
  release?.()
  assert.equal(await first, true)

  visible = false
  assert.equal(await reconciler.trigger(), false)
  assert.equal(runs, 1)

  reconciler.dispose()
  visible = true
  assert.equal(await reconciler.trigger(), false)
})

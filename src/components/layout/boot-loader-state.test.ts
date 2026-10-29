import assert from 'node:assert/strict'
import test from 'node:test'
import { createBootAppShownFlag, createBootEntranceClaim } from './boot-loader-state'

test('the brand entrance plays on the first loader only', () => {
  const entrance = createBootEntranceClaim()
  assert.equal(entrance.wasPlayed(), false)
  entrance.markPlayed()
  assert.equal(entrance.wasPlayed(), true)
})

test('the app-shown flag flips only after the app rendered once', () => {
  const appShown = createBootAppShownFlag()
  assert.equal(appShown.wasShown(), false)
  appShown.markShown()
  assert.equal(appShown.wasShown(), true)
})

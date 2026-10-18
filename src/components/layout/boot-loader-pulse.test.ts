import assert from 'node:assert/strict'
import test from 'node:test'
import { createBootAppShownFlag, createBootEntranceClaim, createBootLoaderPulseClock } from './boot-loader-pulse'

test('a replacement loader keeps the first pulse origin instead of restarting its delay', () => {
  const synchronize = createBootLoaderPulseClock()
  const first = { startTime: 100 }
  synchronize(first, 300)
  const replacement = { startTime: 1700 }
  synchronize(replacement, 1700)
  assert.equal(first.startTime, 100)
  assert.equal(replacement.startTime, 100)
})

test('an unresolved first animation starts from the document timeline and retains zero', () => {
  const synchronize = createBootLoaderPulseClock()
  const first: Pick<Animation, 'startTime'> = { startTime: null }
  synchronize(first, 0)
  const replacement = { startTime: 2000 }
  synchronize(replacement, 2000)
  assert.equal(first.startTime, 0)
  assert.equal(replacement.startTime, 0)
})

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

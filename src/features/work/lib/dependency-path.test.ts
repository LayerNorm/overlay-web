import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dependencyPath } from './dependency-path'
test('arrows reroute when bars move, including overlapping and reverse dates', () => {
  const forward = dependencyPath({ x: 100, y: 20 }, { x: 200, y: 60 })
  assert.equal(forward, 'M 100 20 H 112 V 60 H 200')
  const moved = dependencyPath({ x: 220, y: 20 }, { x: 200, y: 60 })
  assert.match(moved, /^M 220 20/)
  assert.match(moved, /V 4/)
  assert.match(moved, /H 200$/)
  assert.notEqual(moved, forward)
  assert.throws(() => dependencyPath({ x: NaN, y: 0 }, { x: 0, y: 0 }))
})

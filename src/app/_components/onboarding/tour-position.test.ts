import assert from 'node:assert/strict'
import test from 'node:test'
import { tourPosition } from './tour-position'

test('desktop tour sits beside the target and remains in the viewport', () => {
  const target = { left: 12, right: 220, top: 200, bottom: 232 }
  assert.deepEqual(tourPosition(target, { width: 1280, height: 800 }, { width: 320, height: 200 }, false), { left: 232, top: 116, width: 320 })
  assert.equal(tourPosition({ ...target, top: 750, bottom: 782 }, { width: 1280, height: 800 }, { width: 320, height: 200 }, false).top, 588)
})

test('mobile tour fits below the target and clamps near the bottom edge', () => {
  assert.deepEqual(tourPosition({ left: 12, right: 260, top: 200, bottom: 232 }, { width: 390, height: 844 }, { width: 248, height: 220 }, true), { left: 12, top: 244, width: 248 })
  assert.deepEqual(tourPosition({ left: 12, right: 260, top: 700, bottom: 732 }, { width: 320, height: 800 }, { width: 320, height: 220 }, true), { left: 12, top: 568, width: 296 })
})
